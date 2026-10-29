/**
 * 角色：player.bmd 提供骨架 + 141 组动作，装备 BMD 通过骨骼名映射蒙到同一骨架。
 */
import * as THREE from 'three';
import { parseBmd } from '../core/bmd';
import {
  MODEL_SCALE,
  Rig,
  applyActionPose,
  createBoneRemap,
  createRig,
  createSkinnedMesh,
  createStaticMeshes,
  getBoneMatrices,
} from '../core/model';
import { fetchBytes, loadTexture } from '../core/texture';
import { modelBlend } from '../core/blendHeuristic';
import { modelForClass, type ModelRef } from './monsterModels';
import { itemModelPath, PLAYER_DIR, type BodyGender } from './items';
import { bodyOfClass } from '../data/equipCatalog';
import { additiveProps } from '../core/additive';
import { attachGlow, glowSpecFor } from './itemGlow';
import { disposeGuildMark, guildMarkMesh, GUILD_MARK_POSE } from './guildMark';

/**
 * 0.97 客户端动作索引（按 player.bmd 的数据特征 + 客户端 SetAttackSpeed 校准）：
 *   1..11   stop 系列（6 帧、无根骨位移）
 *   13..20  walk 系列（7 帧、LockPositions=1、根骨位移 242.88）
 *   22..29  run 系列（同上，21/29 是泳姿 309.21）
 *   32/33   骑乘跑
 *   34      ATTACK_FIST（SetAttackSpeed 里 FIST 写在 P+548 = 16*34+4）
 *   35..55  各武器攻击
 */
export const PlayerAction = {
  STOP_MALE: 1,
  WALK_MALE: 13,
  RUN: 22,
  ATTACK_FIST: 34,
  ATTACK_SWORD1: 35,
};

/**
 * MU 的动画不是按时长播放的，而是「每帧前进 speed」（BMD__PlayAnimation 里
 * `*AnimationFrame += Speed`），speed 不在 BMD 文件里，由客户端按动作写入：
 *   OpenPlayers   → action 1..11 = 0.28，action 12..32 = 0.30，action 33 = 0.30
 *   SetAttackSpeed→ 攻击 = 0.6 + 攻击速度*0.004（拳）/ 0.25 + …（武器）
 * 原客户端以 ~25fps 跑，所以换算成秒：keys/s = speed × 25。
 */
const MU_REF_FPS = 25;

/**
 * BMD 模型本地空间面向 **-Y**，所以 yaw = atan2(dy,dx) + π/2。
 * 之前按 +Y 算导致角色「倒着走」。
 */
export const MODEL_YAW_OFFSET = Math.PI / 2;

const ACTION_SPEED: Record<number, number> = {
  [PlayerAction.STOP_MALE]: 0.28,
  [PlayerAction.WALK_MALE]: 0.3,
  [PlayerAction.RUN]: 0.3,
  [PlayerAction.ATTACK_FIST]: 0.68, // 0.6 + 攻速 20 × 0.004
  [PlayerAction.ATTACK_SWORD1]: 0.45,
};

const DEFAULT_ACTION_SPEED = 0.28;

/**
 * 格子中心相对格号的偏移。
 *
 * 地形顶点在整数上，所以格 `(x, y)` 的世界范围是 `[x, x+1)`，中心 `x + 0.5`。
 * 角色 `x/y` 存整数格号，渲染时补这半个格 —— 否则人永远站在四个格子的交点上，
 * 点击地面走过去会「差半格」。
 */
const CELL_CENTER = 0.5;

export class Actor {
  readonly root = new THREE.Group();
  readonly meshes: THREE.SkinnedMesh[] = [];
  /** 手持模型（武器 / 盾）。它们是骨骼的子节点，不在 meshes 里 */
  readonly props: THREE.Object3D[] = [];
  /**
   * 强化光效副本（见 `world/itemGlow`）。
   *
   * 它们和原网格**共享几何体**，所以清理时只能摘节点，绝不能 dispose 几何 ——
   * 因此单独一个数组，不混进 `meshes`（那个数组的清理逻辑会 dispose）。
   */
  readonly glows: THREE.Mesh[] = [];
  readonly rig: Rig;
  /** 翅膀：自带骨架的独立模型（见 buildWing），不是主角骨架的蒙皮 */
  wing: WingHandle | null = null;
  /** 守护 / 宠物（`Helper02` 小恶魔）：同样是独立骨架，挂在骨骼 34 */
  helper: HelperHandle | null = null;
  /** 战盟标志：贴在骨骼 26 上的 8×8 像素 billboard（见 `world/guildMark.ts`） */
  guildMark: THREE.Sprite | null = null;
  /** 当前整体透明度（瞬移用，见 `setFade`） */
  fadeAlpha = 1;
  /** 淡出期间的私有材质副本（原共享材质 → 副本） */
  private fadeMats = new Map<THREE.Mesh, { orig: THREE.Material | THREE.Material[]; own: THREE.Material }>();
  name: string;
  /** 玩家 / 怪物 / NPC：动作索引与 AI 行为不同 */
  kind: 'player' | 'monster' | 'npc' = 'player';
  /** 服务端 Class（怪物/NPC 才有） */
  cls = 0;

  action = 0;
  /** 覆盖动作速度（怪物等用默认值） */
  actionSpeed: number | null = null;
  frame = 0;
  loop = true;
  finished = false;

  /*
   * 逻辑位置：**整数格号**（= 服务端的 `lpObj->X/Y`）。
   *
   * 渲染时整体 +0.5 落到格心（见 `CELL_CENTER` 和 `update()`）——
   * 地形格 `(x, y)` 覆盖世界 `[x, x+1)`，一格的中心是 `x+0.5`。
   * 拆开这两个概念以后，「点哪走到哪」和「逻辑用整数」两个要求就不冲突了：
   *   - 玩家点地面 → `floor(点)` 得到格号 → 角色渲染在 `格号+0.5` = 就点在那
   *   - 距离 / 寻路 / 上报服务端全部用整数格号，不会出现 0.4999 这种误差
   */
  x = 0;
  y = 0;

  /** 渲染用的世界 X（格心） */
  get wx() {
    return this.x + CELL_CENTER;
  }

  /** 渲染用的世界 Y（格心） */
  get wy() {
    return this.y + CELL_CENTER;
  }
  z = 0;
  yaw = 0;

  constructor(name: string, rig: Rig) {
    this.name = name;
    this.rig = rig;
    this.root.add(rig.root);
  }

  play(action: number, loop = true) {
    if (this.action === action && loop) return;
    this.action = action;
    this.frame = 0;
    this.loop = loop;
    this.finished = false;
  }

  /**
   * 持械手（右手）的世界坐标 —— 武器拖尾每帧采样它。
   *
   * 对应源码 `AttackStage` 里的
   *   `BMD__TransformPosition(pModel, boneMat, localPos, worldPos, true)`
   * 结果存进 `o + 0x188`（`m_vPosSword`），`Trail_Render` 每帧把它推进拖尾点列。
   *
   * 这里取的是**挂武器的那根骨**（`MOUNT_BONES.right`）；骨骼矩阵是上一帧渲染时更新的，
   * 所以先手动 `updateMatrixWorld` 一次，免得拖尾永远慢半帧。
   */
  handPosition(out = new THREE.Vector3()): THREE.Vector3 {
    // 有武器就跟着**武器**走（刀在哪，光就在哪）
    const weapon = this.props.find(p => p.name.endsWith('@right'));
    if (weapon) {
      weapon.updateWorldMatrix(true, false);
      return weapon.getWorldPosition(out);
    }
    // 空手：退到持械手骨骼
    const bone = findBone(this.rig, 'right');
    if (!bone) return out.copy(this.root.position);
    this.rig.root.updateMatrixWorld(true);
    return bone.getWorldPosition(out);
  }

