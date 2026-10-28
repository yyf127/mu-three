/**
 * 技能施法规格（动作 + 特效）—— 由**客户端源码**驱动，不是手配的。
 *
 * 数据链条：
 *
 *   `tools/extract-skill-fx.mjs`
 *     ├── `Model/Model_Misc.cpp`      `Model_LoadSkillEffectAssets()` (IDA: OpenSkills)
 *     │     → 特效号 190..268 对应 `Data/Skill/*.bmd`
 *     ├── `Scene/Scene_AssetLoad.cpp` 特效贴图表
 *     │     → 特效号 0x4xx 对应 `Data/Effect/*.ozj|.ozt`
 *     ├── `Net/SecondPassword.cpp`    `MoveCharacter()` (IDA: 0x00449900)
 *     │     → **施法者的逐帧特效序列**：技能号 → 这一帧放哪些特效、放几个、放在谁身上
 *     ├── `Combat/Skills.cpp`         `PacketHandler_0x19` (IDA 0x0042BCA0)
 *     │     → **动作号**（见本文件 `ACTION_BY_SKILL`）+ 目标侧状态特效
 *     └── `Render/Effect_Create.cpp`  `pfVar17[0x18]` = 寿命（帧）、`[0x1a]` = 缩放
 *   生成 `src/data/skillFx.generated.ts`
 *
 * 本文件负责把它翻译成渲染层能用的东西：
 *
 *   - 特效号 → 资源：先查模型表，再查贴图表；两边都没有的走 `SUBSTITUTE`，
 *     **逐条注明这个号在源码里到底是什么**（238 是「武器旋转」，不是某个模型）；
 *   - 缩放：**不缩放**。源码 `RenderEffects`（IDA 0x0046BBA0）把 190..268 交给
 *     `Entity_PrepareRender`，用效果槽里的 `+0x1a`（默认 1.0）= 模型自身单位。
 *     以前按「缩到 2.2 米」处理：8 米的火环被压成 4 米，半米的毒柱被放大五倍；
 *   - 动作：`PacketHandler_0x19` 的 switch，逐条照抄（见 `ACTION_BY_SKILL`）。
 */

import {
  EFFECT_LIFE_FRAMES,
  EFFECT_MODELS,
  EFFECT_TEXTURES,
  SKILL_CASTS,
  type SourceFx,
} from './skillFx.generated';
import { type SkillEntry, type SkillFx, type SkillJob } from './skills';
import { SKILL_REFINE } from './skillFxRefine';

/** 特效落在哪 */
export type CastAnchor = 'self' | 'target' | 'targetGround' | 'front';

export interface FxPart {
  /**
   * 模型（`Data/Skill/*.bmd`）、贴图（`Data/Effect/*.ozj|ozt`）、
   * **拖尾**（源码 1210..1212：沿速度方向连发 30 个 1176 火花）、
   * **关节**（源码 `Joint_Create`：两点之间的一道光，比如袭风刺的闪电）、
   * **武器旋转**（源码 238 → 239 `RenderWheelWeapon`：转的是玩家手上的武器）、
   * **武器砸地**（源码 244 `ItemDrop_RenderGroundWeapon`：举起来砸下去）、
   * **碎石**（抛物线飞溅的模型，撞地/砸地后才有）、
   * **图集爆闪**（`Effect/Explotion01.jpg` 那种 4×4 序列帧）。
   */
  kind: 'model' | 'sprite' | 'trail' | 'beam' | 'weapon' | 'weaponSlam' | 'debris' | 'flash';
  /** `Skill/Xxx.bmd` 或 `Effect/Xxx.OZJ` */
  file: string;
  anchor: CastAnchor;
  /** 源码里这一帧放几个 */
  count: number;
  /**
   * 模型用的缩放。
   *
   * 源码 `RenderEffects`（IDA 0x0046BBA0）把 190..268 交给 `Entity_PrepareRender`，
   * 用的是效果槽里的 `+0x1a`（默认 **1.0**，`CreateEffect` 里初始化）——
   * 也就是**模型自己的尺寸**，客户端不做任何「缩到 N 米」的处理。
   */
  scale?: number;
  /** 贴图精灵的边长（米） */
  size?: number;
  /** 寿命（秒）；没给就用模型自身动画长度 */
  life?: number;
  /** BMD 动画速度（源码效果槽 `+0x33`）；默认 0.3 */
  speed?: number;
  /** 地面平铺（魔法阵 / 火环） */
  ground?: boolean;
  /** 额外高度（米） */
  lift?: number;
  /**
   * 贴图每秒上浮多少米（`sprite` 专用）。
   *
   * 默认 `0.18`（火苗往上窜一点），地面法阵用 `0`。
   * 瞬移/小挪移那种「人往上走再消失」的画面就靠它（源码是
   * `CreateTeleportBegin` 让模型自己上移淡出，本 port 没有那个动画通道）。
   */
  rise?: number;
  /** 多个实例的散开半径（米） */
  spread?: number;
  /** 追踪目标飞的弹道（源码 param_5=1 / param_6=Owner） */
  homing?: boolean;
  /** 自转角速度（弧度/秒）：源码 239「武器旋转」是 -750°/s ≈ -13.1 */
  spin?: number;
  /** 生成时离地多高（米）—— 源码 `[6] += 400` 单位 = 4 格 */
  drop?: number;
  /** 初速度（米/秒），落地即停 —— 源码 `[0x30..0x32]` 是「单位/帧」 */
  vel?: { x: number; y: number; z: number };
  /** 初速度的每轴随机抖动（米/秒），碎石用 */
  velJitter?: number;
  /** Z 加速度（米/秒²）：负 = 落石，正 = 从地里顶出来的火石 */
  gravity?: number;
  /** 追踪飞行时间（秒）；只有 `homing` 有意义，默认 0.32 */
  flyTime?: number;
  /**
   * 追踪时的**匀速**（米/秒）。给了就按「当前距离 ÷ 速度」现算飞行时间，
   * 优先级高于 `flyTime`。源码龙卷风是 `MoveSpeed = 240` 单位/秒 = 2.4 m/s。
   */
  flySpeed?: number;
  /** 序列帧图集的切分（`Explotion01` 是 4×4 = 16 帧） */
  frames?: { cols: number; rows: number };
  /** 序列帧速度（帧/秒）；不给就按 `life` 播完一遍 */
  fps?: number;
  /**
   * 贴图着色（0xRRGGBB），与贴图相乘；只对 `sprite` / `flash` 有效。
   * 源码画爆闪时就是带色画的 —— `Color(1, 0.7, 0.35)`，不是白的。
   * `0xffb359` = (1, 0.7, 0.35)。
   */
  tint?: number;
  /**
   * 光束是否**指向目标**（而不是随机四散）。
   * `Joint_Create` 在源码里是两点连线；袭风刺命中时那道雷是从自己连到目标。
   */
  aim?: boolean;
  /**
   * 延迟多少秒再生成（`weaponSlam` 的落地件用）。
   * 源码 244 的落地在 life==3（总 20 帧）→ 0.68 s。
   */
  delay?: number;
  /** 出处或替补说明 */
  note?: string;
}

