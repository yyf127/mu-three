/**
 * 装备判定 —— 把服务端 `CheckItemMoveToInventory` 的规则搬到浏览器侧。
 *
 * 为什么必须本地先判：服务端对 0x24 失败只回 `result = 0xFF`，**不带原因**
 * （`ItemManager.cpp:2531` 起，所有 early-return 都是同一个 0xFF）。
 * 客户端不自己算一遍的话，玩家只会看到"拖上去弹回去"，不知道为什么。
 *
 * 服务端顺序（`ItemManager.cpp:568-610`）：
 *
 *     if (INVENTORY_WEAR_RANGE(slot) == 0) return 1;      // 放背包格子不查任何条件
 *     CheckItemRequireLevel      lpObj->Level     >= m_RequireLevel
 *     CheckItemRequireStrength   lpObj->Strength  >= m_RequireStrength
 *     CheckItemRequireDexterity  lpObj->Dexterity >= m_RequireDexterity
 *     CheckItemRequireVitality   lpObj->Vitality  >= m_RequireVitality
 *     CheckItemRequireEnergy     lpObj->Energy    >= m_RequireEnergy
 *     CheckItemRequireClass      RequireClass[Class] != 0 且 (ChangeUp+1) >= 该值
 *     m_Slot 必须等于目标槽（0/1 互通、10/11 互通）
 *     DW 槽 1 只能放盾；FE 左右手弓/弩不能混
 *
 * 注意 `m_RequireStrength` 不是 Item.txt 里的裸值：客户端 `Item_LegacyLinker.cpp:336`
 * 和服务端 `CItem::Convert` 都会按强化等级放大。这里只算 +0，
 * 带强化的装备需求会更大 —— 所以判定是「本地先拦明显不合法的」，不是最终裁决。
 */
import { textSync } from '../data/localText';
import { itemAttr, EQUIP_SLOT_NAMES } from '../data/itemAttrs';
import { itemPower, itemRequireSrv, type ItemSpec } from '../data/itemPower';

/** 装备判定需要的角色数值（全部来自 0xF3/0x03） */
export interface EquipChar {
  level: number;
  strength: number;
  dexterity: number;
  vitality: number;
  energy: number;
  /** 职业组 0=DW 1=DK 2=FE 3=MG（不是完整职业号） */
  charClass: number;
}

export interface EquipCheck {
  ok: boolean;
  /** 失败原因，直接给 toast 用 */
  reason?: string;
}

/** 目标装备槽和物品槽位是否兼容（服务端 `m_Slot != slot` 的那几条） */
export function slotCompatible(itemSlot: number, targetSlot: number): boolean {
  if (itemSlot < 0) return false;
  if (itemSlot === targetSlot) return true;
  // 武器/盾：0 和 1 可以互换（左右手）
  if (itemSlot <= 1 && targetSlot <= 1) return true;
  // 两枚戒指：10 和 11 可以互换
  if (itemSlot >= 10 && itemSlot <= 11 && targetSlot >= 10 && targetSlot <= 11) return true;
  return false;
}

const CLASS_BIT = [1, 2, 4, 8]; // DW / DK / ELF / MG

/** 职业掩码是否放行该职业；掩码 0 表示通用 */
export function classAllowed(clsMask: number, charClass: number): boolean {
  if (!clsMask) return true;
  const bit = CLASS_BIT[Math.max(0, Math.min(3, charClass))] ?? 1;
  return (clsMask & bit) !== 0;
}

/**
 * 判定「把这件物品放到 targetSlot 能不能成功」。
 * 只用于目标槽 < 12（装备栏）；放背包格子不查任何条件。
 *
 * `spec` 是物品的强化/追加/卓越（`{level, option, excellent}`，直接传
 * `InventoryItem` 也行）。需求走 `itemRequireSrv()` —— **服务端口径**，
 * 和 tooltip 显示的客户端口径故意不同（见 `data/itemPower.ts` 的注释）。
 */
