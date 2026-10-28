/**
 * ⚠️ 自动生成，不要手改 —— 改 `tools/extract-skill-fx.mjs` 后重跑。
 *
 *   node tools/extract-skill-fx.mjs
 *
 * 数据全部摘自 0.97k 客户端源码（`Mu-97k-Client-Source-main`）：
 *
 *   EFFECT_MODELS    `src/Model/Model_Misc.cpp`   Model_LoadSkillEffectAssets() —— IDA: OpenSkills 0x0050B710
 *   EFFECT_TEXTURES  `src/Scene/Scene_AssetLoad.cpp`                              —— 特效贴图表
 *   SKILL_CASTS      `src/Net/SecondPassword.cpp`  MoveCharacter() —— IDA: 0x00449900
 *   EFFECT_LIFE      `src/Render/Effect_Create.cpp`                               —— 寿命（帧）
 */

/** 特效号 → `Data/Skill/` 下的 BMD 模型（源码里的模型槽 190..268） */
export const EFFECT_MODELS: Record<number, string> = {
  190: 'Skill/Ice01.bmd',
  191: 'Skill/Fire01.bmd',
  192: 'Skill/Poison01.bmd',
  193: 'Skill/Tama01.bmd',
  195: 'Skill/Rider01.bmd',
  197: 'Skill/Stone01.bmd',
  198: 'Skill/Stone02.bmd',
  199: 'Skill/Ice02.bmd',
  200: 'Skill/Circle01.bmd',
  201: 'Skill/Circle02.bmd',
  202: 'Skill/Magic01.bmd',
  203: 'Skill/Magic02.bmd',
  204: 'Skill/Storm01.bmd',
  205: 'Skill/Laser01.bmd',
  206: 'Skill/Skeleton01.bmd',
  207: 'Skill/Skeleton02.bmd',
  208: 'Skill/Skeleton03.bmd',
  209: 'Skill/Saw01.bmd',
  210: 'Skill/Bone01.bmd',
  211: 'Skill/Bone02.bmd',
  212: 'Skill/Snow01.bmd',
  213: 'Skill/Snow02.bmd',
  214: 'Skill/Snow03.bmd',
  216: 'Skill/Arrow01.bmd',
  217: 'Skill/Arrowsteel01.bmd',
  218: 'Skill/Arrowthunder01.bmd',
  219: 'Skill/Arrowlaser01.bmd',
  220: 'Skill/Arrowv01.bmd',
  221: 'Skill/Arrowsaw01.bmd',
  222: 'Skill/Arrownature01.bmd',
  223: 'Skill/Arrowbomb01.bmd',
  224: 'Skill/Arrowwing01.bmd',
  225: 'Skill/Protect01.bmd',
  226: 'Skill/Bigstone01.bmd',
  227: 'Skill/Bigstone02.bmd',
  233: 'Skill/Magiccircle01.bmd',
  236: 'Skill/Ball01.bmd',
  240: 'Skill/Blast01.bmd',
  241: 'Skill/Inferno01.bmd',
  242: 'Skill/Arrowdouble01.bmd',
  245: 'Skill/Earthquake01.bmd',
  246: 'Skill/Earthquake02.bmd',
  247: 'Skill/Earthquake03.bmd',
  248: 'Skill/Earthquake04.bmd',
  249: 'Skill/Earthquake05.bmd',
  250: 'Skill/Earthquake06.bmd',
  251: 'Skill/Earthquake07.bmd',
  252: 'Skill/Earthquake08.bmd',
  253: 'Skill/Flashing.bmd',
  254: 'Skill/Tail.bmd',
  255: 'Skill/Piercing.bmd',
  259: 'Skill/Protect02.bmd',
  266: 'Skill/Ridingspear01.bmd',
  267: 'Skill/Rider02.bmd',
  268: 'Skill/Phoenixshield01.bmd',
};