export interface CastSpec {
  /** 角色骨架动作号 */
  action: number;
  /** 动作说明（面板/探针显示） */
  actionNote: string;
  /**
   * 特效来源：
   *   client   = 源码里查到的；
   *   fallback = 源码没给，用 `SKILL_FX` 的表现兜底；
   *   none     = 源码里**确实没有视觉**（只有动作 + 音效），我们也不该硬造。
   */
  source: 'client' | 'fallback' | 'none';
  parts: FxPart[];
  /**
   * 专用渲染器（不走 `parts` 循环）：
   *   `dragon-wave` = 黑龙波：4 条 Laser01 + 光带，贴地游动
   */
  special?: 'dragon-wave';
  /** 面板提示用的一句话 */
  note: string;
}

/* ------------------------------------------------------------------ */
/* 源码里没加载的特效槽位                                              */
/* ------------------------------------------------------------------ */

/**
 * 这几个号在源码里被 `CreateEffect` 引用，但本 port 里没有可以直接播的模型/贴图。
 * 分三种情况，处理方式完全不同（**不要一律当「模型」放**）：
 *
 * ── 238（0xEE）霹雳回旋斩 ─────────────────────────────────────────────
 * `RenderEffects` 里 `case 238: break;` —— **客户端根本不画这个槽**（因为
 * `OpenSkills` 没给它加载模型，硬画就是一个白方块）。它的视觉在
 * `MoveEffect` 的 `case 0xee` 里：每帧 `CreateEffect(0xEF, …)`，
 * 而 **239 = `RenderWheelWeapon`** —— 把 owner 手上那把武器**转起来甩**。
 * 所以真正的表现是「武器绕着人转」，不是某个技能模型。
 * 本 port 还没接 `RenderWheelWeapon`（要先拿到玩家当前武器模型），
 * 用 `Saw01.bmd` 的锯片顶上，形似「旋斩」，但**不是原版**。
 *
 * ── 244（0xF4）雷霆裂闪 ───────────────────────────────────────────────
 * `RenderEffects` 里 `case 244: ItemDrop_RenderGroundWeapon(o);` —— 专属渲染器：
 * 武器先升后落（`MoveEffect` case 0xF4），落到 `cnt == 3` 时砸地出一圈裂缝
 * （247/245/246 = Earthquake 系列）+ 伤害。这里取「砸地后的地裂」那一帧，
 * 用 `Earthquake03.bmd` 顶，缺了「武器砸下来」那半段。
 *
 * ── 1210..1212 极光 / 少数拖尾 ────────────────────────────────────────
 * 不是模型也不是单张精灵：`RenderEffects` 沿速度方向**连发 30 个 1176**
 * （`Spark03.OZJ` 电光）铺一条 30 段的拖尾，每段还点一次地形光。
 * 这里落成 `kind: 'trail'`，由渲染层按朝向铺开（段数减到 10，够看且省 drawCall）。
 *
 * ── 496 / 497（0x1F0 / 0x1F1）袭风刺 / 钻云枪 ─────────────────────────
 * 这两个是 `AttackStage` 在攻击动作的**阶段帧**上生成的，槽位在本 port 没登记，
 * 但 `Data/Skill` 里本来就有同名的专属模型，直接用。
 */
const SUBSTITUTE: Record<number, string> = {
  238: 'Skill/Saw01.bmd',
  244: 'Skill/Earthquake03.bmd',
  1210: 'Effect/Spark03.OZJ',
  496: 'Skill/Pierpart.bmd',
  497: 'Skill/Ridingspear01.bmd',
};

/** 替补说明，写进 `FxPart.note`，README / 探针都能追到 */
const SUBSTITUTE_NOTE: Record<number, string> = {
  238: '源码 238 不绘制（MoveEffect 每帧生成 239 = 武器旋转）→ 用 Saw01 顶',
  244: '源码 244 = 武器砸地专属渲染 → 只取砸地后的地裂 Earthquake03',
  1210: '源码 1210..1212 是 30 段 1176 拖尾 → 用 Spark03 铺拖尾',
  496: '源码槽 0x1F0 未加载 → 用 Pierpart 代',
  497: '源码槽 0x1F1 未加载 → 用 Ridingspear01 代',
};

/* ------------------------------------------------------------------ */
/* 动作：照抄 PacketHandler_0x19 的 switch                             */
/* ------------------------------------------------------------------ */

/**
 * 施法动作（法师 / 精灵）。
 *
 * `Scene_CharSelect_Nav.cpp` 的 `SetPlayerMagic()`（IDA 0x00444A80）：
 * 玩家（entity type 390）走 `SetAttackSpeed()` 之后
 * `SetAction(c, 0x52 + rand() % 2)` —— 也就是 **82/83** 两个交替。
 */
const CAST_ACTION = 82;

/**
 * 技能号 → 动作号。
 *
 * **这张表的唯一来源是 `Combat/Skills.cpp` 的 `PacketHandler_0x19`**
 * （IDA 0x0042BCA0）—— 服务端广播「谁对谁放了哪个技能」之后，客户端就用它
 * 决定施法者播哪个动作。这跟「技能表里的序号」是同一套编号（1..56），
 * 但**动作号不是统一值**，逐条如下：
 *
 *   0x13..0x16 (19..22)  SetAction(caster, skill_type + 37)   → 56..59
 *   0x17       (23)      (caster[771] & 1) ? 41 : 60          → 交替两套
 *   0x2B       (43)      SetAction(caster, 67)                → 67
 *   0x2F       (47)      SetAction(caster, 66)                → 66
 *   0x30       (48)      SetAction(caster, 63)                → 63  ← 不是 82！
 *   0x31       (49)      (World 8/10) ? 65 : 64               → 64
 *   0x38       (56)      SetAction(caster, 81)                → 81  ← 不是挥砍！
 *
 * 上一版把 19..23 / 48 / 56 都当成「通用挥砍（−1）」或「施法 82」，所以
 * 战士的地裂斩/牙突刺/升龙击/旋风斩其实在打拳，天雷闪在挥空气。
 */
