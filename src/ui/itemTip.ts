/**
 * 物品 tooltip 的内容构造（背包 / 商店 / 仓库 / 交易共用）。
 *
 * 原版是 `UI/RenderItemInfo.cpp`（`RenderItemInfo` @0x004DDxxx）—— 一个函数
 * 服务所有「有物品格子」的界面，里面按 `Type` 分支出词条行、耐久行、需求行。
 * 我们把「行」的部分抽到这里，面板只负责**摆位置**（背包钉在格子上方、
 * 商店/仓库钉在货架旁边）。
 *
 * 文字全部来自 `Data/Local/chs/Text.bmd`（`GlobalText`）：
 *
 * | 行 | 索引 | 原文 |
 * |---|---|---|
 * | 单手攻击力 | 40 | `单手攻击力`（模板 `"%s: %d ~ %d"`） |
 * | 攻击速度 | 64 | `攻击速度: %d` |
 * | 防御力 | 65 | `防御力: %d` |
 * | 防御率 | 67 | `防御率: %d` |
 * | 数量 | 69 | `数量: %d` |
 * | 生命 | 70 | `生命: %d` |
 * | 耐久度 | 71 | `耐久度 : [%d/%d]` |
 * | 所需力量 | 73 | `所需力量: %d` |
 * | 还需 | 74 | `(还需 %d)` |
 * | 所需敏捷 | 75 | `所需敏捷: %d` |
 * | 所需等级 | 76 | `所需等级: %d` |
 * | 所需智力 | 77 | `所需智力: %d` |
 * | 耐久度（单值） | 95 | `耐久度 : [ %d ]` |
 * | 买入价格 | 62 | `买入价格: %s` |
 * | 卖出价格 | 63 | `卖出价格: %s` |
 */
import { textSync } from '../data/localText';
import { itemAttr } from '../data/itemAttrs';
import { itemStats } from './itemRules';
import { itemValueOf } from '../data/serverTables';
import { itemReqClassSync } from '../data/localText';

/**
 * 当前角色的等级 + 四维，判断「还差多少」用。
 *
 * 原版 `RenderItemInfo.cpp` 的 `addRequirementLine` 拿 `CA+0x0E/0x14/0x16/0x1A`
 * （等级/力量/敏捷/智力）去比物品的 `Require*`，不够就多画一行
 * `GlobalText[74] "(还需 %d)"`。我们这些数在 `F3/03` 的角色包里，
 * 由 `main.ts::refreshHud()` 灌进来。
 */
export const HERO = { level: 0, str: 0, agi: 0, ene: 0, cls: 0 };

export function setHeroStats(s: Partial<typeof HERO>) {
  if (typeof s.level === 'number') HERO.level = s.level;
  if (typeof s.str === 'number') HERO.str = s.str;
  if (typeof s.agi === 'number') HERO.agi = s.agi;
  if (typeof s.ene === 'number') HERO.ene = s.ene;
  if (typeof s.cls === 'number') HERO.cls = s.cls & 3;
}

/** 按 `Text.bmd` 的模板填值（`%d` / `%s`，`%%` 是字面量） */
export function fillTemplate(tpl: string, args: Array<number | string>): string {
  let i = 0;
  return tpl.replace(/%[dsu%]/g, m => (m === '%%' ? '%' : String(args[i++] ?? '')));
}

export function fmt(idx: number, fallback: string, v: number | string): string {
  return fillTemplate(textSync(idx, fallback), [v]);
}

export function fmt2(idx: number, fallback: string, a: number | string, b: number | string): string {
  return fillTemplate(textSync(idx, fallback), [a, b]);
}

/** tooltip 需要的最小物品字段（`InventoryItem` 结构兼容） */
export interface TipItem {
  type: number;
  level: number;
  option?: number;
  durability?: number;
}

/**
 * 构造 tooltip 的 HTML。
 *
 * @param item 物品
 * @param withPrice `true` = 追加买卖价格行。**只有商人界面才传** ——
 *   原版 `RenderItemInfo.cpp:2020` 那句价格行包在 `if (ShopOpened != 0 && ...)`
 *   里，背包 tooltip 没有这一行。
 */
/**
 * 各职业在 `Text.bmd` 里的名字索引。
 *
 * 实测（`chs/Text.bmd`）：20 魔法师 / 21 剑士 / 22 弓箭手 / 23 魔剑士，
 * 二转对应 24 魔导师 / 25 骑士 / 26 圣射手（魔剑士没有二转）。
 * 顺序和 `RequireClass[i]` 的下标一致 —— DW / DK / ELF / MG。
 */
