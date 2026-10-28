/**
 * 武器拖尾 —— 对应源码的 `Trail_RenderAll`（`FUN_0046c3e0` @ 0x0046C3E0）。
 *
 * 0.97 里「挥砍时的刀光」既不是特效模型也不是精灵，而是**拖尾池**：
 * 每个槽存一串历史点（每点 3 个 float），渲染时用 `GL_QUAD_STRIP` 把这些点连成
 * 一条带子，透明度按 `(count - i) / count` 从新到旧衰减；贴图由
 * `GL_BindTextureSlot(type + 0x48D)` 决定（0x48D = 1165 = `Effect/blur01.OZJ`，
 * 正好是拖尾贴图段的第一个）。
 *
 * 点从哪来：`AttackStage` 每帧把武器骨骼的世界坐标算出来存进 `o + 0x188`
 * （`m_vPosSword`），拖尾池把这个点推进自己的点列 —— 所以刀光的形状就是
 * **武器尖端在最近 0.2~0.3 秒划过的那条弧**。
 *
 * 这里做同样的事：
 *   - `Actor.handPosition()` 每帧给我们持械手的世界坐标；
 *   - `TrailLayer.push()` 采样（并按最小距离去重，静止时不堆点）；
 *   - `update()` 淘汰超龄点、重建一条三角形带（每个点两侧各一个顶点）；
 *   - 顶点色按「越旧越暗」衰减，配合加色混合 = 越旧越透明。
 */

import * as THREE from 'three';
import { loadTexture } from '../core/texture';
import { additiveProps, fxAlpha } from '../core/additive';

/** 拖尾贴图目录（和精灵层同一个） */
export const TRAIL_DIR = 'Data/Effect/';
/** 源码 `GL_BindTextureSlot(type + 0x48D)`：0x48D = 1165 → blur01 */
const DEFAULT_TRAIL_TEXTURE = 'Effect/blur01.OZJ';

export interface TrailOptions {
  file?: string;
  /** 带宽（米） */
  width?: number;
  /** 单点存活秒数（整条拖尾 ≈ 这个长度） */
  life?: number;
  /** 顶点色（加色混合下就是亮度） */
  color?: number;
}

interface TrailPoint {
  p: THREE.Vector3;
  age: number;
}

