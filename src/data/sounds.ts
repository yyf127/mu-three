/**
 * 音效表 —— 逐条抄 0.97 客户端的 `Sound_LoadGameSamples`（IDA `OpenSounds` @ 0x0050F030）。
 *
 * 出处：`Mu-97k-Client-Source-main/src/Model/Model_Gates.cpp:34-120`
 * （那个文件名叫 Gates，装的其实是音频：`LoadWaveFile(id, path, nChannels, b3D)`）。
 *
 * 三条要注意的：
 *
 *   1. **id 就是 `PlayBuffer(id)` 的参数**，最大 420（`g_lpDSBuffer[420][4]`）。
 *   2. `channels` = 原版允许同时出声的实例数（`MaxBufferChannel[id]`）。
 *      1 的（宝石、商店、环境音）被打断就重来；2 的（脚步、挥砍、魔法）可以叠两层。
 *   3. `pos3d` = `Enable3DSound[id]`：原版用 DirectSound3D 按**施法者/受击者坐标**
 *      做方位和距离衰减，所以别人的脚步声/怪物叫声是有位置的。
 *
 * ⚠️ 原版界面上那声「叮」（按钮、开面板）走的是 `PlayBuffer(0x19)` / `(0x1C)`，
 * 而这两个 id **没有被加载**（表里 0x18/0x19/0x1A/0x1B 全空）——
 * `PlayBuffer` 拿到空 buffer 直接 `E_FAIL`，也就是**原版这声本来就是哑的**。
 * 之前有人以为是漏了音效，其实是官方行为，这里保持不放。
 */

export interface SoundDef {
  /** `PlayBuffer(id)` 用的号 */
  id: number;
  /** `Data/Sound/` 下的真实文件名（大小写照磁盘） */
  file: string;
  /** 允许同时播放的实例数（`MaxBufferChannel`） */
  channels: number;
  /** 是否 3D 定位音（`Enable3DSound`） */
  pos3d: boolean;
  /** 原版注释里的韩文原名，方便和二进制对照 */
  note?: string;
}

/** `Data/Sound/` 前缀 */
export const SOUND_DIR = 'Data/Sound/';
/** `Data/Music/` 前缀 */
export const MUSIC_DIR = 'Data/Music/';

