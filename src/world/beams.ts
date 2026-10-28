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
  /** 初始不透明度，默认 0.9 */
  opacity?: number;
}

export interface BeamFx {
  id: number;
  file: string;
  mesh: THREE.Mesh;
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
    const mesh = new THREE.Mesh(crossGeometry(), mat);
    mesh.name = `fx:beam:${opt.file}`;
    mesh.position.copy(a).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(Y_AXIS, dir.clone().normalize());
    mesh.scale.set(opt.width, len, opt.width);
    mesh.renderOrder = 12;
    this.scene.add(mesh);

    const fx: BeamFx = {
      id: nextId++,
      file: opt.file,
      mesh,
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
      from: [f.from.x, f.from.y, f.from.z].map(n => Number(n.toFixed(2))),
      to: [f.to.x, f.to.y, f.to.z].map(n => Number(n.toFixed(2))),
      len: Number(f.from.distanceTo(f.to).toFixed(2)),
      opacity: Number(f.material.opacity.toFixed(2)),
    }));
  }
}