  update(dt: number) {
    const speed = this.actionSpeed ?? ACTION_SPEED[this.action] ?? DEFAULT_ACTION_SPEED;
    const action = this.rig.bmd.actions[this.action];
    const keys = action ? action.numKeys : 0;

    if (keys > 0) {
      this.frame += dt * speed * MU_REF_FPS;
      if (this.loop) {
        const loopLen = Math.max(1, this.rig.loopLen[this.action] ?? keys);
        if (this.frame >= loopLen) this.frame -= loopLen * Math.floor(this.frame / loopLen);
        if (this.frame < 0) this.frame += loopLen;
      } else if (this.frame >= keys - 0.01) {
        // 与原客户端一致：非循环动作停在 frameCount - 0.01
        this.frame = keys - 0.01;
        this.finished = true;
      }
    }

    applyActionPose(this.rig, this.action, this.frame, this.loop);
    this.tickWing(dt);
    this.tickHelper(dt);

    this.root.position.set(this.x + CELL_CENTER, this.y + CELL_CENTER, this.z);
    this.root.rotation.set(0, 0, this.yaw);
  }

  /**
   * 翅膀扇动：翅膀是**自己的骨架 + 自己的动作**（每个 Wing0x.bmd 只有 1 个动作，
   * 关键帧数就是一次扇动周期）。原版把翅膀当独立 PART 渲染，只借主角骨骼 47 的
   * 世界矩阵定位 —— 它的骨架和主角同名（Bone01..Bone09），但绑定姿势完全不同，
   * 所以**不能**当成主角骨架的蒙皮，否则顶点被双份变换、翅膀会碎成几块。
   *
   * 速度：`animationSystem.ts:159-163` 里只要动作号 < 15（待机）就是 4，
   * 走/跑给 16 —— 换成这里的「每帧前进量」就是 4/14 与 16/14。
   */
  private tickWing(dt: number) {
    const w = this.wing;
    if (!w) return;
    const keys = w.rig.bmd.actions[w.action]?.numKeys ?? 0;
    if (keys <= 0) return;
    if (w.paused) {
      applyActionPose(w.rig, w.action, w.frame, true);
      return;
    }

    w.speed = this.action >= 13 && this.action <= 32 ? WING_SPEED.move : WING_SPEED.idle;
    const loopLen = Math.max(1, w.rig.loopLen[w.action] ?? keys);
    w.frame += dt * w.speed * MU_REF_FPS;
    if (w.frame >= loopLen) w.frame -= loopLen * Math.floor(w.frame / loopLen);
    applyActionPose(w.rig, w.action, w.frame, true);
  }

  /** 换翅膀（传 null 摘掉）：根节点挂到背骨 47，旧节点先摘 */
  setWing(w: WingHandle | null) {
    this.wing?.root.removeFromParent();
    this.wing = w;
    if (!w) return;
    const bone = findBone(this.rig, 'back') ?? this.rig.root;
    bone.add(w.root);
  }

  /* ---- 战盟标志 ----------------------------------------------------- */

  /**
   * 换/摘战盟标志。`mark` 是服务端那 32 字节（8×8 的 4bit），`null` = 没有盟。
   *
   * 原版 `RenderGuildMarkOnShield` 把这块 quad 画在**骨骼 26**（`Bip01 R UpperArm`）
   * 上，位移 `(20,-5,-10)`、尺寸 `5×7`（游戏单位）。这里照抄骨骼与相对位移，
   * 尺寸和朝向留在 `guildMark.ts::GUILD_MARK_POSE` 里，实测微调。
   */
  setGuildMark(mark: Uint8Array | null) {
    if (this.guildMark) {
      disposeGuildMark(this.guildMark);
      this.guildMark = null;
    }
    if (!mark || mark.length < 32) return;
    const mesh = guildMarkMesh(mark);
    if (!mesh) return;
    const bone = this.rig.bones[GUILD_MARK_POSE.bone] ?? this.rig.root;
    mesh.position.fromArray(GUILD_MARK_POSE.offset);
    bone.add(mesh);
    this.guildMark = mesh;
  }

  /* ---- 守护 / 宠物 ------------------------------------------------- */

  /**
   * 挂守护（`Helper01..04`）。
   *
   * 原版 `Render_PlayerHelper`（`Render_PlayerEquipment.cpp:738`）只在这一种情况
   * 下画：**helper 槽类型 == 817**（= Helper02，小恶魔 Imp）。它做三件事：
   *
   *   1. `LinkBone = 34` —— 挂骨骼 34（不是背骨 47，也不是手骨 33/42）
   *   2. `PlaySpeed = 0.5` —— 动画半速播放
   *   3. `RenderLinkObject(20, 0, 0, …)` —— 位置 (20,0,0) 游戏单位 = (0.2,0,0) 米
   *
   * 另外在骨骼 34 的 `(20,0,15)` 处还有个 `CreateSprite(1150)` 的小光点，
   * 这里先不做（`world/sprites` 那套要单开一条贴图）。
   */
  setHelper(h: HelperHandle | null) {
    this.helper?.root.removeFromParent();
    this.helper = h;
    if (!h) return;
    // 骨骼 34 是原版写死的挂点；模型缺骨就退到根，至少别丢在原点
    const bone = this.rig.bones[HELPER_BONE] ?? this.rig.root;
    bone.add(h.root);
  }

  /** 守护的循环动画（和翅膀同一套：自有骨架 + 自有帧） */
  private tickHelper(dt: number) {
    const h = this.helper;
    if (!h) return;
    const keys = h.rig.bmd.actions[h.action]?.numKeys ?? 0;
    if (keys <= 0) return;
    const loopLen = Math.max(1, h.rig.loopLen[h.action] ?? keys);
    h.frame += dt * h.speed * MU_REF_FPS;
    if (h.frame >= loopLen) h.frame -= loopLen * Math.floor(h.frame / loopLen);
    applyActionPose(h.rig, h.action, h.frame, true);
  }


  /**
   * 骨架根节点必须进入场景图，否则骨骼矩阵不会更新；
   * 蒙皮网格本身挂到场景根（bindMatrix = identity，蒙皮结果直接是世界坐标）。
   */
  attachMeshes(scene: THREE.Scene) {
    scene.add(this.root);
    for (const m of this.meshes) {
      scene.add(m);
    }
  }