const CLASS_TEXT: Array<[number, number]> = [
  [20, 24], // Dark Wizard → Soul Master
  [21, 25], // Dark Knight → Blade Knight
  [22, 26], // Fairy Elf   → Muse Elf
  [23, -1], // Magic Gladiator（无二转）
];

/** 这件装备能不能被某个职业穿；返回若干行「XXX 可以使用」 */
function classLines(type: number): Array<{ text: string; ok: boolean }> {
  const attr = itemAttr(type);
  // 只有装备才谈职业限制（药水/卷轴的 slot 是 -1）
  if (attr.slot < 0) return [];

  // 优先 item.bmd 的 RequireClass（能区分一转/二转），没读完退回 Item.txt 的位掩码
  const req = itemReqClassSync(type);
  const flags: number[] = req
    ? req.map(v => (v > 0 ? v : 0))
    : [0, 1, 2, 3].map(i => (attr.clsMask & (1 << i) ? 1 : 0));

  // 四个职业都不能用 = 原版直接不画这几行（`if (requireCount == MAX_CLASS) return;`）
  const usable = flags.some(f => f > 0);
  if (!usable) return [];

  const out: Array<{ text: string; ok: boolean }> = [];
  for (let i = 0; i < 4; i++) {
    const tier = flags[i];
    if (!tier) continue;
    // 2 = 只有二转能装 → 用二转职业名；1 = 一转即可
    const idx = tier >= 2 ? (CLASS_TEXT[i][1] ?? CLASS_TEXT[i][0]) : CLASS_TEXT[i][0];
    const name = textSync(idx, '');
    if (!name) continue;
    out.push({ text: fmt(61, '%s 可以使用', name), ok: i === HERO.cls && tier === 1 });
  }
  return out;
}

/**
 * 把 tooltip 摆到物品**旁边**（左 → 右 → 上），绝不压住物品本身。
 *
 * 原版是把 `DrawItemInfoBox` 的**中心**摆在鼠标 x 上、顶边摆在鼠标 y 上
 * （`Scene_MapTick.cpp:58/94`），靠近屏幕右缘时 `RenderText_0040fb70` 会把框
 * 往左推。也就是说原版是会盖住物品的 —— 玩家反馈「词条挡住物品」，
 * 这里改成按**物品矩形**避让：
 *
 *   1. 左侧放得下（不超出舞台左缘）→ 摆左边，垂直居中于物品
 *   2. 否则右侧放得下 → 摆右边
 *   3. 都不行（面板很窄）→ 摆上方
 *   4. 垂直方向一律夹在面板内
 *
 * @param box    tooltip 自身尺寸（px，逻辑坐标）
 * @param item   物品矩形（**相对面板**的逻辑坐标）
 * @param panel  面板尺寸
 * @param panelX 面板在 640 舞台里的绝对 x（用来判断舞台边界）
 */
export function placeTipBeside(
  box: { w: number; h: number },
  item: { x: number; y: number; w: number; h: number },
  panel: { w: number; h: number },
  panelX: number,
  stageW = 640
): { left: number; top: number } {
  const GAP = 6;
  const clampTop = (t: number) => Math.max(0, Math.min(t, panel.h - box.h));
  const centered = clampTop(item.y + (item.h - box.h) / 2);

  // 1) 左侧
  const leftOf = item.x - box.w - GAP;
  if (panelX + leftOf >= 2) return { left: leftOf, top: centered };

  // 2) 右侧
  const rightOf = item.x + item.w + GAP;
  if (panelX + rightOf + box.w <= stageW - 2) return { left: rightOf, top: centered };

  // 3) 上方（左侧右侧都没地方时，宁可压面板也别压物品）
  const left = Math.max(0, Math.min(item.x, panel.w - box.w));
  const top = item.y - box.h - 4;
  return { left, top: clampTop(top >= 0 ? top : item.y + item.h + 4) };
}

