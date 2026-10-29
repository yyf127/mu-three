/**
 * 服务端怪物 / NPC 的 Class → 客户端模型文件。
 *
 * 以前我是按 `Monster{Class+1}.bmd` 猜的，结果和客户端对不上：
 * 客户端 `Monster.cpp::CreateMonster` 是一个大 switch，每个 Class 显式调用
 * `OpenMonsterModel(n)`（→ `Monster{n+1}.bmd`）或 `OpenNpc(n)`（→ `Npc/{名字}01.bmd`），
 * 索引和 Class 完全不是简单加一。
 *
 * 例如 Class 3（Spider）是 `Monster10.bmd`，Class 7（Bull Fighter）是 `Monster06.bmd`，
 * 洛兰的 Lumen the Barmaid（Class 255）是 `Npc/Female01.bmd`。
 *
 * 数据来源：Mu-97k-Client-Source-main/src/Monster/Monster.cpp（CreateMonster）
 *          Mu-97k-Client-Source-main/src/Item/NPC_ModelLoad.cpp（OpenNpc）
 */
import { npcNameOfClass } from '../data/monsters';

/** Class → OpenMonsterModel 的参数 n，模型文件是 Monster{n+1}.bmd */
const MONSTER_MODEL_INDEX: Record<number, number> = {
  1: 1, 2: 2, 3: 9, 5: 1, 6: 4, 7: 5, 9: 4, 10: 3, 11: 7, 12: 6, 13: 8,
  17: 10, 18: 11, 19: 12, 20: 13, 21: 14, 22: 15, 23: 16, 24: 17, 25: 18,
  26: 19, 27: 20, 28: 21, 29: 22, 30: 23, 31: 24, 32: 25, 33: 19, 35: 11,
  36: 28, 37: 26, 38: 27, 39: 28, 40: 29, 41: 30, 42: 31, 43: 2, 44: 31,
  45: 33, 46: 34, 47: 35, 48: 36, 49: 37, 50: 38, 51: 33, 52: 35, 53: 39,
  54: 40, 57: 41, 58: 42, 59: 42, 60: 43, 61: 44, 62: 45, 63: 44, 64: 46,
  65: 47, 66: 48, 67: 27, 68: 49, 69: 50, 70: 51, 71: 52, 72: 53, 73: 54,
  74: 52, 75: 54, 77: 55, 78: 19, 79: 31, 80: 36, 81: 34, 82: 42, 83: 41,
  84: 47, 85: 46, 86: 59, 87: 58, 88: 57, 89: 62, 131: 61, 132: 60,
  150: 32, 151: 40, 234: 19,
};

/** Class → OpenNpc 的参数 n（n 就是 Data/Npc 下的文件基名 + 序号 1） */
const NPC_MODEL_BY_INDEX: Record<number, string> = {
  335: 'Female01',
  336: 'Man01',
  337: 'Girl01',
  338: 'Smith01',
  339: 'Wizard01',
  340: 'SnowMerchant01',
  341: 'SnowSmith01',
  342: 'SnowWizard01',
  343: 'ElfWizard01',
  344: 'ElfMerchant01',
  345: 'Master01',
  346: 'Storage01',
  347: 'Tournament01',
  348: 'MixNpc01',
  349: 'DevilNpc01',
  374: 'Sevina01',
  375: 'BloodCastle01',
  376: 'BloodCastle02',
  377: 'DeviasTrader01',
};

/** Class → OpenNpc 索引 */
const NPC_INDEX_BY_CLASS: Record<number, number> = {
  230: 336,
  231: 377,
  232: 375,
  233: 376,
  235: 374,
  237: 349,
  238: 348,
  239: 347,
  240: 346,
  241: 345,
  242: 343,
  243: 344,
  244: 340,
  245: 342,
  246: 341,
  248: 336,
  250: 336,
  251: 338,
  253: 337,
  254: 339,
  255: 335,
  /*
   * 236 / 247 / 249 不在这张表里 —— 它们走「玩家骨架 + 装备」，
   * 见下面的 `PLAYER_SKIN_NPCS`（原版 `CreateChar5(Key, 390, …)`，
   * 390 = 0x186 = player.bmd 的模型槽）。
   */
};