  /**
   * 换装：只替换网格，骨架 / 动作 / 位置全部保留。
   *
   * 蒙皮网格挂在场景根（bindMatrix = identity，蒙皮结果直接是世界坐标），
   * 手持模型挂在骨骼下，所以两边要分开摘。
   */
  setMeshes(skinned: THREE.SkinnedMesh[], props: THREE.Object3D[]) {
    this.clearGlows();
    // 换装会把旧网格 dispose，淡出副本跟着失效（不释放就是材质泄漏）
    for (const rec of this.fadeMats.values()) rec.own.dispose();
    this.fadeMats.clear();
    for (const m of this.meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.meshes.length = 0;
    for (const g of this.props) g.removeFromParent();
    this.props.length = 0;

    for (const m of skinned) {
      this.meshes.push(m);
      // 骨架根已经在场景里时，直接把新网格挂到同一个父节点
      if (this.root.parent) this.root.parent.add(m);
    }
    for (const g of props) this.props.push(g);

    // 换装时正好在淡出（比如瞬移途中被强制换装）→ 把透明度补到新网格上
    if (this.fadeAlpha < 0.999) this.setFade(this.fadeAlpha);
  }

  /** 加一批光效副本（几何共享，只记录节点） */
  addGlows(copies: THREE.Mesh[]) {
    for (const c of copies) this.glows.push(c);
  }

  /** 摘掉全部光效副本。不 dispose 几何（和原网格共用） */
  clearGlows() {
    for (const g of this.glows) g.removeFromParent();
    this.glows.length = 0;
  }

  /**
   * 整体透明度 —— 瞬移（`CreateTeleportBegin/End` 的 `owner[356]`）。
   *
   * 源码是**硬切**：begin 时 `alpha = 0`（瞬间消失），end 时 `alpha = 1`。
   * 所以这里不做补间，调用方给 0 / 1 就行；给中间值是留给以后做渐隐。
   *
   * ⚠️ 材质必须是**克隆副本**：`getBmdMaterial` 按贴图缓存共享，
   * 直接改 `opacity` 会把所有穿同一套装备的角色一起变透明
   * （强化染色那边已经踩过一次这个坑，见 `createPlayerSkinNpc`）。
   * 还原时把共享材质换回去并释放副本。
   */
  setFade(alpha: number) {
    const v = Math.max(0, Math.min(1, alpha));
    this.fadeAlpha = v;
    const restore = v >= 0.999;

    const targets: THREE.Mesh[] = [];
    const collect = (o: THREE.Object3D) =>
      o.traverse(c => {
        const mesh = c as THREE.Mesh;
        if (mesh.isMesh) targets.push(mesh);
      });
    for (const m of this.meshes) collect(m);
    for (const p of this.props) collect(p);
    if (this.wing) collect(this.wing.root);
    if (this.helper) collect(this.helper.root);

    for (const mesh of targets) {
      /*
       * `visible` 也要一起关：这些材质大多带 `alphaTest`（BMD 的镂空靠它），
       * 而 `alphaTest` 在部分 Three 版本里对 `opacity` 的响应不稳定 ——
       * 实测 opacity 已经 0 了，画面上人还在。硬关 visible 最稳。
       */
      mesh.visible = v > 0.001;
      const rec = this.fadeMats.get(mesh);
      if (restore) {
        if (!rec) continue;
        mesh.material = rec.orig;
        rec.own.dispose();
        this.fadeMats.delete(mesh);
        continue;
      }
      if (rec) {
        rec.own.opacity = v;
        rec.own.depthWrite = false;
        continue;
      }
      const src = mesh.material as THREE.Material | undefined;
      if (!src) continue;
      const own = src.clone();
      own.transparent = true;
      own.opacity = v;
      own.depthWrite = false;
      own.userData.owned = true;
      mesh.material = own;
      this.fadeMats.set(mesh, { orig: src, own });
    }
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.root);
    for (const m of this.meshes) {
      scene.remove(m);
      m.geometry.dispose();
    }
    this.meshes.length = 0;
  }
}

/** 角色装备（洛兰默认的骑士套装） */
/** BMD 解析结果缓存：远程玩家/怪物会反复用到同一批模型，避免重复解析 */
const bmdCache = new Map<string, ReturnType<typeof parseBmd>>();

async function loadBmd(url: string) {
  const hit = bmdCache.get(url);
  if (hit) return hit;
  const parsed = parseBmd(await fetchBytes(url));
  bmdCache.set(url, parsed);
  return parsed;
}

/** 把 Actor 从场景里摘掉并释放几何体 */
export function disposeActor(scene: THREE.Scene, actor: Actor) {
  scene.remove(actor.root);
  // 淡出副本是克隆出来的私有材质，缓存里那份不能碰
  actor.setFade(1);
  // 光效副本和原网格共享几何，先摘节点再让下面的 dispose 生效
  actor.clearGlows();
  if (actor.guildMark) {
    disposeGuildMark(actor.guildMark);
    actor.guildMark = null;
  }
  for (const mesh of actor.meshes) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    // 染色时克隆出来的「私有材质」要单独释放；缓存共享的那份不能碰
    const mat = mesh.material as THREE.Material & { userData?: { owned?: boolean } };
    if (mat?.userData?.owned) mat.dispose();
  }
  actor.meshes.length = 0;
}

/**
 * 穿戴槽（服务端 CItem::m_Slot）→ 部件。
 *
 * 原版 `RenderCharacter`（IDA 0x456770）按槽位画不同东西，这里同样的分法：
 *
 *   2 头盔 / 3 铠甲 / 4 护腿 / 5 护手 / 6 战靴
 *      —— 空槽不画「空」，而是退回**职业默认身体**：`CreateHero` 里
 *         BodyPart[1..5] = (Class&7) + 0x390 / 0x397 / 0x39e / 0x3a5 / 0x3ac，
 *         对应 HelmClass##/ArmorClass##/PantClass##/GloveClass##/BootClass##
 *         （`Model_Items.cpp:212-220` 里编号 = 0x38f+i 起的文件名）。
 *         这就是「没装备也要看得见人」的来源 —— player.bmd 只有骨架（0 个网格），
 *         光靠它一直是隐形的。
 *   0 武器 / 1 盾 —— 单骨静态模型：
 *      安全区 → 挂**骨骼 47（Bone05）**= 背上（`RenderCharacterBackItem`，LinkBone 47）
 *      非安全区 → 右手 33 `knife_gdf` / 左手 42 `hand_bofdgne01`
 *   7 翅膀 —— 模型自带 Bone01..Bone08，与 player.bmd 同名，蒙皮即可
 */
export interface EquipSet {
  weapon?: number;
  shield?: number;
  helm?: number;
  armor?: number;
  pants?: number;
  gloves?: number;
  boots?: number;
  wing?: number;
  helper?: number;
  /** 职业索引（服务端 `Class & 7`）—— 空槽用它挑 HelmClass## 等默认身体 */
  cls?: number;
  /** 安全区：武器背在背上（`RenderCharacterBackItem` 的 Bind 条件之一） */
  safeZone?: boolean;
  /**
   * 各槽的**强化等级**（`CItem::m_Level`，0..15）。
   *
   * 0.97 的视野包 `CharSet[11]` 只带物品类型、不带强化等级，所以这个字段
   * 只有「自己的角色」能填（来自背包 0xF3/0x10 的 `InventoryItem.level`）。
   * 远程玩家留空 = 全部按 +0 画，和原版的行为一致（原版也只有本地角色
   * 的 `pInventory[slot].Level` 可用）。
   */
  levels?: Partial<Record<EquipPartKey, number>>;
  /** 覆盖身体贴图（只有「玩家骨架 NPC」用得上，见 `monsterModels.PlayerSkin.skinTex`） */
  skinTex?: { dir: string; file: string };
}

/** 会带强化光效的槽位（戒指/项链/守护不画外观，也就不参与） */
export type EquipPartKey = 'weapon' | 'shield' | 'helm' | 'armor' | 'pants' | 'gloves' | 'boots' | 'wing';

/** 五个身体槽 + 对应的职业默认模型前缀 */
const CLASS_BODY: { key: EquipPartKey; prefix: string }[] = [
  { key: 'helm', prefix: 'HelmClass' },
  { key: 'armor', prefix: 'ArmorClass' },
  { key: 'pants', prefix: 'PantClass' },
  { key: 'gloves', prefix: 'GloveClass' },
  { key: 'boots', prefix: 'BootClass' },
];

/** 默认外观：不穿装备，只有职业默认身体 */
export const DEFAULT_EQUIPMENT: EquipSet = { cls: 0 };

/**
 * 挂点：先按名字找，找不到退回写死的骨骼号。
 *   right/left 来自 `Entity_Spawn.cpp:377` default 分支（Weapon[0]=33、Weapon[1]=42）
 *   back 来自 `Render_PlayerEquipment.cpp:704`（`*(BYTE*)(c+0x2A4) = 47`）
 */
const MOUNT_BONES = {
  right: { names: ['knife_gdf', 'Bip01 R Hand'], index: 33 },
  left: { names: ['hand_bofdgne01', 'Bip01 L Hand'], index: 42 },
  back: { names: ['Bone05'], index: 47 },
} as const;

/** 会画出来的守护/宠物（精灵 / 小恶魔）；418/419 是坐骑，原版也不画 */
const HELPER_RENDERABLE = new Set([416, 417]);

export type MountSide = keyof typeof MOUNT_BONES;

