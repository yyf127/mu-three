/**
 * 环境粒子（氛围 / 天气）：照 0.97k 客户端的 `Weather_Update`（0x00500E80）搬过来的。
 *
 * 源码按 **World** 决定刷什么（见 `src/Render/Weather.cpp` 的 `switch (World)`）：
 *
 * | World | 类型 | 源码常量 | 说明 |
 * |---|---|---|---|
 * | 0 洛兰 | 0xae | 云 / **飞鸟** | `Rise→Hover→Descend→Fade` 四段生命周期，`FixPigeons` 说的就是它 |
 * | 1 / 4 | 0xb0 | 雨 | 进图过渡态，进场后不刷 |
 * | 3 诺利亚 | 0xaf | 雪花 / 花瓣 | `scale = 0.3`，正弦横向漂移，贴地后回弹 |
 * | 10 天空之城 | 0x10a | 萤火 / 浮游光点 | `scale = 2.2`，`x += sin(φ)·s`、`y -= cos(φ)·s` 的圆周游走 |
 * | 11..16 血色城堡 | 0xb8 | 落叶 | 与云共用生命周期，落地后消失 |
 * | 7 亚特兰蒂斯 | 0xb6 / 0xb7 | 跃鱼 | 只在南半场（`y·0.01 < 128`）刷，本实现暂缺 |
 *
 * 源码的刷怪规则很「跟屁虫」：粒子永远在主角 **±5.12 m** 的方框里生成
 * （`rand & 0x3ff - 0x200`，单位是 cm），离主角超过 15 m（`_DAT_00552d24`）就回收。
 * 所以这里也做「跟着主角走、超出半径就重生」，不做全局铺满 —— 效果一样、开销恒定。
 *
 * 三类表现：
 *   - 漂移（雪 / 花瓣 / 落叶）：`THREE.Points` 点精灵，一次 draw call；
 *   - 萤火：同一套点精灵，换加色混合；
 *   - 飞鸟：`Bird01.bmd` 蒙皮网格（20 骨、6 帧扇翅），绕主角盘旋。
 */
import * as THREE from 'three';
import { parseBmd } from '../core/bmd';
import {
  MODEL_SCALE,
  Rig,
  applyActionPose,
  buildGeometry,
  createRig,
  getBmdMaterial,
} from '../core/model';
import { fetchBytes, loadTexture } from '../core/texture';
import { modelBlend } from '../core/blendHeuristic';
import { mapObjectDir } from './maps';
import { additiveProps, fxAlpha } from '../core/additive';

export type AmbientKind = 'snow' | 'petal' | 'leaf' | 'firefly' | 'bird';

/** World → 氛围粒子种类（照抄 `Weather_Update` 的 `switch (World)`） */
export const AMBIENT_BY_MAP: Record<number, AmbientKind[]> = {
  0: ['bird'],
  3: ['petal'],
  10: ['firefly'],
};

/** 血色城堡 11..16 共用一张表（0xb8 落叶） */
for (let id = 11; id <= 16; id++) AMBIENT_BY_MAP[id] = ['leaf'];

interface DriftDef {
  kind: 'snow' | 'petal' | 'leaf' | 'rain';
  count: number;
  /** 单颗粒子尺寸（米） */
  size: number;
  color: number;
  /** 下落速度（米/秒） */
  fall: number;
  /** 横向漂移速度（米/秒） */
  drift: number;
  /** 生成高度（主角 z 以上，米） */
  top: number;
  /** 以主角为中心的散布半径（米） */
  spread: number;
}

const DRIFT: Record<'snow' | 'petal' | 'leaf' | 'rain', DriftDef> = {
  /*
   * 雨 —— 原版是 0xb0（雨滴）。服务端 `0x0F` 的高半字节是天气类型
   * （0 = 晴、1 = 雨），低半字节是强度（`RainTarget = 6 * intensity`）。
   * 这里按强度调透明度/数量，落速比雪快一个量级。
   */
  rain: { kind: 'rain', count: 240, size: 0.13, color: 0xbdd8ff, fall: 22, drift: 0.2, top: 13, spread: 12 },
  // 源码 0xaf：scale 0.3、`rand()%15-7` 的横向抖动、贴地后速度反向
  snow: { kind: 'snow', count: 120, size: 0.19, color: 0xffffff, fall: 1.1, drift: 0.5, top: 14, spread: 13 },
  petal: { kind: 'petal', count: 110, size: 0.3, color: 0xfff2f6, fall: 0.75, drift: 0.9, top: 12, spread: 13 },
  // 源码 0xb8：落叶比雪大、转得快
  leaf: { kind: 'leaf', count: 90, size: 0.34, color: 0xd8c68a, fall: 1.5, drift: 1.1, top: 13, spread: 13 },
};

