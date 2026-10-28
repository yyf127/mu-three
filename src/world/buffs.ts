/**
 * buff（持续技能效果）视觉层。
 *
 * 0.97 的 buff 不是 UI 上的图标条 —— 是**挂在角色身上的特效**，靠状态位驱动。
 * 三条真相来源：
 *
 *   1. `0x07` 效果状态包：`C1 08 07 [state] [mask:LE16] [index:BE16]`
 *      （`EffectManager.cpp:816` `GCEffectStateSend`）
 *   2. 视野包的 `ViewSkillState`（进视野时身上的状态位已经在了）
 *   3. `0x1B` 取消技能效果：包体是**技能号**，客户端自己映射成掩码
 *      （`Net_Process.cpp:4841`）
 *
 * 客户端侧的动作在 `Net_Process.cpp:1386` `ApplyPersistentSkillEffect97k`：
 * 按掩码建/删特效，并且维持实体 `+120` 那个 `physicalEffects` 位图
 * （重复加同一个 buff 不会再建一份）。这里照同一套语义实现：
 * 位图去重，按位增删。
 *
 * ── 视觉为什么是程序化的 ──────────────────────────────────────────────
 * 原版那几个特效号（1150 生命之光 / 190 冰封 / 1274 火 / joint 266 守护之魂）
 * 都是**精灵池**里的编号，模型/贴图在二进制的一张表里，本仓库的反编译源码
 * 没有那张表（只有 `CreateEffect(1150, …)` 这种调用）。所以这里按「原版看起来
 * 是什么样」用现成贴图 + 几何体重建：
 *
 *   0x0001 中毒       绿色气泡上浮（`smoke01` 染绿）
 *   0x0002 冰冻       淡蓝冰壳（二十面体，半透明）
 *   0x0004 战神之力   脚下橙红火环 + 上浮火苗（`Fire02`）
 *   0x0008 守护之光   脚下蓝色法阵（`Magic_Ground2`，缓慢旋转）
 *   0x0010 生命之光   金色闪耀（`Shiny02` 三片绕身）
 *   0x0020 石化       冰壳（比冰冻更白、更实）
 *   0x0040 防御削弱   暗红雾（`smoke02`）
 *   0x0080 攻击削弱   暗紫雾
 *   0x0100 守护之魂   蓝色半透明球（呼吸缩放）
 *   0x0200 魔力削弱   暗蓝雾
 *
 * 数字都对得上原版的状态位，观感是「同一类特效」。以后找到原版那张特效号表，
 * 只要换掉 `build()` 里的贴图/尺寸，外面这套增删/跟随逻辑不用动。
 */

import * as THREE from 'three';
import { loadTexture } from '../core/texture';
import { STATE_BIT } from '../net/game';
import { additiveProps, fxAlpha } from '../core/additive';

const EFFECT_DIR = 'Data/Effect/';

/** 贴图缓存（同一张图被多个 buff 共用） */
const texCache = new Map<string, Promise<THREE.Texture | null>>();

async function spriteTex(file: string): Promise<THREE.Texture | null> {
  const hit = texCache.get(file);
  if (hit) return hit;
  const task = (async () => {
    const loaded = await loadTexture(EFFECT_DIR, file);
    if (!loaded) return null;
    // `loadTexture` 是给 BMD 用的（UV 反的），Sprite 要翻回来
    const tex = loaded.texture.clone();
    tex.flipY = true;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  })();
  texCache.set(file, task);
  return task;
}

/** 世界坐标里的角色位置（由调用方每帧提供） */
export interface ActorPos {
  x: number;
  y: number;
  z: number;
}

interface BuffVisual {
  mask: number;
  group: THREE.Group;
  /** 每帧自转/呼吸用 */
  tick: (t: number) => void;
  dispose: () => void;
}

/** 一个实体身上的全部 buff 视觉 */
interface BuffSet {
  mask: number;
  visuals: BuffVisual[];
  group: THREE.Group;
}

/** 一个 billboard 面片（加色） */
function sheet(
  tex: THREE.Texture | null,
  size: number,
  color: number,
  opacity: number,
  opts: { lift?: number; ground?: boolean } = {}
): THREE.Object3D {
  const mat = new THREE.MeshBasicMaterial({
    map: tex ?? undefined,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    ...additiveProps(),
    fog: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const geo = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(size);
  mesh.position.z = opts.lift ?? 0;
  if (!opts.ground) mesh.renderOrder = 12;
  // 面片默认躺在 XY 平面 → 世界是 Z-up，正好朝上；billboard 交给 sprite
  return mesh;
}

/** 面向相机的精灵 */
function billboard(
  tex: THREE.Texture | null,
  size: number,
  color: number,
  opacity: number
): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: tex ?? undefined,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    ...additiveProps(),
    fog: false,
    toneMapped: false,
  });
  const sp = new THREE.Sprite(mat);
  sp.scale.setScalar(size);
  sp.renderOrder = 12;
  return sp;
}