/**
 * Class → 怪物名（取服务端 `MonsterSetBase.txt` 的注释列）。
 * 服务端 0x13 报文只给 Class，不带名字，客户端本来是查 MonsterScript.txt，
 * 这里用刷怪表里的名字顶上。
 */
const CLASS_NAMES: Record<number, string> = {
  1: 'Hound',
  2: 'Budge Dragon',
  3: 'Spider',
  4: 'Bull Fighter',
  5: 'Hell Hound',
  6: 'Lich',
  7: 'Giant',
  8: 'Poison Bull Fighter',
  9: 'Thunder Lich',
  10: 'Dark Knight',
  11: 'Ghost',
  12: 'Larva',
  13: 'Hell Spider',
  14: 'Skeleton',
  15: 'Skeleton Archer',
  16: 'Chief Skeleton Warrior',
  17: 'Cyclops',
  18: 'Gorgon',
  19: 'Yeti',
  20: 'Elite Yeti',
  21: 'Assassin',
  22: 'Ice Monster',
  23: 'Hommerd',
  24: 'Worm',
  26: 'Goblin',
  27: 'Chain Scorpion',
  28: 'Beetle Monster',
  29: 'Hunter',
  30: 'Forest Monster',
  31: 'Agon',
  32: 'Stone Golem',
  33: 'Elite Goblin',
  34: 'Cursed Wizard',
  35: 'Death Gorgon',
  36: 'Shadow',
  37: 'Devil',
  38: 'Balrog',
  39: 'Poison Shadow',
  40: 'Death Knight',
  41: 'Death Cow',
  42: 'Red Dragon',
  43: 'Golden Budge Dragon',
  45: 'Bahamut',
  46: 'Vepar',
  47: 'Valkyrie',
  48: 'Lizard King',
  49: 'Hydra',
  50: 'Sea Worm',
  51: 'Great Bahamut',
  52: 'Silver Valkyrie',
  53: 'Golden Titan',
  54: 'Golden Soldier',
  55: 'Death King',
  56: 'Death Bone',
  57: 'Iron Wheel',
  58: 'Tantalos',
  59: 'Zaikan',
  60: 'Blood Wolf',
  61: 'Beam Knight',
};

/** 这些 Class 在客户端里只调 CreateChar5(Key, 390) —— 没有模型加载，本资源也没有 */
const NO_MODEL_CLASSES = new Set([14, 15, 16, 34, 55, 56, 100, 101, 102, 103, 200]);

/**
 * 服务端刷怪表里出现的 NPC 名字（洛兰 / 冰风谷 / 诺利亚）。
 * 服务端 0x13 报文只给 Class，不给名字，只能本地按 Class 映射。
 */
export const NPC_NAMES: Record<number, string> = {
  230: 'Wandering Merchant',
  231: 'Devias Trader',
  232: 'Messenger of Archangel',
  233: 'Messenger of Archangel',
  235: 'Sebina the Priest',
  237: 'Charon',
  238: 'Chaos Goblin',
  239: 'Chaos Card Master',
  240: 'Safety Guardian',
  241: 'Captain Lorence',
  242: 'Elf Lala',
  243: 'Eo the Craftsman',
  244: 'Caren the Barmaid',
  245: 'Wizard Izabel',
  246: 'Weapons Merchant Zienna',
  248: 'Wandering Merchant Martin',
  250: 'Wandering Merchant Peddler',
  251: 'Hanzo the Blacksmith',
  253: 'Lumen the Barmaid',
  254: 'Pasi the Mage',
  255: 'Lumen the Barmaid',
};

