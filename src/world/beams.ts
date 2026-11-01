/**
 * 关节 / 连线渲染层 —— 对应源码的 `Joint_Create`（IDA 0x0046D840）。
 *
 * 0.97 里「两点之间的一道电光 / 光带」不是模型也不是贴图精灵，而是**关节**：
 * `Joint_Create(type, posA, posB, angle, entity, mode, size, …)`，渲染在
 * `Joint_Render`（`FUN_0046c3e0` 那一族）里，做法是沿 A→B 铺一串四边形。
 *
 * 我们用「两片交叉的加色面片」一次性近似整条光束：
 *   - 一片朝相机的侧面永远看得到（交叉 90° 不会正好被看扁）；
 *   - 长度 = 两点距离，宽度 = `size`；
 *   - 加色混合 + `depthWrite:false`，和源码的发光观感一致；
 *   - 寿命到了淡出，节点释放。
 *
 * 只在**确实有两点**的地方用（比如 43 袭风刺 stage 6..12 的 `CreateJoint(0x10A)`×3）。
 * 技能 16/27 传的 `Joint_Create(266, Owner+16, Owner+16, …)` 两端是同一点，
 * 等价于「在身上冒点」，继续走精灵层。
 */

import * as THREE from 'three';
import { loadTexture } from '../core/texture';
import { additiveProps, fxAlpha } from '../core/additive';

export const BEAM_DIR = 'Data/Effect/';

export interface BeamOptions {
  /** `Effect/Xxx.OZJ` */
  file: string;
  /** 光束宽度（米） */
  width: number;
  /** 存活秒数 */
  life: number;
  /**
   * 沿 A→B 拆成几段折线（源码 `Joint_Create(0x4EE)` 的 8 段链）。
   * 不给 = 1，保持原来的单一直光束；>1 时中间节点在垂直平面随机抖动，
   * 视觉上就是原版那种「一段一段的闪电链」而不是一根直棍。
   */
  segments?: number;
  /** 初始不透明度，默认 0.9 */
  opacity?: number;
}

export interface BeamFx {
  id: number;
  file: string;
  mesh: THREE.Mesh;
  /** 分段链的附属段 mesh（空数组 = 原来的单一直光束） */
  extra: THREE.Mesh[];
  material: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  baseOpacity: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  done: boolean;
}

let nextId = 1;

/** 贴图缓存（同一张 Joint 贴图会被几十条光束共用） */
const texCache = new Map<string, Promise<THREE.Texture | null>>();

