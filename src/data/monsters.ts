/**
 * 怪物 / NPC 名字与最大 HP —— 从服务端 `MuServer/Data/Monster/Monster.txt` 生成。
 *
 * 那张表是「Tab 对齐」的（Name 后面补了不定数量的空 Tab），所以解析时把空字段
 * 全部丢掉再取：`[Index, Rate, Name, Level, MaxLife, ...]`。
 *
 * `Index` 就是服务端下发的 `PMSG_VIEWPORT_MONSTER.type`（客户端叫 Class），直接当键用。
 *
 * 用途：
 *   - 头顶名字（0.97 原版不画怪物名，这里按需求补上）
 *   - 血条上限 —— 服务端**不下发**怪物血量，只在受伤的 `0x15` 里带 `Life`，
 *     所以上限只能从这张表拿；没打过之前按满血画。
 */
export interface MonsterInfo {
  name: string;
  maxLife: number;
}

/** 索引 = 服务端怪物 Type */
export const MONSTERS: Record<number, MonsterInfo> = {
  0: { name: 'Bull Fighter', maxLife: 100 },
  1: { name: 'Hound', maxLife: 140 },
  2: { name: 'Budge Dragon', maxLife: 60 },
  3: { name: 'Spider', maxLife: 30 },
  4: { name: 'Elite Bull Fighter', maxLife: 190 },
  5: { name: 'Hell Hound', maxLife: 1400 },
  6: { name: 'Lich', maxLife: 255 },
  7: { name: 'Giant', maxLife: 400 },
  8: { name: 'Poison Bull Fighter', maxLife: 2500 },
  9: { name: 'Thunder Lich', maxLife: 2000 },
  10: { name: 'Dark Knight', maxLife: 3000 },
  11: { name: 'Ghost', maxLife: 1000 },
  12: { name: 'Larva', maxLife: 750 },
  13: { name: 'Hell Spider', maxLife: 1600 },
  14: { name: 'Skeleton', maxLife: 525 },
  15: { name: 'Skeleton Archer', maxLife: 1100 },
  16: { name: 'Chief Skeleton Warrior', maxLife: 1800 },
  17: { name: 'Cyclops', maxLife: 850 },
  18: { name: 'Gorgon', maxLife: 6000 },
  19: { name: 'Yeti', maxLife: 900 },
  20: { name: 'Elite Yeti', maxLife: 1200 },
  21: { name: 'Assassin', maxLife: 800 },
  22: { name: 'Ice Monster', maxLife: 650 },
  23: { name: 'Hommerd', maxLife: 700 },
  24: { name: 'Worm', maxLife: 600 },
  25: { name: 'Ice Queen', maxLife: 4000 },
  26: { name: 'Goblin', maxLife: 45 },
  27: { name: 'Chain Scorpion', maxLife: 80 },
  28: { name: 'Beetle Monster', maxLife: 165 },
  29: { name: 'Hunter', maxLife: 220 },
  30: { name: 'Forest Monster', maxLife: 295 },
  31: { name: 'Agon', maxLife: 340 },
  32: { name: 'Stone Golem', maxLife: 465 },
  33: { name: 'Elite Goblin', maxLife: 120 },
  34: { name: 'Cursed Wizard', maxLife: 4000 },
  35: { name: 'Death Gorgon', maxLife: 6000 },
  36: { name: 'Shadow', maxLife: 2800 },
  37: { name: 'Devil', maxLife: 5000 },
  38: { name: 'Balrog', maxLife: 9000 },
  39: { name: 'Poison Shadow', maxLife: 3500 },
  40: { name: 'Death Knight', maxLife: 5500 },
  41: { name: 'Death Cow', maxLife: 4500 },
  42: { name: 'Red Dragon', maxLife: 5000 },
  43: { name: 'Golden Budge Dragon', maxLife: 2200 },
  44: { name: 'Dragon', maxLife: 15000 },
  45: { name: 'Bahamut', maxLife: 2400 },
  46: { name: 'Vepar', maxLife: 2800 },
  47: { name: 'Valkyrie', maxLife: 3200 },
  48: { name: 'Lizard King', maxLife: 9000 },
  49: { name: 'Hydra', maxLife: 19000 },
  50: { name: 'Sea Worm', maxLife: 19000 },
  51: { name: 'Great Bahamut', maxLife: 7000 },
  52: { name: 'Silver Valkyrie', maxLife: 8000 },
  53: { name: 'Golden Titan', maxLife: 8000 },
  54: { name: 'Golden Soldier', maxLife: 3500 },
  55: { name: 'Death King', maxLife: 1800 },
  56: { name: 'Death Bone', maxLife: 700 },
  57: { name: 'Iron Wheel', maxLife: 17000 },
  58: { name: 'Tantalos', maxLife: 22000 },
  59: { name: 'Zaikan', maxLife: 34000 },
  60: { name: 'Bloody wolf', maxLife: 13500 },
  61: { name: 'Beam Knight', maxLife: 25000 },
  62: { name: 'Mutant', maxLife: 10000 },
  63: { name: 'Death Beam Knight', maxLife: 40000 },
  64: { name: 'Ogre archer', maxLife: 10000 },
  65: { name: 'Elite Ogre', maxLife: 14000 },
  66: { name: 'Cursed king', maxLife: 38000 },
  67: { name: 'Metal Balrog', maxLife: 26000 },
  69: { name: 'Alquamos', maxLife: 11500 },
  70: { name: 'Queen Rainier', maxLife: 19000 },
  71: { name: 'Mega Crust', maxLife: 15000 },
  72: { name: 'Phantom Knight', maxLife: 41000 },
  73: { name: 'Drakan', maxLife: 29000 },
  74: { name: 'Alpha Crust', maxLife: 34500 },
  75: { name: 'Great Drakan', maxLife: 50000 },
  77: { name: 'Phoenix of Darkness', maxLife: 95000 },
  78: { name: 'Golden Goblin', maxLife: 3100 },
  79: { name: 'Golden Derkon', maxLife: 23000 },
  80: { name: 'Golden Lizard King', maxLife: 25000 },
  81: { name: 'Golden Vepar', maxLife: 6300 },
  82: { name: 'Golden Tantalos', maxLife: 30000 },
  83: { name: 'Golden Wheel', maxLife: 15000 },
  84: { name: 'Chief Skeleton Warrior', maxLife: 1100 },
  85: { name: 'Chief Skeleton Archer', maxLife: 1400 },
  86: { name: 'Dark Skull Soldier', maxLife: 1700 },
  87: { name: 'Giant Ogre', maxLife: 2100 },
  88: { name: 'Red Skeleton Knight', maxLife: 2800 },
  89: { name: 'Magic Skeleton', maxLife: 3700 },
  90: { name: 'Chief Skeleton Warrior', maxLife: 3500 },
  91: { name: 'Chief Skeleton Archer', maxLife: 4100 },
  92: { name: 'Dark Skull Soldier', maxLife: 5000 },
  93: { name: 'Giant Ogre', maxLife: 6000 },
  94: { name: 'Red Skeleton Knight', maxLife: 7000 },
  95: { name: 'Magic Skeleton', maxLife: 8000 },
  96: { name: 'Chief Skeleton Warrior', maxLife: 5000 },
  97: { name: 'Chief Skeleton Archer', maxLife: 6500 },
  98: { name: 'Dark Skull Soldier', maxLife: 8000 },
  99: { name: 'Giant Ogre', maxLife: 9500 },
  100: { name: 'Lance', maxLife: 1000 },
  101: { name: 'Iron Stick', maxLife: 1000 },
  102: { name: 'Fire', maxLife: 1000 },
  103: { name: 'Meteorite', maxLife: 1000 },
  104: { name: 'Trap', maxLife: 50 },
  105: { name: 'Canon Trap', maxLife: 1000 },
  106: { name: 'Laser Trap', maxLife: 1000 },
  111: { name: 'Red Skeleton Knight', maxLife: 12000 },
  112: { name: 'Magic Skeleton', maxLife: 15000 },
  113: { name: 'Chief Skeleton Warrior', maxLife: 7500 },
  114: { name: 'Chief Skeleton Archer', maxLife: 9500 },
  115: { name: 'Dark Skull Soldier', maxLife: 12000 },
  116: { name: 'Giant Ogre', maxLife: 15000 },
  117: { name: 'Red Skeleton Knight', maxLife: 18000 },
  118: { name: 'Magic Skeleton', maxLife: 24000 },
  119: { name: 'Chief Skeleton Warrior', maxLife: 12000 },
  120: { name: 'Chief Skeleton Archer', maxLife: 15000 },
  121: { name: 'Dark Skull Soldier', maxLife: 19000 },
  122: { name: 'Giant Ogre', maxLife: 23000 },
  123: { name: 'Red Skeleton Knight', maxLife: 26000 },
  124: { name: 'Magic Skeleton', maxLife: 32000 },
  125: { name: 'Chief Skeleton Warrior', maxLife: 17000 },
  126: { name: 'Chief Skeleton Archer', maxLife: 20000 },
  127: { name: 'Dark Skull Soldier', maxLife: 25000 },
  128: { name: 'Giant Ogre', maxLife: 32000 },
  129: { name: 'Red Skeleton Knight', maxLife: 38000 },
  130: { name: 'Magic Skeleton', maxLife: 47000 },
  131: { name: 'Castle Gate', maxLife: 2000 },
  132: { name: 'Statue of Saint', maxLife: 3000 },
  133: { name: 'Statue of Saint', maxLife: 3000 },
  134: { name: 'Statue of Saint', maxLife: 3000 },
  150: { name: 'Bali', maxLife: 5000 },
  151: { name: 'Soldier', maxLife: 4000 },
  152: { name: 'Pichula', maxLife: 50 },
  200: { name: 'Soccer Ball', maxLife: 1000 },
  230: { name: 'Wandering Merchant Alex', maxLife: 50 },
  231: { name: 'Thompson Kenel', maxLife: 50 },
  232: { name: 'Archangel', maxLife: 50 },
  233: { name: 'Messenger of Archangel', maxLife: 50 },
  234: { name: 'Npc Transfer', maxLife: 50 },
  235: { name: 'Sebina the Priest', maxLife: 50 },
  236: { name: 'Golden Archer', maxLife: 50 },
  237: { name: 'Charon', maxLife: 50 },
  238: { name: 'Chaos Goblin', maxLife: 50 },
  239: { name: 'Arena Guard', maxLife: 50 },
  240: { name: 'Safety Guardian', maxLife: 50 },
  241: { name: 'Captain Lorence', maxLife: 50 },
  242: { name: 'Elf Lala', maxLife: 50 },
  243: { name: 'Eo the Craftsman', maxLife: 50 },
  244: { name: 'Caren the Barmaid', maxLife: 50 },
  245: { name: 'Wizard Izabel', maxLife: 50 },
  246: { name: 'Weapons Merchant Zienna', maxLife: 1000 },
  247: { name: 'Archer Guard', maxLife: 10000 },
  248: { name: 'Merchant Martin', maxLife: 1000 },
  249: { name: 'Berdysh Guard', maxLife: 10000 },
  250: { name: 'Merchant Peddler', maxLife: 1000 },
  251: { name: 'Hanzo the Blacksmith', maxLife: 1000 },
  252: { name: '', maxLife: 50 },
  253: { name: 'Potion Girl Amy', maxLife: 50 },
  254: { name: 'Pasi the Mage', maxLife: 50 },
  255: { name: 'Lumen the Barmaid', maxLife: 50 },
};

