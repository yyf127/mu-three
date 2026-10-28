/**
 * 技能特效层 —— 直接播 `Data/Skill/*.bmd`。
 *
 * 这些文件是**普通 BMD**（骨骼 + 蒙皮网格 + 逐帧动画），和角色模型同一套解析器，
 * 所以渲染方式和翅膀一样：自带骨架、自带动作，播完就销毁。
 *
 * 和角色/翅膀的三个差别：
 *   1. **每个技能的尺寸差 20 倍**（Poison01 只有 48 cm，Inferno01 有 8 m），
 *      所以缩放走每个技能自己的配置，不统一；
 *   2. **锚点在自己身上**（比如 Laser01 的包围盒 x 从 67.9 起，不在原点），
 *      生成时按包围盒把「底部中心」对到落点，不然特效会飘到半边天；
 *   3. 视觉是**发光**的：JPG 纹理没有 alpha，靠加色混合去黑底（同 JPG 翅膀），
 *      并且 `depthWrite = false`，否则半透明面片互相切断。
 *
 * 生命周期：`EffectLayer.update(dt)` 推进帧，播完 `loops` 遍自动移除并释放 geometry。
 */

import * as THREE from 'three';
import { parseBmd, type Bmd } from '../core/bmd';
import {
  MODEL_SCALE,
  applyActionPose,
  createRig,
  createSkinnedMesh,
  type Rig,
} from '../core/model';
import { fetchBytesOptional, loadTexture } from '../core/texture';
import { additiveProps, fxAlpha } from '../core/additive';

export const SKILL_DIR = 'Data/Skill/';

/** 特效纹理的混合方式：JPG（OZJ）加色、TGA（OZT）alpha */
export type EffectBlend = 'add' | 'alpha';

