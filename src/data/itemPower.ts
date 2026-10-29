/**
 * 装备强化（+N）/ 追加（AddOption）/ 卓越（Excellent）的**真实数值**。
 *
 * 三个来源，缺一不可：
 *
 *   1. `CItem::Convert`（MuServer_Source/GameServer/Item.cpp:190-570）
 *      —— 服务端判定与实际战斗用的值；
 *   2. `Item_LegacyLinker.cpp::ItemConvert`（0x47B910）
 *      —— 0.97 客户端 tooltip / 面板显示的值；
 *   3. `Data/Item/ItemOption.txt` —— 追加和卓越的「选项表」，
 *      决定每个部位的追击词条与数值（`GetItemOption`）。
 *
 * ## 强化
 * 固定加值，不是百分比：
 *
 *     m_DamageMin += Level * 3;                      // 武器
 *     if (Level >= 10) m_DamageMin += (L-9)*(L-8)/2;  // +10 起的平方补偿
 *     盾牌   +Level      翅膀 +Level*2      其余防具 +Level*3
 *
 * 客户端写法是 `3 * min9(itemLevel) + post9_bonus(itemLevel)`（+10 起 4/9/14…），
 * 两者在 **+0..+11 完全等价**（+12 起才分叉，而 0.97 上限就是 +11）。
 *
 * ## 追加
 * `ItemOption.txt` 里 `Index=2` 那组：`OptionValue × AddOption`：
 *
 *     武器(0..159)   +4×opt 攻击       法杖(160..191) +4×opt 魔法攻击
 *     盾(192..223)   +5×opt 防御率     防具(224..383) +4×opt 防御
 *     守护/翅膀      见 `optionSpecials()` 里的分支
 *
 * 关键：**追加不进主属性行**。原版 tooltip 的「攻击力: 56~72」不含追加，
 * 追加单独一行（`GlobalText[88]` "Additional Damage +%d"）。所以这里把追加
 * 放在独立的 `add*` 字段，由 UI 决定怎么拼。
 *
 * ## 卓越
 * 有卓越就按「表值」加一次（`Item.cpp:340-410`），并且**直接进主属性行**：
 *
 *     武器 单/双手、魔法攻击  += 25 * 表值 / ItemInfo.Level + 5
 *     防御                    += 12 * 表值 / ItemInfo.Level + ItemInfo.Level/5 + 4
 *     防御率                  += 25 * 表值 / ItemInfo.Level + 5
 *     需求等级 +20
 *
 * 注意顺序：卓越用**表值**算，然后才加强化 —— 所以 `itemPower` 内部不能把
 * 强化值先加进去再算卓越，否则数值会滚雪球。
 *
 * ## 两套需求口径
 * 见 `itemRequireSrv()`：客户端的 tooltip 和服务端的判定**本来就不一致**，
 * 这里刻意分开，别合并。
 */
import { itemAttr } from './itemAttrs';

const GET_ITEM = (group: number, index: number) => group * 32 + index;

/** 一件物品的可变属性（背包包 0xF3/0x10 里就有这几个字段） */
export interface ItemSpec {
  /** 强化等级 `m_Level`，0..15 */
  level?: number;
  /** 追加等级 `m_AddOption`，0..7（每级 +4/+5 见上） */
  option?: number;
  /** 卓越位掩码 `m_ExceOption`，0..63；非 0 即「卓越」 */
  excellent?: number;
}

/** 一件装备在当前强化/追加/卓越下的实际数值 */
export interface ItemPower {
  dmgMin: number;
  dmgMax: number;
  def: number;
  /** 魔法攻击力（法杖 / 魔杖），服务端 `m_MagicDamageRate` */
  magicDmg: number;
  /** 防御率（盾、防具），服务端 `m_DefenseSuccessRate` */
  defRate: number;
  atkSpeed: number;
  /** 追加带来的攻击加成（武器）—— 原版单独一行，不并入 dmgMin/dmgMax */
  addDmg: number;
  /** 追加带来的魔法攻击（法杖） */
  addMagicDmg: number;
  /** 追加带来的防御（防具） */
  addDef: number;
  /** 追加带来的防御率（盾） */
  addDefRate: number;
  /**
   * 需求等级 —— **客户端显示口径**（`Item_LegacyLinker.cpp:370`）：
   * 一律 `RequireLevel + itemLevel * 4`，翅膀（387..390）是 `* 5`。
   */
  reqLevel: number;
  reqStr: number;
  reqAgi: number;
  reqVit: number;
  reqEne: number;
}

/** 服务端判定口径的需求（`CItem::Convert`） */
export interface ItemRequire {
  level: number;
  str: number;
  agi: number;
  vit: number;
  ene: number;
}