async function beamTexture(file: string): Promise<THREE.Texture | null> {
  const hit = texCache.get(file);
  if (hit) return hit;
  const task = (async () => {
    const loaded = await loadTexture(BEAM_DIR, file.replace(/^Effect\//, ''));
    if (!loaded) return null;
    const tex = loaded.texture.clone();
    // 精灵/面片用标准 UV，而 loadTexture 出来的 BMD 纹理是 flipY=false
    tex.flipY = true;
    tex.needsUpdate = true;
    return tex;
  })();
  texCache.set(file, task);
  return task;
}

/**
 * 两片交叉的单位光束：沿 +Y 从 0 到 1，宽度沿 X 和 Z 各一片。
 * 这样无论相机从哪个角度看，总有一片不是「看扁的一条线」。
 */
let crossGeo: THREE.BufferGeometry | null = null;
function crossGeometry(): THREE.BufferGeometry {
  if (crossGeo) return crossGeo;
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const quad = (axis: 'x' | 'z') => {
    const base = pos.length / 3;
    const h = 0.5;
    const pts: [number, number, number][] =
      axis === 'x'
        ? [
            [-h, 0, 0],
            [h, 0, 0],
            [h, 1, 0],
            [-h, 1, 0],
          ]
        : [
            [0, 0, -h],
            [0, 0, h],
            [0, 1, h],
            [0, 1, -h],
          ];
    for (const p of pts) pos.push(p[0], p[1], p[2]);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  quad('x');
  quad('z');
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  crossGeo = g;
  return g;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * 计算一条折线光束的中间节点（只返回第 1 .. n-1 个节点，不含首尾）。
 *
 * 源码 0x4EE 的 8 段链每段位置是「上一段末尾 + 旋转后的朝下向量」，天然形成
 * 一条带垂直落差的折线。我们这里按距离均分后再把中间节点在**垂直平面**
 * （沿 A→B 方向的横向 + 上下）随机抖动，形成「一段段」的闪电链观感。
 */
function chainPoints(
  a: THREE.Vector3,
  b: THREE.Vector3,
  n: number,
  rng: () => number = Math.random
): THREE.Vector3[] {
  if (n <= 1) return [];
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-4) return [];
  const step = dir
    .clone()
    .normalize()
    .multiplyScalar(len / n);
  // 垂直到光束方向的随机轴：取叉积生成一个正交平面
  const up = new THREE.Vector3(0, 0, 1);
  const side = new THREE.Vector3().crossVectors(dir.clone().normalize(), up);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0).cross(up); // 光束本身竖直时
  side.normalize();
  const amp = len / n * 0.35; // 抖动幅度 = 段长的 35%（够明显又不断裂）
  const pts: THREE.Vector3[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const base = a.clone().addScaledVector(dir, t);
    // 中间节点的横向抖动 + 上下抖动 —— 但两端（i=0, n）保持原位置
    const jitter = (Math.random() * 2 - 1) * amp;
    base.addScaledVector(side, jitter);
    base.z += (Math.random() * 2 - 1) * amp * 0.8;
    pts.push(base);
  }
  return pts;
}

export class BeamLayer {
  readonly active: BeamFx[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  async spawn(
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    opt: BeamOptions
  ): Promise<BeamFx | null> {
    const tex = await beamTexture(opt.file);
    if (!tex) return null;

    const a = new THREE.Vector3(from.x, from.y, from.z);
    const b = new THREE.Vector3(to.x, to.y, to.z);
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 0.05) return null;

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      ...additiveProps(),
      fog: false,
      // 原版 GL_SetBlendAdditive 会 glDisable(GL_FOG)：加色特效不吃雾
      side: THREE.DoubleSide,
      toneMapped: false,
      opacity: opt.opacity ?? 0.9,
    });

    /*
     * 分段链：源码 0x4EE 是 8 段折线（`segments` 个 mesh 首尾相连）。
     * 每段都用自己的方向旋转，整体仍然是一条连续的光链。
     * 只有 `segments > 1` 才走折线；默认仍是原来的单一直光束。
     */
    const seg = Math.max(1, Math.floor(opt.segments ?? 1));
    const extra: THREE.Mesh[] = [];
    let mesh: THREE.Mesh;

    // 单段直光：从 a 到 b 铺一片宽面片
    const placeStraight = (from: THREE.Vector3, to: THREE.Vector3, name: string): THREE.Mesh => {
      const d = to.clone().sub(from);
      const l = d.length();
      const m = new THREE.Mesh(crossGeometry(), mat);
      m.name = name;
      m.position.copy(from).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(Y_AXIS, d.clone().normalize());
      m.scale.set(opt.width, Math.max(l, 0.05), opt.width);
      m.renderOrder = 12;
      this.scene.add(m);
      return m;
    };

    if (seg > 1) {
      const pts = chainPoints(a, b, seg);
      let prev = a;
      const segMeshes: THREE.Mesh[] = [];
      for (const p of pts) {
        const l = p.distanceTo(prev);
        if (l < 0.05) continue;
        segMeshes.push(placeStraight(prev, p, `fx:beam:${opt.file}:seg`));
        prev = p;
      }
      const lastL = b.distanceTo(prev);
      if (lastL >= 0.05) segMeshes.push(placeStraight(prev, b, `fx:beam:${opt.file}:seg`));
      if (segMeshes.length === 0) {
        // 极端退化：距离太短导致每段都 < 1mm，整体直光兜底
        segMeshes.push(placeStraight(a, b, `fx:beam:${opt.file}`));
      }
      mesh = segMeshes[0];
      extra.push(...segMeshes.slice(1));
    } else {
      mesh = placeStraight(a, b, `fx:beam:${opt.file}`);
    }

    const fx: BeamFx = {
      id: nextId++,
      file: opt.file,
      mesh,
      // 分段链的附属 mesh 也要随主 mesh 一起淡出/移除
      extra,
      material: mat,
      age: 0,
      life: Math.max(0.08, opt.life),
      baseOpacity: opt.opacity ?? 0.9,
      from: a,
      to: b,
      done: false,
    };
    this.active.push(fx);
    return fx;
  }

  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i];
      f.age += dt;
      if (f.age >= f.life) {
        this.remove(i);
        continue;
      }
      const t = f.age / f.life;
      // 前半段保持亮、后半段收窄淡出 —— 闪电是「一瞬间」的
      f.material.opacity = f.baseOpacity * Math.max(0, 1 - t * t);
    }
  }

  private remove(index: number) {
    const f = this.active[index];
    f.done = true;
    this.scene.remove(f.mesh);
    for (const m of f.extra) this.scene.remove(m);
    f.material.dispose();
    this.active.splice(index, 1);
  }

  /** 当前活着的特效数量（探针计数用） */
  get activeCount() {
    return this.active.length;
  }

  clear() {
    for (let i = this.active.length - 1; i >= 0; i--) this.remove(i);
  }

  async warmUp(files: string[]) {
    for (const f of new Set(files)) await beamTexture(f);
  }

  snapshot() {
    return this.active.map(f => ({
      id: f.id,
      file: f.file,
      age: Number(f.age.toFixed(3)),
      life: f.life,
      // 分段链 = 1（主干）+ 附属段数；直光 = 1
      segments: 1 + f.extra.length,
      from: [f.from.x, f.from.y, f.from.z].map(n => Number(n.toFixed(2))),
      to: [f.to.x, f.to.y, f.to.z].map(n => Number(n.toFixed(2))),
      len: Number(f.from.distanceTo(f.to).toFixed(2)),
      opacity: Number(f.material.opacity.toFixed(2)),
    }));
  }
}
