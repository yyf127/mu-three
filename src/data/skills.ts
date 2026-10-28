/**
 * 技能表 —— 直接读 `Data/Local/chs/skill.bmd`（中文名），再加一张「技能号 → 特效模型」表。
 *
 * `skill.bmd` 是 64 条 × 40 B + 末尾 4 B，和 `item.bmd` 同一套 XOR 加密
 * （密钥 `{FC,CF,AB}`，**每条记录各自从 key[0] 重置**，见 `localText.ts`）。
 * 记录结构（`Tools_Source` 的 SkillEditor）：
 *
 *   char Name[32]     技能名（chs 版是 GBK 中文）
 *   BYTE RequireLevel 需求等级
 *   BYTE Damage       伤害百分比
 *   WORD ManaUse      耗蓝
 *   WORD BPUse        耗 BP
 *   BYTE Range        射程（格）
 *   BYTE RequireEnergy 需求智力
 *
 * ── 为什么读 chs 那一份 ────────────────────────────────────────────────
 * `muonlinejs-master/public/Data/Local/skill.bmd` 是英文版（`Poison` / `Fire Ball`），
 * 原版 Win32 客户端的中文版在 `Data/Local/chs/skill.bmd`（`毒咒` / `火球`）。
 * 两份都是 2564 B、64 槽，只有名字编码不同。这里优先读 chs（GBK），
 * 拿不到再退回英文版 —— 面板上直接显示中文技能名。
 *
 * 槽位：64 个，最大有名字的是 **56 号**（天雷闪）。空槽是
 * 0 / 25 / 29 / 37..40 / 44..46 / 53 / 54 / 57..63 —— 实际有 45 个技能。
 *
 * ── 特效映射为什么是手写的 ──────────────────────────────────────────────
 * 原版客户端没有「技能 → 特效文件」的数据表：`ZzzEffect.cpp` 里是一个巨大的
 * `switch(skillType)`，每个分支直接挑模型。这里照抄同样的思路，只是把分支
 * 摊平成一张表 —— 45 个技能逐个配。
 *
 * `Data/Skill` 里 65 个 bmd 有 63 个纹理齐全（`M_piercing` 缺 `strongP_R.ozj`、
 * `M_waves` 缺 `combo3.ozj`，配进去只会得到空气），所以下面只从能跑的里挑。
 */

import { LOCAL_DIR, xorDecode } from './localText';
import { fetchBytes } from '../core/texture';

export const SKILL_ROWS = 64;
export const SKILL_REC_BYTES = 40;

/** 中文版技能表（优先级更高） */
const CHS_DIR = `${LOCAL_DIR}chs/`;

export interface SkillRecord {
  /** skill.bmd 里的下标（= 上行包里的技能号） */
  id: number;
  name: string;
  requireLevel: number;
  damage: number;
  mana: number;
  bp: number;
  range: number;
  requireEnergy: number;
}

/** 技能归属职业（面板按这个分组） */
export type SkillJob = 'wizard' | 'knight' | 'elf' | 'mg' | 'misc';

export const JOB_LABEL: Record<SkillJob, string> = {
  wizard: 'Dark Wizard',
  knight: 'Dark Knight',
  elf: 'Fairy Elf',
  mg: 'Magic Gladiator',
  misc: 'Other',
};

/**
 * 面板里职业的固定顺序（不靠对象键顺序）。
 *
 * `mg` 排在最后但**不属于 `misc`**：0.97k 客户端没有魔剑士这个职业
 * （MG 是 0.99b 才加的），可 `Skill.txt` 里 55 玄月斩 / 56 天雷闪 的职业位
 * 就是 MG —— 数据如实反映，能不能用交给调用方判断。
 */
export const JOB_ORDER: SkillJob[] = ['wizard', 'knight', 'elf', 'mg', 'misc'];

/** 特效出现在谁身上 */
export type FxAnchor = 'target' | 'self';

