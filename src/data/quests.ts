/**
 * 任务数据（解析服务端 `Data/Quest/*.txt`）。
 *
 * 服务端只下发**状态位**（`0xA0` 里 50 字节 = 192 个任务 × 2 bit），
 * 任务的名字、需求、目标、奖励全在配置表里，客户端必须自己读一份。
 * 三张表从 `MuServer/Data/Quest/` 复制到资源目录（`/Data/Quest/`），
 * 运行时 fetch + 解析，改配置不用重新构建。
 *
 * ── 三张表各管什么 ───────────────────────────────────────────────────
 *
 * `Quest.txt`（每个任务 × 每个状态一行）
 *   Index / MonsterClass / CurrentState / RequireIndex / RequireState /
 *   RequireMinLevel / RequireMaxLevel / DW / DK / FE / MG
 *   → 「这个任务在**某个状态下**的开启条件」。所以同一个任务会有 0/1/2/3 四行，
 *     分别对应 未接 / 进行中 / 已完成 / 已取消。
 *
 * `QuestObjective.txt`
 *   Num / Type(1=物品 2=金币) / Index / Value / … / RequireIndex / RequireState / 职业位
 *   注意这里的 `RequireIndex` 其实是**任务号**（不是前置任务），
 *   `RequireState` 才是「本任务处于该状态时，这条目标才生效」——
 *   服务端 `CheckQuestObjectiveRequisite` 就是这么判的。
 *   例：任务 0 在 state 0/3 时要求「交 100 万 Zen」，state 1 时要求「拿到 471 号物品」。
 *
 * `QuestReward.txt`
 *   Type(1=升级点 2=一转) / Index(客户端表现号 200/201) / Value / RequireIndex / RequireState
 */

import { assetUrl } from '../core/base';

const QUEST_DIR = 'Data/Quest/';

/** 任务状态（服务端 `eQuestState`，bitmask 里 2 bit） */
export const QUEST_STATE = {
  NORMAL: 0,
  ACCEPT: 1,
  FINISH: 2,
  CANCEL: 3,
} as const;

export const QUEST_STATE_LABEL: Record<number, string> = {
  0: '未接取',
  1: '进行中',
  2: '已完成',
  3: '已取消',
};

export interface QuestRow {
  /** 这一行对应的状态 */
  state: number;
  /** 前置任务号（-1 = 无） */
  requireIndex: number;
  requireState: number;
  minLevel: number;
  maxLevel: number;
  /** [DW, DK, FE, MG] 每职业允许的转生次数上限（0 = 不可接） */
  classes: number[];
}

export interface QuestObjective {
  type: number; // 1 = 物品, 2 = 金币
  index: number; // 物品号（= 32 * 类别 + 序号）
  value: number;
  /** 这条目标在「任务处于哪个状态」时生效 */
  requireState: number;
  classes: number[];
}

export interface QuestReward {
  type: number; // 1 = 升级点, 2 = 一转
  index: number; // 客户端表现号
  value: number;
  requireState: number;
  classes: number[];
}

export interface QuestDef {
  index: number;
  npcClass: number;
  /** 每个状态一行的开启条件 */
  rows: QuestRow[];
  objectives: QuestObjective[];
  rewards: QuestReward[];
}

export interface QuestData {
  quests: QuestDef[];
  byIndex: Map<number, QuestDef>;
}

/* ------------------------------------------------------------------ */
/* 解析                                                                */
/* ------------------------------------------------------------------ */

/** 表里的 `*` = 不限；`-1` 保留原值 */
const num = (tok: string | undefined): number => {
  if (tok === undefined || tok === '*' || tok === '') return -1;
  const n = Number(tok);
  return Number.isFinite(n) ? n : -1;
};

/** 去掉注释行 / 空行 / 末尾的 `end`，按空白切列 */
function rows(text: string): string[][] {
  const out: string[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (/^end$/i.test(line)) break;
    out.push(line.split(/\s+/));
  }
  return out;
}

async function fetchText(path: string): Promise<string> {
  const res = await fetch(assetUrl(path), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`任务表读取失败：${path} ${res.status}`);
  return res.text();
}