/** 特效号 → `Data/Effect/` 下的贴图（源码里的精灵段 0x4xx） */
export const EFFECT_TEXTURES: Record<number, string> = {
  1150: 'Effect/flare01.OZJ',
  1165: 'Effect/blur01.OZJ',
  1166: 'Effect/motion_blur.OZJ',
  1167: 'Effect/motion_blur_r.OZJ',
  1170: 'Effect/Chrome01.OZJ',
  1171: 'Effect/bab2.OZJ',
  1175: 'Effect/Spark02.OZJ',
  1176: 'Effect/Spark03.OZJ',
  1180: 'Effect/Thunder01.OZJ',
  1191: 'Effect/lightning2.OZJ',
  1195: 'Effect/Fire01.OZJ',
  1196: 'Effect/Fire02.OZJ',
  1197: 'Effect/Fire03.OZJ',
  1200: 'Effect/Flame01.OZJ',
  1205: 'Effect/blood01.ozt',
  1206: 'Effect/blood.OZT',
  1215: 'Effect/Explotion01.OZJ',
  1216: 'Effect/DinoE.OZJ',
  1220: 'Effect/smoke01.OZJ',
  1221: 'Effect/smoke02.ozt',
  1230: 'Effect/Shiny01.OZJ',
  1231: 'Effect/Shiny02.OZJ',
  1232: 'Effect/Shiny03.OZJ',
  1233: 'Effect/eye01.OZJ',
  1234: 'Effect/ring.OZJ',
  1247: 'Effect/Fire04.OZJ',
  1249: 'Effect/Flare.OZJ',
  1250: 'Effect/flare02.OZJ',
  1253: 'Effect/JointSpirit01.OZJ',
  1254: 'Effect/JointThunder01.OZJ',
  1257: 'Effect/Spark01.OZJ',
  1258: 'Effect/JointLaser01.OZJ',
  1259: 'Effect/JointEnergy01.OZJ',
  1261: 'Effect/JointLaser02.OZJ',
  1262: 'Effect/motion_blur_r2.OZJ',
  1264: 'Effect/Magic_Ground2.OZJ',
  1265: 'Effect/Magic_Circle1.OZJ',
  1266: 'Effect/Chrome02.OZJ',
  1277: 'Effect/flareBlue.OZJ',
  1278: 'Effect/NSkill.OZJ',
  1381: 'Effect/fi01.OZJ',
  1382: 'Effect/fi02.OZT',
  1383: 'Effect/PoundingBall.OZJ',
};

/** 特效号 → 寿命帧数（25fps）；源码 `pfVar17[0x18]` 的位模式换算回来的 */
export const EFFECT_LIFE_FRAMES: Record<number, number> = {
  182: 2,
  194: 50,
  196: 10,
  200: 45,
  201: 40,
  202: 20,
  204: 59,
  209: 10,
  230: 100,
  233: 30,
  237: 50,
  238: 5,
  239: 25,
  240: 30,
  242: 30,
  243: 30,
  245: 35,
  247: 35,
  248: 35,
  249: 40,
  250: 35,
  251: 40,
  252: 40,
  255: 100,
  259: 20,
  265: 60,
  266: 20,
  1180: 20,
  1196: 10,
  1265: 20,
  1267: 10,
  1382: 10,
  1430: 30,
};

export interface SourceFx {
  /** CreateEffect / Particle_Spawn / Joint_Create 的第一个参数 */
  type: number;
  /** 生成在谁身上：自己 / 目标 / 目标脚下的地面点 / 施法者身前 */
  at: 'self' | 'target' | 'targetGround' | 'front';
  /** 源码里这一帧放几个 */
  count: number;
  /**
   * CreateEffect 的第 5 个实参（SubType）。
   * 同一个模型号靠它区分用法：191/0 = 陨石下砸、191/1 = 追踪火球。
   */
  sub?: number;
  /** 是不是追踪弹（源码 param_5 = 1 且 param_6 = Owner） */
  homing?: boolean;
}

export interface SourceCast {
  /** self = 无目标分支（switch ((char)v328)），target = 有目标分支（switch (skillId)） */
  phase: 'self' | 'target';
  effects: SourceFx[];
  particles: SourceFx[];
  joints: SourceFx[];
  bombRing?: boolean;
}