/* ------------------------------------------------------------------ */
/* 点精灵贴图（程序生成，原版没有对应的 OZJ 可复用）                    */
/* ------------------------------------------------------------------ */

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  draw(g, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** 软边圆点：雪花 / 萤火 */
function dotTexture(hard = 0.0) {
  return canvasTexture(64, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, s * hard, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.85)');
    grd.addColorStop(0.78, 'rgba(255,255,255,0.25)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  });
}

/** 花瓣：上宽下尖的小椭圆 */
function petalTexture() {
  return canvasTexture(64, (g, s) => {
    g.translate(s / 2, s / 2);
    g.rotate(-0.5);
    g.beginPath();
    g.ellipse(0, 0, s * 0.42, s * 0.24, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.98)';
    g.fill();
    g.globalCompositeOperation = 'destination-in';
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.44);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.8, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(-s / 2, -s / 2, s, s);
  });
}

/** 落叶：细长的尖头叶片 */
function leafTexture() {
  return canvasTexture(64, (g, s) => {
    g.translate(s / 2, s / 2);
    g.rotate(-0.7);
    g.beginPath();
    g.moveTo(0, -s * 0.44);
    g.quadraticCurveTo(s * 0.3, 0, 0, s * 0.44);
    g.quadraticCurveTo(-s * 0.3, 0, 0, -s * 0.44);
    g.closePath();
    g.fillStyle = 'rgba(255,255,255,0.97)';
    g.fill();
    // 中脉留一道浅缝，远看更像叶子
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.moveTo(0, -s * 0.4);
    g.lineTo(0, s * 0.4);
    g.lineWidth = s * 0.05;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.stroke();
  });
}

const POINT_VERT = `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(-mv.z, 0.2);
  gl_Position = projectionMatrix * mv;
}
`;

const POINT_FRAG = `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uTint;      // 整体透明度倍率（雨强度用，默认 1）
varying float vAlpha;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha * uTint;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

/* ------------------------------------------------------------------ */
/* 漂移粒子                                                            */
/* ------------------------------------------------------------------ */

interface Drift {
  x: number;
  y: number;
  z: number;
  vy: number;
  phase: number;
  /** 横向摆动幅度 / 频率 */
  amp: number;
  freq: number;
  size: number;
}

class DriftField {
  readonly points: THREE.Points;
  private drifts: Drift[] = [];
  private pos: Float32Array;
  private alpha: Float32Array;
  private geo: THREE.BufferGeometry;

  constructor(
    private def: DriftDef,
    tex: THREE.Texture,
    private getHeight: (x: number, y: number) => number
  ) {
    const n = def.count;
    this.pos = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    const size = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      size[i] = def.size * (0.7 + Math.random() * 0.7);
      this.drifts.push({
        x: 0,
        y: 0,
        z: -999,
        vy: def.fall * (0.75 + Math.random() * 0.6),
        phase: Math.random() * Math.PI * 2,
        amp: def.drift * (0.5 + Math.random() * 0.9),
        freq: 0.6 + Math.random() * 1.2,
        size: size[i],
      });
    }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex },
        uColor: { value: new THREE.Color(def.color) },
        uScale: { value: 500 },
        uTint: { value: 1 },
      },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.name = `ambient:${def.kind}`;
  }

  private respawn(d: Drift, cx: number, cy: number, cz: number, first: boolean) {
    const s = this.def.spread;
    d.x = cx + (Math.random() - 0.5) * 2 * s;
    d.y = cy + (Math.random() - 0.5) * 2 * s;
    // 初次铺满整个高度带，之后都从顶上重新落下来
    d.z = cz + (first ? Math.random() * this.def.top : this.def.top * (0.85 + Math.random() * 0.3));
  }

  /** 落速倍率（雨强度用：越大越密越快） */
  private speedScale = 1;

  setSpeedScale(k: number) {
    this.speedScale = Math.max(0.1, k);
  }

  /** 整体透明度倍率（0 = 看不见）。ShaderMaterial 不认 `.opacity`，得走 uniform */
  setTint(k: number) {
    const u = (this.points.material as THREE.ShaderMaterial).uniforms?.uTint;
    if (u) u.value = Math.max(0, Math.min(1, k));
  }

  update(dt: number, cx: number, cy: number, cz: number, scale: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = scale;
    const arr = this.pos;
    const s = this.def.spread;
    for (let i = 0; i < this.drifts.length; i++) {
      const d = this.drifts[i];
      if (d.z < -900 || Math.abs(d.x - cx) > s * 1.3 || Math.abs(d.y - cy) > s * 1.3) {
        const first = d.z < -900;
        this.respawn(d, cx, cy, cz, first);
        if (!first) d.z = cz + this.def.top;
      }

      d.phase += dt * d.freq;
      d.x += Math.sin(d.phase) * d.amp * dt;
      d.y += Math.cos(d.phase * 0.7) * d.amp * 0.6 * dt;
      d.z -= d.vy * this.speedScale * dt;

      const ground = this.getHeight(d.x, d.y) + 0.15;
      if (d.z < ground) {
        // 源码：雪花贴地后 `Vel *= 0.25 + 1.0` 反弹一下再继续落，
        // 这里直接重生到头顶，避免在地面上堆一片白点
        d.z = cz + this.def.top * (0.9 + Math.random() * 0.2);
        d.x = cx + (Math.random() - 0.5) * 2 * s;
        d.y = cy + (Math.random() - 0.5) * 2 * s;
      }

      const o = i * 3;
      arr[o] = d.x;
      arr[o + 1] = d.y;
      arr[o + 2] = d.z;
      // 越远越淡，避免远处糊成一片
      this.alpha[i] = 0.85;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* 萤火（0x10a）                                                        */
/* ------------------------------------------------------------------ */

class FireflyField {
  readonly points: THREE.Points;
  private bugs: { cx: number; cy: number; z: number; phase: number; speed: number; radius: number }[] = [];
  private pos: Float32Array;
  private alpha: Float32Array;
  private geo: THREE.BufferGeometry;

  constructor(
    private count: number,
    tex: THREE.Texture,
    private getHeight: (x: number, y: number) => number
  ) {
    this.pos = new Float32Array(count * 3);
    this.alpha = new Float32Array(count);
    const size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      size[i] = 0.22 + Math.random() * 0.14;
      this.bugs.push({
        cx: 0,
        cy: 0,
        z: -999,
        phase: Math.random() * Math.PI * 2,
        // 源码 scale = 2.2，会随正弦变化
        speed: 0.8 + Math.random() * 0.9,
        radius: 1.2 + Math.random() * 2.2,
      });
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex },
        uColor: { value: new THREE.Color(0xffe9a8) },
        uScale: { value: 500 },
      },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      ...additiveProps(),
      fog: false,
      // 原版 GL_SetBlendAdditive 会 glDisable(GL_FOG)：加色特效不吃雾
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.name = 'ambient:firefly';
  }

  update(dt: number, cx: number, cy: number, cz: number, scale: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = scale;
    for (let i = 0; i < this.bugs.length; i++) {
      const b = this.bugs[i];
      if (b.z < -900 || Math.abs(b.cx - cx) > 22 || Math.abs(b.cy - cy) > 22) {
        b.cx = cx + (Math.random() - 0.5) * 26;
        b.cy = cy + (Math.random() - 0.5) * 26;
        b.z = this.getHeight(b.cx, b.cy) + 1.2 + Math.random() * 2.2;
      }
      // 源码：pos_x += sin(φ)·s、pos_y -= cos(φ)·s，φ 按帧推进 → 圆周游走
      b.phase += dt * b.speed;
      b.cx += Math.sin(b.phase) * b.radius * dt;
      b.cy -= Math.cos(b.phase) * b.radius * dt;
      b.z += Math.sin(b.phase * 2.3) * dt * 0.6;

      const o = i * 3;
      this.pos[o] = b.cx;
      this.pos[o + 1] = b.cy;
      this.pos[o + 2] = b.z;
      // 呼吸闪烁
      this.alpha[i] = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(b.phase * 3.1));
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* 飞鸟（0xae）                                                         */
/* ------------------------------------------------------------------ */

interface Bird {
  holder: THREE.Group;
  rig: Rig;
  phase: number;
  radius: number;
  /** 相对地面的高度 */
  height: number;
  speed: number;
  frame: number;
  flap: number;
}

/** Bird01 的局部朝向修正（模型正面在 +X 侧，绕 Z 转 -90° 让 +Y 面朝飞行方向） */
const BIRD_YAW_OFFSET = -Math.PI / 2;

/* ------------------------------------------------------------------ */
/* 对外                                                                */
/* ------------------------------------------------------------------ */

export interface AmbientStats {
  kind: AmbientKind;
  count: number;
}

export interface AmbientLayer {
  group: THREE.Group;
  stats: AmbientStats[];
  /**
   * 下雨强度（0 = 停，1 = 最大）。服务端 `0x0F` 天气包驱动，
   * 原版 `Weather_Update` 里 `RainTarget = 6 * intensity`。
   */
  setRain(intensity: number): void;
  /** 当前雨强度 0..1 */
  rainLevel(): number;
  /**
   * @param scale 点精灵换算系数 = 视口高度 / (2·tan(fov/2))
   */
  update(dt: number, cx: number, cy: number, cz: number, scale: number): void;
  dispose(): void;
}

export async function createAmbient(
  mapId: number,
  getHeight: (x: number, y: number) => number
): Promise<AmbientLayer> {
  const kinds = AMBIENT_BY_MAP[mapId] ?? [];
  const group = new THREE.Group();
  group.name = 'ambient';
  const stats: AmbientStats[] = [];

  const drifts: DriftField[] = [];
  let fireflies: FireflyField | null = null;
  const birds: Bird[] = [];
  const birdRigs: Rig[] = [];
  const birdMaterials: THREE.Material[] = [];
  const birdGeometries: THREE.BufferGeometry[] = [];
  const disposables: { dispose(): void }[] = [];

  for (const kind of kinds) {
    if (kind === 'snow' || kind === 'petal' || kind === 'leaf') {
      const def = DRIFT[kind];
      const tex =
        kind === 'petal' ? petalTexture() : kind === 'leaf' ? leafTexture() : dotTexture(0.15);
      disposables.push(tex);
      const field = new DriftField(def, tex, getHeight);
      drifts.push(field);
      group.add(field.points);
      stats.push({ kind, count: def.count });
    } else if (kind === 'firefly') {
      const tex = dotTexture(0);
      disposables.push(tex);
      fireflies = new FireflyField(18, tex, getHeight);
      group.add(fireflies.points);
      stats.push({ kind, count: 18 });
    } else if (kind === 'bird') {
      const dir = mapObjectDir(mapId);
      let bytes: Uint8Array | null = null;
      for (const name of ['Bird01', 'Bird02']) {
        try {
          bytes = await fetchBytes(`${dir}${name}.bmd`);
          break;
        } catch {
          /* 换下一个候选名 */
        }
      }
      if (!bytes) {
        console.warn('[ambient] 找不到飞鸟模型，跳过');
        continue;
      }
      const bmd = parseBmd(bytes);

      for (const mesh of bmd.meshes) {
        const tex = await loadTexture(dir, mesh.texturePath);
        birdGeometries.push(
          buildGeometry(mesh, { scale: MODEL_SCALE, boneIndexRemap: (i: number) => i })
        );
        const mb = modelBlend(tex?.texture ?? null, tex?.tag === 'blend', mesh.texturePath);
        birdMaterials.push(
          getBmdMaterial(tex?.texture ?? null, mb.cutout, true, mb.additive, mb.soft)
        );
      }

      /*
       * 每只鸟一套骨架：共用骨架的话 8 只翅膀会完全同拍，很假。
       * 一只鸟 20 根骨、6 个实例也就 120 个骨骼矩阵/帧，比场景物件便宜得多。
       */
      const BIRD_COUNT = 6;
      for (let i = 0; i < BIRD_COUNT; i++) {
        const rig = createRig(bmd, MODEL_SCALE);
        birdRigs.push(rig);

        const holder = new THREE.Group();
        holder.name = `ambient:bird:${i}`;
        for (let m = 0; m < birdGeometries.length; m++) {
          const sm = new THREE.SkinnedMesh(birdGeometries[m], birdMaterials[m]);
          sm.bindMode = THREE.DetachedBindMode;
          sm.bind(rig.skeleton, new THREE.Matrix4());
          sm.frustumCulled = false;
          sm.matrixAutoUpdate = false;
          sm.updateMatrix();
          holder.add(sm);
        }
        group.add(holder);
        birds.push({
          holder,
          rig,
          phase: (i / BIRD_COUNT) * Math.PI * 2 + Math.random() * 0.6,
          /*
           * 半径/高度要配合相机：本作是 40° 俯角、36° FOV 的第三人称，
           * 屏幕上方只到「地平线上一点」。原版鸽子就在主角 ±5 m 内绕圈，
           * 这里取半径 4..7 m、离地 2..4 m，正好落在画面中上部。
           */
          radius: 4 + Math.random() * 3,
          height: 2 + Math.random() * 2,
          // 源码 0xae 的盘旋是 6..8 度/帧（≈0.8 rad/s），这里取稍慢一点
          speed: 0.35 + Math.random() * 0.3,
          frame: Math.random() * 6,
          flap: 0.4 + Math.random() * 0.15,
        });
        // Bird01 原始身长只有 0.36 m，贴着相机飞也才几个像素，放大一点更接近「鸽子」的观感
        holder.scale.setScalar(1.5);
      }
      stats.push({ kind: 'bird', count: birds.length });
    }
  }

  let time = 0;

  function update(dt: number, cx: number, cy: number, cz: number, scale: number) {
    time += dt;
    for (const f of drifts) f.update(dt, cx, cy, cz, scale);
    if (rain.points.visible) rain.update(dt, cx, cy, cz, scale);
    fireflies?.update(dt, cx, cy, cz, scale);

    for (const b of birds) {
      b.phase += dt * b.speed;
      const x = cx + Math.cos(b.phase) * b.radius;
      const y = cy + Math.sin(b.phase) * b.radius;
      // 切向角：对圆求导 = phase + 90°
      const heading = b.phase + Math.PI / 2;
      b.holder.position.set(x, y, getHeight(x, y) + b.height + Math.sin(time * 0.8 + b.phase) * 0.35);
      b.holder.rotation.set(0, 0, heading + BIRD_YAW_OFFSET);

      b.frame += b.flap * 25 * Math.min(dt, 0.1);
      if (b.frame >= 6) b.frame %= 6;
      applyActionPose(b.rig, 0, b.frame, true);
      b.rig.root.updateMatrixWorld(true);
      b.rig.skeleton.update();
    }
  }

  /*
   * 雨：常驻一个 DriftField，默认隐藏；服务端 `0x0F` 来了再按强度显示。
   * 不每次重建是为了避免天气每 10~20 秒变一次时反复分配几何。
   */
  const rainDef = DRIFT.rain;
  const rainTex = dotTexture(0.1);
  disposables.push(rainTex);
  const rain = new DriftField(rainDef, rainTex, getHeight);
  rain.points.visible = false;
  rain.points.name = 'ambient:rain';
  (rain.points.material as THREE.PointsMaterial).opacity = 0.55;
  group.add(rain.points);

  /** 当前雨强度 0..1（探针/调试用） */
  let rainLevel = 0;

  function setRain(intensity: number) {
    const k = Math.max(0, Math.min(1, intensity));
    rainLevel = k;
    rain.points.visible = k > 0.01;
    /*
     * 强度体现在三处：整体透明度、落速、（粒子数固定，靠视觉密度近似）。
     * 注意 `ShaderMaterial` 不认 `.opacity`，必须走 `uTint` uniform。
     */
    rain.setTint(0.35 + 0.65 * k);
    rain.setSpeedScale(0.7 + k * 0.6);
  }

  function getRain() {
    return rainLevel;
  }

  function dispose() {
    for (const d of disposables) d.dispose();
    for (const f of drifts) {
      f.points.geometry.dispose();
      (f.points.material as THREE.Material).dispose();
    }
    if (fireflies) {
      fireflies.points.geometry.dispose();
      (fireflies.points.material as THREE.Material).dispose();
    }
    for (const g of birdGeometries) g.dispose();
    for (const m of birdMaterials) m.dispose();
  }

  return { group, stats, update, dispose, setRain, rainLevel: getRain };
}
