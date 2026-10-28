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
   * 下面三个在原版客户端里**不是普通 NPC 模型**，走的是
   * `CreateChar5(Key, 390, …)`（玩家骨架 + 硬编码装备外观）：
   *
   *   Monster.cpp:1245  case 236: OpenNpc(390); CreateChar5(Key, 390, …)  ← 黄金弓箭手
   *   Monster.cpp:1299  case 247: CreateChar5(Key, 390, …)               ← 守卫
   *   Monster.cpp:1318  case 249: CreateChar5(Key, 390, …)               ← Berdysh Guard
   *
   * `OpenNpc(390)` 在 `NPC_ModelLoad.cpp` 的 switch 里没有对应分支
   * （那份反编译只到 0x176），`Data/Npc` 下也没有 GoldenArcher 的 bmd，
   * 所以本 port 先给它们**替身模型**，保证「人站在那儿」看得见：
   *
   *   236 黄金弓箭手（NPC，女性）→ `Sevina01`（精灵女性）
   *   247 / 249 城门守卫（重甲士兵）→ `Man01`（男装），配合缩放看着像守卫
   *
   * TODO 真正的做法是新增「NPC 用玩家外观」这条路径（charSet + 装备槽），
   *      能一次把 236/247/249 全部还原成原版样子。
   */
  236: 374,
  247: 336,
  249: 336,
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

export interface ModelRef {
  /** 'monster' → Data/Monster、'npc' → Data/NPC */
  dir: 'monster' | 'npc';
  /** 主体模型（承载骨架） */
  base: string;
  /** 附加部件（只有人形 NPC 需要：头/上身/腿/鞋） */
  parts: string[];
  name: string;
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