export interface SpawnOptions {
  /**
   * 目标视觉尺寸（米）—— 按包围盒**最长边**缩放到这个值。
   *
   * ⚠️ **技能特效不要传这个**。原版 `RenderEffects`（IDA 0x0046BBA0）把
   * 190..268 交给 `Entity_PrepareRender`，用效果槽里的 `+0x1a`（默认 1.0），
   * 也就是**模型自己画多大就多大**。这个参数留着只给少数需要强制尺寸的场合。
   */
  size?: number;
  /**
   * 直接给缩放倍数（推荐；源码语义就是这个）。
   * 默认 `1` = BMD 的 0.01 倍（模型原始单位）。
   */
  scale?: number;
  /**
   * **分轴**缩放（在 `scale` 之后再乘），给「想加粗但不想拉长」的东西用。
   *
   * 现在只有箭矢在用：`Arrow01` 蒙皮后的长轴是本地 **+Y**，横截面在 X/Z 上
   * 只有 8.7 cm —— 在游戏镜头下细得几乎看不见。`[2, 1.15, 2]` 把直径加到
   * 17 cm、长度只加 15%，观感和原版接近，又不会变成一根柱子。
   */
  scale3?: [number, number, number];
  /** 离地高度（米），默认 0 = 贴地 */
  lift?: number;
  /**
   * 绕**竖轴**的朝向（弧度），**MU 世界角度**：0 = +X，逆时针为正。
   *
   * 两个坑都踩过，别再改错：
   *   1. 这个世界是 **Z 轴朝上**，所以绕竖轴是 `rotation.z`，不是 `rotation.y`
   *      （`rotation.y` 是绕水平轴，等于把特效翻倒/侧立起来）；
   *   2. 特效模型的角度约定是「0 = +X」——`Data/Skill/Laser01.bmd` 的顶点包围盒
   *      中心就在本地 **+X 0.92 m**，`Blast01`/`Magic02` 在 +Y，`Ice01` 在 -Y；
   *      它们**不像角色 BMD 那样本地朝 -Y**。所以调用方要传
   *      `player.yaw - MODEL_YAW_OFFSET`（= `atan2(dy, dx)`），
   *      直接传 `player.yaw` 会**整体多转 90°**，定向特效就打到侧面去了。
   */
  yaw?: number;
  blend?: EffectBlend;
  /**
   * 每帧推进的动画速度。
   *
   * 源码 `CreateEffect` 把效果槽 `+0x33` 初始化为 **0.3**，`MoveEffect` 尾部
   * 用它调 `BMD__PlayAnimation(model, …, speed)` —— 也就是说特效动画只有
   * 角色动画（0.28~0.6）的一半到三分之一速。以前按 1.0 播，5 帧的火焰
   * 40 ms 就烧完了，看起来「一闪就没」。
   */
  speed?: number;
  /** 播几遍后销毁（默认 1） */
  loops?: number;
  /** 存活秒数（源码 `+0x18` 帧数 ÷ 25）；给了就不按动画长度算 */
  life?: number;
  /**
   * 是否把包围盒底部中心对到落点。
   * **默认 false**：源码就是「效果位置 = 落点」，模型原点在脚底/中心由美术定，
   * 再按包围盒居中会把特效整体推偏（Laser01 的包围盒 x 从 67.9 起，一偏就是半格）。
   */
  anchor?: boolean;
  /**
   * 让特效「飞过去」：从落点沿直线插值到这个世界坐标（米）。
   * 源码里火球的 `CreateEffect(191, ..., param_5=1, param_6=Owner)` 就是
   * 「绑到施法者身上、朝目标飞」，这里用一次线性插值近似。
   */
  flyTo?: { x: number; y: number; z: number };
  /** 飞到目标用多久（秒），默认 0.32 */
  flyTime?: number;
  /**
   * 生成时在落点上方抬多高（米）。源码里「陨石」是 `[6] += 400` 单位 = 4 m。
   */
  drop?: number;
  /**
   * 初速度（米/秒）。源码效果槽 `+0x30..+0x32` 是「单位/帧」（25 fps），
   * 换算成米/秒要 `× 25 / 100`：-50 单位/帧 = **-12.5 m/s**。
   * 触地后水平/垂直速度清零（`MoveEffect` 里 `velZ = 10; velX*=0.5` 那套的简化）。
   */
  vel?: { x: number; y: number; z: number };
  /**
   * 初速度的随机抖动（米/秒）：每个轴在 `±velJitter` 内随机。
   *
   * 碎石的初速度是随机的（`MeteorStoneModel`：`RandomRange(-6.5f, 6.5f)` 单位/帧），
   * 全部同速飞出去会像一排整齐的子弹。
   */
  velJitter?: number;
  /**
   * Z 方向加速度（米/秒²），正 = 往上。
   *
   * 两处用到：
   *   - 陨石碎石：`_velocity.Z -= 1.2f * factor`（每帧，单位/帧²）→ 往下 **-7.5**
   *   - 地狱火石柱：`Position.Z += _gravity; _gravity += 0.5` → 往上加速 **+3.1**
   * 触地（`z <= groundZ` 且正在下落）就停住，不再继续穿地。
   */
  gravity?: number;
  /**
   * 是否在落点地面打一圈加色光斑（默认 true）。
   *
   * 源码 `MoveEffect` 里几乎每个 case 每帧都调 `AddTerrainLight(x, y, color, 2, …)`
   * —— 技能落地时**把脚下的地形照亮**，这是 MU 最标志性的观感之一。
   * 我们的地形是静态顶点色、没有动态光照通道，所以用一张朝上的加色光斑近似：
   * 位置跟着特效走，亮度跟着特效的淡出曲线走。
   */
  /**
   * 地面光斑（**已停用**：原版没有圆片，是 `AddTerrainLight` 给地形顶点加光）。
   * 只有显式传 `true` 才会生成，见 `spawn()` 里的说明。
   */
  glow?: boolean;
  /** 光斑半径（米），默认按缩放估算 */
  glowRadius?: number;
  /**
   * 绕竖轴自转（弧度/秒）。
   *
   * 源码里「武器旋转」类效果（`RenderWheelWeapon`，被 238 每帧生成的 239 调用）
   * 是 `o+200 -= 30°` 每帧 → 25fps 下 **-750°/s ≈ -13.1 rad/s**。
   */
  spin?: number;
}