let cached: Promise<QuestData> | null = null;

/** 读一次并缓存（UI 每次打开都用同一份） */
export function loadQuests(): Promise<QuestData> {
  if (!cached) cached = readAll();
  return cached;
}

async function readAll(): Promise<QuestData> {
  const [qTxt, oTxt, rTxt] = await Promise.all([
    fetchText(`${QUEST_DIR}Quest.txt`),
    fetchText(`${QUEST_DIR}QuestObjective.txt`),
    fetchText(`${QUEST_DIR}QuestReward.txt`),
  ]);

  const byIndex = new Map<number, QuestDef>();

  for (const c of rows(qTxt)) {
    const index = num(c[0]);
    const npcClass = num(c[1]);
    const state = num(c[2]);
    if (index < 0 || state < 0) continue;
    let def = byIndex.get(index);
    if (!def) {
      def = { index, npcClass, rows: [], objectives: [], rewards: [] };
      byIndex.set(index, def);
    }
    def.rows.push({
      state,
      requireIndex: num(c[3]),
      requireState: num(c[4]),
      minLevel: num(c[5]),
      maxLevel: num(c[6]),
      classes: [num(c[7]), num(c[8]), num(c[9]), num(c[10])],
    });
  }

  for (const c of rows(oTxt)) {
    // 列：Num Type Index Value … RequireIndex(12) RequireState(13) DW DK FE MG(14..17)
    const questIndex = num(c[12]);
    const def = byIndex.get(questIndex);
    if (!def) continue;
    def.objectives.push({
      type: num(c[1]),
      index: num(c[2]),
      value: num(c[3]),
      requireState: num(c[13]),
      classes: [num(c[14]), num(c[15]), num(c[16]), num(c[17])],
    });
  }

  for (const c of rows(rTxt)) {
    // 列：Num Type Index Value Level Skill Luck Option Exce RequireIndex(9) RequireState(10) DW DK FE MG(11..14)
    const questIndex = num(c[9]);
    const def = byIndex.get(questIndex);
    if (!def) continue;
    def.rewards.push({
      type: num(c[1]),
      index: num(c[2]),
      value: num(c[3]),
      requireState: num(c[10]),
      classes: [num(c[11]), num(c[12]), num(c[13]), num(c[14])],
    });
  }

  const quests = [...byIndex.values()].sort((a, b) => a.index - b.index);
  return { quests, byIndex };
}

/* ------------------------------------------------------------------ */
/* 状态位                                                              */
/* ------------------------------------------------------------------ */

/**
 * 从 0xA0 的 50 字节 bitmask 里取某个任务的状态。
 *
 * 服务端 `CQuest::AddQuestList`：
 *   `Quest[Index / 4] = (… & mask) | ((State & 3) << ((Index % 4) * 2))`
 * 也就是**每字节 4 个任务、每个 2 bit**。
 */
export function questStateFromMask(mask: Uint8Array<ArrayBufferLike>, index: number): number {
  const byte = mask[Math.floor(index / 4)];
  if (byte === undefined) return 0;
  return (byte >> ((index % 4) * 2)) & 3;
}

/** 反写：本地维护一份 bitmask（0xA1/0xA2 单条更新时用） */
export function setQuestStateInMask(mask: Uint8Array<ArrayBufferLike>, index: number, state: number): void {
  const at = Math.floor(index / 4);
  if (at >= mask.length) return;
  const shift = (index % 4) * 2;
  mask[at] = (mask[at] & ~(3 << shift)) | ((state & 3) << shift);
}

/** 某个任务在某个状态下的那一行（没有就是 null） */
export function rowOf(def: QuestDef, state: number): QuestRow | null {
  return def.rows.find(r => r.state === state) ?? null;
}

/** 当前状态下的目标（服务端只检查 requireState 匹配的那几条） */
export function objectivesOf(def: QuestDef, state: number): QuestObjective[] {
  return def.objectives.filter(o => o.requireState === state);
}

/** 当前状态下的奖励 */
export function rewardsOf(def: QuestDef, state: number): QuestReward[] {
  return def.rewards.filter(r => r.requireState === state);
}