/** 技能号 → MoveCharacter 里那一帧要生成的东西 */
export const SKILL_CASTS: Record<number, SourceCast> = {
  1: {
    phase: 'target',
    effects: [
    { type: 192, at: 'target', count: 1 },
    ],
    particles: [
    { type: 1220, at: 'target', count: 10, sub: 1 },
    ],
    joints: [],
  },
  2: {
    phase: 'target',
    effects: [
    { type: 191, at: 'target', count: 1 },
    ],
    particles: [],
    joints: [],
  },
  4: {
    phase: 'target',
    effects: [
    { type: 191, at: 'self', count: 1, sub: 1, homing: true },
    ],
    particles: [],
    joints: [],
  },
  5: {
    phase: 'self',
    effects: [
    { type: 1200, at: 'targetGround', count: 1 },
    ],
    particles: [],
    joints: [],
  },
  7: {
    phase: 'target',
    effects: [
    { type: 190, at: 'target', count: 1 },
    { type: 199, at: 'target', count: 5 },
    ],
    particles: [],
    joints: [],
  },
  8: {
    phase: 'self',
    effects: [
    { type: 204, at: 'self', count: 1 },
    ],
    particles: [],
    joints: [],
  },
  9: {
    phase: 'self',
    effects: [],
    particles: [],
    joints: [
    { type: 1253, at: 'self', count: 8 },
    ],
  },
  10: {
    phase: 'self',
    effects: [
    { type: 200, at: 'self', count: 1 },
    { type: 201, at: 'self', count: 1 },
    ],
    particles: [],
    joints: [],
  },
  11: {
    phase: 'target',
    effects: [
    { type: 203, at: 'self', count: 1 },
    ],
    particles: [],
    joints: [],
  },
  12: {
    phase: 'self',
    effects: [
    { type: 1210, at: 'front', count: 1 },
    ],
    particles: [],
    joints: [],
  },
  13: {
    phase: 'self',
    effects: [
    { type: 240, at: 'targetGround', count: 2 },
    ],
    particles: [],
    joints: [],
  },
  14: {
    phase: 'self',
    effects: [
    { type: 241, at: 'self', count: 1 },
    ],
    particles: [],
    joints: [],
    bombRing: true,
  },
  16: {
    phase: 'target',
    effects: [],
    particles: [],
    joints: [
    { type: 266, at: 'target', count: 5 },
    ],
  },
  17: {
    phase: 'target',
    effects: [
    { type: 1180, at: 'self', count: 1 },
    ],
    particles: [],
    joints: [],
  },
  26: {
    phase: 'target',
    effects: [
    { type: 1264, at: 'target', count: 1, sub: 1, homing: true },
    ],
    particles: [],
    joints: [],
  },
  27: {
    phase: 'target',
    effects: [
    { type: 1264, at: 'target', count: 1, sub: 2 },
    ],
    particles: [],
    joints: [
    { type: 266, at: 'target', count: 10, sub: 4 },
    ],
  },
  28: {
    phase: 'target',
    effects: [
    { type: 1264, at: 'target', count: 1, sub: 3 },
    ],
    particles: [],
    joints: [],
  },
  30: {
    phase: 'self',
    effects: [
    { type: 1264, at: 'self', count: 1, sub: 3 },
    ],
    particles: [],
    joints: [],
  },
  31: {
    phase: 'self',
    effects: [
    { type: 1264, at: 'self', count: 1, sub: 3 },
    ],
    particles: [],
    joints: [],
  },
  32: {
    phase: 'self',
    effects: [
    { type: 1264, at: 'self', count: 1, sub: 3 },
    ],
    particles: [],
    joints: [],
  },
  33: {
    phase: 'self',
    effects: [
    { type: 1264, at: 'self', count: 1, sub: 3 },
    ],
    particles: [],
    joints: [],
  },
  34: {
    phase: 'self',
    effects: [
    { type: 1264, at: 'self', count: 1, sub: 3 },
    ],
    particles: [],
    joints: [],
  },
  35: {
    phase: 'self',
    effects: [
    { type: 1264, at: 'self', count: 1, sub: 3 },
    ],
    particles: [],
    joints: [],
  },
  36: {
    phase: 'self',
    effects: [
    { type: 1264, at: 'self', count: 1, sub: 3 },
    ],
    particles: [],
    joints: [],
  },
  41: {
    phase: 'self',
    effects: [
    { type: 238, at: 'self', count: 1 },
    ],
    particles: [],
    joints: [],
  },
  42: {
    phase: 'self',
    effects: [
    { type: 244, at: 'self', count: 1 },
    ],
    particles: [],
    joints: [],
  },
  48: {
    phase: 'self',
    effects: [
    { type: 1264, at: 'self', count: 36, sub: 4 },
    ],
    particles: [],
    joints: [
    { type: 1253, at: 'self', count: 36, sub: 2 },
    ],
  },
  49: {
    phase: 'self',
    effects: [
    { type: 1382, at: 'self', count: 1 },
    ],
    particles: [],
    joints: [],
  },
};