function findBone(rig: Rig, side: MountSide): THREE.Bone | null {
  const spec = MOUNT_BONES[side];
  for (const n of spec.names) {
    const i = rig.boneIndexByName.get(n);
    if (i !== undefined && rig.bones[i]) return rig.bones[i];
  }
  return rig.bones[spec.index] ?? null;
}

interface LoadedModel {
  bmd: ReturnType<typeof parseBmd>;
  dir: string;
  file: string;
}

/** 按 type 取装备 BMD（带缓存）。`body` 决定防具用 Male 还是 Elf 那套文件名 */
async function loadItemBmd(type: number, body: BodyGender = 'Male'): Promise<LoadedModel | null> {
  const path = itemModelPath(type, body);
  if (!path) return null;
  const file = path.file.toLowerCase().endsWith('.bmd') ? path.file : `${path.file}.bmd`;
  try {
    return { bmd: await loadBmd(`${path.dir}${file}`), dir: path.dir, file };
  } catch {
    console.warn(`[player] 缺装备模型 ${path.dir}${file}（type=${type}）`);
    return null;
  }
}

/**
 * 职业默认身体：`HelmClass01..05`，扩展职业用 `*Class201..203`。
 * 都没有就退回 01（宁可穿错一代，也比隐形强）。
 */
async function loadClassBody(
  playerDir: string,
  prefix: string,
  cls: number
): Promise<LoadedModel | null> {
  const n = (cls & 7) + 1;
  const candidates = [n, n >= 6 ? 200 + (n - 5) : 0, 1].filter(v => v > 0);
  for (const c of candidates) {
    const file = `${prefix}${String(c).padStart(2, '0')}.bmd`;
    try {
      return { bmd: await loadBmd(`${playerDir}${file}`), dir: playerDir, file };
    } catch {
      /* 试下一个 */
    }
  }
  console.warn(`[player] 找不到职业默认模型 ${prefix}##（cls=${cls}）`);
  return null;
}

/** 和主角同骨骼的部件（身体 / 翅膀） */
async function buildSkinnedPart(
  actor: Actor,
  model: LoadedModel,
  out: THREE.SkinnedMesh[],
  itemLevel = 0,
  skinTex?: { dir: string; file: string }
) {
  const { bmd, dir, file } = model;
  const remap = createBoneRemap(bmd, actor.rig);

  for (const mesh of bmd.meshes) {
    /*
     * `skinTex` = 换皮。原版黄金守卫（Class 236）就是「player.bmd 裸模
     * + `Npc/guard_gold2.OZJ`」—— 那身金甲不是装备模型，是一张贴图。
     * 换皮失败就退回原贴图，不至于整件装备消失。
     */
    const tex =
      (skinTex ? await loadTexture(skinTex.dir, skinTex.file) : null) ??
      (await loadTexture(dir, mesh.texturePath));
    if (!tex) continue;
    const mb = modelBlend(tex.texture, tex.tag === 'blend', mesh.texturePath);
    const skinned = createSkinnedMesh(
      bmd, mesh, actor.rig, remap, tex.texture, mb.cutout, mb.soft, mb.additive
    );
    skinned.name = `${file}:${mesh.texturePath}`;
    // 强化等级挂在网格上，等入场景后统一建光效副本（见 applyEquipment 末尾）
    skinned.userData.itemLevel = itemLevel;
    out.push(skinned);
  }
}

/**
 * 背武器的姿态。
 *
 * 直接照抄 `RenderLinkObject` 的 pose 表，不再自己凑基变换。
 *
 * 安全区背挂的调用是 `RenderLinkObject(0, 0, 15, …, Link=1, …)`；`Link=1`
 * 走 linked path，而 `param_1/2/3`（那三个 `0, 0, 15`）**只在 `Link=0` 的
 * 非链接分支里被读到**（`RenderLinkObject.cpp` 全文就那 3 行）。所以位置和
 * 朝向全部来自 pose 表：一个欧拉角 + 一个平移列，`R_ConcatTransforms` 把
 * 它乘到骨骼 47 上。
 *
 * 实测武器包围盒 y 范围 `[-0.13 .. 1.02]`：握把在原点、刀身朝 **+Y** 伸出，
 * 也就是刀梢在 +Y（旧注释写的 -Y 是错的，换 pose 后朝向断言整体反号才发现）。
 * 注意**剑类是个例外**：type 0..31 的剑/匕首刀身建在 −Y，包围盒 `y[-0.65..0.10]`，
 * 具体要不要再翻见 `BACK_FLIP`。
 *
 * 源码 pose 本身对斧/锤/杖/弓/矛是「柄在上、头朝下」，所以这些要再绕模型自身
 * 中心转 180°（`flipInPlace`，位置不动）；剑类不能翻（翻了就是尖朝天）；
 * 盾牌也**不翻**：盾面朝外才是正面（`Shield01` 中央那个金属凸起对着镜头），
 * 转了就看到内衬和绑带了。
 */
export const BACK_POSE = {
  /**
   * 源码 pose 的欧拉角（**度**，值依次是 X / Y / Z）。
   *
   * `RenderLinkObject.cpp` 的通用武器分支：`afStack_264[3..5] = (70, 0, 90)`
   * 然后 `Matrix_BuildFromEuler` → `R = Rz(z)·Ry(y)·Rx(x)`（源码展开式与
   * 标准 ZYX 完全一致，已逐项对过）。
   */
  euler: [70, 0, 90] as [number, number, number],
  /**
   * 源码 pose 的平移列（**格**）。原值是 `(-20, 5, 40)`，游戏单位 /100。
   *
   * 这一组只对通用武器有效；盾牌（592..623）和「第二件」各有自己的表，
   * 见 `BACK_POSE_SECOND`。
   */
  offset: [-0.2, 0.05, 0.4] as [number, number, number],
  /**
   * 第二件（背挂时盾牌是 index 1）的 pose：源码走
   * `g_BackItemHand != 0` 分支 → `Angle(-110, 180, 90)` + `trans(20, 15, 40)`。
   *
   * 只对「第二把武器」成立；盾牌要更优先的盾表，见 `shieldOffset`。
   */
  secondEuler: [-110, 180, 90] as [number, number, number],
  secondOffset: [0.2, 0.15, 0.4] as [number, number, number],
  /**
   * 盾牌：源码在 `g_BackItemHand` 之前先判 `param_6 >= 592 && < 624`，
   * 绝大多数盾落到「其余盾」分支 —— **沿用通用角度** `(70, 0, 90)`，
   * 只换平移 `trans(-10, 10, 0)`。
   *
   * （`598` 骷髅盾、`605` 龙盾、`606/607` 传说/大天使、`608` 元素盾各有
   * 自己的角度，要按模型号细分；我们现在拿不到可靠的「模型号 → item type」
   * 映射，先统一按多数分支走。）
   */
  shieldOffset: [-0.1, 0.1, 0] as [number, number, number],
};

/** 调试用：运行时改背武器姿态，探针一次性试多个候选 */
export function setBackPose(p: Partial<typeof BACK_POSE>) {
  Object.assign(BACK_POSE, p);
}

/**
 * 背挂时要**绕模型自身中心再转 180°**的物品。
 *
 * 源码 pose 表对所有武器用同一个姿势（`(70, 0, 90)` + `trans(-20, 5, 40)`），
 * 但各家美术的建模基准不一样：
 *
 *   - 斧 / 锤 / 杖 / 弓 / 矛：刀身建在 **+Y**（握把在原点、梢头朝 +Y），
 *     直接挂上去是「柄在上、头朝下」，再翻 180° 才是柄朝下、头朝上；
 *   - **剑类（item type 0..31）恰好相反**：模型包围盒 `y[-0.65 .. 0.10]`，
 *     刀身朝 **−Y**，挂上去本来就已经是「柄在肩、尖朝下」——再翻就变成
 *     尖朝天插在背上（就是这次报的问题）。
 *
 * 所以按 item type 的 32 一组来判，**剑组不翻、其余照翻**。
 * （`weapon` 是探针 A/B 用的总开关，正常保持 true。）
 */