/** 技能特效配置 */
export interface SkillFx {
  /** `Data/Skill/` 下的模型文件名 */
  file: string;
  /**
   * 主职业 —— **只用于面板分组排序的兜底**。
   * 真正的职业归属看 `SKILL_JOBS`（来自服务端 `Skill.txt`），这里不再作数。
   */
  job: SkillJob;
  /** 目标视觉尺寸（米，按包围盒最长边缩放） */
  size: number;
  /** 离地高度（米） */
  lift?: number;
  /** 帧速度倍数 */
  speed?: number;
  /** 播几遍 */
  loops?: number;
  /** 施法动作号（角色骨架的 action） */
  action?: number;
  /** 从按下到出特效的延迟（毫秒），让动作先起来 */
  delay?: number;
  /**
   * 特效落点：`target` 打在靶子身上（默认），`self` 出在自己脚下。
   * buff / 召唤 / 瞬移这类技能挂到靶子身上会很怪。
   */
  at?: FxAnchor;
  /** 只出光效、不结算伤害（治疗、护盾、召唤、瞬移） */
  noDamage?: boolean;
}

/**
 * 技能号 → 特效。45 条，覆盖 `skill.bmd` 里所有有名字的槽位。
 *
 * `size` 是「屏幕上看起来多大」：角色 2.2 m 高，所以点状技能 1.6 m、
 * 柱状技能 2.2~2.6 m、范围技能 3 m 上下。实际缩放由 `EffectLayer.spawn()`
 * 用蒙皮后的包围盒反算，不依赖 BMD 原始单位（那些模型从 0.4 m 到 8 m 都有）。
 */