let trailTexture: Promise<THREE.Texture | null> | null = null;
function defaultTexture(): Promise<THREE.Texture | null> {
  if (trailTexture) return trailTexture;
  trailTexture = (async () => {
    const loaded = await loadTexture(TRAIL_DIR, DEFAULT_TRAIL_TEXTURE.replace(/^Effect\//, ''));
    if (!loaded) return null;
    const tex = loaded.texture.clone();
    tex.flipY = true;
    tex.needsUpdate = true;
    return tex;
  })();
  return trailTexture;
}

/** 两点最小间距（米）：太小会把同一个位置堆成一坨，太大弧形就不顺 */
const MIN_STEP = 0.03;
/** 最多保留多少个点（源码池子里每槽也是定长的） */
const MAX_POINTS = 24;

export class TrailLayer {
  /** 当前是否在采样（挥砍/施法动作期间为 true） */
  private tracing = false;
  private points: TrailPoint[] = [];
  private mesh: THREE.Mesh | null = null;
  private material: THREE.MeshBasicMaterial | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private width: number;
  private life: number;
  private color: THREE.Color;
  private scene: THREE.Scene;
  private lastPoint = new THREE.Vector3();
  private tmpSide = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();
  private up = new THREE.Vector3(0, 0, 1);

  /** 当前是否有拖尾（只有一条，采样点 > 0 就算活着） */
  get activeCount() {
    return this.points.length ? 1 : 0;
  }

  constructor(scene: THREE.Scene, opt: TrailOptions = {}) {
    this.scene = scene;
    this.width = opt.width ?? 0.16;
    this.life = opt.life ?? 0.24;
    this.color = new THREE.Color(opt.color ?? 0xfff0c8);
  }

  /** 开始一段新拖尾（动作起手时调用） */
  begin() {
    this.tracing = true;
  }

  /** 结束采样：不再加点，已有点自然老化消失 */
  end() {
    this.tracing = false;
  }

  /** 每帧调用，喂一个采样点（一般是持械手的世界坐标） */
  push(p: THREE.Vector3) {
    if (!this.tracing) return;
    if (this.points.length) {
      const last = this.points[this.points.length - 1].p;
      if (last.distanceToSquared(p) < MIN_STEP * MIN_STEP) return;
    }
    this.points.push({ p: p.clone(), age: 0 });
    if (this.points.length > MAX_POINTS) this.points.shift();
    this.lastPoint.copy(p);
  }

  update(dt: number) {
    if (!this.points.length) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }

    // 老化 + 淘汰
    for (const pt of this.points) pt.age += dt;
    while (this.points.length && this.points[0].age > this.life) this.points.shift();

    if (this.points.length < 2) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }

    this.rebuild();
  }

  private async ensureMesh() {
    if (this.mesh) return;
    const tex = await defaultTexture();
    if (!tex) return;
    this.material = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      ...additiveProps(),
      fog: false,
      // 原版 GL_SetBlendAdditive 会 glDisable(GL_FOG)：加色特效不吃雾
      side: THREE.DoubleSide,
      vertexColors: true,
      toneMapped: false,
    });
    this.geometry = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'fx:trail';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.scene.add(this.mesh);
  }

  /** 重建整条带子（点数 ≤ 24，每帧重建的开销可以忽略） */
  private rebuild() {
    void this.ensureMesh();
    if (!this.geometry) return;
    // 贴图还没加载完：下一帧再来
    if (!this.material) return;

    const n = this.points.length;
    const pos = new Float32Array(n * 2 * 3);
    const col = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    const idx: number[] = [];

    for (let i = 0; i < n; i++) {
      const cur = this.points[i];
      // 朝向下一点（末点用上一点的方向）
      const next = this.points[Math.min(i + 1, n - 1)];
      const prev = this.points[Math.max(i - 1, 0)];
      this.tmpDir.subVectors(next.p, prev.p);
      if (this.tmpDir.lengthSq() < 1e-8) this.tmpDir.set(1, 0, 0);
      this.tmpDir.normalize();

      // 带宽方向 = 切线 × 世界上方向；退化时换一个参考轴
      this.tmpSide.crossVectors(this.tmpDir, this.up);
      if (this.tmpSide.lengthSq() < 1e-5) this.tmpSide.crossVectors(this.tmpDir, new THREE.Vector3(1, 0, 0));
      this.tmpSide.normalize().multiplyScalar(this.width * 0.5);

      const a = 0;
      void a;
      // 老化系数：新点 1、旧点 0（源码 (count - i) / count）
      const fade = Math.max(0, 1 - cur.age / this.life);
      // 两端收窄，像刀尖划过
      const taper = 1 - Math.abs(i / (n - 1) - 0.5) * 0.35;

      for (const s of [-1, 1]) {
        const o = (i * 2 + (s < 0 ? 0 : 1)) * 3;
        pos[o + 0] = cur.p.x + this.tmpSide.x * s * taper;
        pos[o + 1] = cur.p.y + this.tmpSide.y * s * taper;
        pos[o + 2] = cur.p.z + this.tmpSide.z * s * taper;
        col[o + 0] = this.color.r * fade;
        col[o + 1] = this.color.g * fade;
        col[o + 2] = this.color.b * fade;
      }
      const u = (i * 2) * 2;
      uv[u + 0] = 0;
      uv[u + 1] = i / (n - 1);
      uv[u + 2] = 1;
      uv[u + 3] = i / (n - 1);

      if (i < n - 1) {
        const b = i * 2;
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geometry.setIndex(idx);
    this.geometry.computeBoundingSphere();
    if (this.mesh) this.mesh.visible = true;
  }

  clear() {
    this.points.length = 0;
    this.tracing = false;
    if (this.mesh) this.mesh.visible = false;
  }

  dispose() {
    this.clear();
    if (this.mesh) this.scene.remove(this.mesh);
    this.geometry?.dispose();
    this.material?.dispose();
  }

  snapshot() {
    const pts = this.points.map(p => [p.p.x, p.p.y, p.p.z].map(v => Number(v.toFixed(2))));
    let span = 0;
    for (let i = 1; i < this.points.length; i++) {
      span += this.points[i].p.distanceTo(this.points[i - 1].p);
    }
    return {
      tracing: this.tracing,
      points: this.points.length,
      /** 折线总长（米）—— 探针用它判断「真的划过一段弧」 */
      span: Number(span.toFixed(2)),
      visible: this.mesh?.visible === true,
      first: pts[0] ?? null,
      last: pts[pts.length - 1] ?? null,
    };
  }
}