const ACTION_BY_SKILL: Record<number, number> = {
  19: 56, // Falling Slash
  20: 57, // Lunge
  21: 58, // Uppercut
  22: 59, // Cyclone
  23: 41, // Slash：41 与 60 交替（源码 (caster[771] & 1) ? 41 : 60）
  /*
   * 41 / 42 / 55 的专属动作来自**本地攻击分支** `Attack_WarriorBranch97k`
   * （`Combat/Combat.cpp`，IDA L2940 / L3537 / L4665）：
   *
   *   case 41: SetAction(entity, 61)   // 霹雳回旋斩
   *   case 42: SetAction(entity, 62)   // 雷霆裂闪
   *   case 55: SetAction(entity, 61)   // 玄月斩
   *
   * 注意 `PacketHandler_0x19` 的 switch **没有**这三个 case（远端看到别人放
   * 这三个技能时走 default、不设动作），所以以前两边都落到了「施法 82/83」
   * —— 战士转圈斩 / 裂闪播的是法师举手，肉眼就能看出来不对。
   */
  41: 61, // Twisting Slash
  42: 62, // Rageful Blow
  43: 67, // Death Stab
  47: 66, // Impale
  48: 63, // Greater Life
  49: 64, // Fire Breath（World 8/10 → 65）
  55: 61, // Fire Slash（与 41 同一套旋斩动作）
  56: 81, // Power Slash
};

/** 动作出处说明（面板 / 探针） */
const ACTION_NOTE: Record<number, string> = {
  19: '19 地裂斩 → 动作 56（0x13 + 37）',
  20: '20 牙突刺 → 动作 57（0x14 + 37）',
  21: '21 升龙击 → 动作 58（0x15 + 37）',
  22: '22 旋风斩 → 动作 59（0x16 + 37）',
  23: '23 天地十字剑 → 动作 41/60 交替（caster[771]&1）',
  41: '41 霹雳回旋斩 → 动作 61（Attack_WarriorBranch case 41）',
  42: '42 雷霆裂闪 → 动作 62（Attack_WarriorBranch case 42）',
  55: '55 玄月斩 → 动作 61（Attack_WarriorBranch case 55，与 41 同套）',
  43: '43 袭风刺 → 动作 67（0x2B）',
  47: '47 钻云枪 → 动作 66（0x2F）',
  48: '48 生命之光 → 动作 63（0x30）',
  49: '49 流星焰 → 动作 64（0x31，World 8/10 是 65）',
  56: '56 天雷闪 → 动作 81（0x38）',
};

/**
 * 走 `SetPlayerMagic`（82/83）的：所有「对目标放魔法」和无目标的 buff/召唤。
 * 对应的 case：0x01/0x02/0x04/0x07/0x0B/0x11（箭与魔法弹）、0x03（闪电）、
 * 0x10（16）、0x1A..0x24（26..28、30..36）。
 * 0x06/0x0F（瞬移）在客户端走 `CreateTeleportBegin`，这里借用施法姿。
 */
const MAGIC_SKILLS = new Set([
  1, 2, 3, 4, 6, 7, 11, 15, 16, 17, 26, 27, 28, 30, 31, 32, 33, 34, 35, 36,
]);

/**
 * 走 `SetPlayerBow`（`case 0x18 / 0x33 / 0x34`）：动作号随弓/弩变（46..49），
 * 所以这里给 −1，让 `attackAction()` 按当前武器算。
 */
/** 弓箭类技能：源码走 `CreateArrows`（投射物实体），不是原地特效 */
export const BOW_SKILLS = new Set([24, 51, 52]);

/**
 * `PacketHandler_0x19` 里这些 case **不设动作**（0x32 怪物区域攻击、
 * 0x37 火焰斩只挂状态），动作由别的路径决定 → 交给武器挥砍。
 */
const NO_EXPLICIT_ACTION = new Set([50, 55]);

/**
 * 源码里**没有视觉**、只播动作的技能 —— 现在只剩怪物技能。
 *
 * 依据：`MoveCharacter` 的 `switch((char)v328)` 没有 19..23 的 case（那个开关只列了
 * 5,8,9,10,12,13,14,30..36,41,42,48,49），`switch(skillId)` 也没有，
 * `AttackStage` 的 case 只有 43/47/48/49/52/55/56 —— 三条路都没有 `CreateEffect`。
 * 也就是说原版放「地裂斩/牙突刺/升龙击/旋风斩/天地十字剑」时**只有挥砍动作**，
 * 光效来自武器的拖尾（`Trail_Render`，另一套系统）。
 *
 * ── 为什么 19..23 从这里移出去了（阶段 AG）────────────────────────────
 * 0.97 的 Win 端靠「实体武器 + 材质拖影」撑起这五个技能的观感，而 H5 port 的
 * 武器是刚体蒙皮 + 折线拖尾，视觉重量差很多 —— 实测「只播动作」在画面上
 * 几乎没有反馈。所以改成**走 `SKILL_FX` 的表现兜底**（`fromFallback`），
 * 每个技能挑一件语义最贴的现成资源：
 *
 *   19 地裂斩 → Earthquake02（地裂冲击，贴地）
 *   20 牙突刺 → Piercing（贯穿尖刺）
 *   21 升龙击 → Blast01（向上爆开）
 *   22 旋风斩 → Storm01（环绕旋风）
 *   23 天地十字剑 → Kcross（十字光）
 *
 * 这五条**不是源码数据**，是 `source: 'fallback'` —— 面板上会标「兜底」，
 * 想恢复「严格照抄源码」就把 19..23 加回这个集合即可。
 */
const NO_VISUAL = new Set([50]);

/**
 * 源码里特效挂在**目标**身上、但玩家实际是对自己放的（buff / 治疗 / 召唤）。
 * 离线演示的「靶子」是只怪，把治疗光环挂在怪身上很怪，所以这几个技能
 * 把「目标」换成施法者自己。技能语义来自 `eSkillNumber`（GameEnums.h）。
 */
const SELF_CAST = new Set([16, 18, 26, 27, 28, 30, 31, 32, 33, 34, 35, 36, 48]);

/* ------------------------------------------------------------------ */
/* 尺寸 / 观感                                                         */
/* ------------------------------------------------------------------ */

/** 精灵默认边长（米）：贴图拉的面片，按「角色 2.2 m 高」定 */
const SPRITE_SIZE = 2.6;
/** 地面片（魔法阵 / 火环）铺得更开 */
const GROUND_SIZE = 3.8;
/** 粒子/光点小一些 */
const PARTICLE_SIZE = 0.9;