export interface Effect {
  id: number;
  /** 模型文件名，如 `Fire01.bmd` */
  file: string;
  root: THREE.Group;
  rig: Rig;
  meshes: THREE.SkinnedMesh[];
  /** 每个网格的材质（克隆过的，用来做淡出） */
  mats: THREE.MeshBasicMaterial[];
  action: number;
  frame: number;
  /** 该动作的关键帧数 */
  keys: number;
  speed: number;
  loopsLeft: number;
  age: number;
  /** 动画播完一遍需要的秒数 */
  period: number;
  /** 完整播几遍（配置值） */
  loops: number;
  /** 保持不透明的时长（秒）= max(period × loops, MIN_LIFE) */
  aliveFor: number;
  /** 落点（游戏坐标）：模型是绕这个点摆的，不是绕 root.position */
  anchor: { x: number; y: number; z: number };
  /** 飞行弹道：起点 → 终点，`flyTime` 秒走完；没配就是原地 */
  fly?: { from: THREE.Vector3; to: THREE.Vector3; time: number };
  /** 自转角速度（弧度/秒）；0 = 不转 */
  spin: number;
  /** 绕竖轴的朝向（MU 世界角度，0 = +X）；探针用来核对「没多转 90°」 */
  yaw: number;
  /** 速度（米/秒）；触地后归零 */
  vel?: THREE.Vector3;
  /** Z 加速度（米/秒²）；undefined = 纯匀速（原行为） */
  gravity?: number;
  /** 地面光斑（AddTerrainLight 的近似）；null = 没有 */
  glow: THREE.Mesh | null;
  /** 落点高度：速度触到这个 Z 就停（陨石落地） */
  groundZ: number;
  done: boolean;
}

/**
 * 最短可见时间。
 *
 * 很多技能特效只有 **1 帧**（Laser01 / Blast01 / Saw01 / Ice02 都是），
 * 按 25fps 播就是 40ms —— 一帧都不到，渲染出来什么都看不见。
 * 原版靠 sprite 的 alpha 渐变兜住，这里给它一个下限。
 */
const MIN_LIFE = 0.35;
/** 消失前的淡出时长（秒） */
const FADE = 0.2;

/* ------------------------------------------------------------------ */
/* 资源                                                                */
/* ------------------------------------------------------------------ */

/**
 * 地面光斑贴图：径向渐变（中心白 → 边缘透明）。
 *
 * 原版 `AddTerrainLight` 是把地形顶点按 `color × 距离衰减` 提亮，
 * 这里没有逐顶点光照通道，用一张加色混合的贴图顶上去，观感等价。
 */
let glowTexture: THREE.Texture | null = null;
function radialGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // 中心亮、边缘 0：二次衰减，和 AddTerrainLight 的 mode 2 形状接近
  grd.addColorStop(0.0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  glowTexture = tex;
  return tex;
}

/** 地面片几何：世界是 Z 轴朝上，PlaneGeometry 默认躺在 XY 平面就是「平铺在地上」 */
let groundPlane: THREE.PlaneGeometry | null = null;
function groundPlaneGeo(): THREE.PlaneGeometry {
  if (!groundPlane) groundPlane = new THREE.PlaneGeometry(1, 1);
  return groundPlane;
}

const bmdCache = new Map<string, Promise<Bmd | null>>();

function loadEffectBmd(file: string): Promise<Bmd | null> {
  const hit = bmdCache.get(file);
  if (hit) return hit;
  const task = (async () => {
    const bytes = await fetchBytesOptional(SKILL_DIR + file);
    if (!bytes) {
      console.warn(`[effect] 缺模型 ${SKILL_DIR}${file}`);
      return null;
    }
    return parseBmd(bytes);
  })();
  bmdCache.set(file, task);
  return task;
}

const materialCache = new Map<string, THREE.Material>();

/**
 * 特效材质。
 *
 * 和 `getBmdMaterial` 的区别是「发光」：特效几乎全是加色混合的亮面，
 * 顶点色（BMD 的顶点亮度）乘上去就是原版那种通透感。
 */
