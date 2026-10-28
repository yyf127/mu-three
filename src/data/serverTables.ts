/**
 * 服务端下发的三张「辅助表」。
 *
 * 这三张表都不是配置在客户端的，而是**服务端在登录后主动推**的
 * （`CItemStack` / `CItemValue` / `CMove` 三个类的 `GC*Send`）：
 *
 * | 包 | 内容 | 谁在用 |
 * |---|---|---|
 * | `F3/E3` | 物品最大堆叠数 | 背包 tooltip「可堆叠 N」、拆分堆叠 |
 * | `F3/E4` | 固定买卖价 | 背包 tooltip「售价 X zen」、修理费 |
 * | `F3/E5` | `/move` 列表 + 服务端算好的门槛 | 移动命令窗口的价格/等级门禁 |
 *
 * 为什么要单独存一份而不是直接用 `item.bmd` 自己算：MuEmu 的公式和 0.97 客户端
 * 内建的 `ItemValue`（0x0047C690）**不一样**，服务端按自己那份算钱。照客户端的
 * 公式显示价格，结果就是「tooltip 写 1200，卖出去只有 800」。所以只要服务端推了
 * 表，就一律以表为准（参考客户端 `Item_ServerValue.cpp` 的 `ItemValue_MuEmu` 同款做法）。
 *
 * 表没到之前（离线演示、刚登录的头几帧）查询全部返回 `null` / 0，调用方自己回落。
 */

import type { ItemStackEntry, ItemValueEntry, MoveListEntry } from '../net/game';

/* ------------------------------------------------------------------ */
/* F3/E3 —— 堆叠上限                                                   */
/* ------------------------------------------------------------------ */
let stacks: ItemStackEntry[] = [];

export function setItemStackList(list: ItemStackEntry[]): void {
  stacks = list.slice();
  console.log(`[table] F3/E3 堆叠表 ${stacks.length} 条`);
}

/**
 * 某件物品最多能叠多少（`CItemStack::GetMaxStack`）。
 *
 * `level` 传 `-1` 就是「不分等级」。表里没有 = 0（不能叠）。
 */
export function itemMaxStack(itemIndex: number, level = -1): number {
  for (const it of stacks) {
    if (it.itemIndex !== itemIndex) continue;
    if (it.level !== -1 && it.level !== level) continue;
    return it.maxStack;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* F3/E4 —— 固定价格                                                   */
/* ------------------------------------------------------------------ */
let values: ItemValueEntry[] = [];

export function setItemValueList(list: ItemValueEntry[]): void {
  values = list.slice();
  console.log(`[table] F3/E4 价格表 ${values.length} 条`);
}

/**
 * 查固定价格（`CItemValue::GetValue`）。
 *
 * 找到就返回 `{ buy, sell }`；`-1` 表示这一项在这个方向上「不覆盖」——
 * 原版 `FindValue` 里 `if (v == -1) continue;`，我们照做，退到下一条。
 */
export function itemValueOf(itemIndex: number, level = -1): { buy: number; sell: number } | null {
  let buy = -1;
  let sell = -1;
  for (const it of values) {
    if (it.index !== itemIndex) continue;
    if (it.level !== -1 && it.level !== level) continue;
    // 原版 `FindValue`：`if (v == -1) continue;` —— 这一项在这个方向上没覆盖，
    // 就继续找下一条（同一个 Type 可能有多条，只有某一条填了 SellValue）
    if (buy < 0 && it.buy >= 0) buy = it.buy;
    if (sell < 0 && it.sell >= 0) sell = it.sell;
    if (buy >= 0 && sell >= 0) break;
  }
  return buy < 0 && sell < 0 ? null : { buy, sell };
}

/** 价格表里有多少条带有效售价（调试 / 探针用） */
export function itemValueSellCount(): number {
  return values.filter(v => v.sell >= 0).length;
}

/* ------------------------------------------------------------------ */
/* F3/E5 —— 移动列表                                                   */
/* ------------------------------------------------------------------ */
let moves: MoveListEntry[] = [];
let movesAt = 0;

export function setMoveList(list: MoveListEntry[]): void {
  moves = list.slice();
  movesAt = Date.now();
  console.log(`[table] F3/E5 移动列表 ${moves.length} 条：` + moves.map(m => `${m.mapName}${m.canMove ? '' : '(锁)'}`).join(' '));
}

export function serverMoveList(): readonly MoveListEntry[] {
  return moves;
}

export function serverMoveListAt(): number {
  return movesAt;
}

/** 按 `Move.txt` 的英文名找（服务端只给 Name，不给 Index） */
export function serverMoveByName(name: string): MoveListEntry | null {
  const k = name.trim().toLowerCase();
  return moves.find(m => m.mapName.toLowerCase() === k) ?? null;
}

/* ------------------------------------------------------------------ */
/* 调试 / 探针                                                         */
/* ------------------------------------------------------------------ */
export function serverTablesSnapshot() {
  return {
    stacks: stacks.length,
    values: values.length,
    moves: moves.length,
    movesAt,
    moveSample: moves.slice(0, 8).map(m => ({
      mapNumber: m.mapNumber,
      name: m.mapName,
      canMove: m.canMove,
      lv: [m.minLevel, m.maxLevel],
      money: m.money,
    })),
    stackSample: stacks.slice(0, 6),
    valueSample: values.slice(0, 6),
    valueWithSell: values.filter(v => v.sell >= 0).length,
  };
}
