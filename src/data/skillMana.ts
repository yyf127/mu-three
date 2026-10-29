/**
 * 「蓝不够时怎么办」—— 源码 `Attack_UseManaScroll97k`
 * （`Combat/Combat.cpp:869`，被 41/42/48/55/56 等分支共用）。
 *
 * ```c
 * const bool lowMana = (piMana > (int)*(unsigned short*)(attr + 30));
 * switch (iType) {
 *   case 41:
 *     if (lowMana) { Attack_UseManaScroll97k(); return; }   // ← 用完药也 return
 *     ...
 * }
 * ```
 *
 * 两个容易搞错的点：
 *
 * 1. **用了药也不放技能** —— `Attack_UseManaScroll97k()` 之后立刻 `return`，
 *    所以是「喝一瓶、等下一帧再点」，不是「自动补蓝接着放」；
 * 2. 药是**从快捷槽按分类找**（`Item_FindQuickSlotByCategory(3)`，3 = 魔法药），
 *    不是随便哪个格子里的蓝瓶。
 */

/** 本次技能为什么没放出去 */
export type ManaBlock = '' | 'mana' | 'mana-scroll';

/**
 * @param cost     技能蓝耗（`skill.bmd` 的 Mana）
 * @param mana     当前魔法值
 * @param hasPotion 快捷槽里有没有魔法药水
 */
export function manaBlock(cost: number, mana: number, hasPotion: boolean): ManaBlock {
  if (cost <= 0 || mana >= cost) return '';
  return hasPotion ? 'mana-scroll' : 'mana';
}

/** 给界面用的提示文案（源码用 `GlobalText[474]`「魔法值不足」） */
export function manaBlockText(block: ManaBlock, cost: number): string {
  if (block === 'mana-scroll') return `魔法值不足（需要 ${cost}），已使用魔法药水`;
  if (block === 'mana') return `魔法值不足（需要 ${cost}），背包里没有魔法药水`;
  return '';
}