export const SOUNDS: SoundDef[] = [
  /* ── 环境循环音（地图底噪，原版用 DSBPLAY_LOOPING 长放） ────────── */
  { id: 0x00, file: 'aWind.wav', channels: 1, pos3d: false, note: '바람 风' },
  { id: 0x01, file: 'aRain.wav', channels: 1, pos3d: false, note: '비 雨' },
  { id: 0x02, file: 'aForest.wav', channels: 1, pos3d: false, note: '숲 森林' },
  { id: 0x03, file: 'aDungeon.wav', channels: 1, pos3d: false, note: '던젼 地牢' },
  { id: 0x05, file: 'aTower.wav', channels: 1, pos3d: false, note: '탑 塔' },
  { id: 0x06, file: 'aWater.wav', channels: 1, pos3d: false, note: '물 水' },
  { id: 0x07, file: 'desert.wav', channels: 1, pos3d: false, note: 'desert 沙漠' },
  { id: 0x14, file: 'aHeaven.wav', channels: 1, pos3d: false, note: 'aHeaven 天空' },

  /* ── 脚步（按地面材质，2 声道可叠） ───────────────────────────── */
  { id: 0x08, file: 'pWalk(Soil).wav', channels: 2, pos3d: false, note: '걷기(땅) 土' },
  { id: 0x09, file: 'pWalk(Grass).wav', channels: 2, pos3d: false, note: '걷기(풀) 草' },
  { id: 0x0a, file: 'pWalk(Snow).wav', channels: 2, pos3d: false, note: '걷기(눈) 雪' },
  { id: 0x0b, file: 'pSwim.wav', channels: 2, pos3d: false, note: '수영 游泳' },

  /* ── 环境动物/机关（3D） ─────────────────────────────────────── */
  { id: 0x0c, file: 'aBird1.WAV', channels: 1, pos3d: true, note: '새1 鸟' },
  { id: 0x0d, file: 'aBird2.WAV', channels: 1, pos3d: true, note: '새2 鸟' },
  { id: 0x0e, file: 'aBat.wav', channels: 1, pos3d: true, note: '박쥐 蝙蝠' },
  { id: 0x0f, file: 'aMouse.WAV', channels: 1, pos3d: true, note: '쥐 老鼠' },
  { id: 0x10, file: 'aGrate.wav', channels: 1, pos3d: true, note: '쇠창살 铁栅' },
  { id: 0x11, file: 'aDoor.wav', channels: 1, pos3d: false, note: '문 门' },
  { id: 0x12, file: 'aCastleDoor.wav', channels: 1, pos3d: false, note: '성문 城门' },
  { id: 0x15, file: 'aThunder01.wav', channels: 1, pos3d: false, note: '雷 1' },
  { id: 0x16, file: 'aThunder02.wav', channels: 1, pos3d: false, note: '雷 2' },
  { id: 0x17, file: 'aThunder03.wav', channels: 1, pos3d: false, note: '雷 3' },

  /* ── 打击（2 声道；短击 0x32..0x34 / 重击 0x35..0x38） ─────────── */
  { id: 0x32, file: 'eShortBlow1.wav', channels: 2, pos3d: false, note: '짧은타격1' },
  { id: 0x33, file: 'eShortBlow2.wav', channels: 2, pos3d: false, note: '짧은타격2' },
  { id: 0x34, file: 'eShortBlow3.wav', channels: 2, pos3d: false, note: '짧은타격3' },
  { id: 0x35, file: 'eBlow1.wav', channels: 2, pos3d: false, note: '타격1' },
  { id: 0x36, file: 'eBlow2.wav', channels: 2, pos3d: false, note: '타격2' },
  { id: 0x37, file: 'eBlow3.wav', channels: 2, pos3d: false, note: '타격3' },
  { id: 0x38, file: 'eBlow4.wav', channels: 2, pos3d: false, note: '타격4' },

  /* ── 挥砍（空挥/命中前那一下） ───────────────────────────────── */
  { id: 0x28, file: 'eSwingWeapon1.wav', channels: 2, pos3d: false, note: '무기휘두르기1' },
  { id: 0x29, file: 'eSwingWeapon2.wav', channels: 2, pos3d: false, note: '무기휘두르기2' },
  { id: 0x2a, file: 'eSwingLightSword.wav', channels: 2, pos3d: false, note: '광선검휘두르기' },
  { id: 0x41, file: 'eBow.wav', channels: 2, pos3d: false, note: '활 弓' },
  { id: 0x42, file: 'eCrossbow.wav', channels: 2, pos3d: false, note: '석궁 弩' },
  { id: 0x43, file: 'eMix.wav', channels: 2, pos3d: false, note: '믹스 合成' },

  /* ── 玩家动作 ───────────────────────────────────────────────── */
  { id: 0x1d, file: 'pGetItem.wav', channels: 1, pos3d: false, note: '아이템가지기 拾取' },
  { id: 0x1e, file: 'pDropItem.wav', channels: 1, pos3d: false, note: '아이템떨어트리기 丢弃' },
  { id: 0x1f, file: 'pDropMoney.wav', channels: 1, pos3d: false, note: '금화떨어트리기 掉钱' },
  { id: 0x20, file: 'pDrink.wav', channels: 1, pos3d: false, note: '마시기 喝药' },
  { id: 0x21, file: 'pEatApple.wav', channels: 1, pos3d: false, note: '사과먹기 吃苹果' },
  { id: 0x22, file: 'pHeartBeat.wav', channels: 1, pos3d: false, note: '심장 心跳' },
  { id: 0x23, file: 'pEnergy.wav', channels: 1, pos3d: false, note: '에너지 能量' },
  { id: 0x4b, file: 'pMaleScream1.wav', channels: 2, pos3d: false, note: '남자비명1' },
  { id: 0x4c, file: 'pMaleScream2.wav', channels: 2, pos3d: false, note: '남자비명2' },
  { id: 0x4d, file: 'pMaleScream3.wav', channels: 2, pos3d: false, note: '남자비명3' },
  { id: 0x4e, file: 'pMaleDie.wav', channels: 2, pos3d: false, note: '남자죽기 死亡' },
  { id: 0x4f, file: 'pFemaleScream1.wav', channels: 2, pos3d: false, note: '여자비명1' },
  { id: 0x50, file: 'pFemaleScream2.wav', channels: 2, pos3d: false, note: '여자비명2' },

  /* ── 技能（战士） ───────────────────────────────────────────── */
  { id: 0x51, file: 'sKnightDefense.wav', channels: 1, pos3d: false, note: '전사방어' },
  { id: 0x52, file: 'sKnightSkill1.wav', channels: 1, pos3d: false, note: '내려찍기 下劈' },
  { id: 0x53, file: 'sKnightSkill2.wav', channels: 1, pos3d: false, note: '찌르기 突刺' },
  { id: 0x54, file: 'sKnightSkill3.wav', channels: 1, pos3d: false, note: '올려치기 上撩' },
  { id: 0x55, file: 'sKnightSkill4.wav', channels: 1, pos3d: false, note: '돌려치기 回旋' },

  /* ── 技能（法师/精灵，3D） ──────────────────────────────────── */
  { id: 0x56, file: 'sTornado.wav', channels: 2, pos3d: true, note: '토네이도 龙卷风' },
  { id: 0x57, file: 'sEvil.wav', channels: 2, pos3d: true, note: '영혼 黑龙波' },
  { id: 0x58, file: 'sMagic.wav', channels: 2, pos3d: true, note: '마법 魔法' },
  { id: 0x59, file: 'sHellFire.wav', channels: 2, pos3d: true, note: '헬파이어 地狱火' },
  { id: 0x5a, file: 'sIce.wav', channels: 2, pos3d: true, note: '얼음 冰' },
  { id: 0x5b, file: 'sFlame.wav', channels: 2, pos3d: true, note: '불기둥 火柱' },
  { id: 0x5c, file: 'sAquaFlash.wav', channels: 2, pos3d: true, note: '아쿠아 极光' },

  /* ── 通用爆发/破坏 ─────────────────────────────────────────── */
  { id: 0x30, file: 'eBreak.wav', channels: 1, pos3d: true, note: '부서짐 破碎' },
  { id: 0x2c, file: 'eExplosion.wav', channels: 1, pos3d: true, note: '폭파 爆炸' },
  { id: 0x2e, file: 'eMeteorite.wav', channels: 2, pos3d: true, note: '운석 陨石' },
  { id: 0x3c, file: 'eThunder.wav', channels: 1, pos3d: true, note: '번개 闪电' },
  { id: 0x31, file: 'eGem.wav', channels: 1, pos3d: false, note: '보석 宝石' },

  /* ── 怪物（Bone 系） ───────────────────────────────────────── */
  { id: 0x5d, file: 'mBone1.WAV', channels: 2, pos3d: true, note: '해골1' },
  { id: 0x5e, file: 'mBone2.wav', channels: 2, pos3d: true, note: '해골2' },
  { id: 0x13, file: 'mAssassin1.wav', channels: 1, pos3d: true, note: '암살자' },
  { id: 0x11e, file: 'mShadowAttack1.wav', channels: 1, pos3d: false, note: '쉐도우공격' },

  /* ── 杂项 ─────────────────────────────────────────────────── */
  { id: 0x44, file: 'eFirecracker1.wav', channels: 1, pos3d: true, note: '爆竹1' },
  { id: 0x45, file: 'eFirecracker2.wav', channels: 1, pos3d: true, note: '爆竹2' },
  { id: 0x46, file: 'eMedal.wav', channels: 1, pos3d: true, note: '奖牌' },
  { id: 0x49, file: 'ePhoenixExp.wav', channels: 1, pos3d: true, note: '凤凰经验' },
  { id: 0x5f, file: 'eRidingSpear.wav', channels: 1, pos3d: false, note: '骑乘长枪' },
  { id: 0x60, file: 'eRaidShoot.wav', channels: 1, pos3d: false, note: 'RaidShoot' },
  { id: 0x61, file: 'eSwellLife.wav', channels: 1, pos3d: false, note: '生命之光' },
  { id: 0x62, file: 'eBlow.wav', channels: 1, pos3d: false, note: 'Blow' },
  { id: 0x64, file: 'ePiercing.wav', channels: 1, pos3d: false, note: '穿透箭' },
  { id: 0x65, file: 'eIceArrow.wav', channels: 1, pos3d: false, note: '冰封箭' },
  { id: 0x66, file: 'eTelekinesis.wav', channels: 1, pos3d: false, note: 'Telekinesis' },
  { id: 0x67, file: 'eSoulBarrier.wav', channels: 1, pos3d: false, note: '守护之魂' },
  { id: 0x68, file: 'eBloodAttack.wav', channels: 1, pos3d: false, note: 'BloodAttack' },
  { id: 0x69, file: 'eHitGate.wav', channels: 1, pos3d: false, note: 'HitGate' },
  { id: 0x6a, file: 'eHitGate2.wav', channels: 1, pos3d: false, note: 'HitGate2' },
  { id: 0x6b, file: 'eHitCristal.wav', channels: 1, pos3d: false, note: 'HitCristal' },
  { id: 0x6c, file: 'eDownGate.wav', channels: 1, pos3d: false, note: 'DownGate' },
  { id: 0x6d, file: 'eCrow.wav', channels: 1, pos3d: false, note: 'Crow' },
  { id: 0x76, file: 'aTamajjang1.wav', channels: 1, pos3d: true, note: '塔玛藏 1' },
  { id: 0x77, file: 'aTamajjang2.wav', channels: 1, pos3d: true, note: '塔玛藏 2' },

  /* ── NPC（`NPC_ModelLoad.cpp`，按 NPC 类型加载到固定槽） ─────── */
  { id: 0x78, file: 'nBlackSmith.wav', channels: 1, pos3d: false, note: '铁匠' },
  { id: 0x79, file: 'nMix.wav', channels: 1, pos3d: false, note: '合成机' },
];