export class BuffLayer {
  private scene: THREE.Scene;
  private sets = new Map<number, BuffSet>();
  private time = 0;
  /** 本层用到的贴图（按文件名缓存 promise） */
  private texes = new Map<string, Promise<THREE.Texture | null>>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private tex(file: string) {
    let p = this.texes.get(file);
    if (!p) {
      p = spriteTex(file);
      this.texes.set(file, p);
    }
    return p;
  }

  /** 这个实体当前的状态位 */
  maskOf(id: number): number {
    return this.sets.get(id)?.mask ?? 0;
  }

  /** 全部在场 buff（调试/探针） */
  snapshot() {
    return [...this.sets.entries()].map(([id, s]) => ({
      id,
      mask: s.mask,
      visuals: s.visuals.length,
      /** 每个视觉挂了多少个子节点（贴图是异步加载的，几帧后才有） */
      parts: s.visuals.reduce((n, v) => n + v.group.children.length, 0),
      pos: [s.group.position.x, s.group.position.y, s.group.position.z].map(n => +n.toFixed(2)),
    }));
  }

  /**
   * 把某个实体的状态位设成 `mask`（等价于写实体 `+120` 的位图）。
   *
   * 语义和 `ApplyPersistentSkillEffect97k` 一致：**只处理变化的那几位**，
   * 重复设置同一个 buff 不会重建视觉（原版也是这么防抖的）。
   */
  set(id: number, mask: number) {
    let set = this.sets.get(id);
    if (!set) {
      if (mask === 0) return;
      set = { mask: 0, visuals: [], group: new THREE.Group() };
      set.group.name = `buffs:${id}`;
      this.scene.add(set.group);
      this.sets.set(id, set);
    }

    const added = mask & ~set.mask;
    const removed = set.mask & ~mask;

    if (removed) {
      for (const v of set.visuals) {
        if (v.mask & removed) {
          set.group.remove(v.group);
          v.dispose();
        }
      }
      set.visuals = set.visuals.filter(v => !(v.mask & removed));
    }

    if (added) {
      for (const bit of Object.values(STATE_BIT)) {
        if ((added & bit) === 0) continue;
        const v = this.build(id, bit);
        set.visuals.push(v);
        set.group.add(v.group);
      }
    }

    set.mask = mask;
    if (mask === 0 && set.visuals.length === 0) {
      this.scene.remove(set.group);
      this.sets.delete(id);
    }
  }

  /**
   * 只加不减 —— 视野包的语义。
   *
   * 原版对 `ViewSkillState` 只做 `ApplyPersistentSkillEffect97k(…, 1)`
   * （`Net_Process.cpp:3979/4069/4129`），从不因为它把位清掉；清只发生在
   * 实体离开视野（实体被删，特效跟着 owner 一起没）。这里照抄。
   */
  add(id: number, mask: number) {
    if (mask) this.set(id, this.maskOf(id) | mask);
  }

  /** 加一位 / 减一位（`0x07` 和 `0x1B` 都走这里） */
  applyBit(id: number, bit: number, on: boolean) {
    const cur = this.maskOf(id);
    this.set(id, on ? cur | bit : cur & ~bit);
  }

  clear(id: number) {
    this.set(id, 0);
  }

  /** 清空（换图 / 掉线时用） */
  clearAll() {
    for (const id of [...this.sets.keys()]) this.set(id, 0);
  }

  /**
   * 每帧调：把每个 buff 组挪到角色身上，并跑自转/呼吸。
   * `posOf` 拿不到位置（实体已离开视野）时**不删**，只是原地不动 ——
   * 真正的删除由 `0x14` 离开视野那条路调 `clear()`。
   */
  update(dt: number, posOf: (id: number) => ActorPos | null) {
    this.time += dt;
    const t = this.time;
    for (const [id, set] of this.sets) {
      const p = posOf(id);
      if (p) set.group.position.set(p.x, p.y, p.z);
      for (const v of set.visuals) v.tick(t);
    }
  }

