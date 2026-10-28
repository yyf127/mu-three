/**
 * 服务端配置（`server/data/game.json`）的读取。
 *
 * 数据来源：`tools/build-game-config.mjs` 把 `MuServer/Data/*.txt`
 * （Monster.txt / MonsterSetBase.txt / Skill.txt）编成一份 JSON。
 * 演示服没有服务端，就靠这张表「像联机一样」拿到怪物的血/攻防/掉率、
 * 每张图的真实刷怪点。
 *
 * 为什么不做成数据库：全量 2000 行、只读、一次读全，SQL 的并发/事务/索引都用不上，
 * 反而要多背 670KB 的 sql.js wasm。一张 108KB 的 JSON（gzip ~18KB）就够了。
 */
import { assetUrl } from '../core/base';

export interface MonsterDef {
  cls: number;
  name: string;
  level: number;
  maxHp: number;
  maxMana: number;
  dmgMin: number;
  dmgMax: number;
  defense: number;
  mgcDef: number;
  atkRate: number;
  defRate: number;
  atkRange: number;
  view: number;
  moveSpeed: number;
  atkSpeed: number;
  /** 千分比掉率（Monster.txt 的 ItemRate） */
  itemRate: number;
  money: number;
  minItemLevel: number;
}

export interface SpawnDef {
  mob: number;
  x: number;
  y: number;
  dir: number;
  /** 刷新半径（0 = 固定点） */
  range: number;
}

export interface SkillDef {
  idx: number;
  name: string;
  damage: number;
  mana: number;
  range: number;
  effect: number;
  reqLevel: number;
}

/** `Item.txt` 的掉落相关三列：type = group*32 + index、物品等级、是否可掉 */
export type ItemDropRow = [type: number, level: number, drop: number];

/** 货架上一件商品：`[type, level, durability, skill, luck, option, excellent]` */
export type ShopItemRow = [number, number, number, number, number, number, number];

export interface ShopDef {
  /** 商店名（`Shop/NNN - 名字.txt` 的名字部分） */
  name: string;
  items: ShopItemRow[];
}

interface GameConfigFile {
  meta: { builtAt: string; source: string; counts: Record<string, number> };
  monsters: Record<string, MonsterDef>;
  spawns: Record<string, SpawnDef[]>;
  skills: SkillDef[];
  items?: ItemDropRow[];
  /** NPC 职业 → 商店（`ShopManager.txt` + `Shop/*.txt`） */
  shops?: Record<string, ShopDef>;
}

export interface GameConfigStatus {
  state: 'idle' | 'loading' | 'ready' | 'failed';
  error?: string;
  bytes?: number;
  ms?: number;
  counts?: Record<string, number>;
}

let loading: Promise<GameConfigFile | null> | null = null;
let config: GameConfigFile | null = null;
const status: GameConfigStatus = { state: 'idle' };

/** 调试面板/探针用 */
export function gameConfigStatus(): GameConfigStatus {
  return { ...status };
}

/**
 * 读配置（幂等）。失败只记一次日志并返回 null，调用方回退到内置表。
 */
export function loadGameConfig(): Promise<GameConfigFile | null> {
  if (loading) return loading;
  loading = (async () => {
    status.state = 'loading';
    const t0 = performance.now();
    try {
      const res = await fetch(assetUrl('server/data/game.json'));
      if (!res.ok) throw new Error(`game.json HTTP ${res.status}`);
      const text = await res.text();
      config = JSON.parse(text) as GameConfigFile;
      status.state = 'ready';
      status.bytes = text.length;
      status.ms = Math.round(performance.now() - t0);
      status.counts = config.meta?.counts;
      console.log(
        `[gameconfig] 服务端配置就绪：${(text.length / 1024).toFixed(0)}KB / ${status.ms}ms ` +
          `（怪 ${config.meta.counts.monsters} / 刷怪点 ${config.meta.counts.spawns}）`
      );
      return config;
    } catch (err) {
      status.state = 'failed';
      status.error = String(err);
      console.warn('[gameconfig] 服务端配置不可用，回退到内置表', err);
      return null;
    }
  })();
  return loading;
}

/** 全量怪物表（159 条） */
export async function monsterTable(): Promise<Map<number, MonsterDef>> {
  const map = new Map<number, MonsterDef>();
  const cfg = await loadGameConfig();
  if (!cfg) return map;
  for (const [cls, def] of Object.entries(cfg.monsters)) map.set(Number(cls), def);
  return map;
}

/** 某张图的刷怪点；没有这张图就返回空数组 */
export async function spawnTable(map: number): Promise<SpawnDef[]> {
  const cfg = await loadGameConfig();
  return cfg?.spawns?.[String(map)] ?? [];
}

/**
 * 某只怪（按等级）能掉的东西 —— 照抄服务端 `CMonsterManager::InsertMonsterItem`：
 *
 *   掉落池 = 所有 `Drop != 0` 且 `物品等级 ∈ [怪物等级-2, 怪物等级+4]` 的物品
 *
 * 按等级缓存，同一张图的怪等级大多重复，一次算完反复用。
 */
const dropPoolCache = new Map<number, number[]>();

export async function dropPool(monsterLevel: number): Promise<number[]> {
  const hit = dropPoolCache.get(monsterLevel);
  if (hit) return hit;
  const cfg = await loadGameConfig();
  const rows = cfg?.items ?? [];
  const lo = monsterLevel - 2;
  const hi = monsterLevel + 4;
  const pool: number[] = [];
  for (const [type, level, drop] of rows) {
    // Level < 0 的物品服务端就不参与掉落（`ItemInfo.Level < 0` 直接跳过）
    if (!drop || level < 0) continue;
    if (level >= lo && level <= hi) pool.push(type);
  }
  /*
   * 低等级怪（蜘蛛 Lv2 → 物品等级 [0,6]）池子可能很空，放宽到 ±10 兜底，
   * 免得「打了半天什么都不掉」；放宽也找不到就返回空（不硬塞东西）。
   */
  if (!pool.length) {
    for (const [type, level, drop] of rows) {
      if (!drop || level < 0) continue;
      if (level >= monsterLevel - 10 && level <= monsterLevel + 10) pool.push(type);
    }
  }
  dropPoolCache.set(monsterLevel, pool);
  return pool;
}

/**
 * 某类 NPC 开的商店（没有商店返回 null）。
 *
 * 服务端 `CShopManager::GetShopNumber(MonsterClass)` 的等价物：
 * 职业号查 `ShopManager.txt`，货架在 `Shop/NNN - 名字.txt`。
 */
export async function shopOf(npcClass: number): Promise<ShopDef | null> {
  const cfg = await loadGameConfig();
  return cfg?.shops?.[String(npcClass)] ?? null;
}

/** 技能表（45 条），后续战斗/技能面板用 */
export async function skillTable(): Promise<SkillDef[]> {
  const cfg = await loadGameConfig();
  return cfg?.skills ?? [];
}