/** 按 Type 查名字（查不到回落到调用方给的备用名） */
/**
 * `Data/Local/NPCName.txt` 读进来的名字表（中文客户端那份）。
 *
 * 原版 `getMonsterName(Type)` 只查这张表（`Item/NPC_Data.cpp` 的
 * `NPCName_LoadTextData` 就是它的数据源），**不看服务端的 Monster.txt** ——
 * 所以中文客户端里是「骷灵战士 / 圣导士塞维娜」，不是「Skeleton / Sebina」。
 * 我们的 `MONSTERS` 表来自服务端 `Monster.txt`（英文），只当兜底。
 */
let NPC_NAME_TABLE: Map<number, string> | null = null;

/** 装表（`main.ts` 启动时喂一次）；表为空时所有查询都退回 `MONSTERS` */
export function setNpcNameTable(table: Map<number, string>): void {
  NPC_NAME_TABLE = table;
  console.log(`[name] NPCName.txt ${table.size} 条（怪物/NPC 中文名牌）`);
}

/** 表里有多少条（探针 / 日志用） */
export function npcNameTableSize(): number {
  return NPC_NAME_TABLE?.size ?? 0;
}

/** 只查 NPCName.txt（没有就返回空串） */
export function npcNameOfClass(cls: number): string {
  return NPC_NAME_TABLE?.get(cls) ?? '';
}

export function monsterNameOf(cls: number, fallback = ''): string {
  return npcNameOfClass(cls) || MONSTERS[cls]?.name || fallback;
}

/** 按 Type 查最大 HP（0 = 表里没写 / NPC） */
export function monsterMaxLifeOf(cls: number): number {
  return MONSTERS[cls]?.maxLife ?? 0;
}