export const SKILL_FX: Record<number, SkillFx> = {
  /* ── 法师 ────────────────────────────────────────────────── */
  1: { file: 'Poison01.bmd', job: 'wizard', size: 2.2, speed: 0.9 }, // 毒咒：绿色毒雾柱
  2: { file: 'Groundstone.bmd', job: 'wizard', size: 2.6, speed: 0.8 }, // 陨石：石头砸地
  3: { file: 'Laser01.bmd', job: 'wizard', size: 2.6, speed: 1.1 }, // 掌心雷：雷柱
  4: { file: 'Fire01.bmd', job: 'wizard', size: 2.2, speed: 1.0 }, // 火球：火柱
  // 火龙：和火球同一个模型，拉长 + 慢放，才是「横着喷一条」
  5: { file: 'Fire01.bmd', job: 'wizard', size: 3.6, speed: 0.7, loops: 2 }, // 火龙
  6: { file: 'Magiccircle01.bmd', job: 'wizard', size: 2.4, speed: 0.9, at: 'self', noDamage: true }, // 瞬移：脚下魔法阵
  7: { file: 'Ice01.bmd', job: 'wizard', size: 2.8, speed: 1.0 }, // 冰封：冰晶炸开
  8: { file: 'Storm01.bmd', job: 'wizard', size: 3.6, speed: 1.2 }, // 龙卷风
  /*
   * 9 黑龙波 —— 源码 `case 9` 是 4 条 `Joint_Create(1253)` + 每帧 `CreateEffect(205)`
   * （`Skill/Laser01.bmd`），由 `main.ts` 的 `castDragonWave()` 专用渲染器负责。
   * 这里留空：`SKILL_CASTS[9]` 存在且带 `special` 时根本不会查这张兜底表。
   * 以前写的 `Ball01.bmd`（能量球）是错的。
   */
  9: { file: '', job: 'wizard', size: 2.0, speed: 1.0 },
  10: { file: 'Inferno01.bmd', job: 'wizard', size: 3.2, speed: 0.8 }, // 地狱火：地面火环
  11: { file: 'Waveforce.bmd', job: 'wizard', size: 3.4, speed: 1.0, lift: 0.1 }, // 真空波：地面冲击
  12: { file: 'Blast01.bmd', job: 'wizard', size: 2.6, speed: 1.0 }, // 极光：斜插光柱
  13: { file: 'Blast01.bmd', job: 'wizard', size: 2.8, speed: 1.0 }, // 爆炎
  14: { file: 'Inferno01.bmd', job: 'wizard', size: 4.2, speed: 0.7, loops: 2 }, // 毁灭烈焰：火环放大两遍
  15: { file: 'Magiccircle01.bmd', job: 'wizard', size: 2.8, speed: 0.9, at: 'self', noDamage: true }, // 小挪移
  16: { file: 'Protect02.bmd', job: 'wizard', size: 2.2, speed: 0.8, loops: 2, at: 'self', noDamage: true }, // 守护之魂
  17: { file: 'Ball01.bmd', job: 'wizard', size: 1.5, speed: 1.2 }, // 能量球

  /* ── 战士 ────────────────────────────────────────────────── */
  18: { file: 'Protect01.bmd', job: 'knight', size: 2.2, speed: 0.8, loops: 2, at: 'self', noDamage: true }, // 圣盾防御
  19: { file: 'Earthquake02.bmd', job: 'knight', size: 3.0, speed: 1.0, lift: 0.1 }, // 地裂斩
  20: { file: 'Piercing.bmd', job: 'knight', size: 2.4, speed: 1.2 }, // 牙突刺
  21: { file: 'Blast01.bmd', job: 'knight', size: 2.6, speed: 1.1, lift: 1.2 }, // 升龙击：向上爆开
  22: { file: 'Storm01.bmd', job: 'knight', size: 2.4, speed: 1.4, at: 'self' }, // 旋风斩：环绕旋风
  23: { file: 'Kcross.bmd', job: 'knight', size: 3.0, speed: 1.2 }, // 天地十字剑：十字光
  41: { file: 'Saw01.bmd', job: 'knight', size: 2.4, speed: 1.5 }, // 霹雳回旋斩
  42: { file: 'Earthquake05.bmd', job: 'knight', size: 3.4, speed: 1.0, lift: 0.1 }, // 雷霆裂闪
  43: { file: 'Pierpart.bmd', job: 'knight', size: 2.6, speed: 1.2 }, // 袭风刺
  47: { file: 'Ridingspear01.bmd', job: 'knight', size: 2.8, speed: 1.1 }, // 钻云枪
  49: { file: 'Fire01.bmd', job: 'knight', size: 2.6, speed: 1.2 }, // 流星焰
  55: { file: 'Tail.bmd', job: 'mg', size: 3.0, speed: 1.2 }, // 玄月斩：月牙弧光（MG 技能）
  56: { file: 'Laser01.bmd', job: 'mg', size: 3.2, speed: 1.2 }, // 天雷闪（MG 技能）

  /* ── 精灵 ────────────────────────────────────────────────── */
  24: { file: 'Arrowdouble01.bmd', job: 'elf', size: 2.6, speed: 1.2 }, // 多重箭
  26: { file: 'Protect01.bmd', job: 'elf', size: 2.0, speed: 0.8, loops: 2, at: 'self', noDamage: true }, // 治疗
  27: { file: 'Protect02.bmd', job: 'elf', size: 2.2, speed: 0.8, loops: 2, at: 'self', noDamage: true }, // 守护之光
  28: { file: 'Magic01.bmd', job: 'elf', size: 2.4, speed: 1.0, at: 'self', noDamage: true }, // 战神之力
  48: { file: 'Protect02.bmd', job: 'knight', size: 2.6, speed: 0.7, loops: 2, at: 'self', noDamage: true }, // 生命之光（DK 技能，以前误标成精灵）
  51: { file: 'Ice02.bmd', job: 'elf', size: 1.8, speed: 1.0 }, // 冰封箭
  52: { file: 'Piercing.bmd', job: 'elf', size: 2.6, speed: 1.2 }, // 穿透箭

  /* ── 精灵召唤（都是「召唤物闪现一下」，出在自己脚边） ──────── */
  30: { file: 'Tama01.bmd', job: 'elf', size: 1.8, speed: 1.0, at: 'self', noDamage: true }, // 召唤 哥布林
  31: { file: 'Bigstone01.bmd', job: 'elf', size: 2.4, speed: 1.0, at: 'self', noDamage: true }, // 召唤 石巨人
  32: { file: 'Skeleton02.bmd', job: 'elf', size: 2.0, speed: 1.0, at: 'self', noDamage: true }, // 召唤 暗杀者
  33: { file: 'Rider02.bmd', job: 'elf', size: 2.6, speed: 1.0, at: 'self', noDamage: true }, // 召唤 雪人王
  34: { file: 'Skeleton03.bmd', job: 'elf', size: 2.2, speed: 1.0, at: 'self', noDamage: true }, // 召唤 暗黑骑士
  35: { file: 'Rider01.bmd', job: 'elf', size: 2.6, speed: 1.0, at: 'self', noDamage: true }, // 召唤 守护兽巴里
  36: { file: 'Phoenixshield01.bmd', job: 'elf', size: 2.4, speed: 1.0, at: 'self', noDamage: true }, // 召唤 黄金斗士

  /* ── 其他 ────────────────────────────────────────────────── */
  50: { file: 'Earthquake08.bmd', job: 'misc', size: 3.0, speed: 1.0, lift: 0.1 }, // 怪物区域攻击
};

