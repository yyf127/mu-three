/**
 * 混沌机器的合成配方推导 —— 移植自 Win 端
 * `src/Item/Item_ChaosMix.cpp:337 CheckMixRecipe(short* grid, int cols, int rows)`。
 *
 * 为什么客户端要自己算一遍配方：
 *   服务端 `CChaosBox::CGChaosMixRecv` 只认 `type`，**不校验材料**。材料不对时
 *   `GetXxxMixRates()` 直接 `return false`，`ChaosItemMix` 跟着 `return`，
 *   **一个包都不回**（见 ChaosBox.cpp:381-393）。此时 `ChaosLock` 已经被置 true，
 *   客户端会一直等那个永远不来的 0x86，整个混沌机卡死到关闭重开为止。
 *   所以「点了合成」之前必须先在本地判断材料够不够，够才发包。
 *
 * 这个函数只负责**判断是哪种配方**（返回 `eChaosMixNumber`），不做成功率计算 ——
 * 成功率/费用由服务端 0x88 算（`GetChaosMixRateAndMoney`），客户端照抄公式必然会
 * 和服务端配置（`m_ChaosItemMixRate[AccountLevel]`）漂移。
 *
 * 返回值的负数来自原版：
 *   -2 = 恶魔之眼/恶魔之钥 等级不一致
 *   -8 = 血色城堡 卷轴/骨 等级不一致
 */
import type { InventoryItem } from '../net/game';

/** `GET_ITEM(group, index)` = group * 32 + index（`Item.h`） */
const GET_ITEM = (g: number, i: number) => g * 32 + i;

export const CHAOS_ITEM = {
  /** (12,15) 混沌之石 Jewel of Chaos —— 所有配方都缺不了它 */
  JEWEL_OF_CHAOS: GET_ITEM(12, 15), // 399
  /**
   * (13,14) 洛克之羽 Loch's Feather —— 二代翅膀材料。
   * 注意别和 470「创造宝石」搞混：`GetWing2MixRates` 要的是 (13,14) 且等级 0。
   */
  LOCH_FEATHER: GET_ITEM(13, 14), // 430
  /** (13,2) 独角兽之角 Horn of Uniria —— 10 个 + 混沌 = 独角兽 Dinorant */
  HORN_OF_UNIRIA: GET_ITEM(13, 2), // 418
  /** (13,16)/(13,17) 血色城堡 大天使卷轴 / 血骨 */
  BC_SCROLL: GET_ITEM(13, 16), // 432
  BC_BONE: GET_ITEM(13, 17), // 433
  /** (14,13)/(14,14) 祝福宝石 / 灵魂宝石 —— +10、+11 装备 */
  JEWEL_OF_BLESS: GET_ITEM(14, 13), // 461
  JEWEL_OF_SOUL: GET_ITEM(14, 14), // 462
  /** (14,17)/(14,18) 恶魔之眼 / 恶魔之钥 —— 恶魔广场入场券 */
  DS_EYE: GET_ITEM(14, 17), // 465
  DS_KEY: GET_ITEM(14, 18), // 466
  /** (14,22) 创造宝石 Jewel of Creation —— 混沌 + 它 = 果实（洗点） */
  JEWEL_OF_CREATION: GET_ITEM(14, 22), // 470
};

/** 一代翅膀（`case 384/385/386`） */
const WING1_TYPES = new Set([384, 385, 386]);
/** 原版只在「卓越武器」这几个编号上给配方 11（Chaos Weapon） */
const EXCELLENT_WEAPON_TYPES = new Set([70, 134, 167]);

export interface ChaosRecipeResult {
  /**
   * `eChaosMixNumber`：0 = 材料不匹配、1 混沌武器、2 恶魔广场、3 +10、4 +11、
   * 5 独角兽、6 果实、7 二代翅膀、8 血色城堡、11 一代翅膀；
   * 负数 = 材料等级不一致（-2 恶魔广场 / -8 血色城堡）
   */
  type: number;
  /** 材料件数（原版 `counts[0]`，面板上不用，调试/探针用） */
  total: number;
}

/**
 * 推导配方。
 *
 * @param items 混沌箱里的物品（`slot` 必须是 **箱子内格号 0..31**）
 * @param cols  箱子列数（原版 8）
 * @param rows  箱子行数（原版 4）
 *
 * 原版是按 8×4 网格槽位逐格扫的，这里直接吃 `slot` —— 两者等价，
 * 因为我们把 0x31/0x24 回执的 slot 原样存进了 `slot`。
 */