/**
 * 「用玩家骨架 + 装备槽」的 NPC。
 *
 * 原版 `CreateMonster` 里 236/247/249 走的是 `CreateChar5(Key, 390, …)` ——
 * 390 = 0x186 = **player.bmd 的模型槽**（`Model_Items.cpp` 的
 * `AccessModel(0x186, "Data\\Player\\", "Player", -1)`），
 * 所以这三个人形 NPC 本质上就是「玩家骨架 + 硬编码装备」。
 *
 * 部件偏移（每 24 字节一个槽，`Monster.cpp:1299`）：
 *
 * ```
 * c+504 Helm  c+528 Armor  c+552 Pant  c+576 Glove  c+600 Boot
 * c+624 Weapon  c+648 Shield
 * ```
 *
 * 模型槽号 → 物品类型只需减 400（`AccessModel(i + 0x26f, "HelmMale", i)`
 * 与 `SLOT_FILES` 的 `type + 400` 是同一套）：
 *
 * | 槽号 | 文件 | 物品类型 |
 * | --- | --- | --- |
 * | 633 / 665 / 697 / 729 / 761 | HelmMale10 / ArmorMale10 / PantMale10 / GloveMale10 / BootMale10 | 233 / 265 / 297 / 329 / 361（Plate 板甲五件） |
 * | 539 | CrossBow04 | 139 |
 * | 535 | Arrows01 | 135 |
 * | 503 | Spear09 | 103 |
 */
export interface PlayerSkin {
  /** 装备槽（物品类型），没写的槽不画装备 */
  equip: {
    helm?: number;
    armor?: number;
    pants?: number;
    gloves?: number;
    boots?: number;
    weapon?: number;
    shield?: number;
  };
  /**
   * 覆盖身体贴图。原版 `case 236` 里 `*(unsigned int*)(c + 4) = 207`
   * 就是「换一张皮肤」。
   *
   * 用 `skin_archer_01`（`Model_Monsters.cpp:24` 的 `OpenJPG(..., 0x131)`）：
   * 那是弓箭手专用的金色皮甲贴图，采样下来 48% 的像素落在「金」色域，
   * 而 `guard_gold2` 其实是守卫的腰布（深灰褐，gold 仅 5%），套上去只会更黑。
   */
  skinTex?: { dir: string; file: string };
  /**
   * 装备材质染色（与贴图相乘）。原版的黄金守卫是**专用模型 + 专用贴图**，
   * 这份资源包里没有（`skin_archer_01` 没有任何 bmd 引用它，套到 Plate 的
   * UV 上是错乱的），所以用乘法染色把板甲压成暗金铜色 —— 是近似，
   * 不是逐像素还原。
   */
  tint?: number;
  /** 体型：精灵装备走 Elf 系列文件名，其余 Male */
  body?: 'Male' | 'Elf';
}

/**
 * 玩家骨架 NPC 的外观表（原版 `Monster.cpp:1245/1299/1318`）。
 *
 * - **236 黄金弓箭手**：`c+4 = 207` 换皮（`guard_gold2.OZJ`）+ `c+446 = 8`
 *   动作组。原版没写装备槽，但 `CreateCharacterPointer` 会按 Type=390 填一套
 *   默认部件；这里按截图（金色全身板甲 + 弓）取 Plate 五件 + CrossBow04，
 *   靠 `skinTex` 把五件的贴图统一换成金色那张；
 * - **247 Archer Guard**：Plate 五件 + CrossBow04 + Arrows01（左手那袋箭）；
 * - **249 Berdysh Guard**：Plate 五件 + Spear09，没有盾。
 */
export const PLAYER_SKIN_NPCS: Record<number, PlayerSkin> = {
  236: {
    equip: { helm: 233, armor: 265, pants: 297, gloves: 329, boots: 361, weapon: 139 },
    tint: 0xf0b24a,
  },
  247: {
    equip: { helm: 233, armor: 265, pants: 297, gloves: 329, boots: 361, weapon: 139, shield: 135 },
  },
  249: {
    equip: { helm: 233, armor: 265, pants: 297, gloves: 329, boots: 361, weapon: 103 },
  },
};

export interface ModelRef {
  /** 'monster' → Data/Monster、'npc' → Data/NPC */
  dir: 'monster' | 'npc';
  /** 主体模型（承载骨架） */
  base: string;
  /** 附加部件（只有人形 NPC 需要：头/上身/腿/鞋） */
  parts: string[];
  name: string;
  /** 有值 = 用 player.bmd 骨架 + 这套装备（见 `PLAYER_SKIN_NPCS`） */
  player?: PlayerSkin;
}