/**
 * 技能 → 可用职业。**职业位不在 `skill.bmd` 里。**
 *
 * `skill.bmd` 一条记录就是 40 字节，到第 39 字节（`RequireEnergy`）就结束了，
 * 没有任何职业字段 —— 客户端只是「按名字显示 + 按射程/蓝耗判定能不能放」。
 * 真正决定「谁能学这个技能」的是**服务端**的 `MuServer/Data/Skill/Skill.txt`，
 * 第 13..16 列依次是 `DW DK FE MG`：
 *
 *     Index  Name        Damage MP  BP Range Radio Delay Attrib Effect ReqLvl ReqEne  DW DK FE MG
 *     1      "Poison"    12     42  0  6     0     0     1      55     0      0       1  0  0  1
 *
 * 值 > 0 = 该职业可学（值本身是这一列的技能等级，这里只当布尔用）。
 * 常见值是 1 和 2 —— 15/42/43/51 这四条就是 2（分别是 DW/DK/DK/FE 各自一个）。
 * **这四条特别容易看错成「MG=2」**：四列是固定的 `DW DK FE MG`，
 * 某列是 0 也照样占位，不能把后面的值往前挤。第一次誊这张表就栽在这里。
 *
 * ── 两份数据怎么对上的 ────────────────────────────────────────────────
 * 上表 `Poison` 行抽出来是 `Damage=12 / MP=42 / BP=0 / Range=6`；
 * `chs/skill.bmd` 第 1 条解出来是 `b33=12 / w34=42 / w36=0 / b38=6`。
 * 逐字节吻合 → 偏移解释正确（`+32 RequireLevel`、`+33 Damage`、`+34 ManaUse`、
 * `+36 BPUse`、`+38 Range`、`+39 RequireEnergy`，与 `Tools_Source` 的
 * `SkillEditor.cs` 结构声明一致）。顺便：这份 0.97k 表里 `+32`/`+39` 全是 0，
 * 即**没有等级/智力门槛**，所以 `canUse()` 现在只卡职业、不卡等级。
 *
 * 数据是手工誊过来的，`tools/skill-probe.mjs` 会拿它跟 Skill.txt 逐条对账。
 */