export function itemTipHtml(item: TipItem, withPrice = false): string {
  const attr = itemAttr(item.type);
  const plus = item.level > 0 ? `+${item.level}` : '';
  const extra = item.option && item.option > 0 ? ` (追加 +${item.option})` : '';
  const lines: string[] = [`<b class="tip-name">${plus}${attr.name}${extra}</b>`];
  for (const s of itemStats(item.type)) lines.push(`<span class="tip-stat">${s}</span>`);

  /*
   * 耐久 / 数量 / 生命 —— 分支和 `RenderItemInfo.cpp:1800` 一一对应：
   *
   *   448..456 / 135 / 143（箭矢、药水这类可叠的）→ `[69] 数量: %d`
   *   416..423（宠物）                             → `[70] 生命: %d`
   *   426（精灵地图？）                            → `[95] 耐久度 : [ %d ]`
   *   有耐久上限的装备                             → `[71] 耐久度 : [%d/%d]`
   */
  const dur = Math.round(item.durability ?? 0);
  const maxDur = attr.dura;
  if ((item.type >= 448 && item.type <= 456) || item.type === 135 || item.type === 143) {
    lines.push(`<span class="tip-stat">${fmt(69, '数量: %d', dur)}</span>`);
  } else if (item.type >= 416 && item.type <= 423) {
    lines.push(`<span class="tip-stat">${fmt(70, '生命: %d', dur)}</span>`);
  } else if (item.type === 426) {
    lines.push(`<span class="tip-stat">${fmt(95, '耐久度 : [ %d ]', dur)}</span>`);
  } else if (maxDur > 0) {
    lines.push(`<span class="tip-stat">${fmt2(71, '耐久度 : [%d/%d]', dur, maxDur)}</span>`);
  }

  /*
   * 装备需求 —— 原版是**每个属性一行**，缺哪项就在下一行补一句
   * `GlobalText[74] "(还需 %d)"`（红色）。
   */
  if (attr.slot >= 0) {
    const reqLines: Array<[number, string, number, number]> = [
      // [GlobalText 索引, 兜底模板, 需求值, 当前值]
      [73, '所需力量: %d', attr.reqStr, HERO.str],
      [75, '所需敏捷: %d', attr.reqAgi, HERO.agi],
      [77, '所需智力: %d', attr.reqEne, HERO.ene],
      [76, '所需等级: %d', attr.reqLevel, HERO.level],
    ];
    for (const [idx, fb, need, have] of reqLines) {
      if (!need) continue;
      const lack = HERO.level > 0 && have < need;
      lines.push(`<span class="tip-req${lack ? ' lack' : ''}">${fmt(idx, fb, need)}</span>`);
      if (lack) lines.push(`<span class="tip-req lack">${fmt(74, '(还需 %d)', need - have)}</span>`);
    }
  }

  /*
   * 职业限制（`RenderItemInfo.cpp:1385` 的 `addClassLine` 循环）：
   *
   * ```c
   * for (i = 0; i < MAX_CLASS; ++i) {
   *     BYTE need = pItem->RequireClass[i];   // 0 跳过 / 1 一转 / 2 二转
   *     if (!need) continue;
   *     snprintf(line, ..., GlobalText[61], GlobalText[classTextIndex]);  // "%s 可以使用"
   *     addClassLine(line, (i == firstClass && need <= stepClass) ? 0 : 5);
   * }
   * ```
   *
   * 也就是**每个能用的职业一行**「剑士 可以使用」。`RequireClass == 2` 表示
   * 只有二转（魔导师 / 骑士 / 圣射手）能装，这时名字换成对应的二转职业名。
   * 当前角色能用的那些行不上色，用不了的整行标红（原版是给这一行加深红底）。
   */
  for (const line of classLines(item.type)) {
    if (line.ok) lines.push(`<span class="tip-cls">${line.text}</span>`);
    else lines.push(`<span class="tip-cls lack">${line.text}</span>`);
  }

  /*
   * 价格（只有商人界面）。`F3/E4` 那张表是服务端推的固定价 ——
   * MuEmu 的算价公式和 0.97 客户端内建的不一样，显示本地算的数字会和
   * 实际扣的钱对不上。`SellValue == -1` 表示这一项不覆盖售价，退回买入价。
   */
  if (withPrice) {
    const value = itemValueOf(item.type, item.level ?? -1);
    if (value) {
      if (value.sell >= 0) {
        lines.push(`<span class="tip-price">${fmt(63, '卖出价格: %s', value.sell.toLocaleString())}</span>`);
      } else if (value.buy >= 0) {
        lines.push(`<span class="tip-price">${fmt(62, '买入价格: %s', value.buy.toLocaleString())}</span>`);
      }
    }
  }

  /*
   * 这里**不再**加「可堆叠 N」那一行。
   * 原版 `RenderItemInfo` 里没有这一行（堆叠上限只在拆堆叠时用来算数量），
   * 是我们上一轮自己加的；`F3/E3` 的表仍然在 `serverTables.ts` 里，
   * 拆堆叠（Shift+左键）时才用得到。
   */

  return lines.join('<br>');
}