export const BACK_FLIP = {
  weapon: true,
  /**
   * 不翻的大类（`Math.floor(type / 32)`）。
   *
   * `0` = 剑 / 匕首 / 短刀（item type 0..31）。盾牌走单独的 `false` 分支，
   * 不在这个集合里讨论。
   */
  keep: new Set([0]),
};

/** 这件物品背挂时要不要头尾对调（剑类不要，盾牌另有分支） */
export function backFlipOf(type: number): boolean {
  return BACK_FLIP.weapon && !BACK_FLIP.keep.has(Math.floor(type / 32));
}

/* ------------------------------------------------------------------ */
/* 翅膀                                                                */
/* ------------------------------------------------------------------ */

/**
 * 翅膀扇动速度（MU 语义：每次 update 前进 `speed`，乘 25fps 换成「关键帧/秒」）。
 *
 * 翅膀文件只有 1 个动作，7 帧就是一次完整扇动（末帧≈首帧，实际循环 6 帧）。
 * `animationSystem.ts:159-163` 里待机给 4、走跑给 16（基准 14），换算：
 *   待机 4/14 ≈ 0.29 → 6 帧一次 ≈ 0.83 s
 *   走跑 16/14 ≈ 1.14 → ≈ 0.21 s（跑起来确实扇得很急）
 * 这里取 0.3 / 0.9 两者之间偏稳一点的值，`setWingPose` 旁边留了常量方便再调。
 */
export const WING_SPEED = { idle: 0.3, move: 0.9 };

/**
 * 哪些翅膀模型要整体翻 180°。
 *
 * MU 的翅膀不是同一套美术基准建的：精灵翼（Wing01/Wing04）的翼骨链在模型里
 * 已经带 +Z 分量（Bone03 的局部位置 z=25.6），挂上去自然向上展开；
 * 天使 / 恶魔（Wing02/Wing03）的翼骨链是纯水平的（z=0），翼膜又往 -Z 垂，
 * 挂到背骨 47 上就是「翼尖朝下」—— 看起来整对翅膀倒挂着。
 *
 * 原版靠 `RenderLinkObject` 里每个 type 一组 `AngleMatrix` 角度兜住，
 * 这里同样按模型号给补偿：绕模型左右轴再翻 π，翼尖就朝上了。
 */
export const WING_FLIP = new Set([2, 3]); // Wing02 = Wings of Heaven，Wing03 = Wings of Satan

/**
 * 翅膀挂点修正。
 *
 * 翅膀 BMD 是照「角色原点」建模的（骨骼 Bone01 就在 (0,0,0) 附近，翼展铺在
 * X-Z 平面上），所以挂到哪根骨头上，翼根就落在那个骨骼的原点高度。
 * 而挂点骨骼 47（Bone05，Bip01 Spine 的子骨）在**腰背**：实测 z ≈ 1.63 m
 * （角色身高 2.25 m、肩线 Bip01 Clavicle ≈ 1.90 m），直接挂上去整对翅膀就
 * 卡在腰上。原版靠 `Entity_Spawn` 里写死的 `BoneOffset(-60)` 往上推，
 * 这里等价成骨骼局部偏移。
 *
 * 实测 Bone05 的局部轴（角色局部坐标）：+Z ≈ (0.22, -0.07, 0.97) —— 基本朝上，
 * 但带 13° 的体侧倾斜。所以「沿 +Z 抬 0.28」会同时往 +X 甩 0.06 m，
 * 用 `offset[0] = -0.06` 抵掉，翼根就正好落在两肩中间。
 *   0.28 × 0.973 ≈ 0.27 m  → 翼根 1.61 → 1.88 m（肩胛）
 */
export const WING_POSE = {
  /** 骨骼局部：+Z 朝上、+Y 朝背后、+X 朝体侧（和背挂武器同一套轴） */
  offset: [-0.06, 0.12, 0.3] as [number, number, number],
  /** 欧拉角（弧度）：绕左右轴前倾一点，别让翼面完全垂直 */
  rx: -0.15,
  ry: 0,
  rz: 0,
};

/** 调试用：运行时改翅膀挂点，探针一次性试多个候选 */
export function setWingPose(p: Partial<typeof WING_POSE>) {
  Object.assign(WING_POSE, p);
}

/** 把 WING_POSE（+ 该模型的翻转）写到翅膀根节点 */
export function applyWingPose(w: WingHandle) {
  w.root.position.fromArray(WING_POSE.offset);
  w.root.rotation.set(
    WING_POSE.rx + (w.flip ? Math.PI : 0),
    WING_POSE.ry,
    WING_POSE.rz
  );
}

/* ------------------------------------------------------------------ */
/* 守护 / 宠物                                                         */
/* ------------------------------------------------------------------ */

/** 原版写死的守护挂点：`Render_PlayerEquipment.cpp:741` 的 `c+0x2BC = 34` */
const HELPER_BONE = 34;

/** 守护把手：自有骨架 + 自有循环帧，根节点挂骨骼 34 */
export interface HelperHandle {
  root: THREE.Group;
  rig: Rig;
  action: number;
  frame: number;
  /** 原版 `PlaySpeed = 0.5`（`Render_PlayerEquipment.cpp:742`） */
  speed: number;
}

/**
 * 守护的位置 / 播放速度。原版 `RenderLinkObject(20, 0, 0, …)` 的单位是
 * 游戏单位（1 米 = 100），所以是 `(0.2, 0, 0)`。
 *
 * 如果位置看着不对，先用 `__MU_APP__.helperPose({offset:[x,y,z]})` 试，
 * 找到合适的再写回来 —— 骨骼 34 的局部轴和世界轴不是一回事。
 */
export const HELPER_POSE = {
  offset: [0.2, 0, 0] as [number, number, number],
  speed: 0.5,
};

/** 调试用：运行时改守护姿态 */
export function setHelperPose(p: Partial<{ offset: [number, number, number]; speed: number }>) {
  Object.assign(HELPER_POSE, p);
}

/** 翅膀把手：自带骨架 + 扇动帧，根节点挂背骨 */
export interface WingHandle {  root: THREE.Group;
  rig: Rig;
  /** 现在只用到 action 0（翅膀文件只有 1 个动作） */
  action: number;
  frame: number;
  speed: number;
  /** 纹理混合方式：JPG 翅膀靠亮度去黑底，TGA 翅膀走 alpha 混合 */
  blend: WingBlend;
  /** 这个模型要不要绕左右轴再翻 180°（见 WING_FLIP） */
  flip: boolean;
  /** 调试用：冻住扇动（探针逐帧看翼面形状） */
  paused?: boolean;
}

const wingMaterialCache = new Map<string, THREE.Material>();

/**
 * JPG 翅膀用哪种方式把黑底去掉：
 *   `lum` 亮度当 alpha —— 黑底透明，翼面保留原来的明暗（默认）
 *   `add` 加色混合   —— 黑底也「不加色」，效果相近但暗部直接消失
 * 留成开关是因为两种观感差异明显，探针/人眼可以来回切。
 */
export const WING_BLEND: { jpg: 'lum' | 'add' } = { jpg: 'add' };

export type WingBlend = 'alpha' | 'lum' | 'add';

function wingMode(tag: string): WingBlend {
  return tag === 'blend' ? 'alpha' : WING_BLEND.jpg;
}

/**
 * 翅膀材质。
 *
 * 两套纹理长得完全不一样，得分开处理：
 *   `elfin_wing.OZJ` / `NewingEl.OZJ` —— 带黑底的 JPEG，**没有 alpha 通道**；
 *   `angel_wing.OZT` / `devil_wing.OZT` —— 32 位 TGA，alpha 是真的（0/255 加渐变）。
 *
 * 所以 JPG 那两对用加色混合（黑=0 直接消失，羽翼通透发光，和原版观感一致），
 * TGA 那两对用普通 alpha 混合。两边都必须双面 —— 翼面是单层三角面，
 * 从背后看要被剔除的话整对翅膀就没了。
 */