/**
 * 人形 NPC 的部件表。
 *
 * `Female01.bmd` / `Man01.bmd` / `Girl01.bmd` 本身 **只有骨骼、没有网格**（0 mesh），
 * 真正的身体在 `FemaleHead01`、`ManUpper01` 这些部件里。
 * 客户端 `OpenNpc` 会循环加载 1..3 号部件并挂到同一套骨架上。
 */
const NPC_PARTS: Record<string, string[]> = {
  Female01: [
    'FemaleHead01',
    'FemaleHead02',
    'FemaleUpper01',
    'FemaleUpper02',
    'FemaleLower01',
    'FemaleLower02',
    'FemaleBoots01',
    'FemaleBoots02',
  ],
  Man01: [
    'ManHead01',
    'ManHead02',
    'ManUpper01',
    'ManUpper02',
    'ManGloves01',
    'ManGloves02',
    'ManBoots01',
    'ManBoots02',
  ],
  Girl01: [
    'GirlHead01',
    'GirlHead02',
    'GirlUpper01',
    'GirlUpper02',
    'GirlLower01',
    'GirlLower02',
  ],
};

/**
 * Class → 模型。没有模型的 Class（守卫、Golden Archer 等）返回 null。
 */
export function modelForClass(cls: number): ModelRef | null {
  /*
   * 玩家骨架 NPC（236 黄金弓箭手 / 247 Archer Guard / 249 Berdysh Guard）。
   * 原版是 `CreateChar5(Key, 390)` + 硬编码装备槽，所以这里给个 `player` 标记，
   * 由 `createCreatureByClass` 换一条加载路径（player.bmd 骨架 + applyEquipment）。
   */
  const skin = PLAYER_SKIN_NPCS[cls];
  if (skin) {
    return {
      dir: 'npc',
      base: 'player.bmd',
      parts: [],
      name: npcNameOfClass(cls) || NPC_NAMES[cls] || `NPC ${cls}`,
      player: skin,
    };
  }

  const npcIndex = NPC_INDEX_BY_CLASS[cls];
  if (npcIndex !== undefined) {
    const file = NPC_MODEL_BY_INDEX[npcIndex];
    if (!file) return null;
    const parts = (NPC_PARTS[file] ?? []).map(p => `${p}.bmd`);
    // 名字优先拿 `NPCName.txt`（中文原文），再退回本文件的英文常量表
    return { dir: 'npc', base: `${file}.bmd`, parts, name: npcNameOfClass(cls) || NPC_NAMES[cls] || `NPC ${cls}` };
  }

  const idx = MONSTER_MODEL_INDEX[cls];
  if (idx !== undefined) {
    return {
      dir: 'monster',
      base: `Monster${String(idx + 1).padStart(2, '0')}.bmd`,
      parts: [],
      name: CLASS_NAMES[cls] ?? `Class ${cls}`,
    };
  }

  if (NO_MODEL_CLASSES.has(cls)) return null;

  // 表里没有的 Class：退回旧规则，至少能显示点东西
  return {
    dir: 'monster',
    base: `Monster${String(cls + 1).padStart(2, '0')}.bmd`,
    parts: [],
    name: CLASS_NAMES[cls] ?? `Class ${cls}`,
  };
}

/** 是不是 NPC（服务端 Class ≥ 230 的都是 NPC / 守卫） */
export function isNpcClass(cls: number): boolean {
  return cls >= 230;
}

/**
 * 怪物动作索引（客户端 MONSTER_ACTION_* 常量）。
 * 怪物 BMD 的动作组和玩家完全不同：玩家走路是 13，怪物只有 0..5 组。
 */
export const MONSTER_ACTION = {
  STOP: 0,
  MOVE: 1,
  ATTACK1: 2,
  ATTACK2: 3,
  SHOCK: 4,
  DIE: 5,
} as const;