function effectMaterial(tex: { texture: THREE.Texture; tag: string }, blend: EffectBlend): THREE.Material {
  const key = `${tex.texture.uuid}|${blend}`;
  const hit = materialCache.get(key);
  if (hit) return hit;

  const mat = new THREE.MeshBasicMaterial({
    map: tex.texture,
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  if (blend === 'add') {
    Object.assign(mat, additiveProps());
    mat.fog = false;
    mat.alphaTest = 0.02;
  } else {
    mat.blending = THREE.NormalBlending;
    mat.alphaTest = 0.02;
  }
  mat.name = `fx:${blend}`;
  materialCache.set(key, mat);
  return mat;
}

/* ------------------------------------------------------------------ */
/* 特效实例                                                            */
/* ------------------------------------------------------------------ */

let nextId = 1;

/**
 * 蒙皮后的真实包围盒（世界坐标）。
 *
 * `Box3.setFromObject` 对 SkinnedMesh 只会用 bind pose 的几何包围盒，
 * 而特效模型的实际大小要**过一遍骨骼矩阵**才知道 —— Fire01 的顶点范围是
 * 166 cm，但骨骼带着火柱往上长，不加这一步就会把特效缩放成错误的大小。
 */
function skinnedBox(meshes: THREE.SkinnedMesh[]): THREE.Box3 {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    const si = m.geometry.getAttribute('skinIndex');
    const bones = m.skeleton.bones;
    for (let i = 0; i < pos.count; i++) {
      const b = bones[si.getX(i)];
      if (!b) continue;
      v.fromBufferAttribute(pos, i).applyMatrix4(b.matrixWorld);
      box.expandByPoint(v);
    }
  }
  return box;
}

export class EffectLayer {
  readonly active: Effect[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * 生成一个特效。`pos` 是**游戏坐标**（x/y 是格坐标，z 是高度米）。
   * 模型缺失时返回 null（技能表里配了但资源没有的情况要靠探针抓出来）。
   */
  async spawn(file: string, pos: { x: number; y: number; z: number }, opt: SpawnOptions = {}): Promise<Effect | null> {
    const bmd = await loadEffectBmd(file);
    if (!bmd) return null;

    const rig = createRig(bmd, MODEL_SCALE);
    const identity = (n: number) => n;
    const meshes: THREE.SkinnedMesh[] = [];
    const mats: THREE.MeshBasicMaterial[] = [];

    for (const mesh of bmd.meshes) {
      const tex = await loadTexture(SKILL_DIR, mesh.texturePath);
      if (!tex) continue;
      const blend = opt.blend ?? (/\.tga$/i.test(mesh.texturePath) ? 'alpha' : 'add');
      const skinned = createSkinnedMesh(bmd, mesh, rig, identity, tex.texture, true);
      // 材质按实例克隆：淡出要改 opacity，共享材质会把同一张图的所有特效一起弄透明
      const mat = effectMaterial(tex, blend).clone() as THREE.MeshBasicMaterial;
      skinned.material = mat;
      skinned.frustumCulled = false;
      skinned.renderOrder = 12;
      skinned.name = `fx:${file}:${mesh.texturePath}`;
      meshes.push(skinned);
      mats.push(mat);
    }
    if (!meshes.length) return null;

    const root = new THREE.Group();
    root.name = `fx:${file}`;
    root.add(rig.root);
    root.rotation.z = opt.yaw ?? 0;

    /*
     * 蒙皮网格必须挂在**场景根**，不能挂在 root 下面 ——
     * `createSkinnedMesh` 用的是 bindMatrix = identity，顶点直接被骨骼世界矩阵
     * 变换（同 `Actor.attachMeshes`）。再挂到 root 下会多吃一次 root 的
     * 位置/缩放，特效就会飞出屏幕（或者被缩成看不见的一点）。
     */
    this.scene.add(root);
    for (const m of meshes) this.scene.add(m);

    const keys = bmd.actions[0]?.numKeys ?? 1;
    // 源码：CreateEffect 把动画速度 `+0x33` 初始化为 0.3（不是 1.0）
    const speed = opt.speed ?? 0.3;
    const loops = opt.loops ?? 1;

    /* 只在需要按 size 反算缩放 / 需要贴地对齐时，才去算蒙皮包围盒 */
    let box = new THREE.Box3();
    if (opt.size !== undefined || opt.anchor === true) {
      const midFrame = keys > 1 ? keys * 0.5 : 0;
      applyActionPose(rig, 0, midFrame, true);
      root.updateMatrixWorld(true);
      box = skinnedBox(meshes);
    }

    let scale = opt.scale ?? 1;
    if (opt.size && !box.isEmpty()) {
      const s = box.getSize(new THREE.Vector3());
      const longest = Math.max(s.x, s.y, s.z);
      if (longest > 0.01) scale = opt.size / longest;
    }
    if (opt.scale3) {
      root.scale.set(scale * opt.scale3[0], scale * opt.scale3[1], scale * opt.scale3[2]);
    } else {
      root.scale.setScalar(scale);
    }

    if (opt.anchor !== true || box.isEmpty()) {
      // 源码行为：效果位置就是落点，模型原点由美术定，不做任何居中
      root.position.set(pos.x, pos.y, pos.z + (opt.lift ?? 0) + (opt.drop ?? 0));
    } else {
      // 包围盒是在 scale=1、原点处的世界坐标；缩放后按比例贴到落点
      const cx = (box.min.x + box.max.x) / 2;
      const cy = (box.min.y + box.max.y) / 2;
      const z0 = box.min.z;
      root.position.set(
        pos.x - cx * scale,
        pos.y - cy * scale,
        pos.z - z0 * scale + (opt.lift ?? 0)
      );
    }

    const period = keys / (speed * 25);
    const e: Effect = {
      id: nextId++,
      file,
      root,
      rig,
      meshes,
      mats,
      action: 0,
      frame: 0,
      keys,
      speed,
      loopsLeft: loops,
      age: 0,
      period,
      loops,
      /*
       * 存活时长：源码有 `+0x18` 寿命（帧）就用它（`life` 秒），
       * 没有就按动画播一遍的长度算。两者都至少有 MIN_LIFE，
       * 否则单帧特效（Laser01 只有 1 帧）会 0 秒消失。
       */
      aliveFor: Math.max(opt.life ?? period * loops, period * loops, MIN_LIFE),
      anchor: { x: pos.x, y: pos.y, z: pos.z },
      fly: opt.flyTo
        ? {
            from: root.position.clone(),
            to: new THREE.Vector3(opt.flyTo.x, opt.flyTo.y, opt.flyTo.z),
            time: Math.max(0.08, opt.flyTime ?? 0.32),
          }
        : undefined,
      spin: opt.spin ?? 0,
      yaw: opt.yaw ?? 0,
      vel: opt.vel
        ? (() => {
            const j = opt.velJitter ?? 0;
            const r = () => (j ? (Math.random() * 2 - 1) * j : 0);
            return new THREE.Vector3(opt.vel.x + r(), opt.vel.y + r(), opt.vel.z + r());
          })()
        : undefined,
      gravity: opt.gravity,
      glow: null,
      groundZ: pos.z + (opt.lift ?? 0),
      done: false,
    };

    /*
     * 地面光斑 —— **默认关闭，而且原版没有这个东西**。
     *
     * 之前这里给每个特效都贴一张 `radialGlowTexture()`（canvas 画的径向渐变），
     * 结果技能一放，脚边就多出一个圆形亮斑。但原版从没画过圆片：
     * 它用的是 `AddTerrainLight()` —— 把 **地形顶点**按 `color × 距离衰减` 提亮，
     * 强度低、无边界、不会跳出来一个圆。这是两回事。
     *
     * 现在只有显式传 `glow: true` 才生成（目前没有调用点这么传）。
     * 真要「照亮地面」得做逐顶点通道，不是贴圆片。
     */
    if (opt.glow === true) {
      const r = opt.glowRadius ?? Math.max(1.6, 2.6 * scale);
      const glowMat = new THREE.MeshBasicMaterial({
        map: radialGlowTexture(),
        color: 0xfff2d8, // 源码这里传的是施法者的 light（接近白），偏暖一点更像火光
        transparent: true,
        depthWrite: false,
        ...additiveProps(),
        fog: false,
      // 原版 GL_SetBlendAdditive 会 glDisable(GL_FOG)：加色特效不吃雾
        toneMapped: false,
        opacity: 0,
      });
      const glow = new THREE.Mesh(groundPlaneGeo(), glowMat);
      glow.name = `fx:glow:${file}`;
      glow.position.set(root.position.x, root.position.y, e?.groundZ ?? pos.z);
      glow.scale.setScalar(r);
      glow.renderOrder = 3;
      glow.userData.baseRadius = r;
      this.scene.add(glow);
      e.glow = glow;
    }

    applyActionPose(rig, 0, 0, true);
    this.active.push(e);
    return e;
  }

  /** 每帧推进所有特效；播完了的移除并释放 */
  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      e.age += dt;
      e.frame += dt * e.speed * 25;

      if (e.frame >= e.keys - 0.01) {
        if (e.loopsLeft > 1) {
          e.loopsLeft -= 1;
          e.frame = 0;
        } else {
          // 停在最后一帧（多帧特效停在消散帧，单帧特效就保持原样）
          e.frame = e.keys - 0.01;
        }
      }
      applyActionPose(e.rig, e.action, e.frame, true);

      if (e.fly) {
        // 0 → 1 走完弹道，到位后停住（原版火球命中就换成命中特效）
        const t = Math.min(1, e.age / e.fly.time);
        e.root.position.lerpVectors(e.fly.from, e.fly.to, t);
      }

      if (e.spin) e.root.rotation.z += e.spin * dt;

      /* 速度推进（陨石下落 / 碎石抛物线）；触地就停在落点高度，剩下的寿命用来烧 */
      if (e.vel) {
        if (e.gravity) e.vel.z += e.gravity * dt;
        e.root.position.addScaledVector(e.vel, dt);
        // 只有**正在下落**才算触地：往上抛的碎石刚生成时 z 就在地面附近
        if (e.vel.z <= 0 && e.root.position.z <= e.groundZ) {
          e.root.position.z = e.groundZ;
          e.vel = undefined;
        }
      }

      if (e.glow) {
        // 光斑贴地跟随（火球飞过去时，地面那圈光也跟着走）
        e.glow.position.set(e.root.position.x, e.root.position.y, e.groundZ + 0.03);
        const gm = e.glow.material as THREE.MeshBasicMaterial;
        const lifeT = Math.min(1, e.age / Math.max(0.01, e.aliveFor));
        // 0.12 s 拉亮，之后随整体淡出归零
        fxAlpha(gm, 0.3 * (1 - lifeT) * Math.min(1, e.age / 0.12));
        const r0 = Number(e.glow.userData.baseRadius ?? 2);
        e.glow.scale.setScalar(r0 * (1 + lifeT * 0.45));
      }

      if (e.age >= e.aliveFor) {
        const k = 1 - (e.age - e.aliveFor) / FADE;
        if (k <= 0) {
          this.remove(i);
          continue;
        }
        for (const m of e.mats) fxAlpha(m, k);
      }
    }
  }

  private remove(index: number) {
    const e = this.active[index];
    e.done = true;
    this.scene.remove(e.root);
    if (e.glow) {
      this.scene.remove(e.glow);
      (e.glow.material as THREE.Material).dispose();
      e.glow = null;
    }
    for (const m of e.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    for (const m of e.mats) m.dispose();
    e.rig.skeleton.dispose();
    this.active.splice(index, 1);
  }

  /** 当前活着的特效数量（探针计数用） */
  get activeCount() {
    return this.active.length;
  }

  clear() {
    for (let i = this.active.length - 1; i >= 0; i--) this.remove(i);
  }

  /**
   * 预热：把模型和纹理提前拉下来。
   *
   * 第一次放某个技能时 `parseBmd` + 纹理解码要几百毫秒到一秒，点了 Cast 之后
   * 有一瞬间什么都没发生。进图后串行预热一遍，点击就是即时的。
   * 模型/纹理都有缓存，重复调用不会重复请求。
   */
  async warmUp(files: string[]) {
    for (const file of new Set(files)) {
      const bmd = await loadEffectBmd(file);
      if (!bmd) continue;
      for (const mesh of bmd.meshes) await loadTexture(SKILL_DIR, mesh.texturePath);
    }
  }

  /** 调试快照（探针断言用） */
  snapshot() {
    return this.active.map(e => ({
      id: e.id,
      file: e.file,
      frame: Number(e.frame.toFixed(2)),
      keys: e.keys,
      age: Number(e.age.toFixed(3)),
      meshes: e.meshes.length,
      // 落点（不是 root.position —— root 是骨骼原点，模型绕它居中/贴地）
      pos: [e.anchor.x, e.anchor.y, e.anchor.z].map(n => Number(n.toFixed(2))),
      /**
       * **实时的** root 位置。落点 `pos` 是生成时算好就不动的，
       * 而追踪弹（`flyTo`）每帧都在改 root —— 探针靠这个字段断言「它真的飞了」。
       */
      at: [e.root.position.x, e.root.position.y, e.root.position.z].map(n => Number(n.toFixed(2))),
      scale: e.root.scale.x,
      /** 绕竖轴朝向（MU 世界角度，0 = +X）；用来断言「没多转 90°」 */
      yaw: Number(e.yaw.toFixed(4)),
      /** 落点地面光斑（近似 AddTerrainLight）是否在 */
      glow: e.glow !== null,
      /**
       * 模型本地 **+Z** 经骨骼蒙皮后在世界上指向哪（单位向量）。
       *
       * 箭矢类模型（`Arrow01.bmd` 等）的顶点长轴就在本地 +Z，所以这个向量
       * 等于「箭头实际指向」。探针用它和飞行方向做点乘断言，比截图上量像素
       * 靠谱 —— 也正因为能看到这个值，才发现原版模型被骨骼绑成了世界 +Y。
       */
      axis: (() => {
        const bone = e.rig.bones[0];
        if (!bone) return [1, 0, 0];
        const dir = new THREE.Vector3(0, 0, 1).transformDirection(bone.matrixWorld);
        return [dir.x, dir.y, dir.z].map(n => Number(n.toFixed(3)));
      })(),
      /** 还在飞 / 还在下落（探针用来区分「没配」和「配了但没推进」） */
      fly: !!e.fly,
      vel: !!e.vel,
      live: e.root.visible && e.root.parent !== null,
    }));
  }
}