export const SKILL_JOBS: Record<number, SkillJob[]> = {
  // ── DW + MG 共用（法师系；MG 是混合职业，法师技能几乎全有）
  1: ['wizard', 'mg'], // Poison 毒咒
  2: ['wizard', 'mg'], // Meteorite 陨石
  3: ['wizard', 'mg'], // Lightning 掌心雷
  4: ['wizard', 'mg'], // Fire Ball 火球
  5: ['wizard', 'mg'], // Flame 火龙
  6: ['wizard'], // Teleport 瞬移 —— 只有 DW（MG 那列是 0）
  7: ['wizard', 'mg'], // Ice 冰封
  8: ['wizard', 'mg'], // Twister 龙卷风
  9: ['wizard', 'mg'], // Evil Spirit 黑龙波
  10: ['wizard', 'mg'], // Hell Fire 地狱火
  11: ['wizard', 'mg'], // Power Wave 真空波
  12: ['wizard', 'mg'], // Aqua Beam 极光
  13: ['wizard', 'mg'], // Blast 爆炎
  14: ['wizard', 'mg'], // Inferno 毁灭烈焰
  15: ['wizard'], // Teleport Party 小挪移 —— DW=2、MG=0，只有法师
  16: ['wizard'], // Mana Shield 守护之魂 —— 只有 DW
  17: ['wizard', 'mg'], // Energy Ball 能量球

  // ── DK + MG 共用（战士系）
  18: ['knight', 'mg'], // Defense 圣盾防御
  19: ['knight', 'mg'], // Falling Slash 地裂斩
  20: ['knight', 'mg'], // Lunge 牙突刺
  21: ['knight', 'mg'], // Uppercut 升龙击
  22: ['knight', 'mg'], // Cyclone 旋风斩
  23: ['knight', 'mg'], // Slash 天地十字剑
  41: ['knight', 'mg'], // Twisting Slash 霹雳回旋斩
  42: ['knight'], // Rageful Blow 雷霆裂闪 —— DK=2、MG=0，只有战士
  43: ['knight'], // Death Stab 袭风刺 —— DK=2、MG=0，只有战士
  47: ['knight', 'mg'], // Impale 钻云枪
  48: ['knight'], // Greater Life 生命之光 —— **只有 DK**（不关精灵的事）
  49: ['knight'], // Fire Breath 流星焰 —— 只有 DK

  // ── FE（精灵）
  24: ['elf'], // Triple Shot 多重箭
  26: ['elf'], // Heal 治疗
  27: ['elf'], // Greater Defense 守护之光
  28: ['elf'], // Greater Damage 战神之力
  30: ['elf'], // Summon Goblin 召唤 哥布林
  31: ['elf'], // Summon Stone Golem 召唤 石巨人
  32: ['elf'], // Summon Assassin 召唤 暗杀者
  33: ['elf'], // Summon Elite Yeti 召唤 雪人王
  34: ['elf'], // Summon Dark Knight 召唤 暗黑骑士
  35: ['elf'], // Summon Bali 召唤 守护兽巴里
  36: ['elf'], // Summon Soldier 召唤 黄金斗士
  51: ['elf'], // Ice Arrow 冰封箭 —— FE=2、MG=0，只有精灵
  52: ['elf'], // Penetration 穿透箭

  // ── MG 专属
  55: ['mg'], // Fire Slash 玄月斩
  56: ['mg'], // Power Slash 天雷闪

  // ── 谁都不能「学」，只有怪物用
  50: [], // Monster Area Attack 怪物区域攻击
};


/** 技能列表条目：`fx` 可能为空（skill.bmd 里有名字但没配特效） */
export interface SkillEntry extends SkillRecord {
  fx?: SkillFx;
  /** 主职业（= `jobs[0]`，面板分组用；空数组归 `misc`） */
  job: SkillJob;
  /**
   * 能学这个技能的职业，来自 `SKILL_JOBS`（= 服务端 `Skill.txt` 的 DW/DK/FE/MG）。
   * 空数组 = 客户端没有任何职业能学（例如怪物专用技能）。
   */
  jobs: SkillJob[];
}

/** 空数组（谁都不能学）在主职业里落到 `misc`，避免面板漏掉这条 */
function primaryJob(jobs: SkillJob[]): SkillJob {
  return jobs[0] ?? 'misc';
}

/**
 * 沙盘/角色职业 id → 技能职业。
 *
 * 下标就是 `equipCatalog.ts` 里 `SANDBOX_CLASSES` 的 `id`
 * （0 = Dark Wizard，1 = Dark Knight，2 = Fairy Elf，3 = Magic Gladiator，
 * 与 `Text.bmd` 20..23 一致）。`& 7` 是因为原版把职业 id 塞在一个字节的低 3 位里。
 */
export const JOB_BY_CLASS_ID: SkillJob[] = ['wizard', 'knight', 'elf', 'mg'];

export function jobOfClassId(id: number): SkillJob {
  return JOB_BY_CLASS_ID[id & 7] ?? 'wizard';
}

