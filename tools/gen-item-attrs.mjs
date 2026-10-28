/**
 * 从服务端 `Data/Item/Item.txt` 生成 `src/data/itemAttrs.ts`。
 *
 * 为什么用服务端的表而不是客户端 `item.bmd`：两者是同一份数据，
 * 但 Item.txt 是明文、字段名写在表头里，而 item.bmd 是加密二进制。
 * 索引体系一致：文件里「单独一行的数字」是 group，每行第一个字段是组内 index，
 * `type = group * 32 + index`（客户端 `GET_ITEM`、服务端 `CItem::m_Index`）。
 *
 * 这一版改成**按表头列名取值**。老版本靠「跳过 Name 后面的空 tab」定位，
 * 但不同段的表头不一样：
 *
 *   //Index Slot Skill Width Height Serial Option Drop Name  Level DmgMin DmgMax AtkSped Durab ...
 *   //Index Slot Skill Width Height Serial Option Drop Name  Level Defense MagiDef Durab ReqLvl ...
 *
 * 武器段第三列是 DmgMax，防具段第三列是 MagiDef，硬编码下标必然串位。
 *
 * 用法：node tools/gen-item-attrs.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC = resolve(ROOT, '../MuServer/Data/Item/Item.txt');
const OUT = join(ROOT, 'src/data/itemAttrs.ts');

const lines = readFileSync(SRC, 'latin1').split(/\r?\n/);

/**
 * 每行一条：
 *   [宽, 高, 名字, 最小攻, 最大攻, 防御, 装备槽, 需求等级, 需求力, 需求敏,
 *    需求智, 需求体, 耐久, 职业掩码, 攻击速度]
 *
 * 装备槽（`Slot` 列）= 服务端 `CItem::m_Slot`，`CheckItemMoveToInventory` 就是拿它
 * 跟目标槽位比：`if (lpItem->m_Slot != slot && slot 不是 0/1/10/11) return 0`。
 * 值 0..11 对应面板上的 12 个装备位；-1 表示不能装备（药水、宝石、卷轴）。
 *
 * 职业掩码 = DW | DK<<1 | ELF<<2 | MG<<3，0 表示任何职业都能用。
 * Item.txt 里这一列的值是 0/1/2（2 = 转职后才能用），这里统一折成 1。
 */
const rows = new Map();
let group = -1;
/** 当前段的列名 → 下标，由 `//Index ...` 表头行给出 */
let cols = null;

const pick = (f, name, dflt = 0) => {
  const i = cols?.[name];
  if (i === undefined) return dflt;
  const v = Number(f[i]);
  return Number.isFinite(v) ? v : dflt;
};

