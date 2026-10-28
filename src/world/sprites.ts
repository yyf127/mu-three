/**
 * 精灵特效层 —— 播 `Data/Effect/*.ozj|.ozt` 贴图。
 *
 * 0.97k 里有一半技能不是 BMD 模型，而是**一张贴图拉成的面片**：
 * 火焰（`Flame01.jpg`）、魔法阵（`Magic_Ground2.jpg`）、雷电（`Thunder01.jpg`）、
 * 灵魂/激光连线（`JointSpirit01.jpg` / `JointLaser01.jpg`）……
 * 源码在 `Scene_AssetLoad.cpp` 里把它们的贴图预加载到 0x4ab..0x596 这些槽位，
 * `CreateEffect(槽位, ...)` 就是往那个槽位挂一个面片。
 *
 * 两种摆法：
 *   - **billboard**（默认）：始终对着相机，用于火球、雷电、光点；
 *   - **ground**：贴地平铺（绕 X 轴 -90°），用于魔法阵、地狱火圈、轰击环。
 *
 * 生命周期按源码 `Effect_Create.cpp` 里 `pfVar17[0x18]` 的帧数（25fps）算，
 * 最后 25% 淡出。生成的节点挂在自己的组里，播完即释放。
 */

import * as THREE from 'three';
import { loadTexture } from '../core/texture';
import { additiveProps, fxAlpha } from '../core/additive';

export const EFFECT_DIR = 'Data/Effect/';

export interface SpriteOptions {
  /** 视觉尺寸（米，方片边长） */
  size: number;
  /** 存活时长（秒） */
  life: number;
  /** 贴地平铺（魔法阵 / 地面环） */
  ground?: boolean;
  /** 起始高度偏移（米） */
  lift?: number;
  /** 上升速度（米/秒），火苗用 */
  rise?: number;
  /** 淡入时长占比（0..1），默认 0.15 */
  fadeIn?: number;
  /** 淡出时长占比（0..1），默认 0.35 */
  fadeOut?: number;
  /** 初始不透明度 */
  opacity?: number;
  /** 绕轴自转（弧度/秒），地面法阵用 */
  spin?: number;
  /**
   * 序列帧图集：整张贴图按 `cols × rows` 切成若干帧，按 `fps` 播一遍。
   *
   * 依据 `ScrollOfMeteoriteEffect.DrawAnimatedExplosion`：
   * `Effect/Explotion01.jpg` 是 **4×4 = 16 帧**，帧号 = `t * 15`，
   * 也就是 16 帧跑完整个 `life`（约 0.64 s）。
   * 不给就是普通静态贴图。
   */
  frames?: { cols: number; rows: number };
  /** 序列帧播放速度（帧/秒）；默认按 `life` 播完一遍 */
  fps?: number;
  /**
   * 着色（0xRRGGBB），与贴图**相乘**。
   *
   * 加色混合下，纯白贴图叠几层就糊成一片白 —— 原版不会，
   * 因为它是**带颜色**画的：`ScrollOfMeteoriteEffect.DrawAnimatedExplosion`
   * 里 `Color(1f * alpha, 0.7f * alpha, 0.35f * alpha, alpha)`，
   * 也就是把爆闪压成橙红。不给就是不染色（白）。
   */
  tint?: number;
}

export interface SpriteFx {
  id: number;
  /** 贴图路径，如 `Effect/Flame01.OZJ` */
  file: string;
  object: THREE.Object3D;
  material: THREE.MeshBasicMaterial;
  /** 0 = billboard，1 = 地面片 */
  kind: 0 | 1;
  age: number;
  life: number;
  size: number;
  baseOpacity: number;
  rise: number;
  spin: number;
  fadeIn: number;
  fadeOut: number;
  /** 序列帧：图集切分（null = 静态贴图） */
  frames: { cols: number; rows: number; count: number; fps: number } | null;
  /** 落点（探针用） */
  at: { x: number; y: number; z: number };
  done: boolean;
}

let nextId = 1;

/** 贴图缓存：同张贴图被几十个特效共用，clone 一次就够 */
const spriteTextureCache = new Map<string, Promise<THREE.Texture | null>>();