export function checkMixRecipe(
  items: InventoryItem[],
  cols = 8,
  rows = 4
): ChaosRecipeResult {
  const grid = items.filter(it => it.slot >= 0 && it.slot < cols * rows);

  let total = 0;
  let chaos = 0;
  let lvl9 = 0;
  let lvl10 = 0;
  let bless = 0;
  let soul = 0;
  let eye = 0;
  let key = 0;
  let eyeLevel = 0;
  let keyLevel = 0;
  let bcScroll = 0;
  let bcBone = 0;
  let bcScrollLevel = 0;
  let bcBoneLevel = 0;
  let horn = 0;
  /** (14,22) 创造宝石 —— 果实配方的材料 */
  let creation = 0;
  /** (13,14) 洛克之羽 —— 二代翅膀配方的材料 */
  let feather = 0;
  let wing = 0;
  let excellent = 0;
  let excellentWeapon = 0;
  let plain = 0;
  /** `counts+57`：卓越且等级 ≥ 4（二代翅膀配方的「附加材料」判定） */
  let excellentHigh = 0;
  /** 原版 `counts+61` 在整个函数里**从未自增**，恒为 0；留着只为了对照 */
  const lucky = 0;

  for (const it of grid) {
    total++;

    // 原版这两条在最外层，对所有物品生效（`itemType < 384 || itemType <= 390`
    // 是反编译产物，按恒真处理）
    if (it.level === 9) lvl9++;
    else if (it.level === 10) lvl10++;

    switch (it.type) {
      case CHAOS_ITEM.JEWEL_OF_CHAOS:
        chaos++;
        break;
      case CHAOS_ITEM.JEWEL_OF_BLESS:
        bless++;
        break;
      case CHAOS_ITEM.JEWEL_OF_SOUL:
        soul++;
        break;
      case CHAOS_ITEM.LOCH_FEATHER:
        feather++;
        break;
      case CHAOS_ITEM.HORN_OF_UNIRIA:
        horn++;
        break;
      case CHAOS_ITEM.JEWEL_OF_CREATION:
        creation++;
        break;
      case CHAOS_ITEM.DS_EYE:
        eyeLevel = it.level;
        eye++;
        break;
      case CHAOS_ITEM.DS_KEY:
        keyLevel = it.level;
        key++;
        break;
      case CHAOS_ITEM.BC_SCROLL:
        bcScrollLevel = it.level;
        bcScroll++;
        break;
      case CHAOS_ITEM.BC_BONE:
        bcBoneLevel = it.level;
        bcBone++;
        break;
      default:
        if (WING1_TYPES.has(it.type)) {
          wing++;
        } else {
          if (it.excellent !== 0) {
            excellent++;
            if (EXCELLENT_WEAPON_TYPES.has(it.type)) excellentWeapon++;
          } else {
            plain++;
          }
          // 原版读 `itemPtr+27 & 0x3F`（卓越属性位）且要求等级 ≥ 4
          if (it.excellent !== 0 && it.level >= 4) excellentHigh++;
        }
        break;
    }
  }

  // ── 入场券：3 件（混沌 + 眼 + 钥 / 混沌 + 卷轴 + 骨），两件材料等级必须相同 ──
  if (total === 3 && chaos === 1) {
    if (eye === 1 && key === 1) {
      return { type: eyeLevel !== keyLevel ? -2 : 2, total };
    }
    if (bcScroll === 1 && bcBone === 1) {
      return { type: bcScrollLevel !== bcBoneLevel ? -8 : 8, total };
    }
  }

  // ── 二代翅膀：混沌 + 洛克之羽 + 一代翅膀 + 若干「卓越且 +4 以上」 ──
  // (`GetWing2MixRates`：ChaosCount==1 && FeatherCount==1 && wing==1)
  if (
    chaos === 1 &&
    feather === 1 &&
    wing === 1 &&
    total === excellentHigh + 3 &&
    lucky === 0
  ) {
    return { type: 7, total };
  }

  // ── +10 / +11：祝福 + 灵魂 + 9 级 / 10 级装备 ──
  if (total === 4 && chaos === 1 && lvl9 === 1 && bless === 1 && soul === 1) {
    return { type: 3, total };
  }
  if (total === 6 && chaos === 1 && lvl10 === 1 && bless === 2 && soul === 2) {
    return { type: 4, total };
  }

  // ── 独角兽：混沌 + 10 个独角兽之角 ──
  if (total === 11 && horn === 10 && chaos === 1) {
    return { type: 5, total };
  }

  // ── 果实：混沌 + 创造宝石（`GetFruitMixRates`：Chaos==1 && Creation==1） ──
  if (total === 2 && creation === 1 && chaos === 1) {
    return { type: 6, total };
  }

  if (chaos <= 0) return { type: 0, total };

  // ── 混沌武器 / 一代翅膀：混沌 + 若干卓越装备（不能掺普通装备和其它材料） ──
  if (
    excellent > 0 &&
    eye === 0 &&
    key === 0 &&
    horn === 0 &&
    plain === 0 &&
    creation === 0 &&
    feather === 0 &&
    wing === 0 &&
    lucky === 0 &&
    bcScroll === 0 &&
    bcBone === 0
  ) {
    return { type: excellentWeapon <= 0 ? 1 : 11, total };
  }

  return { type: 0, total };
}

/** 配方名（原版 `GlobalText[601..608]`，这里用中文；索引写在旁边） */
export const MIX_LABEL: Record<number, string> = {
  0: '材料不匹配', // 601 "Improper items for combination"
  1: '混沌武器合成', // 602 "Chaos Item Mix"
  2: '恶魔广场入场券', // 603 "Devil's Invitation Mix"
  3: '创造 +10 装备', // 604 "Create +10 item"
  4: '创造 +11 装备', // 605 "Create +11 item"
  5: '独角兽（Dinorant）', // 原版取 601+5=606，索引本身错位，这里按语义写
  6: '果实', // 同上
  7: '二代翅膀', // 601+7 = 608
  8: '血色城堡入场券', // 601+8 = 609
  11: '一代翅膀',
};

/** 负数结果的中文解释（原版只回负数，界面显示 `Improper items`） */
export function mixErrorText(type: number): string {
  if (type === -2) return '恶魔之眼与恶魔之钥等级必须一致';
  if (type === -8) return '大天使卷轴与血骨等级必须一致';
  return '材料不匹配';
}