function spriteLife(type: number): number {
  const frames = EFFECT_LIFE_FRAMES[type];
  // 源码的寿命单位是帧（25fps）。没登记的就按 0.8 s，够看见又不拖沓。
  const sec = frames ? frames / 25 : 0.8;
  return Math.min(3.2, Math.max(0.3, sec));
}

/**
 * 关节（`Joint_Create`）用的替代贴图。
 *
 * 源码里 `Joint_Create` 画的是**两点之间的连线**（一串小面片），不是模型：
 * `Scene_AssetLoad.cpp` 给它准备的是 `JointSpirit01` / `JointThunder01` /
 * `JointLaser01` 这类贴图。但 `MoveCharacter` 里有两处（技能 16 守护之魂、
 * 27 守护之光）传的是 **266** —— 那是个模型槽（`RidingSpear01.bmd`），
 * 原版借它的**纹理**做连线。
 *
 * 这个 port 没有关节渲染器，把 266 当模型放会在玩家身上出现一把长枪。
 * 所以「模型槽当关节用」的情况统一换成灵魂火花贴图 —— 观感是「身上冒光点」，
 * 和守护类技能的预期一致，也不会凭空多出一把武器。
 */
const JOINT_FALLBACK_TEXTURE = 'Effect/JointSpirit01.OZJ';

/** 地面片判定：魔法阵 / 地面火环这几张贴图是躺着看的 */
const GROUND_TEXTURES = new Set([1264, 1265, 1234]);

/** 这几个技能的特效本来是「地面上一圈」 */
function isGroundSkill(id: number): boolean {
  return id === 10 || id === 14 || id === 48 || (id >= 30 && id <= 36) || id === 26 || id === 27 || id === 28;
}

/* ------------------------------------------------------------------ */
/* 源码补充：AttackStage 里的技能                                      */
/* ------------------------------------------------------------------ */

/**
 * `Combat_AttackStage.cpp` 的 `AttackStage()`（IDA 0x00448930）里，
 * 战士的 43 / 47 / 56 是在**攻击动作的某个阶段帧**上出特效的，
 * 不在 `MoveCharacter` 的 dispatch 里，所以提取器抓不到。这里按源码抄成固定 parts：
 *
 *   43 袭风刺：stage 6..12 每帧 2 次 `CreateEffect(496)`
 *   47 钻云枪：stage 4 一次 `CreateEffect(497)`；stage 8 两次 `CreateEffect(496)`
 *   56 天雷闪：`CreateEffect(203)` 五次，角度每次 +20°
 */
const ATTACK_STAGE_EXTRAS: Record<number, FxPart[]> = {
  43: [
    /*
     * `AttackStage` case 0x2B（skill==43 袭风刺）的自身侧：
     *   CreateEffect(1254) ×2（scale 50）   —— JointThunder01 雷
     *   CreateEffect(1254) ×2（scale 10）
     *   CreateEffect(1257) ×2               —— Spark01 火花关节
     * 共 6 道从身上炸开的电弧（源码 attackTime 2..8 每帧 ±300 单位随机）。
     * 之前错配成 Pierpart×2 + 单种雷×3。
     */
    {
      kind: 'beam',
      file: 'Effect/JointThunder01.OZJ',
      anchor: 'self',
      count: 2,
      size: 0.5, // scale 50
      spread: 2.6,
      life: 0.3,
      note: 'AttackStage skill==43 → CreateEffect(1254) ×2 scale50（JointThunder）',
    },
    {
      kind: 'beam',
      file: 'Effect/JointThunder01.OZJ',
      anchor: 'self',
      count: 2,
      size: 0.2, // scale 10
      spread: 2.6,
      life: 0.3,
      note: 'AttackStage skill==43 → CreateEffect(1254) ×2 scale10（JointThunder）',
    },
    {
      kind: 'beam',
      file: 'Effect/Spark01.OZJ',
      anchor: 'self',
      count: 2,
      size: 0.3,
      spread: 2.6,
      life: 0.3,
      note: 'AttackStage skill==43 → CreateEffect(1257) ×2（Spark01 火花关节）',
    },
  ],
  47: [
    {
      kind: 'model',
      file: SUBSTITUTE[497],
      anchor: 'self',
      count: 1,
      scale: 1,
      note: 'AttackStage skill==47 stage 4 → CreateEffect(497)',
    },
    {
      kind: 'model',
      file: SUBSTITUTE[496],
      anchor: 'self',
      count: 2,
      scale: 1,
      note: 'AttackStage skill==47 stage 8 → CreateEffect(496) ×2',
    },
  ],
  56: [
    {
      kind: 'model',
      file: EFFECT_MODELS[203],
      anchor: 'self',
      count: 5,
      scale: 1,
      spread: 0.8,
      note: 'AttackStage skill==56 → CreateEffect(203) ×5，角度每次 +20°',
    },
  ],
};

/* ------------------------------------------------------------------ */
/* 翻译                                                                */
/* ------------------------------------------------------------------ */

/** `CreateEffect` 初始化时 `+0x1a`（缩放）的默认值 —— 源码里就是 1.0 */
const EFFECT_SCALE = 1;

/** 拖尾段数：源码 1210..1212 铺 30 段，这里取 10（观感够、drawCall 省一半） */
const TRAIL_STEPS = 10;