  /** 按位造视觉 */
  private build(id: number, bit: number): BuffVisual {
    const group = new THREE.Group();
    group.name = `buff:${id}:${bit}`;
    const parts: THREE.Object3D[] = [];
    const tickers: ((t: number) => void)[] = [];

    switch (bit) {
      case STATE_BIT.REDUCE_MAGICDEFENSE: {
        // 守护之魂：蓝色半透明球 + 呼吸
        const geo = new THREE.SphereGeometry(0.95, 16, 12);
        const mat = new THREE.MeshBasicMaterial({
          color: 0x5fb6ff,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          ...additiveProps(),
          fog: false,
      // 原版 GL_SetBlendAdditive 会 glDisable(GL_FOG)：加色特效不吃雾
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const ball = new THREE.Mesh(geo, mat);
        ball.position.z = 0.95;
        ball.renderOrder = 11;
        group.add(ball);
        parts.push(ball);
        tickers.push(t => {
          const pulse = 1 + Math.sin(t * 3.2) * 0.06;
          ball.scale.setScalar(pulse);
        });
        break;
      }
      case STATE_BIT.HARDEN:
      case STATE_BIT.FREEZE: {
        // 冰封/石化：半透明冰壳（二十面体，低多边形更像 MU 的冰晶）
        const geo = new THREE.IcosahedronGeometry(0.85, 0);
        const mat = new THREE.MeshBasicMaterial({
          color: bit === STATE_BIT.HARDEN ? 0xbfe6ff : 0x8fc9ff,
          transparent: true,
          opacity: bit === STATE_BIT.HARDEN ? 0.34 : 0.24,
          depthWrite: false,
          ...additiveProps(),
          fog: false,
      // 原版 GL_SetBlendAdditive 会 glDisable(GL_FOG)：加色特效不吃雾
          toneMapped: false,
        });
        const ice = new THREE.Mesh(geo, mat);
        ice.position.z = 1.0;
        ice.scale.set(1, 0.95, 1.25);
        ice.renderOrder = 11;
        group.add(ice);
        parts.push(ice);
        tickers.push(t => {
          ice.rotation.z = t * 0.4;
        });
        break;
      }
      case STATE_BIT.DEFENSE: {
        // 守护之光：脚下法阵缓慢旋转
        void this.tex('Magic_Ground2.OZJ').then(tex => {
          const disk = sheet(tex, 2.2, 0x7fb8ff, 0.55, { ground: true, lift: 0.06 });
          disk.position.z = 0.06;
          group.add(disk);
          parts.push(disk);
          tickers.push(t => {
            disk.rotation.z = t * 0.5;
          });
        });
        break;
      }
      case STATE_BIT.ATTACK: {
        // 战神之力：脚下火环 + 两个上浮火苗
        void this.tex('Fire02.OZJ').then(tex => {
          const ring = sheet(tex, 2.0, 0xff8a3c, 0.5, { ground: true });
          ring.position.z = 0.06;
          group.add(ring);
          parts.push(ring);
          for (const [i, off] of [0, Math.PI].entries()) {
            const flame = billboard(tex, 1.1, 0xff7a26, 0.55);
            flame.position.set(Math.cos(off) * 0.35, Math.sin(off) * 0.35, 0.3 + i * 0.1);
            group.add(flame);
            parts.push(flame);
            tickers.push(t => {
              flame.position.z = 0.35 + ((t * 0.7 + i * 0.5) % 1) * 1.7;
              (flame.material as THREE.SpriteMaterial).opacity =
                0.6 * (1 - ((t * 0.7 + i * 0.5) % 1));
            });
          }
        });
        break;
      }
      case STATE_BIT.ADD_LIFE: {
        // 生命之光：三片金色闪耀绕身
        void this.tex('Shiny02.OZJ').then(tex => {
          for (let i = 0; i < 3; i++) {
            const sp = billboard(tex, 1.0, 0xffd766, 0.7);
            group.add(sp);
            parts.push(sp);
            const phase = (i / 3) * Math.PI * 2;
            tickers.push(t => {
              const a = t * 1.6 + phase;
              sp.position.set(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.8 + Math.sin(t * 2 + phase) * 0.25);
              (sp.material as THREE.SpriteMaterial).opacity = 0.45 + 0.3 * Math.sin(t * 4 + phase);
            });
          }
        });
        break;
      }
      case STATE_BIT.POISON: {
        // 中毒：绿色气泡上浮
        void this.tex('smoke01.OZJ').then(tex => {
          for (let i = 0; i < 4; i++) {
            const bub = billboard(tex, 0.45, 0x6cff6c, 0.55);
            group.add(bub);
            parts.push(bub);
            const phase = i / 4;
            tickers.push(t => {
              const k = (t * 0.5 + phase) % 1;
              const a = phase * 6.28;
              bub.position.set(Math.cos(a) * 0.35, Math.sin(a) * 0.35, 0.2 + k * 1.8);
              (bub.material as THREE.SpriteMaterial).opacity = 0.6 * (1 - k);
            });
          }
        });
        break;
      }
      case STATE_BIT.REDUCE_DEFENSE:
      case STATE_BIT.REDUCE_ATTACKDAMAGE:
      case STATE_BIT.REDUCE_MAGICPOWER: {
        // 三种 debuff：一口暗色雾，颜色区分（红/紫/蓝）
        const color =
          bit === STATE_BIT.REDUCE_DEFENSE
            ? 0xff4a3a
            : bit === STATE_BIT.REDUCE_ATTACKDAMAGE
              ? 0xb45cff
              : 0x4a6cff;
        void this.tex('smoke02.OZT').then(tex => {
          const cloud = billboard(tex, 1.6, color, 0.35);
          cloud.position.z = 1.0;
          group.add(cloud);
          parts.push(cloud);
          tickers.push(t => {
            cloud.scale.setScalar(1.6 + Math.sin(t * 2.2) * 0.12);
          });
        });
        break;
      }
      default:
        break;
    }

    const dispose = () => {
      for (const p of parts) {
        const mesh = p as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = (mesh as THREE.Mesh).material as THREE.Material | undefined;
        // 贴图是共享缓存，不 dispose
        mat?.dispose();
      }
      tickers.length = 0;
    };

    return {
      mask: bit,
      group,
      tick: t => {
        for (const f of tickers) f(t);
      },
      dispose,
    };
  }
}
