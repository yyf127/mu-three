/**
 * `CharSet[11]`（视野包里的装备压缩字段）→ `EquipSet`（可渲染的物品类型）。
 *
 * 出处：客户端 `ChangeCharacterExt`（IDA 0x0045C8C0，`Scene_CharSelect_Nav.cpp:1966`），
 * 调用处是 `ChangeCharacterExt(idx, (BYTE*)e + 5)` —— 也就是说这块字段从
 * **`CharSet[1]` 开始**才是 `Equipment[0]`，`CharSet[0]` 是职业位。
 *
 * 服务端的布局（`Viewport.h:39` `PMSG_VIEWPORT_PLAYER`）：
 *
 *   CharSet[0]    职业位（`((cs>>4)|(cs&0x10))>>1` → 0 DW / 1 DK / 2 FE / 3 MG）
 *   CharSet[1..3] Equipment[0..2]
 *   CharSet[4..5] Equipment[3..4]
 *   CharSet[7..9] Equipment[6..8]（6..8 是武器强化位，渲染用不到）
 *   CharSet[9]    = Equipment[8]：五个 +16 的「大序号」标志位
 *   CharSet[10]   = Equipment[9]：翅膀的变体位（`&1`）
 *
 * 客户端把十个字节拆成五件身体装备（`ChangeCharacterExt` 的 5 个块）：
 *
 * | 部位 | 序号来源 | +16 标志 |
 * | --- | --- | --- |
 * | 头盔 | `E[2] >> 4` | `E[8] & 0x80` |
 * | 铠甲 | `E[2] & 0x0F` | `E[8] & 0x40` |
 * | 护腿 | `E[3] >> 4` | `E[8] & 0x20` |
 * | 手套 | `E[3] & 0x0F` | `E[8] & 0x10` |
 * | 靴子 | `E[4] >> 4` | `E[8] & 0x08` |
 *
 * 序号是 **0 基**的（0 → `*Male01.bmd`，和 `itemModelPath` 的 `index+1` 正好对上），
 * **31（0x1F）= 该职业的默认外观**（客户端会改用 `ArmorClass##`）。
 * 翅膀：`E[4] & 3`（0..2，3 = 带 `E[9] & 1` 的特殊款）。
 */

import type { EquipSet } from '../world/actor';

/** 五件身体装备的物品组号（`items.ts` 的 `GROUPS`：7 Helm / 8 Armor / 9 Pant / 10 Glove / 11 Boot） */
const BODY_GROUP = {
  helm: 7,
  armor: 8,
  pants: 9,
  gloves: 10,
  boots: 11,
} as const;

/** 序号 31 = 「用职业默认外观」的哨兵值 */
const CLASS_DEFAULT = 31;

/** 职业位 → 0 DW / 1 DK / 2 FE / 3 MG（和 `syncCharacterPanel` 那套位运算一致） */
export function classOfCharSet(cs0: number): number {
  return (((cs0 >> 4) | (cs0 & 0x10)) >> 1) & 0x0f;
}

/** 一件身体装备：`tier < 0` 表示空槽（用职业默认） */
function bodyType(group: number, tier: number): number | undefined {
  if (tier < 0 || tier >= CLASS_DEFAULT) return undefined;
  return group * 32 + tier;
}

export interface DecodedCharSet {
  equip: EquipSet;
  /** 五个部位解出来的序号（调试/探针用，-1 = 空） */
  tiers: { helm: number; armor: number; pants: number; gloves: number; boots: number };
  /** 翅膀序号 0..2；3 = 特殊款；-1 = 没翅膀 */
  wing: number;
}

/**
 * 把 11 字节 `CharSet` 解成可以直接喂给 `applyEquipment` 的 `EquipSet`。
 *
 * 空槽**不写进 `equip`**：`applyEquipment` 遇到 `undefined` 会退回职业默认身体
 * （`HelmClass##` 之类），正好是原版对空槽的处理。
 */
export function decodeCharSet(charSet: number[] | undefined, safeZone = false): DecodedCharSet {
  const cs = charSet ?? [];
  const b = (i: number) => (cs[i] ?? 0) & 0xff;
  // Equipment[k] = CharSet[k + 1]
  const e = (k: number) => b(k + 1);

  const hi = (v: number, flag: boolean) => {
    const tier = v + (flag ? 16 : 0);
    return tier >= CLASS_DEFAULT ? -1 : tier;
  };

  const tiers = {
    helm: hi(e(2) >> 4, (e(8) & 0x80) !== 0),
    armor: hi(e(2) & 0x0f, (e(8) & 0x40) !== 0),
    pants: hi(e(3) >> 4, (e(8) & 0x20) !== 0),
    gloves: hi(e(3) & 0x0f, (e(8) & 0x10) !== 0),
    boots: hi(e(4) >> 4, (e(8) & 0x08) !== 0),
  };

  const equip: EquipSet = { cls: classOfCharSet(b(0)), safeZone };
  const helm = bodyType(BODY_GROUP.helm, tiers.helm);
  const armor = bodyType(BODY_GROUP.armor, tiers.armor);
  const pants = bodyType(BODY_GROUP.pants, tiers.pants);
  const gloves = bodyType(BODY_GROUP.gloves, tiers.gloves);
  const boots = bodyType(BODY_GROUP.boots, tiers.boots);
  if (helm !== undefined) equip.helm = helm;
  if (armor !== undefined) equip.armor = armor;
  if (pants !== undefined) equip.pants = pants;
  if (gloves !== undefined) equip.gloves = gloves;
  if (boots !== undefined) equip.boots = boots;

  // 翅膀：`E[4] & 3`，3 = 特殊款（`E[9] & 1` 选中另一套）→ 都落在 Wing 组
  const wingRaw = e(4) & 3;
  const wing = wingRaw === 3 ? (e(9) & 1 ? 3 : -1) : wingRaw;
  if (wing >= 0) equip.wing = 12 * 32 + wing;

  return { equip, tiers, wing };
}