function wingMaterial(tex: { texture: THREE.Texture; tag: string }): THREE.Material {
  const blend = wingMode(tex.tag);
  const key = `${tex.texture.uuid}|${blend}`;
  const hit = wingMaterialCache.get(key);
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
  } else if (blend === 'lum') {
    // JPG 翅膀：黑底没有 alpha，用亮度当 alpha（原版靠加色混合同理）
    mat.alphaTest = 0.05;
    mat.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          sampledDiffuseColor.a *= max(max(sampledDiffuseColor.r, sampledDiffuseColor.g), sampledDiffuseColor.b);
          diffuseColor *= sampledDiffuseColor;
        #endif`
      );
    };
  } else {
    mat.blending = THREE.NormalBlending;
    mat.alphaTest = 0.02;
  }
  mat.name = `wing:${blend}`;
  wingMaterialCache.set(key, mat);
  return mat;
}

/**
 * 建翅膀。
 *
 * 关键点：**不能**按骨骼名把翅膀蒙到主角骨架上。翅膀的 `Bone01..Bone09`
 * 和主角背骨同名，但那是两套完全不同的绑定姿势 —— 硬蒙的结果是顶点被
 * 「主角骨骼矩阵 × 主角绑定逆矩阵」再变换一次，翼面直接被撕成几片，
 * 看起来就是「网格不对、纹理对不上」。
 *
 * 正确做法（`RenderLinkObject` 的 Link=1 分支 + muonlinejs `playerObject.ts:76-78`）：
 * 翅膀拿**自己的骨架**按自己的 action 播扇动，整体再挂到背骨 47 上。
 */
async function buildWing(type: number): Promise<{ handle: WingHandle; meshes: THREE.SkinnedMesh[] } | null> {
  const loaded = await loadItemBmd(type);
  if (!loaded) return null;
  const { bmd, dir, file } = loaded;

  const rig = createRig(bmd, MODEL_SCALE);
  // 自己的骨架 → 索引原样映射
  const identity = (n: number) => n;
  const meshes: THREE.SkinnedMesh[] = [];

  for (const mesh of bmd.meshes) {
    const tex = await loadTexture(dir, mesh.texturePath);
    if (!tex) continue;
    const skinned = createSkinnedMesh(bmd, mesh, rig, identity, tex.texture, true);
    skinned.material = wingMaterial(tex);
    skinned.name = `${file}:${mesh.texturePath}`;
    meshes.push(skinned);
  }
  if (!meshes.length) return null;

  const root = new THREE.Group();
  root.name = 'wingRoot';
  root.add(rig.root);

  // 模型号决定要不要翻（Wing02 = 天使 / Wing03 = 恶魔 是「翼尖朝下」建的）
  const wingNo = Number(/Wing(\d+)/i.exec(file)?.[1] ?? 0);
  const handle: WingHandle = {
    root,
    rig,
    action: 0,
    frame: 0,
    speed: WING_SPEED.idle,
    blend: wingBlendOf(loaded),
    flip: WING_FLIP.has(wingNo),
  };
  applyWingPose(handle);

  return { handle, meshes };
}

/**
 * 建一个守护 / 宠物（`Helper01..04`，item type 416..419）。
 *
 * 和翅膀一样是**自带骨架的独立模型**：BMD 里骨骼命名和 player.bmd 完全不同，
 * 不能当主角骨架的蒙皮，只能把它的骨骼根挂到主角的骨骼 34 上。
 * 蒙皮网格本身仍然加到场景根（`bindMatrix = identity`，蒙皮结果直接是世界坐标）。
 */
async function buildHelper(
  type: number
): Promise<{ handle: HelperHandle; meshes: THREE.SkinnedMesh[] } | null> {
  const loaded = await loadItemBmd(type);
  if (!loaded) return null;
  const { bmd, dir, file } = loaded;

  const rig = createRig(bmd, MODEL_SCALE);
  const identity = (n: number) => n;
  const meshes: THREE.SkinnedMesh[] = [];

  for (const mesh of bmd.meshes) {
    const tex = await loadTexture(dir, mesh.texturePath);
    if (!tex) continue;
    const mb = modelBlend(tex.texture, tex.tag === 'blend', mesh.texturePath);
    const skinned = createSkinnedMesh(
      bmd,
      mesh,
      rig,
      identity,
      tex.texture,
      mb.cutout,
      mb.soft,
      mb.additive
    );
    skinned.name = `${file}:${mesh.texturePath}`;
    meshes.push(skinned);
  }
  if (!meshes.length) return null;

  const root = new THREE.Group();
  root.name = 'helperRoot';
  root.add(rig.root);
  root.position.fromArray(HELPER_POSE.offset);

  return {
    handle: { root, rig, action: 0, frame: 0, speed: HELPER_POSE.speed },
    meshes,
  };
}

/** 翅膀纹理的混合方式：`.tga`（OZT）走 alpha，`.jpg`（OZJ）走加色 */
function wingBlendOf(loaded: LoadedModel): WingBlend {  const tex = loaded.bmd.meshes[0]?.texturePath ?? '';
  return wingMode(/\.tga$/i.test(tex) ? 'blend' : 'opaque');
}

/**
 * 源码 `Matrix_BuildFromEuler`：欧拉角（度）→ 3×3 旋转。
 *
 * `RenderLinkObject.cpp` 的展开式逐项对过，等价于 **R = Rz(z)·Ry(y)·Rx(x)**：
 * ```
 * [ cy·cz              sx·sy·cz - cx·sz   cx·sy·cz + sx·sz ]
 * [ cy·sz              sx·sy·sz + cx·cz   cx·sy·sz - sx·cz ]
 * [ -sy                sx·cy              cx·cy            ]
 * ```
 */
function eulerMatrix([x, y, z]: readonly [number, number, number]): THREE.Matrix4 {
  const X = (x * Math.PI) / 180;
  const Y = (y * Math.PI) / 180;
  const Z = (z * Math.PI) / 180;
  const cx = Math.cos(X), sx = Math.sin(X);
  const cy = Math.cos(Y), sy = Math.sin(Y);
  const cz = Math.cos(Z), sz = Math.sin(Z);
  return new THREE.Matrix4().set(
    cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz, 0,
    cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz, 0,
    -sy, sx * cy, cx * cy, 0,
    0, 0, 0, 1
  );
}

/**
 * 把 `group` 里已有的子件搬进一个「绕模型自身中心转 180°」的中间层。
 *
 * **位置不动**：绕中心转，模型占据的空间范围完全不变，只换头尾朝向。
 *
 * ⚠️ 中心必须用 **group 局部**坐标算。上一版直接 `Box3.expandByObject()`
 * ——它用的是 `object.matrixWorld`，而此时 group 已经设好了 pose（欧拉角 +
 * 平移列），算出来的盒子在**骨骼空间**里，却被当成 group 局部坐标去补
 * `(0, 2cy, 2cz)`，于是每件武器被推走 `2×(骨骼空间里的中心)`：短剑顶到
 * 头顶、长矛扎进地里，看着就是「有的偏高」。
 *
 * 现在把每个网格的世界矩阵先乘 `group.matrixWorld⁻¹` 换回局部，再并成
 * 一个 AABB，中心才和 `inner.position` 在同一个坐标系里。
 */
function flipInPlace(group: THREE.Group): void {
  group.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const box = new THREE.Box3();
  group.traverse(o => {
    if (!(o as THREE.Mesh).isMesh) return;
    const geo = (o as THREE.Mesh).geometry;
    geo.computeBoundingBox();
    if (!geo.boundingBox) return;
    const m = new THREE.Matrix4().multiplyMatrices(toLocal, o.matrixWorld);
    box.union(geo.boundingBox.clone().applyMatrix4(m));
  });
  if (box.isEmpty()) return;

  const c = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  inner.name = 'flip180';
  // 模型 X 轴是刀面法线，绕它转 180° = 头尾对调、刀面朝向不变
  inner.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  // p → R·(p−c)+c = R·p + (c − R·c)，R = diag(1,−1,−1) ⇒ t = (0, 2cy, 2cz)
  inner.position.set(0, 2 * c.y, 2 * c.z);
  for (const child of [...group.children]) inner.add(child);
  group.add(inner);
}

