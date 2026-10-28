/**
 * 技能特效**补充表** —— 来自 `xulek/muonline`（`Client.Main/Objects/Effects`）。
 *
 * 为什么需要这一层：
 *
 *   1. `skillFx.generated.ts` 是从 **0.97k 原版二进制** 里挖出来的「这一帧生成了什么」，
 *      它能告诉我们「陨石 = CreateEffect(191)，从 4 格高处以 -12.5 m/s 砸下来」，
 *      但**挖不出「砸中之后还发生了什么」** —— 落地那一刻的碎石、爆闪、火柱
 *      在二进制里是模型自己播的动画 + 另一套粒子系统，静态提取拿不到。
 *   2. `xulek/muonline` 是照着官方 `SourceMain5.2` 重写的 C# 客户端，
 *      把这些**结构性行为**（撞地后生成什么、环形还是一片、图集几帧）写得很明确。
 *
 * 单位换算：那边 `Constants.TERRAIN_SCALE = 100f`（1 格 = 100 单位），
 * 我们 1 格 = 1 米，所以**所有长度 ÷ 100**；速度是「单位/帧」（25 fps），
 * 换算成米/秒要 `× 25 / 100 = ÷ 4`；加速度是「单位/帧²」→ `× 625 / 100`。
 *
 * ⚠️ 只补「缺失的那部分」，**不改源码已经给出的数值**（下落高度、寿命、动作号）。
 * 那边的 `FallFrames = 20f` 注释写着 "slowed ~2.5x for more dramatic arc"，
 * 是作者为了好看刻意放慢的，我们仍然用 0.97k 的真实下落时间。
 */

import type { FxPart } from './skillFx';

/** 一张图集贴图的切分方式（`Effect/Explotion01` 是 4×4 = 16 帧） */
const EXPLOSION_ATLAS = { cols: 4, rows: 4 };

export interface SkillRefine {
  /**
   * **整份替换**源码 parts（不是追加）。
   *
   * 用于「源码的件被我们换一种表现」的情况 —— 典型是黑龙波：
   * 源码是 8 条 `Joint_Create(1253)`，由 `MoveJoint` 每帧驱动；
   * 我们这边不是「关节池 + 逐帧 tick」的架构，得换成
   * `special: 'dragon-wave'` 交给专用渲染器，所以源码那 8 个静态件要丢掉。
   */
  replace?: FxPart[];
  /**
   * 交给 `main.ts` 的专用渲染器（不走通用的 part 循环）。
   * 目前只有 `dragon-wave`（黑龙波）。
   */
  special?: 'dragon-wave';
  /** 追加在源码 parts 之后的件 */
  add?: FxPart[];
  /** 微调源码已有的件（按 kind + file 匹配第一件） */
  patch?: Array<{ kind: FxPart['kind']; file?: string; set: Partial<FxPart> }>;
  /** 这一条补充的出处 */
  note: string;
}