/** 强化上限：0.97 只做到 +11，客户端渲染也按这个分档 */
export const MAX_ITEM_LEVEL = 11;

const clampLevel = (n: number) => Math.max(0, Math.min(MAX_ITEM_LEVEL, n | 0));
const clampOption = (n: number) => Math.max(0, Math.min(7, n | 0));

/** `Level >= 10` 之后那段补偿：+10 → 1、+11 → 3、+12 → 6 … */
function bonusTriangle(level: number): number {
  return level >= 10 ? Math.floor(((level - 9) * (level - 8)) / 2) : 0;
}

/** 整数除法照抄 C：`(a * b * c) / 100 + 20`，不做四舍五入 */
function scaled(base: number, level: number, itemLevel: number, per: number): number {
  if (!base) return 0;
  return Math.floor((base * (level * 3 + itemLevel) * per) / 100) + 20;
}

/**
 * 「2 转翅膀」= 387..390（Wings of Spirit/Soul/Devil/Darkness）。
 * 服务端和客户端都只对这一组用 `+5/级` 的需求等级和 `+2/级` 的防御；
 * 384..386（精灵/天使/撒旦之翼）走普通防具的 `+4` / `+3`。
 */
const isWingType = (type: number) => type >= GET_ITEM(12, 3) && type <= GET_ITEM(12, 6);

/** 所有翅膀（384..390）—— 追加选项的 `+4 力量` 只对这一整段生效（`Item.cpp:513`） */
const isAnyWing = (type: number) => type >= GET_ITEM(12, 0) && type <= GET_ITEM(12, 6);

/** 追加/卓越的数值加成（都不含需求，需求在下面单独算） */
function damageOf(type: number, spec: ItemSpec) {
  const a = itemAttr(type);
  const L = clampLevel(spec.level ?? 0);
  const opt = clampOption(spec.option ?? 0);
  const excel = (spec.excellent ?? 0) !== 0;
  const itemLevel = a.itemLevel;

  let dmgMin = a.dmgMin;
  let dmgMax = a.dmgMax;
  let magicDmg = 0;
  let def = a.def;
  /*
   * `atkSpeed` 这一列对武器是 AttackSpeed、对盾和防具是 DefenseRate
   * （生成脚本按段取列）。武器的强化不加攻速，所以防御率必须从 0 起算，
   * 否则剑会凭空多出一条「防御率」。
   */
  const isWeapon = Math.floor(type / 32) <= 5;
  let defRate = isWeapon ? 0 : a.atkSpeed;

  // ── 1. 卓越（用**表值**算，必须在加强化之前）────────────────────────
  if (excel && itemLevel > 0) {
    if (dmgMin > 0) dmgMin += Math.floor((dmgMin * 25) / itemLevel) + 5;
    if (dmgMax > 0) dmgMax += Math.floor((dmgMax * 25) / itemLevel) + 5;
    if (magicDmg > 0) magicDmg += Math.floor((magicDmg * 25) / itemLevel) + 5;
    if (def > 0) def += Math.floor((def * 12) / itemLevel) + Math.floor(itemLevel / 5) + 4;
    if (defRate > 0) defRate += Math.floor((defRate * 25) / itemLevel) + 5;
  }

  // ── 2. 强化 ─────────────────────────────────────────────────────────
  const bonus = L * 3 + bonusTriangle(L);
  if (dmgMin > 0) dmgMin += bonus;
  if (dmgMax > 0) dmgMax += bonus;
  if (def > 0) {
    const isShield = Math.floor(type / 32) === 6;
    def += (isShield ? L : isWingType(type) ? L * 2 : L * 3) + bonusTriangle(L);
  }
  if (defRate > 0) defRate += bonus;

  // ── 3. 追加（独立字段）─────────────────────────────────────────────
  let addDmg = 0;
  let addMagicDmg = 0;
  let addDef = 0;
  let addDefRate = 0;
  if (opt) {
    if (type >= 0 && type < 160) addDmg = 4 * opt;
    else if (type >= 160 && type < 192) addMagicDmg = 4 * opt;
    else if (type >= 192 && type < 224) addDefRate = 5 * opt;
    else if (type >= 224 && type < 384) addDef = 4 * opt;
    else if (type >= 424 && type < 448) {
      /* 守护 / 宠物：追加是「生命恢复」，不进攻击防御 */
    } else {
      // 翅膀（384..390）按模型号分流，照抄 Item_LegacyLinker.cpp:443-462
      switch (type) {
        case 384: break; // 精灵翼：生命恢复
        case 385: addMagicDmg = 4 * opt; break;
        case 386: addDmg = 4 * opt; break;
        default:
          if (excel && ((spec.excellent ?? 0) & 0x20)) break; // 卓越 HP 位
          if (type === 388) addMagicDmg = 4 * opt;
          else addDmg = 4 * opt;
          break;
      }
    }
  }

  return { dmgMin, dmgMax, def, magicDmg, defRate, addDmg, addMagicDmg, addDef, addDefRate, atkSpeed: a.atkSpeed };
}

