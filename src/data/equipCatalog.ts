/**
 * 装备目录 —— 离线演示里「装备佩戴」菜单的数据来源。
 *
 * 权威表是 `Data/Local/item.bmd`（512 条 × 64 字节，字段见 `localText.ts`）：
 *
 *   +00 char[30] Name        装备英文名（菜单直接显示这个）
 *   +30 BYTE      TwoHand     0 单手 / 1 双手（动作表要用）
 *   +49 BYTE      RequireLevel
 *   +56..59       RequireDW / DK / ELF / MG —— **0 = 不能穿，1 = 能穿，2 = 二转专属**
 *
 * item.bmd 里没有「部位」字段，部位就是**物品编号本身的分组**：
 *
 *   type = group * 32 + index（和 `GET_ITEM(group,index)`、服务端 `CItem::m_Index` 一致）
 *   0..5  武器（剑/斧/锤/矛/弓/法杖）→ 右手
 *   6     盾                        → 左手
 *   7..11 盔/甲/腿/手/靴            → 对应穿戴槽 2..6
 *   12    0..6 是翅膀（7 以后是技能球，不是装备）
 *
 * 只有「表里有名字 + 分组落在可穿戴范围 + 模型文件真的存在」三条同时满足，
 * 才会进下拉框 —— 否则选了也是一片空白（0.97 男防具只有 01..10 + 16/17，
 * 精灵防具只有 01..05，超出的编号客户端根本没加载，见 `Model_Items.cpp:246-262`）。
 */
import { assetUrl } from '../core/base';
import { loadItemTable } from './localText';
import { itemModelPath, type BodyGender } from '../world/items';

/** 0 = 黑暗巫师 1 = 黑暗骑士 2 = 精灵 3 = 魔剑士（Text.bmd 20..23） */
export const SANDBOX_CLASSES = [
  { id: 0, name: 'Dark Wizard' },
  { id: 1, name: 'Dark Knight' },
  { id: 2, name: 'Fairy Elf' },
  { id: 3, name: 'Magic Gladiator' },
] as const;

/**
 * 菜单里的 8 个下拉框，顺序照参考图：先防具，再左右手，最后翅膀。
 * `slot` 是服务端背包的穿戴槽（0 武器 / 1 盾 / 2 盔 / 3 甲 / 4 腿 / 5 手 / 6 靴 / 7 翅膀）。
 */
export const EQUIP_SLOTS = [
  { slot: 2, label: 'Helm', key: 'helm' },
  { slot: 3, label: 'Armor', key: 'armor' },
  { slot: 4, label: 'Pants', key: 'pants' },
  { slot: 5, label: 'Gloves', key: 'gloves' },
  { slot: 6, label: 'Boots', key: 'boots' },
  { slot: 1, label: 'Left Hand', key: 'shield' },
  { slot: 0, label: 'Right Hand', key: 'weapon' },
  { slot: 7, label: 'Wings', key: 'wing' },
] as const;

export type EquipSlotKey = (typeof EQUIP_SLOTS)[number]['key'];

export interface EquipOption {
  type: number;
  name: string;
  slot: number;
  twoHand: boolean;
  reqLevel: number;
}

/** 职业 → 防具体型（0.97 只有男 / 精灵两套文件名） */
export function bodyOfClass(cls: number): BodyGender {
  return (cls & 7) === 2 ? 'Elf' : 'Male';
}

/** type → 穿戴槽；-1 = 不是可穿戴部位 */
export function slotOfType(type: number): number {
  const group = Math.floor(type / 32);
  const index = type % 32;
  if (group <= 5) return 0;
  if (group === 6) return 1;
  if (group >= 7 && group <= 11) return group - 5;
  if (group === 12 && index <= 6) return 7;
  return -1;
}

/** 模型存在性缓存（`/Data/.../Xxx.bmd` → 有没有） */
const modelExists = new Map<string, boolean>();
/** 每个职业的目录只算一次 */
const catalogCache = new Map<number, Promise<EquipOption[]>>();

function modelUrl(type: number, body: BodyGender): string | null {
  const p = itemModelPath(type, body);
  if (!p) return null;
  const file = p.file.toLowerCase().endsWith('.bmd') ? p.file : `${p.file}.bmd`;
  return `${p.dir}${file}`;
}

/**
 * 探测模型文件在不在。
 *
 * 注意 **不能只看 `res.ok`**：开发服务器带 SPA 回退，路径不存在时也会
 * 返回 200 + index.html。真正的 bmd 响应没有 `text/html`，靠这个区分。
 */
async function hasModel(url: string): Promise<boolean> {
  const hit = modelExists.get(url);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    const res = await fetch(assetUrl(url), { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    ok = res.ok && !type.includes('text/html');
  } catch {
    ok = false;
  }
  modelExists.set(url, ok);
  return ok;
}

/**
 * 箭矢 / 弩矢不是「穿在身上的装备」——虽然同属 group 4（弓），
 * 但 `Item.txt` 把它们记在左手槽，实际是消耗品，进菜单只会让人误会。
 */
const AMMO = new Set([135 /* Arrows */, 143 /* Bolts */]);

/**
 * 取某职业能穿的装备（含「None」以外的全部选项）。
 *
 * 过滤顺序：有名字 → 分组落在可穿戴槽 → `RequireXxx > 0`（0 = 该职业不能穿，
 * 2 = 二转专属，也算能穿）→ 模型文件存在。
 */
export async function loadEquipCatalog(cls: number): Promise<EquipOption[]> {
  const id = cls & 7;
  const cached = catalogCache.get(id);
  if (cached) return cached;

  const task = (async () => {
    const table = await loadItemTable();
    const body = bodyOfClass(id);
    const raw: EquipOption[] = [];

    for (const rec of table) {
      if (!rec.name || AMMO.has(rec.type)) continue;
      const slot = slotOfType(rec.type);
      if (slot < 0) continue;
      // [DW, DK, ELF, MG]：0 表示这个职业穿不了
      if ((rec.reqClass[id] ?? 0) <= 0) continue;
      raw.push({
        type: rec.type,
        name: rec.name,
        slot,
        twoHand: rec.twoHand !== 0,
        reqLevel: rec.reqLevel,
      });
    }

    // 并发生存性探测，再按原顺序过滤掉没有模型的
    const urls = raw.map(o => modelUrl(o.type, body));
    const okFlags = await Promise.all(urls.map(u => (u ? hasModel(u) : Promise.resolve(false))));
    return raw.filter((_, i) => okFlags[i]);
  })();

  catalogCache.set(id, task);
  return task;
}

/** 从目录里挑某个槽位的选项（按名字排序，菜单里好找） */
export function optionsForSlot(catalog: EquipOption[], slot: number): EquipOption[] {
  return catalog.filter(o => o.slot === slot).sort((a, b) => a.name.localeCompare(b.name));
}