for (const raw of lines) {
  const line = raw.trimEnd();
  if (!line) continue;

  // 表头行：定义当前段的列名
  if (line.startsWith('//Index')) {
    cols = {};
    line
      .replace(/^\/\//, '')
      .split('\t')
      .forEach((name, i) => {
        const key = name.trim();
        if (key) cols[key] = i;
      });
    continue;
  }
  if (line.trimStart().startsWith('//')) continue;

  const trimmed = line.trim();
  // 单独的组号行（段前那个数字 = group）
  if (!trimmed.includes('\t') && /^\d+$/.test(trimmed)) {
    group = Number(trimmed);
    continue;
  }
  if (group < 0 || !cols) continue;

  const f = line.split('\t');
  const idx = Number(f[0]);
  if (!Number.isInteger(idx)) continue;

  const name = (f[cols['Name']] ?? '').replace(/"/g, '').trim();
  if (!name) continue;

  const w = pick(f, 'Width', 1) || 1;
  const h = pick(f, 'Height', 1) || 1;
  const isWeapon = cols['DmgMin'] !== undefined;
  const isArmor = cols['Defense'] !== undefined;

  const dmgMin = isWeapon ? pick(f, 'DmgMin') : 0;
  const dmgMax = isWeapon ? pick(f, 'DmgMax') : 0;
  const def = isArmor ? pick(f, 'Defense') : 0;

  const slot = pick(f, 'Slot', -1);
  const reqLevel = pick(f, 'ReqLvl');
  const reqStr = pick(f, 'ReqStr');
  const reqAgi = pick(f, 'ReqAgi');
  const reqEne = pick(f, 'ReqEne');
  const reqVit = pick(f, 'ReqVit');
  const dura = pick(f, 'Durab');
  const atkSpeed = isWeapon ? pick(f, 'AtkSped') : pick(f, 'DefRate');

  const dw = pick(f, 'DW');
  const dk = pick(f, 'DK');
  const elf = pick(f, 'ELF');
  const mg = pick(f, 'MG');
  const clsMask = (dw ? 1 : 0) | (dk ? 2 : 0) | (elf ? 4 : 0) | (mg ? 8 : 0);

  rows.set(group * 32 + idx, [
    w, h, name, dmgMin, dmgMax, def,
    slot, reqLevel, reqStr, reqAgi, reqEne, reqVit, dura, clsMask, atkSpeed,
  ]);
}

const sorted = [...rows.entries()].sort((a, b) => a[0] - b[0]);
const body = sorted
  .map(([type, r]) => `  ${type}: ${JSON.stringify(r)},`)
  .join('\n');

const out = `/* 本文件由 tools/gen-item-attrs.mjs 生成，勿手改。
 * 数据源：MuServer/Data/Item/Item.txt（0.97k 服务端物品表）
 *
 * type = group * 32 + index，和客户端 \`GET_ITEM(group,index)\`、
 * 服务端 \`CItem::m_Index\` 完全一致；宽高单位是背包格（20px 一格）。
 *
 * 数值都是 **+0 基础值**（不含强化/追加/卓越）。
 */
export type ItemRow = [
  /** 占格宽 */ number,
  /** 占格高 */ number,
  /** 英文名 */ string,
  /** 武器最小攻 */ number,
  /** 武器最大攻 */ number,
  /** 防具防御 */ number,
  /** 装备槽 0..11，-1 = 不可装备 */ number,
  /** 需求等级 */ number,
  /** 需求力量 */ number,
  /** 需求敏捷 */ number,
  /** 需求智力 */ number,
  /** 需求体力 */ number,
  /** 耐久 */ number,
  /** 职业掩码 DW|DK<<1|ELF<<2|MG<<3，0 = 通用 */ number,
  /** 攻击速度（武器）或防御率（盾/防具） */ number,
];

export const ITEM_ATTRS: Record<number, ItemRow> = {
${body}
};

const ATTR_CACHE = new Map<number, ItemAttr>();

export interface ItemAttr {
  w: number;
  h: number;
  name: string;
  dmgMin: number;
  dmgMax: number;
  def: number;
  slot: number;
  reqLevel: number;
  reqStr: number;
  reqAgi: number;
  reqEne: number;
  reqVit: number;
  dura: number;
  clsMask: number;
  atkSpeed: number;
}

/** 取物品的格子尺寸、词条与装备条件；表里没有的类型退回 1×1 + 编号 */
export function itemAttr(type: number): ItemAttr {
  const hit = ATTR_CACHE.get(type);
  if (hit) return hit;
  const row = ITEM_ATTRS[type];
  const value: ItemAttr = row
    ? {
        w: row[0], h: row[1], name: row[2],
        dmgMin: row[3], dmgMax: row[4], def: row[5],
        slot: row[6], reqLevel: row[7], reqStr: row[8], reqAgi: row[9],
        reqEne: row[10], reqVit: row[11], dura: row[12],
        clsMask: row[13], atkSpeed: row[14],
      }
    : {
        w: 1, h: 1, name: \`Item \${type}\`,
        dmgMin: 0, dmgMax: 0, def: 0,
        slot: -1, reqLevel: 0, reqStr: 0, reqAgi: 0, reqEne: 0, reqVit: 0,
        dura: 0, clsMask: 0, atkSpeed: 0,
      };
  ATTR_CACHE.set(type, value);
  return value;
}

/** 物品类型的中文类别名（背包格子的 tooltip 用） */
export function itemKindName(type: number): string {
  const group = Math.floor(type / 32);
  return (
    [
      '剑', '斧', '锤', '矛', '弓', '法杖', '盾',
      '头盔', '铠甲', '护腿', '护手', '战靴',
      '翅膀', '守护', '药水', '魔法书',
    ][group] ?? '道具'
  );
}

/** 12 个装备槽的中文名，下标 = Item.txt 的 Slot 列 */
export const EQUIP_SLOT_NAMES = [
  '武器', '盾牌', '头盔', '铠甲', '护腿', '护手',
  '战靴', '翅膀', '守护', '项链', '戒指', '戒指',
];
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out, 'utf8');
console.log(`已生成 ${OUT}（${sorted.length} 条物品）`);
