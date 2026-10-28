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

interface GameConfigFile {
  meta: { builtAt: string; source: string; counts: Record<string, number> };
  monsters: Record<string, MonsterDef>;
  spawns: Record<string, SpawnDef[]>;
  skills: SkillDef[];
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

/** 技能表（45 条），后续战斗/技能面板用 */
export async function skillTable(): Promise<SkillDef[]> {
  const cfg = await loadGameConfig();
  return cfg?.skills ?? [];
}