async function buildHeldItem(
  actor: Actor,
  type: number,
  side: MountSide,
  index = 0,
  itemLevel = 0
): Promise<THREE.Group | null> {
  const loaded = await loadItemBmd(type);
  if (!loaded) return null;
  const { bmd, dir } = loaded;

  const ownRig = createRig(bmd, MODEL_SCALE);
  const boneMats = getBoneMatrices(ownRig);

  const group = new THREE.Group();
  group.name = `held:${type}@${side}`;
  for (const mesh of bmd.meshes) {
    const tex = await loadTexture(dir, mesh.texturePath);
    if (!tex) continue;
    const mb = modelBlend(tex.texture, tex.tag === 'blend', mesh.texturePath);
    const { geometries, material } = createStaticMeshes(
      { ...bmd, meshes: [mesh] },
      boneMats,
      tex.texture,
      mb.cutout,
      MODEL_SCALE,
      mb.additive,
      mb.soft
    );
    for (const geo of geometries) {
      const m = new THREE.Mesh(geo, material);
      m.userData.itemLevel = itemLevel;
      group.add(m);
    }
  }
  if (!group.children.length) return null;

  if (side === 'back') {
    // 盾（item type group 6 = 192..223）走源码的盾表，优先于「第二件」那组
    const isShield = Math.floor(type / 32) === 6;
    const pose = isShield
      ? { euler: BACK_POSE.euler, offset: BACK_POSE.shieldOffset }
      : index > 0
        ? { euler: BACK_POSE.secondEuler, offset: BACK_POSE.secondOffset }
        : { euler: BACK_POSE.euler, offset: BACK_POSE.offset };
    group.quaternion.setFromRotationMatrix(eulerMatrix(pose.euler));
    group.position.set(pose.offset[0], pose.offset[1], pose.offset[2]);
    // 剑类是「柄上尖下」的建模基准，翻了就成尖朝天 —— 见 BACK_FLIP；
    // 盾牌也不翻（盾面得朝外，转了就看到内衬和绑带）
    if (!isShield && backFlipOf(type)) flipInPlace(group);
  }

  const bone = findBone(actor.rig, side);
  if (!bone) return null;
  bone.add(group);
  return group;
}

export interface EquipmentResult {
  skinned: string[];
  held: { name: string; mount: MountSide }[];
  /** 翅膀：自带骨架、自己扇；没有就是 null */
  wing: { name: string; bones: number; keys: number; blend: WingBlend } | null;
  /** 守护 / 宠物：同样是自带骨架的独立模型，挂在骨骼 34 */
  helper: { name: string; bones: number; keys: number } | null;
}

/**
 * 重建主角的装备外观。
 *
 * 只换网格，不动骨架 —— 位置/朝向/当前动作都保留，穿脱装备时不会「闪一下」。
 * 返回实际生成的部件，探针用它断言「身体用了几件职业默认 / 武器挂在哪个骨骼」。
 */
export async function applyEquipment(
  actor: Actor,
  playerDir: string,
  equip: EquipSet
): Promise<EquipmentResult> {
  const skinned: THREE.SkinnedMesh[] = [];
  const cls = equip.cls ?? 0;
  // 防具文件名带体型：精灵（Class 2）用 HelmElf/ArmorElf…，其余用 Male。
  // 0.97 的客户端只有这两套（`Model_Items.cpp:246` / `:256`），选错就是 404。
  const body = bodyOfClass(cls);

  // 身体：有装备用装备，没装备退职业默认（永远画满 5 件，角色不再隐形）
  for (const part of CLASS_BODY) {
    const type = equip[part.key];
    const lv = equip.levels?.[part.key] ?? 0;
    const byItem = type !== undefined ? await loadItemBmd(type, body) : null;
    const model = byItem ?? (await loadClassBody(playerDir, part.prefix, cls));
    // 职业默认身体没有强化等级（它不是「物品」），只有真装备才吃 +N
    if (model) await buildSkinnedPart(actor, model, skinned, byItem ? lv : 0, equip.skinTex);
  }

  let wingInfo: EquipmentResult['wing'] = null;
  if (equip.wing !== undefined) {
    const built = await buildWing(equip.wing);
    if (built) {
      const lv = equip.levels?.wing ?? 0;
      for (const m of built.meshes) {
        m.userData.itemLevel = lv;
        skinned.push(m);
      }
      actor.setWing(built.handle);
      wingInfo = {
        name: built.meshes[0]?.name ?? '',
        bones: built.handle.rig.bones.length,
        keys: built.handle.rig.bmd.actions[built.handle.action]?.numKeys ?? 0,
        blend: built.handle.blend,
      };
    } else {
      actor.setWing(null);
    }
  } else {
    actor.setWing(null);
  }

  // 守护 / 宠物（`Helper01..04`）。原版只在 helper 类型 == 817 时才画，
  // 但模型路径解析（group 13 → Helper0N）对 416..419 都成立，所以这里放开，
  // 让 816 精灵 / 818 独角兽 / 819 恐龙也能显示 —— 观感差异留给实测再调。
  let helperInfo: EquipmentResult['helper'] = null;
  /*
   * 只有 416/417（Helper01 精灵 / Helper02 小恶魔）会画：它们是「跟着飞」的宠物，
   * 自带 8 骨 7 帧的循环动画。
   *
   * 418/419（独角兽 / 恐龙头）是**骑乘坐骑**，原版客户端也不给它们开这条分支
   * （`Render_PlayerHelper` 第一行 `if (helper != 817) return`，817 就是
   * Helper02 的模型号）—— 它们只有 2 骨 1 帧的静态模型，摆在肩上会像一块板子。
   * 骑乘本身是服务端行为（移动速度/姿态），客户端这边不画。
   */
  if (equip.helper !== undefined && HELPER_RENDERABLE.has(equip.helper)) {
    const built = await buildHelper(equip.helper);
    if (built) {
      for (const m of built.meshes) skinned.push(m);
      actor.setHelper(built.handle);
      helperInfo = {
        name: built.meshes[0]?.name ?? '',
        bones: built.handle.rig.bones.length,
        keys: built.handle.rig.bmd.actions[0]?.numKeys ?? 0,
      };
    } else {
      actor.setHelper(null);
    }
  } else {
    actor.setHelper(null);
  }

  // 武器/盾：安全区背在背上，非安全区握在手里
  const onBack = equip.safeZone === true;
  const held: THREE.Object3D[] = [];
  const heldInfo: { name: string; mount: MountSide }[] = [];
  // 背挂朝向在 buildHeldItem 里按物品类判（剑不翻、盾不翻），这里只决定挂哪
  const slots: [EquipPartKey, number | undefined, MountSide][] = [
    ['weapon', equip.weapon, onBack ? 'back' : 'right'],
    ['shield', equip.shield, onBack ? 'back' : 'left'],
  ];
  for (const [key, type, mount] of slots) {
    if (type === undefined) continue;
    const obj = await buildHeldItem(actor, type, mount, held.length, equip.levels?.[key] ?? 0);
    if (obj) {
      held.push(obj);
      heldInfo.push({ name: obj.name, mount });
    }
  }

  actor.setMeshes(skinned, held);

  /*
   * 强化光效：**必须在 `setMeshes` 之后**建 —— `attachGlow` 要往「源网格
   * 现在的父节点」上挂副本，而防具/翅膀的父节点是场景根、武器是骨骼下的
   * group，这一步之前前者还没入场景。
   */
  for (const m of skinned) {
    const lv = (m.userData.itemLevel as number) ?? 0;
    actor.addGlows(attachGlow(m, glowSpecFor(lv)));
  }
  for (const g of held) {
    // 先收集再挂：attachGlow 会往 group 里加子节点，边遍历边加容易把新副本也走一遍
    const meshes: THREE.Mesh[] = [];
    g.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) meshes.push(mesh);
    });
    for (const mesh of meshes) {
      const lv = (mesh.userData.itemLevel as number) ?? 0;
      actor.addGlows(attachGlow(mesh, glowSpecFor(lv)));
    }
  }

  return { skinned: skinned.map(m => m.name), held: heldInfo, wing: wingInfo, helper: helperInfo };
}