/** id → 定义 */
export const SOUND_BY_ID = new Map<number, SoundDef>(SOUNDS.map(s => [s.id, s]));

/**
 * 环境循环音 —— 抄 `Game_MainLoop.cpp:430-500` 的 BGM 状态机。
 *
 * 原版每个 `World` 子状态挂一条 **looped** 的 `PlayBuffer`，切图时把不相干的
 * `Sound_StopBuffer` 掉。这里按地图号给一个「底噪」，语义一样：
 *
 *   0 洛兰/室外 → 风(0)      1 地下城 → 地牢(3)     2 冰风谷 → 风(0)
 *   3 诺利亚    → 森林(2)    4 失落之塔 → 塔(5)     7 亚特兰蒂斯 → 水(6)
 *   8 塔卡      → 沙漠(7)    9 恶魔广场 → 地牢(3)   10 天空之城 → 天堂(0x14)
 *   11..16 血色城堡 → 地牢(3)
 */
export const AMBIENT_BY_MAP: Record<number, number> = {
  0: 0x00,
  1: 0x03,
  2: 0x00,
  3: 0x02,
  4: 0x05,
  5: 0x00,
  6: 0x00,
  7: 0x06,
  8: 0x07,
  9: 0x03,
  10: 0x14,
  11: 0x03,
  12: 0x03,
  13: 0x03,
  14: 0x03,
  15: 0x03,
  16: 0x03,
};

