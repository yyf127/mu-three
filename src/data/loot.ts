/**
 * 掉落判定（离线演示用）。
 *
 * 照着 0.97 服务端 `Monster.cpp::Die` 后半段那几行实现，不自己编规则：
 *
 *   ItemDropRate = ServerInfo.ItemDropRate[账号等级]      // 本服 Common.dat = 100
 *   if (rand % max(1, ItemRate) < ItemDropRate) {
 *     DropIndex = GetMonsterItem(怪物等级)                // 池子按物品等级筛，见 dropPool()
 *     ItemLevel = GetItemLevelOption(...)                 // 追加等级 +N
 *   }
 *
 * 两处按演示需要做了简化，注释里标了：
 *   1. `ItemOptionRate.txt` 没导，+N 的概率用经验值近似（越高级的怪越容易出 +N）；
 *   2. 卓越 / 幸运 / 技能位先不出（演示背包不显示这些标记，出了也看不出来）。
 */
import { dropPool, type MonsterDef } from './gameConfig';

export interface RolledDrop {
  /** `group * 32 + index` */
  type: number;
  /** 追加等级 `+N` */
  level: number;
}

/** `GameServerInfo - Common.dat` 里的 `ItemDropRate_AL0..3` */
const ITEM_DROP_RATE = 100;

/** 每次击杀最多掉几件（服务端的 while 循环也只掉一件，这里留口子给以后调） */
const MAX_DROPS = 1;

/**
 * 掷一次掉落。
 *
 * 注意 `ItemRate` 在这版服务端里是**除数**（`rand % ItemRate < 100`），
 * 所以 `ItemRate = 2` 的怪几乎必掉、`200` 的怪只有 50% —— 和「数字越大越爱掉」
 * 的直觉相反，但这就是服务端代码的行为，照抄。
 */
export async function rollDrops(def: MonsterDef): Promise<RolledDrop[]> {
  const pool = await dropPool(def.level);
  if (!pool.length) return [];

  const itemRate = Math.max(1, def.itemRate);
  const chance = Math.min(1, ITEM_DROP_RATE / itemRate);
  if (Math.random() >= chance) return [];

  const out: RolledDrop[] = [];
  for (let i = 0; i < MAX_DROPS; i++) {
    const type = pool[Math.floor(Math.random() * pool.length)];
    out.push({ type, level: rollAddLevel(def.level) });
  }
  return out;
}

/**
 * 追加等级 `+N`。
 *
 * 服务端读 `ItemOptionRate.txt`（本服没这张表），这里按怪物等级给个近似：
 * 低等级怪只出 +0/+1，50 级往上才可能见到 +3。
 */
function rollAddLevel(monsterLevel: number): number {
  const r = Math.random();
  if (monsterLevel >= 50 && r < 0.01) return 3;
  if (monsterLevel >= 20 && r < 0.05) return 2;
  if (r < 0.15) return 1;
  return 0;
}