/**
 * 这个角色现在能不能放这个技能。
 *
 * 只卡职业，**不卡等级** —— 这份 0.97k 的 `skill.bmd` 里 `+32 RequireLevel`
 * 和 `+39 RequireEnergy` 全表都是 0（`Skill.txt` 的 `ReqLvl`/`ReqEne` 也是 0），
 * 等级门槛实际由服务端在学技能时把关，客户端没有可判的数据。
 * 以后换一份填了这两列的表，把 `level` 接进来即可。
 */
export function canUse(entry: SkillEntry, job: SkillJob): boolean {
  return entry.jobs.includes(job);
}

let cache: Promise<SkillEntry[]> | null = null;
let sourceTag: 'chs' | 'en' | 'none' = 'none';

/** 当前技能表来自哪份文件（面板提示用） */
export function skillSource(): 'chs' | 'en' | 'none' {
  return sourceTag;
}

function ascii(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/**
 * 取一条 32 字节的名字。
 * 有高位字节就按 GBK 解（chs 版），纯 ASCII 直接转（英文版）。
 */
function readName(bytes: Uint8Array, start: number, max: number): string {
  let end = start;
  const limit = Math.min(start + max, bytes.length);
  while (end < limit && bytes[end] !== 0) end++;
  const slice = bytes.subarray(start, end);
  let high = false;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] & 0x80) { high = true; break; }
  }
  if (!high) return ascii(slice);
  try {
    return new TextDecoder('gbk').decode(slice);
  } catch {
    return ascii(slice); // 环境不支持 gbk 时退化成乱码，但不至于崩
  }
}

/**
 * 中文包里好些名字尾巴挂着技能号（`火龙-5`、`黑龙波-9`、`霹雳回旋斩-41`），
 * 那是打包工具的补丁标记，不是技能名的一部分，显示前掐掉。
 */
function cleanName(name: string): string {
  return name.replace(/-\d+\s*$/, '').replace(/\s+/g, ' ').trim();
}

async function fetchTable(dir: string): Promise<Uint8Array | null> {
  try {
    return xorDecode(await fetchBytes(`${dir}skill.bmd`), SKILL_REC_BYTES);
  } catch {
    return null;
  }
}

/** 解整张技能表（64 条，含空槽） */
export async function loadSkillTable(): Promise<SkillRecord[]> {
  let bytes = await fetchTable(CHS_DIR);
  if (bytes) sourceTag = 'chs';
  if (!bytes) {
    bytes = await fetchTable(LOCAL_DIR);
    if (bytes) sourceTag = 'en';
  }
  if (!bytes) {
    sourceTag = 'none';
    return [];
  }

  const rows: SkillRecord[] = [];
  const n = Math.floor(bytes.length / SKILL_REC_BYTES);
  for (let i = 0; i < n; i++) {
    const o = i * SKILL_REC_BYTES;
    rows.push({
      id: i,
      name: cleanName(readName(bytes, o, 32)),
      requireLevel: bytes[o + 32],
      damage: bytes[o + 33],
      mana: bytes[o + 34] | (bytes[o + 35] << 8),
      bp: bytes[o + 36] | (bytes[o + 37] << 8),
      range: bytes[o + 38],
      requireEnergy: bytes[o + 39],
    });
  }
  return rows;
}

/** 面板用的技能清单：有名字就收（没配特效的也列出来，点了只播动作） */
export function loadSkills(): Promise<SkillEntry[]> {
  if (cache) return cache;
  cache = (async () => {
    const rows = await loadSkillTable();
    return rows
      .filter(r => r.name !== '')
      .map(r => {
        const fx = SKILL_FX[r.id];
        /*
         * 职业以 `SKILL_JOBS`（服务端 Skill.txt）为准，`SKILL_FX[].job` 只当兜底。
         * 两者曾经不一致过：48 生命之光被写成精灵技能（实际是 DK），
         * 55/56 被写成战士技能（实际是 MG）。以 Skill.txt 为准之后这类错不会再有。
         */
        const jobs = SKILL_JOBS[r.id] ?? (fx ? [fx.job] : []);
        return { ...r, fx, jobs, job: primaryJob(jobs) };
      });
  })();
  return cache;
}