/**
 * BGM（`globals.cpp:365-373` 的 `g_lpszMp3`）。
 *
 * 原版只有 6 首：酒馆(Pub)、MuTheme=Lorencia（登录 + 洛兰）、
 * Devias 教堂(Cathedral，**素材缺失**)、Devias、Noria、Dungeon(World 1 和 5)。
 * 所以别的地图**本来就没有 BGM**，只有底噪 —— 这里如实照抄，不硬凑。
 */
export const BGM_BY_MAP: Record<number, string> = {
  0: 'Lorencia.mp3',
  1: 'Dungeon.mp3',
  2: 'Devias.mp3',
  3: 'Noria.mp3',
  5: 'Dungeon.mp3',
};

/** 登录界面/选角：原版 `SceneFlag == 2` 放的就是 MuTheme（= Lorencia.mp3） */
export const BGM_LOGIN = 'Lorencia.mp3';

/**
 * 技能号 → 音效号（`Combat_AttackStage.cpp` / `Skills.cpp` 里各 case 的 `PlayBuffer`）。
 *
 * 只收「有明确出处」的那些；没列到的技能**不出声**（原版不少技能本来就没音效，
 * 硬给一个反而错）。战士四连（41/42/43/47/49）对应 `sKnightSkill1..4`，
 * 顺序按 `Model_Gates.cpp` 那条注释里的对应关系。
 */
export const SKILL_SOUND: Record<number, number> = {
  1: 0x58, // 毒咒       sMagic
  2: 0x2e, // 陨石       eMeteorite
  3: 0x3c, // 掌心雷     eThunder
  4: 0x5b, // 火球       sFlame
  5: 0x5b, // 火龙       sFlame
  7: 0x5a, // 冰封       sIce
  8: 0x56, // 龙卷风     sTornado
  9: 0x57, // 黑龙波     sEvil
  10: 0x59, // 地狱火     sHellFire
  12: 0x5c, // 极光       sAquaFlash
  13: 0x2c, // 爆炎       eExplosion
  14: 0x5b, // 毁灭烈焰   sFlame
  16: 0x67, // 守护之魂   eSoulBarrier
  18: 0x51, // 圣盾防御   sKnightDefense（战士系）
  27: 0x58, // 守护之光   sMagic
  28: 0x58, // 战神之力   sMagic
  41: 0x55, // 霹雳回旋斩 sKnightSkill4（돌려치기 回旋）
  42: 0x52, // 雷霆裂闪   sKnightSkill1（내려찍기 下劈）
  43: 0x53, // 袭风刺     sKnightSkill2（찌르기 突刺）
  47: 0x54, // 钻云枪     sKnightSkill3（올려치기 上撩）
  48: 0x61, // 生命之光   eSwellLife
  51: 0x65, // 冰封箭     eIceArrow
  52: 0x64, // 穿透箭     ePiercing
  55: 0x55, // 玄月斩     sKnightSkill4
  56: 0x55, // 天雷闪     sKnightSkill4
};