function toPart(fx: SourceFx, isGround: boolean): FxPart | null {
  /*
   * 238（霹雳回旋斩）—— **不是模型，是玩家手上的武器在转**。
   *
   * `RenderEffects` 里 `case 238: break;`（这个槽根本不画）；
   * `MoveEffect` 的 `case 0xee` 每帧 `CreateEffect(0xEF)`，
   * 239 走 `RenderWheelWeapon`（0x0046B7C0）：
   *   `o+36 += -30°/帧`、`o+32 = 90°`、`o+24 += 100 单位`、模型 = owner 武器 + 400。
   */
  /*
   * 244（雷霆裂闪 / Rageful Blow）—— 源码有**专属渲染器**
   * `ItemDrop_RenderGroundWeapon`（0x0046B980），不是普通模型：
   *
   *   `Effect_Create` case 0xF4：`+0x18 = 2.8026e-44` → 位模式 **20 帧 = 0.8 s**，
   *   `[0x36] = 50.0`（砸下去时的倾斜角）。
   *   `MoveEffect` case 0xF4 的时间线：
   *     life 20..15  武器上升
   *     life 15      翻转垂直项（`o+216`）→ 开始下落
   *     life 10..15  每帧 **-8 单位**（-2 m/s）
   *     life 3       砸地：`Joint_Create(0x4E9)` ×8 裂缝、`Particle_Spawn(0x4BF)` 扬尘、
   *                  `CreateEffect(0xFD/0xF7/0xF5/0xF6)` 拖尾与碎石
   *     life 2       结算并销毁
   *   而 `ItemDrop_RenderGroundWeapon` 自己只在 `life > 10` 时画武器 ——
   *   也就是说**落地之后这画的是裂缝，不再画武器**。
   *
   * 这里落成两件：武器（weaponSlam，0.8 s）+ 延迟 0.68 s 出现的地裂模型。
   */
  if (fx.type === 244) {
    return {
      kind: 'weaponSlam',
      // 空手兜底用的地裂模型；有武器时武器由渲染层克隆玩家武器
      file: SUBSTITUTE[244],
      anchor: fx.at,
      count: 1,
      life: 0.8,      // +0x18 = 20 帧
      lift: 0,        // 从地面升起，不额外抬高
      spin: -2.4,     // 砸下时绕竖轴缓慢自转（观感）
      delay: 0.68,    // life 3 时砸地（20-3=17 帧 = 0.68 s）
      note: '244 → ItemDrop_RenderGroundWeapon（0x0046B980）：武器升起→砸下→地裂，寿命 20 帧',
    };
  }

  if (fx.type === 238) {
    return {
      kind: 'weapon',
      // 空手兜底：源码 41 空手也转不出武器，这里退化成锯片
      file: SUBSTITUTE[238],
      anchor: fx.at,
      count: 1,
      lift: 1.0,    // o+24 += 100 单位
      spin: -13.09, // -30°/帧 × 25 fps
      life: 1.0,    // 239 的 +0x18 = 25 帧
      note: '238 → MoveEffect 每帧 CreateEffect(239) → RenderWheelWeapon：转玩家武器，-30°/帧、抬高 100 单位、pitch 90°',
    };
  }

  const model = EFFECT_MODELS[fx.type];
  const texture = EFFECT_TEXTURES[fx.type];

  /*
   * 拖尾段（1210..1212）优先判断：它的号在贴图表里也有一个“主贴图”，
   * 但源码不是只画一张，而是沿速度方向连发 30 个 1176。
   */
  if (fx.type >= 1210 && fx.type <= 1212) {
    return {
      kind: 'trail',
      file: SUBSTITUTE[fx.type] ?? EFFECT_TEXTURES[1176] ?? 'Effect/Spark03.OZJ',
      anchor: fx.at,
      count: TRAIL_STEPS,
      size: 0.55,
      life: 0.45,
      lift: 0.2,
      note: SUBSTITUTE_NOTE[fx.type] ?? `拖尾(${fx.type}) → 连发 1176 火花`,
    };
  }

  if (model) {
    const def = defOf(fx.type, fx.sub);
    return {
      kind: 'model',
      file: model,
      anchor: fx.at,
      count: fx.count,
      // 源码：模型效果按自身单位画，scale 取效果槽的 +0x1a（默认 1.0）
      scale: def?.scale ?? EFFECT_SCALE,
      // 寿命 / 动画速度也照 `Effect_Create` 的 +0x18 / +0x33
      life: def?.life !== undefined ? def.life / 25 : undefined,
      speed: def?.speed,
      drop: def?.drop,
      vel: def?.vel ? { ...def.vel } : undefined,
      homing: fx.homing,
      note:
        `CreateEffect(${fx.type}${fx.sub ? `/${fx.sub}` : ''}) → ${model}` +
        (def?.life ? `｜${def.life} 帧` : ''),
    };
  }

  if (texture) {
    const ground = isGround || GROUND_TEXTURES.has(fx.type);
    return {
      kind: 'sprite',
      file: texture,
      anchor: fx.at,
      count: fx.count,
      size: ground ? GROUND_SIZE : SPRITE_SIZE,
      life: spriteLife(fx.type),
      ground,
      lift: ground ? 0.06 : fx.at === 'front' ? 1.0 : 0,
      spread: fx.count > 1 ? 0.9 : 0,
      note: `CreateEffect(${fx.type}) → ${texture}`,
    };
  }

  const sub = SUBSTITUTE[fx.type];
  if (!sub) return null;
  const isBmd = sub.endsWith('.bmd');
  return {
    kind: isBmd ? 'model' : 'sprite',
    file: sub,
    anchor: fx.at,
    count: fx.count,
    scale: isBmd ? EFFECT_SCALE : undefined,
    size: isBmd ? undefined : SPRITE_SIZE,
    life: isBmd ? undefined : 0.6,
    homing: fx.homing,
    /*
     * 238（霹雳回旋斩）在源码里是「每帧生成 239 = 武器旋转」，
     * `RenderWheelWeapon` 每帧 `-30°`。这里没有武器模型渲染器，
     * 用锯片顶上，但把**转速照抄**下来，至少「旋」这个动作是对的。
     */
    spin: fx.type === 238 ? -13.1 : undefined,
    lift: fx.type === 238 ? 1.0 : undefined,
    spread: fx.count > 1 ? 0.8 : 0,
    note: SUBSTITUTE_NOTE[fx.type],
  };
}

function fromFallback(fx: SkillFx | undefined): FxPart[] {
  if (!fx) return [];
  return [
    {
      kind: 'model',
      file: `Skill/${fx.file}`,
      anchor: fx.at ?? 'target',
      count: 1,
      scale: EFFECT_SCALE,
      lift: fx.lift,
      note: '表现兜底（源码未覆盖这个技能）',
    },
  ];
}

/**
 * 技能号 → 动作号。
 *
 * 顺序就是源码的优先级：
 *   1. `PacketHandler_0x19` 里显式给了动作号的（19..23、43、47、48、49、56）→ 照抄；
 *   2. 弓箭类（24/51/52）→ `SetPlayerBow`，随武器算；
 *   3. 法师 / 精灵的魔法、buff、召唤 → `SetPlayerMagic` = 82/83；
 *   4. 0x19 里不设动作的（50/55）→ 随武器挥砍。
 *
 * 注意 3 为什么按职业兜：技能 5/8/9/10/12/13/14 **不在 0x19 的 case 里**，
 * 它们在 `MoveCharacter` 的 `switch ((char)v328)` 里（施法者自己那条路径），
 * 但动作同样是施法姿 —— 客户端所有「魔法」都过 `SetPlayerMagic`。
 *
 * 返回 `-1` 表示「交给调用方按当前武器算」。
 */