/** 归一化：允许 `itemPower(type, 9)` 这种简写 */
function normalize(spec: number | ItemSpec | undefined): Required<ItemSpec> {
  const s: ItemSpec = typeof spec === 'number' ? { level: spec } : (spec ?? {});
  return { level: s.level ?? 0, option: s.option ?? 0, excellent: s.excellent ?? 0 };
}

/**
 * 取一件物品的实际数值 —— **客户端显示口径**（tooltip / 属性面板）。
 * 需求四维也已按客户端的规则加上追加（`+5×option`）和卓越（`+20`）。
 */
export function itemPower(type: number, spec: number | ItemSpec = 0): ItemPower {
  const s = normalize(spec);
  const a = itemAttr(type);
  const L = clampLevel(s.level);
  const opt = clampOption(s.option);
  const excel = s.excellent !== 0;
  const itemLevel = a.itemLevel;
  const group = Math.floor(type / 32);
  const n = damageOf(type, s);

  // 法杖盾位（group 5 + slot 1）的智力需求是另一条式子：*(Level + ItemLevel)*3
  const energyStave = group === 5 && a.slot === 1;
  const reqEne = energyStave
    ? scaled(a.reqEne, 0, itemLevel + L, 3)
    : scaled(a.reqEne, L, itemLevel, 4);

  let reqLevel = a.reqLevel ? a.reqLevel + L * (isWingType(type) ? 5 : 4) : 0;
  // 客户端：`if (itemExcel > 0 && ip->RequireLevel) ip->RequireLevel += 20`
  if (excel && reqLevel) reqLevel += 20;

  // 客户端：追加给 0..383 的武器/法杖/盾/防具都加 5×opt 力量需求
  const addReqStr = opt && type >= 0 && type < 384 ? 5 * opt : 0;

  return {
    ...n,
    reqLevel,
    reqStr: scaled(a.reqStr, L, itemLevel, 3) + addReqStr,
    reqAgi: scaled(a.reqAgi, L, itemLevel, 3),
    reqVit: scaled(a.reqVit, L, itemLevel, 3),
    reqEne,
  };
}

/**
 * 取一件物品的**服务端判定**需求（`CItem::Convert`）。
 *
 * 和 `itemPower()` 的三处差别，都是原版真实存在的不一致：
 *   1. 需求等级：武器到护符（group 0..11）**不随强化涨**，宝珠/卷轴也不涨；
 *   2. 卓越 +20 只对 `m_Index >= GET_ITEM(12,0)`（翅膀及以上）；
 *   3. 追加 +4×opt **只对翅膀**（`Item.cpp:513-563`），其它部位不加。
 *
 * 本地穿装判定必须用这一套 —— 用客户端那套会误拦（显示穿不了、其实服务端放行）。
 */
export function itemRequireSrv(type: number, spec: number | ItemSpec = 0): ItemRequire {
  const s = normalize(spec);
  const a = itemAttr(type);
  const L = clampLevel(s.level);
  const opt = clampOption(s.option);
  const excel = s.excellent !== 0;
  const itemLevel = a.itemLevel;
  const group = Math.floor(type / 32);

  let level = a.reqLevel;
  if (level) {
    const isOrbOrScroll =
      type >= GET_ITEM(12, 7) && type <= GET_ITEM(12, 19) && type !== GET_ITEM(12, 15);
    if (type >= GET_ITEM(0, 0) && type < GET_ITEM(12, 0)) {
      /* 武器到护符：不动 */
    } else if (isWingType(type)) {
      level += L * 5;
    } else if (isOrbOrScroll) {
      /* 宝珠 / 卷轴：不动 */
    } else {
      level += L * 4;
    }
    if (excel && type >= GET_ITEM(12, 0)) level += 20;
  }

  const energyStave = group === 5 && a.slot === 1;
  // 翅膀：追加每级 +4 力量（`m_RequireStrength += m_AddOption * 4`）
  const addStr = opt && isAnyWing(type) ? 4 * opt : 0;

  return {
    level,
    str: scaled(a.reqStr, L, itemLevel, 3) + addStr,
    agi: scaled(a.reqAgi, L, itemLevel, 3),
    vit: scaled(a.reqVit, L, itemLevel, 3),
    ene: energyStave ? scaled(a.reqEne, 0, itemLevel + L, 3) : scaled(a.reqEne, L, itemLevel, 4),
  };
}