export async function createPlayer(
  scene: THREE.Scene,
  playerDir: string,
  equipment: EquipSet = DEFAULT_EQUIPMENT
): Promise<Actor> {
  const bmd = await loadBmd(`${playerDir}player.bmd`);
  const rig = createRig(bmd, MODEL_SCALE);

  const actor = new Actor('player', rig);
  actor.root.name = 'player';

  scene.add(actor.root);
  await applyEquipment(actor, playerDir, equipment);

  actor.play(PlayerAction.STOP_MALE, true);
  return actor;
}

/**
 * 按服务端下发的 Class 建怪物 / NPC。
 *
 * 模型不是 `Monster{Class+1}.bmd`（那是猜的，会张冠李戴），
 * 而是按客户端 `CreateMonster` 的 switch 查表：见 `monsterModels.ts`。
 * NPC（Class ≥ 230）从 `Data/Npc/` 取模型。
 */
/**
 * 用玩家骨架画的 NPC（236 黄金弓箭手 / 247 Archer Guard / 249 Berdysh Guard）。
 *
 * 原版 `CreateChar5(Key, 390, …)`：390 = 0x186 = **player.bmd 的模型槽**
 * （`Model_Items.cpp` 的 `AccessModel(0x186, "Data\\Player\\", "Player", -1)`），
 * 然后直接往 `c+504..c+648` 那 7 个装备槽里写模型号。也就是说它们
 * **就是玩家**：同一副骨架、同一条装备管线，只是外观被写死。
 *
 * 所以这里不复刻那套 24 字节偏移（模型号还要再对一遍 `SLOT_FILES`），
 * 而是把槽号翻译成 `EquipSet` 再走 `applyEquipment` ——
 * 装备蒙皮、贴图混合、骨骼映射、强化光效全部复用现成逻辑。
 */
async function createPlayerSkinNpc(
  scene: THREE.Scene,
  cls: number,
  model: ModelRef
): Promise<{ actor: Actor; model: ModelRef } | null> {
  const skin = model.player;
  if (!skin) return null;
  try {
    const bmd = await loadBmd(`${PLAYER_DIR}player.bmd`);
    const rig = createRig(bmd, MODEL_SCALE);
    const actor = new Actor('player.bmd', rig);
    actor.kind = 'npc';
    actor.cls = cls;
    actor.name = model.name;

    /*
     * player.bmd **只有骨架、0 个网格**，所以这一步只把 root 放进场景。
     * 必须先放 —— `applyEquipment` 末尾的 `setMeshes` 靠 `root.parent`
     * 决定新网格挂到哪，root 不在场景里网格就成了孤儿。
     */
    actor.attachMeshes(scene);

    await applyEquipment(actor, PLAYER_DIR, {
      ...skin.equip,
      skinTex: skin.skinTex,
    });

    /*
     * 染色：材质的 `color` 与 `map` 相乘，所以灰蓝贴图 × 暖金 = 暗金铜色。
     * 这是「资源包里没有专用金甲模型」时的近似方案，见 `PlayerSkin.tint`。
     *
     * **必须 clone** —— `getBmdMaterial` 是**按贴图缓存共享**的，直接改
     * `color` 会把所有用同一张贴图的角色一起染金（我第一版就把 249
     * Berdysh Guard 染成了金色）。克隆出来的材质标 `owned`，销毁时一起释放。
     */
    if (skin.tint !== undefined) {
      for (const m of actor.meshes) {
        const mat = m.material as THREE.MeshPhongMaterial;
        if (!mat?.color) continue;
        const owned = mat.clone();
        owned.color.setHex(skin.tint);
        owned.userData.owned = true;
        m.material = owned;
      }
    }
    actor.play(0, true);
    return { actor, model };
  } catch (err) {
    console.warn(`[creature] Class=${cls} 玩家骨架 NPC 加载失败（player.bmd）`, err);
    return null;
  }
}

export async function createCreatureByClass(
  scene: THREE.Scene,
  dirs: { monster: string; npc: string },
  cls: number
): Promise<{ actor: Actor; model: ReturnType<typeof modelForClass> } | null> {
  const model = modelForClass(cls);
  if (!model) return null;

  // 236 / 247 / 249 走玩家骨架那条路
  if (model.player) return createPlayerSkinNpc(scene, cls, model);

  const baseDir = model.dir === 'npc' ? dirs.npc : dirs.monster;

  try {
    // 主体承载骨架（人形 NPC 的主体只有骨骼、没有网格）
    const baseBmd = await loadBmd(`${baseDir}${model.base}`);
    const rig = createRig(baseBmd, MODEL_SCALE);
    const actor = new Actor(model.base, rig);
    actor.kind = model.dir === 'npc' ? 'npc' : 'monster';
    actor.cls = cls;
    actor.name = model.name;

    const addPart = async (fileName: string, bmd: ReturnType<typeof parseBmd>, isBase: boolean) => {
      const remap = isBase ? (node: number) => node : createBoneRemap(bmd, rig);
      for (const mesh of bmd.meshes) {
        const tex = await loadTexture(baseDir, mesh.texturePath);
        if (!tex) continue;
        const mb = modelBlend(tex.texture, tex.tag === 'blend', mesh.texturePath);
        const skinned = createSkinnedMesh(
          bmd, mesh, rig, remap, tex.texture, mb.cutout, mb.soft, mb.additive
        );
        skinned.name = `${fileName}:${mesh.texturePath}`;
        actor.meshes.push(skinned);
      }
    };

    await addPart(model.base, baseBmd, true);

    // 部件（头/上身/腿/鞋）挂到同一套骨架
    for (const part of model.parts) {
      try {
        const partBmd = await loadBmd(`${baseDir}${part}`);
        await addPart(part, partBmd, false);
      } catch {
        /* 资源里缺这个部件就跳过（例如 FemaleBoots03） */
      }
    }

    actor.attachMeshes(scene);
    actor.play(0, true);
    return { actor, model };
  } catch (err) {
    console.warn(`[creature] Class=${cls} 模型加载失败（${baseDir}${model.base}）`, err);
    return null;
  }
}

/** 直接按文件名建一个静态模型（怪物 / NPC 共用） */
export async function createModelActor(
  scene: THREE.Scene,
  dir: string,
  fileName: string
): Promise<Actor | null> {
  try {
    const bmd = await loadBmd(`${dir}${fileName}`);
    const rig = createRig(bmd, MODEL_SCALE);
    const actor = new Actor(fileName, rig);

    for (const mesh of bmd.meshes) {
      const tex = await loadTexture(dir, mesh.texturePath);
      if (!tex) continue;
      const mb = modelBlend(tex.texture, tex.tag === 'blend', mesh.texturePath);
      const skinned = createSkinnedMesh(
        bmd,
        mesh,
        rig,
        node => node,
        tex.texture,
        mb.cutout,
        mb.soft,
        mb.additive
      );
      skinned.name = `${fileName}:${mesh.texturePath}`;
      actor.meshes.push(skinned);
    }

    actor.attachMeshes(scene);
    actor.play(0, true);
    return actor;
  } catch (err) {
    console.warn(`[model] 加载 ${dir}${fileName} 失败`, err);
    return null;
  }
}