async function spriteTexture(file: string): Promise<THREE.Texture | null> {
  const hit = spriteTextureCache.get(file);
  if (hit) return hit;
  const task = (async () => {
    const loaded = await loadTexture(EFFECT_DIR, file.replace(/^Effect\//, ''));
    if (!loaded) return null;
    /*
     * `loadTexture` 出来的纹理是 `flipY = false`（BMD 的 UV 是反的），
     * 而 Sprite / PlaneGeometry 用的是标准 UV —— 不翻回来贴图会上下颠倒。
     * clone 会共用同一张 image，只是各自上传一次。
     */
    const tex = loaded.texture.clone();
    tex.flipY = true;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  })();
  spriteTextureCache.set(file, task);
  return task;
}

/**
 * 地面片的几何。
 *
 * 这个世界是 **Z 轴朝上**（`MuCamera` 里 `camera.up = (0,0,1)`，角色/地形都用
 * x/y 当格坐标、z 当高度），而 `PlaneGeometry` 默认就躺在 XY 平面、法线朝 +Z
 * —— 也就是「平铺在地上」，正好是我们要的，**不需要再 rotateX**。
 * （早先按 Y-up 的习惯转了 -90°，结果魔法阵全部立成一面墙。）
 */
function groundGeometry(): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(1, 1);
}

const groundGeo = groundGeometry();

export class SpriteLayer {
  readonly active: SpriteFx[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  async spawn(
    file: string,
    pos: { x: number; y: number; z: number },
    opt: SpriteOptions
  ): Promise<SpriteFx | null> {
    const base = await spriteTexture(file);
    if (!base) return null;

    /*
     * 序列帧必须**每个实例克隆一张纹理**：`offset` 是纹理自己的属性，
     * 共用同一个 Texture 会让场上所有 Explotion 帧号一起跳。
     * clone 共享 image，只多一次 GPU 上传。
     */
    const tex = opt.frames ? base.clone() : base;
    let frames: SpriteFx['frames'] = null;
    if (opt.frames) {
      const { cols, rows } = opt.frames;
      const count = cols * rows;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.repeat.set(1 / cols, 1 / rows);
      tex.offset.set(0, 0);
      tex.needsUpdate = true;
      frames = { cols, rows, count, fps: opt.fps ?? count / Math.max(0.12, opt.life) };
    }

    const ground = opt.ground === true;
    const object: THREE.Object3D = ground
      ? new THREE.Mesh(groundGeo, undefined as unknown as THREE.Material)
      : new THREE.Sprite(undefined as unknown as THREE.SpriteMaterial);

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      ...additiveProps(),
      fog: false,
      // 原版 GL_SetBlendAdditive 会 glDisable(GL_FOG)：加色特效不吃雾
      side: THREE.DoubleSide,
      toneMapped: false,
      opacity: opt.opacity ?? 1,
    });
    mat.name = `fx:sprite:${file}`;
    if (opt.tint !== undefined) mat.color.setHex(opt.tint);
    (object as THREE.Mesh).material = mat;

    if (!ground) {
      (object as THREE.Sprite).material = mat as unknown as THREE.SpriteMaterial;
    }

    object.position.set(pos.x, pos.y, pos.z + (opt.lift ?? 0));
    object.scale.setScalar(opt.size);
    object.renderOrder = 12;
    object.name = `fx:sprite:${file}`;
    if (ground) object.rotation.z = Math.random() * Math.PI * 2;
    this.scene.add(object);

    const fx: SpriteFx = {
      id: nextId++,
      file,
      object,
      material: mat,
      kind: ground ? 1 : 0,
      age: 0,
      life: Math.max(0.12, opt.life),
      size: opt.size,
      baseOpacity: opt.opacity ?? 1,
      rise: opt.rise ?? 0,
      spin: opt.spin ?? 0,
      fadeIn: opt.fadeIn ?? 0.15,
      fadeOut: opt.fadeOut ?? 0.35,
      frames,
      at: { x: pos.x, y: pos.y, z: pos.z + (opt.lift ?? 0) },
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
      let alpha = 1;
      if (t < f.fadeIn) alpha = t / f.fadeIn;
      else if (t > 1 - f.fadeOut) alpha = Math.max(0, (1 - t) / f.fadeOut);
      fxAlpha(f.material, f.baseOpacity * alpha);

      if (f.rise) f.object.position.z += f.rise * dt;
      if (f.spin) f.object.rotation.z += f.spin * dt;

      if (f.frames) {
        const idx = Math.min(
          f.frames.count - 1,
          Math.floor(f.age * f.frames.fps)
        );
        const col = idx % f.frames.cols;
        const row = Math.floor(idx / f.frames.cols);
        /*
         * 贴图是 `flipY = true` 上传的（BMD 的 UV 是反的，见 spriteTexture），
         * 所以图集第 0 行在 V 轴底部，offset.y 直接用 `row / rows`，
         * 不需要再 `1 - (row+1)/rows`。顺序错了会看到爆炸倒着播。
         */
        f.material.map!.offset.set(col / f.frames.cols, row / f.frames.rows);
      }

      // 轻微膨胀：原版面片是「炸开」的，纯静态大小会显得很硬
      const grow = 1 + t * 0.18;
      f.object.scale.setScalar(f.size * grow);
    }
  }

  private remove(index: number) {
    const f = this.active[index];
    f.done = true;
    this.scene.remove(f.object);
    // 序列帧是每实例克隆的纹理，得跟着材质一起释放
    if (f.frames) f.material.map?.dispose();
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

  /** 预热贴图（进图时把技能要用的贴图拉下来） */
  async warmUp(files: string[]) {
    for (const file of new Set(files)) await spriteTexture(file);
  }

  snapshot() {
    return this.active.map(f => ({
      id: f.id,
      file: f.file,
      kind: f.kind === 1 ? 'ground' : 'billboard',
      age: Number(f.age.toFixed(3)),
      life: Number(f.life.toFixed(3)),
      size: f.size,
      opacity: Number(f.material.opacity.toFixed(2)),
      pos: [f.at.x, f.at.y, f.at.z].map(n => Number(n.toFixed(2))),
    }));
  }
}