export function checkEquip(
  type: number,
  targetSlot: number,
  ch: EquipChar,
  spec: number | ItemSpec = 0
): EquipCheck {
  const attr = itemAttr(type);
  const need = itemRequireSrv(type, spec);
  const s = typeof spec === 'number' ? { level: spec } : spec;
  const tags = [
    s.level ? `+${s.level}` : '',
    s.option ? `(追加 +${s.option})` : '',
    s.excellent ? '(卓越)' : '',
  ].join('');

  if (attr.slot < 0) {
    return { ok: false, reason: `${attr.name} 不能装备` };
  }
  if (!slotCompatible(attr.slot, targetSlot)) {
    return {
      ok: false,
      reason: `${attr.name} 只能装备在「${EQUIP_SLOT_NAMES[attr.slot] ?? '?'}」`,
    };
  }
  if (ch.level < need.level) {
    return {
      ok: false,
      reason: `等级不足：${attr.name}${tags} 需要 ${need.level}（当前 ${ch.level}）`,
    };
  }
  if (ch.strength < need.str) {
    return {
      ok: false,
      reason: `力量不足：${attr.name}${tags} 需要 ${need.str}（当前 ${ch.strength}，还差 ${need.str - ch.strength}）`,
    };
  }
  if (ch.dexterity < need.agi) {
    return {
      ok: false,
      reason: `敏捷不足：${attr.name}${tags} 需要 ${need.agi}（当前 ${ch.dexterity}，还差 ${need.agi - ch.dexterity}）`,
    };
  }
  if (ch.vitality < need.vit) {
    return { ok: false, reason: `体力不足：${attr.name}${tags} 需要 ${need.vit}（当前 ${ch.vitality}）` };
  }
  if (ch.energy < need.ene) {
    return { ok: false, reason: `智力不足：${attr.name}${tags} 需要 ${need.ene}（当前 ${ch.energy}）` };
  }
  if (!classAllowed(attr.clsMask, ch.charClass)) {
    return { ok: false, reason: `${attr.name} 不是本职业能穿的` };
  }
  return { ok: true };
}

/**
 * 卓越（Excellent）的逐位词条 —— 照抄 `Item_LegacyLinker.cpp:466-490` 的位映射。
 *
 * 卓越掩码是 6 个独立位，**不同部位映射到不同的文案**（`GlobalText` 索引见下），
 * 这也是为什么不能像数值那样统一按 `25*Stat/Level` 处理：
 *
 *   防具 / 盾（192..383、424..425）    武器 / 法杖（0..191、428..429）
 *     0x20 → 622 最大生命值 +4%         0x20 → 628 卓越攻击几率 +10%
 *     0x10 → 623 最大魔法值 +4%         0x10 → 629 攻击力 +等级/20（法杖 631）
 *     0x08 → 624 伤害减少 +4%           0x08 → 630 攻击力 +2%（法杖 632）
 *     0x04 → 625 伤害反射 +5%           0x04 → 633 攻击(魔法)速度 +%d
 *     0x02 → 626 防御成功率 +10%        0x02 → 634 杀怪回血 +生命/8
 *     0x01 → 627 杀怪所获金 +40%        0x01 → 635 杀怪回蓝 +魔法/8
 *
 * 模板里的 `%%` 是 sprintf 的转义（`Camera.cpp` 那边同样是 `GL_GREATER` 那种
 * 双写），必须折叠成单个 `%` —— 否则玩家会看到「+4%%」。
 */
export function excellentLines(type: number, mask = 0): string[] {
  if (!mask) return [];
  const isArmor = (type >= 192 && type < 384) || type === 424 || type === 425;
  const isWeapon = (type >= 0 && type < 192) || type === 428 || type === 429;
  if (!isArmor && !isWeapon) return [];

  const isStaff = (type >= 160 && type < 192) || type === 428;
  const out: string[] = [];
  const add = (idx: number, arg: number | string = '') => {
    const tpl = textSync(idx, '');
    // 没加载到中文文本就不显示 —— 宁可少一行，也别冒出「GlobalText[622]」这种
    if (tpl) out.push(fill(tpl, arg));
  };

  if (isArmor) {
    if (mask & 0x20) add(622);
    if (mask & 0x10) add(623);
    if (mask & 0x08) add(624);
    if (mask & 0x04) add(625);
    if (mask & 0x02) add(626);
    if (mask & 0x01) add(627);
  } else {
    if (mask & 0x20) add(628);
    if (mask & 0x10) add(isStaff ? 631 : 629);
    if (mask & 0x08) add(isStaff ? 632 : 630);
    // 攻速这一条模板自带 %d，取值固定 7（`push_special(77, 7)`）
    if (mask & 0x04) add(633, 7);
    if (mask & 0x02) add(634);
    if (mask & 0x01) add(635);
  }
  return out;
}

/**
 * 背包内移动的目标格能否放下：越界或和别的物品重叠都算失败。
 * 服务端 `InventoryAddItem` 会调 `InventoryRectCheck(x, y, w, h)`，
 * 判定逻辑就是这张 8×8 的占用表。
 *
 * `items` 传**移动前**的全量背包（包含被拖的那件），`from` 是它原来的槽位。
 * 被拖的物品自己占的格子不算冲突 —— 服务端也是先把它从地图上抹掉再放。
 */
export function canPlaceInGrid(
  type: number,
  targetSlot: number,
  items: { slot: number; type: number }[],
  fromSlot: number
): boolean {
  const attr = itemAttr(type);
  const cell = targetSlot - 12;
  if (cell < 0) return false;
  const col = cell % 8;
  const row = Math.floor(cell / 8);
  if (col + attr.w > 8 || row + attr.h > 8) return false;

  for (const other of items) {
    if (other.slot < 12 || other.slot === fromSlot) continue;
    const oa = itemAttr(other.type);
    const oc = other.slot - 12;
    const oc0 = oc % 8;
    const or0 = Math.floor(oc / 8);
    const overlap =
      col < oc0 + oa.w && oc0 < col + attr.w && row < or0 + oa.h && or0 < row + attr.h;
    if (overlap) return false;
  }
  return true;
}