function actionOf(id: number, job: SkillJob): { action: number; note: string } {
  const fixed = ACTION_BY_SKILL[id];
  if (fixed !== undefined) return { action: fixed, note: ACTION_NOTE[id] ?? `动作 ${fixed}` };

  if (BOW_SKILLS.has(id)) {
    return { action: -1, note: `${id} 走 SetPlayerBow（弓/弩 46..49，随武器）` };
  }
  if (job === 'wizard' || job === 'elf' || MAGIC_SKILLS.has(id)) {
    return { action: CAST_ACTION, note: `${id} 施法动作 ${CAST_ACTION}（SetPlayerMagic 0x52/0x53）` };
  }
  if (NO_EXPLICIT_ACTION.has(id)) {
    return { action: -1, note: `${id} 在 0x19 里不设动作 → 随武器挥砍` };
  }
  return { action: -1, note: '源码未给动作 → 随武器挥砍（SetPlayerAttack）' };
}

/* ------------------------------------------------------------------ */
/* 效果定义：Effect_Create 里每个 (类型, SubType) 的初始状态            */
/* ------------------------------------------------------------------ */

/**
 * 一张表把 `Render/Effect_Create.cpp` 里散落的常量收拢起来。
 *
 * 效果槽的字段（`MoveEffect.cpp` 头部注释里的布局）：
 *   `+0x18` 寿命（帧，25 fps）    `+0x1a` 缩放    `+0x33` BMD 动画速度
 *   `+0x30..32` 速度 XYZ（**单位/帧**）           `[6]` 高度偏移（单位）
 *   `[3]` 初始缩放/摆动系数（各 case 含义不同，这里只取能确认的）
 *
 * 键是 `"类型/SubType"` —— 同一个模型号靠 SubType 区分用法：
 * `191/0` 是陨石（从天而降），`191/1` 是火球（追踪目标）。
 * 每条的数值都在注释里标了源码位置，改了源码要能对回去。
 *
 * 没登记的 (类型, SubType) 走默认：寿命 = BMD 动画长度、速度 0.3、缩放 1。
 */
interface EffectDef {
  /** 寿命（帧，来自 `+0x18` 的 denormal 位模式） */
  life?: number;
  /** 缩放（`+0x1a`） */
  scale?: number;
  /** BMD 动画速度（`+0x33`） */
  speed?: number;
  /** 生成时离地高度（米） */
  drop?: number;
  /** 速度（米/秒）；源码是「单位/帧」，×25/100 换算 */
  vel?: { x: number; y: number; z: number };
}

const EFFECT_DEF: Record<string, EffectDef> = {
  /* 190 Ice01 —— 冰封 */
  // Effect_Create case 0xBE, SubType 0：寿命 50 帧、[3]=0.8、[0x33]=1.0
  '190/0': { life: 50, speed: 1.0 },
  // 同 case，SubType 1..2（冰封箭）：寿命 20 帧、[0x1a]=0.5（缩小一半）
  '190/1': { life: 20, scale: 0.5 },
  '190/2': { life: 20, scale: 0.5 },

  /* 191 Fire01 —— 陨石 / 火球 */
  // case 0xBF, SubType 0：寿命 40 帧、[6] += 400（离地 4 m）、[0x32] = -50（-12.5 m/s）
  '191/0': { life: 40, drop: 4, vel: { x: 0, y: 0, z: -12.5 } },
  // SubType 1（火球）：寿命 60 帧、[6] += 120；它沿自己的角度飞（-Y），
  // 这里不套速度，改用 homing 的 flyTo，方向更准
  '191/1': { life: 60 },

  /* 192 Poison01 —— 毒咒 */
  // case 0xC0：寿命 40 帧、[3] = 1.0
  '192/0': { life: 40, speed: 1.0 },

  /* 200 Circle01 —— 脚下魔法阵 */
  // case 200：寿命 45 帧
  '200/0': { life: 45 },

  /* 203 Magic02 —— 天雷闪的「五道雷」 */
  // case 0xCB：寿命 20 帧、[0x31] = -60（沿 -Y 推）
  '203/0': { life: 20 },

  /* 204 Storm01 —— 龙卷风 */
  // case 0xCC：寿命 59 帧、[6] = 地形高度（贴地）、[0x31] = -10
  '204/0': { life: 59 },

  /* 240 Blast01 —— 极光/爆炎 */
  // case 0xF0：寿命 30 帧
  '240/0': { life: 30 },

  /* 241 Inferno01 —— 地狱火 / 毁灭烈焰（按 SubType 分档） */
  // case 0xF1：SubType 0 寿命 15 帧、SubType 1 35 帧、SubType 2 12 帧；[0x33] = 0.5
  '241/0': { life: 15, speed: 0.5 },
  '241/1': { life: 35, speed: 0.5 },
  '241/2': { life: 12, speed: 0.5 },
};

/** 查 (类型, SubType) 的定义；查不到返回 undefined（走默认） */
function defOf(type: number, sub: number | undefined): EffectDef | undefined {
  return EFFECT_DEF[`${type}/${sub ?? 0}`];
}

/**
 * 法师（Dark Wizard）几个技能的表现修正 —— 阶段 AI。
 *
 * 这五条的共同点：**二进制里的调用是对的，是这个 port 把它画成了静止的一团**。
 * 依据 `Net/SecondPassword.cpp` 的 `switch ((char)v328)`（施法者自己那条路径）：
 *
 * ```
 * case 11  CreateEffect(203,  o+16, Angle, …, 0, nullptr)   // o+16 = 施法者位置
 * case 17  CreateEffect(1180, o+16, Angle, …, 0, Owner)     // 同上
 * ```
 *
 * 两处都只在**施法者身上生成一次**，真正的位移由 `MoveEffect` 按 `Angle`
 * 推进 —— 也就是「一波推出去 / 一颗球飞出去」。本 port 之前把 `at: 'self'`
 * 理解成「原地不动」，于是真空波变成脚下的一圈雷、能量球变成脚边的一团光。
 *
 * 修正方式：
 *   - 11 真空波 → `Magic02` 从施法者飞向目标（`homing`）
 *   - 17 能量球 → 改用 `Ball01` 飞向目标（原来的 1180 是贴图 1176/Thunder01，
 *     贴图层没有位移能力，画出来只能是原地一团）
 *
 * 掌心雷（3）与瞬移（6/15）在二进制里**确实没有 `CreateEffect`**
 * （case 3 只有 `PlayBuffer(60)` + 打断目标动作；6/15 走的是
 * `CreateTeleportBegin/End` 的模型升降淡出），所以它们仍然是兜底，
 * 只是换成更像原版的素材：一道雷 / 一圈法阵加升腾的光。
 */
const WIZARD_FIX: Record<
  number,
  { parts: FxPart[]; source: CastSpec['source']; note: string }