export const SKILL_REFINE: Record<number, SkillRefine> = {
  /* ── 9 黑龙波（Evil Spirit）─────────────────────────────────────────
   * 源码 `SecondPassword.cpp` 的 `case 9`：
   *
   *   v399 = { 施法者.x, 施法者.y, z + 100 }        // 起点：头顶 1 格
   *   for (kk = 0; kk < 4; ++kk) {
   *     v394 = { 0, 0, kk * 90.0f };                // 4 个方向，各差 90°
   *     Joint_Create(1253, v399, o+16, v394, 0, o, 80.0f, target, hk);  // 头
   *     Joint_Create(1253, v399, o+16, v394, 0, o, 20.0f, -1, 0);      // 尾
   *   }
   *
   * 每帧（`MoveJoint.cpp` type 0x4E5 / sub 0）：
   *   - `scale == 80` 的那 4 条 → `CreateEffect(205)` = `Skill/Laser01.bmd`（寿命 1 帧，每帧重出）
   *   - 目标点每帧写成「施法者 z+80」→ 追着人游
   *   - `MoveHumming(..., 10.0f)` 转向；`+0x9c4 += (rand%32-16)*0.2` 抖动
   *   - `terrain+100 > z` / `terrain+400 < z` 贴地约束；颜色 `lifetime*0.1` 渐暗
   *   - `AddTerrainLight(..., 4)` 给脚下打光
   *
   * 也就是说画面是「4 条 Laser01 贴着地游 + 每条后面拖一条光带」。
   * 我们的 `castOf` 会把 joint 压成静态贴图点（8 个紫点贴在人身上），
   * 所以整份替换成专用渲染器。
   */
  9: {
    note: '9 黑龙波：4 条 Laser01（源码 205）+ 光带，贴地游动（MoveJoint 0x4E5 sub0）',
    replace: [],
    special: 'dragon-wave',
  },
  /* ── 12 极光（Aqua Beam）────────────────────────────────────────────
   * 源码 `case 12`：`CreateEffect(1210, WorldPosition, o+28, Light, 0, o, target, hk)`。
   *
   * `Effect_Create case 0x4BA` 把它初始化成**飞行弹体**：
   *   `+0x18 = 2.8026e-44`（3 帧寿命）、`+0x3a..3c = (0.5, 0.7, 1.0)` 蓝白、
   *   `local_68 = -50` → 局部前进 `(0, -50, 0)`/帧、`pfVar17[3] = 16` 缩放；
   * 同时 `RenderEffects` 会沿它走过的路连发 **30 段 1176**（`Effect/Spark03`）拖尾。
   *
   * 我们以前只画了 10 段拖尾，**没有弹体** —— 看起来像「原地冒火花」。
   * 这里补一条「从施法者射向落点」的光柱，拖尾补到 30 段。
   */
  12: {
    note: '12 极光：光柱（源码 1210 弹体）+ 30 段拖尾（1176）',
    replace: [
      {
        kind: 'beam',
        file: 'Effect/JointLaser01.OZJ',
        anchor: 'self',
        count: 1,
        size: 0.55,
        life: 0.42,
        aim: true,
        note: '源码 CreateEffect(1210)：蓝白 (0.5,0.7,1.0)、scale 16、每秒 50 单位前冲',
      },
      {
        kind: 'trail',
        file: 'Effect/Spark03.OZJ',
        anchor: 'front',
        count: 30,
        size: 0.5,
        life: 0.45,
        note: '源码沿弹道连发 30 段 1176（Spark03）',
      },
    ],
  },
  /* ── 48 生命之光（Greater Life）──────────────────────────────────────
   * 源码 `case 48`：`CreateEffect(1264)` **一个** + `for (i<36) Joint_Create(1253, 自己→自己, scale 60)`。
   *
   * 也就是说「1 个法阵 + 36 道竖直光带」，不是 36 个法阵。
   *
   * 我们的生成表在这里出了一个 bug：`extract-skill-fx.mjs` 把循环次数
   * （36）套到了 case 里**所有**件上，`1264` 也跟着变成 36 个 ——
   * 于是 36 张 `Magic_Ground2` 叠在一起，白成一片。
   * 这里整份替换掉，按源码数量来。
   */
  48: {
    note: '48 生命之光：1 个法阵 + 36 道竖光（源码 1264×1 + 1253×36）',
    replace: [
      {
        kind: 'sprite',
        file: 'Effect/Magic_Ground2.OZJ',
        anchor: 'self',
        count: 1,
        size: 3.8,
        life: 1.1,
        ground: true,
        lift: 0.06,
        note: '源码 CreateEffect(1264) @自己 sub4 → Magic_Ground2',
      },
      {
        kind: 'sprite',
        file: 'Effect/JointSpirit01.OZJ',
        anchor: 'self',
        count: 36,
        size: 0.5,
        life: 0.9,
        lift: 0.05,
        // 源码那 36 条是「从脚往上拉」的关节；贴图层用「向上窜的光点」近似
        rise: 6.5,
        spread: 1.05,
        note: '源码 for(i<36) Joint_Create(1253, 自己→自己, scale 60)',
      },
    ],
  },
  /* ── 27 守护之光（Greater Defense）────────────────────────────────────
   * 源码：`CreateEffect(1264)` + **2 个** `Joint_Create(266, 自己→自己, sub4)`。
   * 生成表给成了 10 个（同样是 count 传递的锅）。
   */
  27: {
    note: '27 守护之光：法阵 + 2 道环绕光（源码 1264×1 + 266×2）',
    replace: [
      {
        kind: 'sprite',
        file: 'Effect/Magic_Ground2.OZJ',
        anchor: 'self',
        count: 1,
        size: 3.8,
        life: 1.1,
        ground: true,
        lift: 0.06,
        note: '源码 CreateEffect(1264) sub2',
      },
      {
        kind: 'sprite',
        file: 'Effect/JointSpirit01.OZJ',
        anchor: 'self',
        count: 2,
        size: 0.9,
        life: 1.0,
        lift: 0.9,
        spread: 0.7,
        note: '源码 Joint_Create(266) ×2（266 是模型槽，借纹理，这里用灵魂火花）',
      },
    ],
  },
  /* ── 55 玄月斩（Fire Slash）──────────────────────────────────────────
   * 源码 `AttackStage` 的 `skill==55` 分支（`Combat_AttackStage.cpp`）：
   *
   *   if (stage && stage <= 2) CreateEffect(1267, …, sub=1, owner=o);
   *   if (frame >= 3) { PlayBuffer(84); CreateEffect(1168, …, owner=o, target, hotkey); }
   *
   *   1267 = `Effect_Create` 的 `case 0x4F3`：寿命 **1 帧**（`+0x18 = 1.4013e-44`），
   *          本质是「贴着一个点闪一下」，H5 里 1 帧 ≈ 看不见；
   *   1168 = `case 0x490`：寿命 30 帧（1.2 s），`+0x3a..3c = 0.8` 灰白，
   *          `goto LAB_00463e3d` —— 那是「**从骨骼连到目标的一道线**」，不是模型。
   *
   * 所以原版这一刀的画面是「一道弧光 + 一道连到目标的光鞭」。
   * 以前 55 只配了 `Tail.bmd` 一件、而且落在**目标**位置，看起来像目标自己发光。
   */
  55: {
    note: '55 玄月斩：挥砍弧光挪到身前 + 补上一道连到目标的能量弧 + 命中爆闪（源码 1267/1168）',
    patch: [
      {
        kind: 'model',
        file: 'Skill/Tail.bmd',
        set: { anchor: 'front', spin: 7, life: 0.42, scale: 1.1 },
      },
    ],
    add: [
      {
        kind: 'beam',
        file: 'Effect/JointEnergy01.OZJ',
        anchor: 'self',
        count: 1,
        size: 0.5,
        // 源码 1168 是 30 帧（1.2 s）；太短会看不见，取一半
        life: 0.55,
        aim: true,
        note: '源码 1168（Effect_Create case 0x490）= 从施法者连到目标的一道线，30 帧',
      },
      {
        kind: 'flash',
        file: 'Effect/Explotion01.OZJ',
        anchor: 'target',
        count: 1,
        size: 2.0,
        life: 0.55,
        lift: 1.2,
        tint: 0xffc46b,
        note: '源码 1267（case 0x4F3）= 1 帧闪光，这里放到 0.4 s 才看得见',
      },
    ],
  },
  /* ── 2 陨石 ──────────────────────────────────────────────────────────
   * `ScrollOfMeteoriteEffect.TriggerImpact()`：
   *   - `SpawnImpactStones()`：**6 颗**（`Skill/Stone01|02.bmd` 随机），
   *     初速 `RandomRange(-6.5, 6.5)` 水平 / `6..12` 垂直（单位/帧）
   *     → 水平 ±1.6 m/s、垂直 1.5..3.0 m/s，`velocity.Z -= 1.2` 每帧 → 重力 **-7.5**
   *     寿命 16..24 帧（0.64..0.96 s），缩放 0.65..1.0
   *   - `SpawnImpactFire()`：**3 层火柱**，高度 0 / 35 / 70（0 / 0.35 / 0.7 格），
   *     缩放 1 / 0.75 / 0.5，时长 3.5 / 2.8 / 2.1 s
   *   - `DrawImpactFlash()`：`Effect/Explotion01.jpg` **4×4 = 16 帧**图集，
   *     在撞击点周围叠 4 处，世界半径 220 单位 = **2.2 格**，闪 16 帧（0.64 s）
   * 0.97k 那边只有「火模型砸下来」，落地后是一片空白 —— 这就是陨石「不像陨石」的原因。
   */
  2: {
    note: 'Meteorite 撞击：碎石 ×6 + 爆闪 ×4 + 火柱 ×3（xulek ScrollOfMeteoriteEffect）',
    add: [
      {
        kind: 'debris',
        file: 'Skill/Stone01.bmd',
        anchor: 'targetGround',
        count: 3,
        scale: 0.85,
        life: 0.8,
        vel: { x: 0.9, y: 0.9, z: 1.9 },
        velJitter: 1.7,
        gravity: -7.5,
        delay: 0.34, // 火模型 4 格 / 12.5 m/s ≈ 0.32 s 落地
        note: '撞击碎石 Stone01（wiki：6 颗之一半，初速 ±1.6、重力 -7.5）',
      },
      {
        kind: 'debris',
        file: 'Skill/Stone02.bmd',
        anchor: 'targetGround',
        count: 3,
        scale: 0.85,
        life: 0.8,
        vel: { x: -0.9, y: 0.6, z: 2.2 },
        velJitter: 1.7,
        gravity: -7.5,
        delay: 0.34,
        note: '撞击碎石 Stone02（wiki：6 颗之一半）',
      },
      {
        kind: 'flash',
        file: 'Effect/Explotion01.OZJ',
        anchor: 'targetGround',
        count: 4,
        size: 4.4, // 世界半径 2.2 格 → 直径 4.4
        life: 0.64, // 16 帧
        frames: EXPLOSION_ATLAS,
        /*
         * 四处爆裂**不是叠在同一点**：源码 `burstPositions` 是
         * (0,0,50) / (30,20,30) / (-25,15,60) / (15,-30,40) 单位
         * → xy 在 ±0.3 格内、高度 0.3..0.6 格。散太开就成了一圈礼花，
         * 叠太紧又糊成一团，按源码取 0.32。
         *
         * 着色也是源码给的：`Color(1, 0.7, 0.35)` → `0xffb359`。不加这层，
         * 4 层加色白贴图 = 一片死白（这正是之前「地板被白光盖住」的观感）。
         */
        spread: 0.32,
        lift: 0.45,
        tint: 0xffb359,
        delay: 0.34,
        note: '撞击爆闪 Explotion01 4×4 图集 ×4（wiki：世界半径 2.2 格、16 帧、橙色叠加）',
      },
      {
        kind: 'sprite',
        file: 'Effect/Flame01.OZJ',
        anchor: 'targetGround',
        count: 1,
        size: 1.5,
        life: 3.5,
        lift: 0,
        delay: 0.34,
        note: '撞击火柱第 1 层（wiki：0 格高、缩放 1、3.5 s）',
      },
      {
        kind: 'sprite',
        file: 'Effect/Flame01.OZJ',
        anchor: 'targetGround',
        count: 1,
        size: 1.13,
        life: 2.8,
        lift: 0.35,
        delay: 0.34,
        note: '撞击火柱第 2 层（wiki：0.35 格高、缩放 0.75、2.8 s）',
      },
      {
        kind: 'sprite',
        file: 'Effect/Flame01.OZJ',
        anchor: 'targetGround',
        count: 1,
        size: 0.75,
        life: 2.1,
        lift: 0.7,
        delay: 0.34,
        note: '撞击火柱第 3 层（wiki：0.7 格高、缩放 0.5、2.1 s）',
      },
    ],
  },

  /* ── 5 火龙 ──────────────────────────────────────────────────────────
   * `ScrollOfFlameEffect`：地面片按 **2×2 格**铺（不是整片），再叠火焰粒子。
   * 我们原来凭感觉给了 3.8 米（≈4 格），铺得过大，火看起来「假大」。
   * 另外补 5 簇上升火苗 —— 那边是 `flame particles`，我们只有一张静态地面片。
   */
  5: {
    note: 'Flame 地面片收成 2×2 格 + 上升火苗 ×5（xulek ScrollOfFlameEffect）',
    patch: [{ kind: 'sprite', file: 'Effect/Flame01.OZJ', set: { size: 2.2, life: 1.1 } }],
    add: [
      {
        kind: 'sprite',
        file: 'Effect/Flame01.OZJ',
        anchor: 'targetGround',
        count: 5,
        size: 0.8,
        life: 0.75,
        lift: 0.25,
        spread: 1.0,
        note: '火焰粒子（wiki：地面 2×2 格 + flame particles）',
      },
    ],
  },

  /* ── 8 龙卷风 ────────────────────────────────────────────────────────
   * `ScrollOfTwisterEffect`（`Skills/TwisterSkillEffect.cs` 建它）：
   *   - `ResolveMoveDirection()` 取**朝目标的方向**，`_center += dir * MoveSpeed * dt`，
   *     `MoveSpeed = 240` 单位/秒 = **2.4 m/s 匀速**；
   *   - `_storm.Angle.Z += StormSpinSpeed * dt`，`StormSpinSpeed = 8` rad/s；
   *   - 寿命 `LifeFrames = 59` = 2.36 s；
   *   - 沿路还冒 `Effect/smoke02` 烟、`JointThunder01` 雷电和石头。
   * 我们原来固定在施法者脚下、转速 2.4 rad/s，看起来像「站着放了个柱子」。
   * 0.97k 那边没有「匀速」概念，所以这里用 `flySpeed` 让追踪速度回到 2.4 m/s。
   */
  8: {
    note: '龙卷风朝目标 2.4 m/s 匀速移动 + 8 rad/s 自转（xulek ScrollOfTwisterEffect）',
    patch: [
      {
        kind: 'model',
        file: 'Skill/Storm01.bmd',
        set: { homing: true, flySpeed: 2.4, spin: 8, life: 2.36, lift: 0 },
      },
    ],
    add: [
      {
        kind: 'sprite',
        file: 'Effect/smoke02.OZT',
        anchor: 'self',
        count: 6,
        size: 1.4,
        life: 0.9,
        lift: 0.2,
        spread: 0.9,
        delay: 0.05,
        note: '沿路烟尘（wiki：Effect/smoke02，每 0.035 s 一颗）',
      },
    ],
  },

  /* ── 10 地狱火 ───────────────────────────────────────────────────────
   * `ScrollOfHellFireEffect`：
   *   - `Circle01.bmd` + `Circle02.bmd` 双环（我们已有，寿命 45/40 帧）
   *   - `SpawnStone()` 在 `RandFPSCheck(4)` 里 —— 也就是**每 4 帧一颗**，
   *     45 帧寿命内约 **11 颗**，不是一次性撒完。位置在半径
   *     `Next(0,300)` = **0..3 格**的随机角度上，缩放 0.9、寿命 40 帧（1.6 s）
   *   - 石头的运动是 **向上加速**：`Position.Z += gravity; gravity += 0.5`
   *     → **+3.1 m/s²**，1.6 s 后升到约 **4 格高**，所以是「从地里顶出来的火石」
   *   - 镜头抖 3.5、地形光 300 单位
   * 用 `delay` 拆成 4 批错开生成，模拟源码的「滴出来」而不是一次炸开。
   */
  10: {
    note: '地狱火补火石 ×12（wiki：每 4 帧一颗、半径 0..3 格、向上加速 3.1）',
    add: [
      {
        kind: 'debris',
        file: 'Skill/Stone01.bmd',
        anchor: 'self',
        count: 3,
        scale: 0.9,
        life: 1.6,
        spread: 3.0,
        vel: { x: 0, y: 0, z: 0 },
        gravity: 3.1,
        note: '火石第 1 批（wiki：0..3 格随机、向上加速 3.1 m/s²）',
      },
      {
        kind: 'debris',
        file: 'Skill/Stone02.bmd',
        anchor: 'self',
        count: 3,
        scale: 0.9,
        life: 1.6,
        spread: 3.0,
        vel: { x: 0, y: 0, z: 0 },
        gravity: 3.1,
        delay: 0.32, // 每 4 帧 ≈ 0.16 s，一批 3 颗即 ~0.48 s 内出完
        note: '火石第 2 批',
      },
      {
        kind: 'debris',
        file: 'Skill/Stone01.bmd',
        anchor: 'self',
        count: 3,
        scale: 0.9,
        life: 1.6,
        spread: 3.0,
        vel: { x: 0, y: 0, z: 0 },
        gravity: 3.1,
        delay: 0.64,
        note: '火石第 3 批',
      },
      {
        kind: 'debris',
        file: 'Skill/Stone02.bmd',
        anchor: 'self',
        count: 3,
        scale: 0.9,
        life: 1.6,
        spread: 3.0,
        vel: { x: 0, y: 0, z: 0 },
        gravity: 3.1,
        delay: 0.96,
        note: '火石第 4 批（源码寿命内共约 11 颗）',
      },
    ],
  },

  /* ── 14 毁灭烈焰 ─────────────────────────────────────────────────────
   * `ScrollOfInfernoEffect`：中心一个 `Skill/inferno01.bmd`，外面**一圈爆裂**
   * `SpawnBursts()`：8 个，**半径 `RingRadius = 220` 单位 = 2.2 格**、
   * 抬高 `BombZOffset = 80` 单位 = 0.8 格、每个 45°；
   * 每个爆裂上叠一张 `Explotion01` 图集（`scale 2.4`，色 `1/0.7/0.4`）
   * 和 20 颗 `Effect/Spark03` 火花。
   * 早先凭感觉给 `spread: 3.2`，环散得比源码宽一半，看着像「龙卷火」。
   */
  14: {
    note: '毁灭烈焰补外圈爆闪 ×8 + 火花 ×8（xulek ScrollOfInfernoEffect）',
    add: [
      {
        kind: 'flash',
        file: 'Effect/Explotion01.OZJ',
        anchor: 'self',
        count: 8,
        size: 2.4,
        life: 0.55,
        frames: EXPLOSION_ATLAS,
        spread: 2.2, // RingRadius 220 单位
        lift: 0.8, // BombZOffset 80 单位
        tint: 0xffb366, // 源码 `new Color(1f, 0.7f, 0.4f)`
        delay: 0.1,
        note: '外圈爆裂 ×8（wiki：半径 2.2 格、抬高 0.8 格、橙红 1/0.7/0.4）',
      },
      {
        kind: 'sprite',
        file: 'Effect/Spark03.OZJ',
        anchor: 'self',
        count: 10, // 源码每个爆裂 20 颗，共 160；挑 10 颗代表
        size: 0.6,
        life: 0.5,
        lift: 0.8,
        spread: 2.2,
        delay: 0.1,
        note: '外圈火花（wiki：Spark03，每爆裂 20 颗）',
      },
    ],
  },

  /* ── 42 雷霆裂闪 ─────────────────────────────────────────────────────
   * `RagefulBlowEffect`（wiki 9.2 #5）：冲击波 + 能量拖尾 + 地震模型 + 碎石。
   * 我们已有「武器砸地 → 地裂 + 扬尘」，缺**冲击波那一下**和飞溅碎石。
   *
   * 源码只有 **1 处**爆裂（`_explosion.Scale = 0.5f`，`ExplosionLifeFrames = 20`
   * → 0.8 s，`Color.White` 不染色），加 12 道 `Spark01` 关节火花和 24 颗
   * `Spark02` 火星。早先写成「2 处、尺寸 3.4」是凭感觉放的，太大也太多。
   */
  42: {
    note: '雷霆裂闪补冲击波爆闪 + 火星 + 碎石（xulek RagefulBlowEffect）',
    add: [
      {
        kind: 'flash',
        file: 'Effect/Explotion01.OZJ',
        anchor: 'self',
        count: 1,
        size: 2.0,
        life: 0.8, // 20 帧
        frames: EXPLOSION_ATLAS,
        lift: 0.3,
        tint: 0xffffff, // 源码这一处就是 `Color.White`，不染色
        delay: 0.68, // 与落地同帧（life==3）
        note: '落地冲击波（wiki：1 处、20 帧、白色）',
      },
      {
        kind: 'sprite',
        file: 'Effect/Spark02.OZJ',
        anchor: 'self',
        count: 10, // 源码 24 颗
        size: 0.7,
        life: 0.45,
        lift: 0.5,
        spread: 1.8,
        delay: 0.68,
        note: '落地火星（wiki：Spark02 ×24）',
      },
      {
        kind: 'debris',
        file: 'Skill/Stone01.bmd',
        anchor: 'self',
        count: 4,
        scale: 0.7,
        life: 0.7,
        spread: 1.2,
        vel: { x: 0, y: 0, z: 2.4 },
        velJitter: 2.2,
        gravity: -7.5,
        delay: 0.68,
        note: '落地碎石（wiki：stone debris，重力 -7.5）',
      },
    ],
  },

  /* ── 43 袭风刺 ───────────────────────────────────────────────────────
   * `DeathStabEffect` + `DeathStabVictimEffect`：命中后的 35 帧里，
   * **每 2 帧**在受击者身上随机挑两根骨骼，中间挂一道 `JointThunderEffect`
   * （`Effect/JointThunder01`）—— 电是被打的人身上来回爬，不是一道长光。
   * 我们原来 3 道光束全在自己身上炸开（`AttackStage` 的 `CreateJoint(0x10A)`），
   * 少了「打在人身上」那一下 —— 用 `anchor: 'target'` 的短电弧补上。
   */
  43: {
    note: '袭风刺补「受击者体表电弧」×6（xulek DeathStabVictimEffect）',
    add: [
      {
        kind: 'beam',
        file: 'Effect/JointThunder01.OZJ',
        anchor: 'target',
        count: 6,
        size: 0.32,
        life: 0.5,
        spread: 0.55,
        lift: 1.0,
        delay: 0.16,
        note: '受击者身上随机两点间的电弧（wiki：每 2 帧一道、共 35 帧）',
      },
    ],
  },
};