/**
 * 一件物品的词条行（tooltip 用）。
 *
 * 格式照 `UI/RenderItemInfo.cpp`（`RII_ADD`）里的那几句原版拼装：
 *
 * ```c
 * RII_ADD(0, 0, "%s: %d ~ %d", GlobalText[40], ip->DamageMin, ip->DamageMax);
 * RII_ADD(0, 0, GlobalText[64], p->AttackSpeed);          // 攻击速度: %d
 * RII_ADD(0, 0, GlobalText[65], p->Defense);              // 防御力: %d
 * RII_ADD(0, 0, GlobalText[67], ip->SuccessfulBlocking);  // 防御率: %d
 * ```
 *
 * `GlobalText[40]` =「单手攻击力」、`[41]` =「双手攻击力」、`[42]` =「魔法攻击力」。
 * `item.bmd` 里没有「双手」标志（原版的 `p->TwoHand` 来自另一个结构），所以
 * 武器统一按 `[40] 单手攻击力` 写 —— 写成「攻击力」那种自己编的词反而更差。
 *
 * 耐久行**不在这里**：它需要「当前/上限」两个数，当前值在物品实例上，
 * 由 `inventory.ts::showItemTip` 用 `GlobalText[71]` 拼。
 */
/** 按 `Text.bmd` 的模板填值（`%d` / `%s`，`%%` 是字面量） */
function fill(tpl: string, ...args: Array<number | string>): string {
  let i = 0;
  return tpl.replace(/%[dsu%]/g, m => (m === '%%' ? '%' : String(args[i++] ?? '')));
}

export function itemStats(type: number, spec: number | ItemSpec = 0): string[] {
  const a = itemAttr(type);
  const p = itemPower(type, spec);
  const out: string[] = [];
  /*
   * 攻击力那行的三个原版细节（`RenderItemInfo.cpp:1709-1712`）：
   *
   *   1. 文案按**单手 / 双手**取 `GlobalText[40]` / `[41]`
   *      （`p->TwoHand + 40`，而服务端的 TwoHand 就是 `Width >= 2`）；
   *   2. **法杖（160..191）的物攻要除以 2** 再显示 —— `if (type >= 160 && type <= 192)
   *      { dmin /= 2; dmax /= 2; }`，不这么显示会比原版大一倍；
   *   3. 法杖的 `MagicDamageRate`（Item.txt 的 MagiDmg 列）**原版 tooltip 根本不显示**
   *      —— 整个 `RenderItemInfo` 里没有引用它。所以这里也不显示，别自作主张加一行。
   */
  if (p.dmgMin || p.dmgMax) {
    const isStaff = type >= 160 && type < 192;
    const min = isStaff ? Math.floor(p.dmgMin / 2) : p.dmgMin;
    const max = isStaff ? Math.floor(p.dmgMax / 2) : p.dmgMax;
    const twoHand = a.w >= 2;
    const label = textSync(twoHand ? 41 : 40, twoHand ? '双手攻击力' : '单手攻击力');
    out.push(fill('%s: %d ~ %d', label, min, max));
  }
  // 下面几条的模板自带 `%d`（`GlobalText[65]` =「防御力: %d」），不能再拼一遍
  if (p.def) out.push(fill(textSync(65, '防御力: %d'), p.def));
  if (p.atkSpeed && a.slot <= 5) out.push(fill(textSync(64, '攻击速度: %d'), p.atkSpeed));
  if (p.defRate && a.slot === 1) out.push(fill(textSync(67, '防御率: %d'), p.defRate));
  return out;
}

/**
 * 追加（Additional Option）词条 —— **单独几行**，不并进主属性。
 *
 * 原版 `RenderItemInfo` 的 SpecialNum 循环就是这么画的
 * （`GlobalText[88..91]` 依次是 攻击 / 魔法攻击 / 防御率 / 防御）。
 */
export function additionalLines(type: number, spec: number | ItemSpec = 0): string[] {
  const p = itemPower(type, spec);
  const out: string[] = [];
  if (p.addDmg) out.push(fill(textSync(88, '追加攻击力+%d'), p.addDmg));
  if (p.addMagicDmg) out.push(fill(textSync(89, '追加魔法攻击力 +%d'), p.addMagicDmg));
  if (p.addDefRate) out.push(fill(textSync(90, '追加防御率 +%d'), p.addDefRate));
  if (p.addDef) out.push(fill(textSync(91, '追加防御力 +%d'), p.addDef));
  return out;
}