> = {
  3: {
    source: 'fallback',
    note: '源码 case 3 无 CreateEffect（只有音效 + 打断目标动作）→ 用「一道雷」表现',
    parts: [
      {
        kind: 'beam',
        file: 'Effect/JointThunder01.OZJ',
        anchor: 'self',
        count: 1,
        size: 0.55,
        life: 0.26,
        aim: true,
        note: '掌心雷：施法者 → 目标的一道雷（源码无模型，借袭风刺同款雷纹理）',
      },
      {
        kind: 'sprite',
        file: 'Effect/Thunder01.OZJ',
        anchor: 'target',
        count: 1,
        size: 3.0,
        life: 0.42,
        lift: 1.3,
        tint: 0xcfdcff,
        note: '掌心雷：命中处的雷光',
      },
      {
        kind: 'sprite',
        file: 'Effect/Spark03.OZJ',
        anchor: 'target',
        count: 6,
        size: 0.55,
        life: 0.5,
        spread: 1.1,
        lift: 0.9,
        note: '掌心雷：命中的电花（源码无，补观感）',
      },
    ],
  },
  11: {
    source: 'fallback',
    note: '源码 CreateEffect(203) 在施法者身上生成、沿角度推进 → 这里改成飞向目标',
    parts: [
      {
        kind: 'model',
        file: 'Skill/Magic02.bmd',
        anchor: 'self',
        count: 1,
        scale: 1,
        homing: true,
        flySpeed: 20,
        lift: 1.0,
        life: 0.8,
        note: '真空波：Magic02 从施法者飞向目标（源码 MoveEffect 沿 Angle 推进）',
      },
    ],
  },
  17: {
    source: 'client',
    note: '源码 CreateEffect(212)=Skill/Snow01（怪 282 用 1180=Thunder01）→ Snow01 飞向目标',
    parts: [
      {
        kind: 'model',
        file: 'Skill/Snow01.bmd',
        anchor: 'self',
        count: 1,
        scale: 1,
        homing: true,
        flySpeed: 17,
        lift: 1.0,
        life: 0.85,
        note: '能量球：Snow01（源码 212）飞向目标（1180 在贴图层没有位移能力，故用 212 的模型）',
      },
    ],
  },
  6: {
    source: 'fallback',
    note: '源码 6 走 CreateTeleportBegin/End（模型上升淡出，无特效模型）→ 法阵 + 升腾光',
    parts: [
      {
        kind: 'sprite',
        file: 'Effect/Magic_Circle1.OZJ',
        anchor: 'self',
        count: 1,
        size: 3.2,
        life: 0.85,
        ground: true,
        spin: 1.6,
        note: '瞬移：脚下的魔法阵（原版是模型升降淡出，法阵补足瞬移感）',
      },
      {
        kind: 'sprite',
        file: 'Effect/Shiny02.OZJ',
        anchor: 'self',
        count: 4,
        size: 1.2,
        life: 0.8,
        lift: 0.3,
        rise: 2.6,
        spread: 0.7,
        note: '瞬移：升腾的光（CreateTeleportBegin 的上移感）',
      },
    ],
  },
  15: {
    source: 'fallback',
    note: '小挪移：同瞬移，范围稍大（源码同为 CreateTeleportBegin/End）',
    parts: [
      {
        kind: 'sprite',
        file: 'Effect/Magic_Circle1.OZJ',
        anchor: 'self',
        count: 1,
        size: 3.8,
        life: 0.9,
        ground: true,
        spin: -1.8,
        note: '小挪移：脚下魔法阵',
      },
      {
        kind: 'sprite',
        file: 'Effect/Shiny02.OZJ',
        anchor: 'self',
        count: 6,
        size: 1.3,
        life: 0.85,
        lift: 0.3,
        rise: 3.0,
        spread: 1.1,
        note: '小挪移：升腾的光（范围比瞬移大）',
      },
    ],
  },
};

/**
 * 取一个技能的施法规格。
 * 传 `skill` 是为了拿「手配的兜底表现参数」（源码没覆盖的那 14 个）。
 */
export function castOf(skill: SkillEntry): CastSpec {
  const id = skill.id;
  const src = SKILL_CASTS[id];
  const ground = isGroundSkill(id);

  let parts: FxPart[] = [];

  if (src) {
    const all: SourceFx[] = [
      ...src.effects,
      ...src.particles.map(p => ({ ...p, at: p.at })),
      ...src.joints,
    ];
    parts = all
      .map((fx, i) => {
        const isJoint = i >= src.effects.length + src.particles.length;
        const isExtra = i >= src.effects.length;

        /*
         * 关节（`Joint_Create`）一律按**贴图面片**画，不按模型。
         * 两个例外处理都在这里：
         *   1. 槽位本身就是贴图（1253/1254 = JointSpirit/JointThunder）→ 直接用；
         *   2. 槽位是模型（266 = RidingSpear01，源码借它的纹理）→ 换灵魂火花贴图。
         */
        if (isJoint) {
          const texture = EFFECT_TEXTURES[fx.type];
          const file = texture ?? JOINT_FALLBACK_TEXTURE;
          return {
            kind: 'sprite' as const,
            file,
            anchor: fx.at,
            count: Math.max(1, fx.count),
            size: PARTICLE_SIZE * 1.1,
            life: Math.max(0.6, spriteLife(fx.type)),
            ground: false,
            lift: 0.6,
            // 关节是「连成一条」的，散得太开就不像了，所以只用很小的抖动
            spread: fx.count > 1 ? 0.35 : 0,
            note: texture
              ? `Joint_Create(${fx.type}) → ${file}`
              : `Joint_Create(${fx.type}) 借模型槽纹理 → 用 ${file} 近似（本 port 没有关节渲染）`,
          };
        }

        if (isExtra && !EFFECT_MODELS[fx.type]) {
          const texture = EFFECT_TEXTURES[fx.type];
          if (texture) {
            return {
              kind: 'sprite' as const,
              file: texture,
              anchor: fx.at,
              count: Math.max(1, fx.count),
              size: PARTICLE_SIZE,
              life: Math.min(0.8, spriteLife(fx.type)),
              ground: false,
              lift: 1.1,
              spread: fx.count > 1 ? 0.7 : 0,
              note: `Particle_Spawn(${fx.type}) → ${texture}`,
            };
          }
        }
        return toPart(fx, ground);
      })
      .filter((p): p is FxPart => !!p);
  }

  if (ATTACK_STAGE_EXTRAS[id]) parts.push(...ATTACK_STAGE_EXTRAS[id]);

  /*
   * 武器砸地类的**落地件**：源码 244 在 life==3 那一帧才
   *   `CreateEffect(0xF7/0xF5/0xF6)`（碎石/地裂）+ `Particle_Spawn(0x4BF)`（扬尘），
   * 所以它们不能和武器同时出现 —— 用 `delay` 推到落地那一刻（0.68 s）。
   * 放到 `parts` 里而不是在渲染层偷偷生成，是为了让「源码说有几件」和
   * 「实际生成几件」永远一一对应（探针按 `parts` 数）。
   */
  if (parts.some(p => p.kind === 'weaponSlam')) {
    parts.push(
      {
        kind: 'model',
        file: SUBSTITUTE[244],
        anchor: 'self',
        count: 1,
        scale: 1,
        life: 0.5,
        delay: 0.68,
        note: '落地（life==3）→ 地裂模型（源码 CreateEffect(0xF7/0xF5/0xF6) 的碎石）',
      },
      {
        kind: 'sprite',
        file: 'Effect/smoke01.OZJ',
        anchor: 'self',
        count: 6,
        size: 0.55,
        life: 0.55,
        spread: 0.55,
        delay: 0.68,
        note: '落地（life==3）→ Particle_Spawn(0x4BF) 扬尘（源码 8 个，这里 6 个）',
      }
    );
  }

  /*
   * wiki 补充（`xulek/muonline`，见 `skillFxRefine.ts`）：
   * 二进制里能挖到「生成了哪个模型」，挖不到**撞地之后发生了什么**
   * （碎石、爆闪、火柱、外圈爆裂、命中目标的那道雷）。
   * `patch` 微调已有件，`add` 追加缺失件；`source` 仍保持 `client`
   * —— 因为它补的是同一个技能的同一套表现，不是我们编的。
   */
  /*
   * 源码一件都没给（`SKILL_CASTS` / `ATTACK_STAGE_EXTRAS` 都没有）时，先用
   * `SKILL_FX` 的兜底件铺底，**再**套 `SKILL_REFINE`。
   *
   * 顺序很重要：55 玄月斩的 `Tail.bmd` 就来自兜底，而 `SKILL_REFINE[55].patch`
   * 要把它从「落在目标身上」改成「身前挥砍」。以前兜底放在 refine 之后，
   * patch 找不到那件、add 又加了 2 件 → `parts.length` 变非 0，
   * 兜底的 Tail 就被整份丢掉了（实测只剩 2 件）。
   */
  const fromSource = parts.length > 0;
  if (!parts.length) parts = fromFallback(skill.fx);

  const refine = SKILL_REFINE[id];
  if (refine?.patch) {
    for (const rule of refine.patch) {
      const target = parts.find(
        p => p.kind === rule.kind && (!rule.file || p.file === rule.file)
      );
      if (target) Object.assign(target, rule.set);
    }
  }
  if (refine?.add?.length) parts.push(...refine.add);
  // 整份替换（黑龙波那种「换个渲染器」的情况）
  if (refine?.replace) parts = refine.replace.map(p => ({ ...p }));

  /*
   * 法师的五个技能走显式修正表（见 `WIZARD_FIX` 的注释）：
   * 二进制的调用没错，是这个 port 把「在施法者身上生成 + 沿角度推进」
   * 画成了「原地不动」。替换整份 parts，避免和上面生成的件混在一起。
   */
  let source: CastSpec['source'] = fromSource ? 'client' : 'fallback';
  const wiz = WIZARD_FIX[id];
  if (wiz) {
    parts = wiz.parts.map(p => ({ ...p }));
    source = wiz.source;
  }

  // buff / 治疗 / 召唤：源码挂在目标身上，演示里改成挂自己
  if (SELF_CAST.has(id)) {
    for (const p of parts) if (p.anchor === 'target') p.anchor = 'self';
  }

  const a = actionOf(id, skill.job);

  // 源码里就没有视觉的技能：不生成任何特效（只播动作 + 打伤害）
  if (NO_VISUAL.has(id)) {
    return {
      action: a.action,
      actionNote: a.note,
      source: 'none',
      parts: [],
      note: '源码无特效：只有挥砍动作（光效来自武器拖尾，另一套系统）',
    };
  }

  const spec = {
    action: a.action, // -1 = 让调用方按当前武器算挥砍动作
    actionNote: a.note,
    source,
    parts,
    special: refine?.special,
    note: refine?.special
      ? refine.note
      : wiz
        ? wiz.note
        : source === 'client'
          ? `源码 ${parts.length} 件特效`
          : '源码未覆盖，走表现兜底',
  };

  /*
   * 弓箭类在客户端是**投射物实体**（`CreateArrow` / `CreateArrows`，从弓上飞出去），
   * 不是原地特效 —— `MoveCharacter` 里 case 24/51/52 都只调 `CreateArrows`，
   * 一次 `CreateEffect` 都没有。所以这里的 parts 留空，箭由 `main.ts` 的
   * `shootArrows()` 负责（3 支 / 1 支 / 1 支，见那里的注释）。
   *
   * 以前这里是把 `SKILL_FX` 的兜底箭头模型改成 `homing` —— "一坨飞过去"，
   * 数量也不对（多重箭只出 1 支）。
   */
  if (BOW_SKILLS.has(id)) {
    /*
     * 52 穿透箭：源码除 `CreateArrows`（箭由 `shootArrows` 发）外，
     * 还 `CreateJoint(1258)×2 @目标`（JointLaser02 贯穿光）。
     * 其余弓箭技能（24/51）源码只有 CreateArrows，parts 保持空。
     */
    if (id === 52) {
      parts = [
        {
          kind: 'beam',
          file: 'Effect/JointLaser02.OZJ',
          anchor: 'target',
          count: 2,
          size: 0.42,
          life: 0.4,
          aim: true,
          note: '52 穿透箭：CreateJoint(1258)×2 @目标（JointLaser02 贯穿光）',
        },
      ];
    }
    return {
      action: a.action,
      actionNote: a.note,
      source: 'client',
      parts,
      note:
        id === 52
          ? '52 穿透箭：CreateArrows（箭由 shootArrows 发）+ Joint 1258×2 贯穿光'
          : '源码走 CreateArrows（投射物实体，不是原地特效）→ 由 shootArrows 发箭',
    };
  }

  return spec;
}

/** 面板上给技能标一个「来源」小标 */
export function sourceTag(id: number): '源码' | '兜底' | '无' {
  if (SKILL_CASTS[id] || ATTACK_STAGE_EXTRAS[id]) return '源码';
  if (NO_VISUAL.has(id)) return '无';
  return '兜底';
}
