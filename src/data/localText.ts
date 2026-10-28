/**
 * `Data/Local` 下的本地化文本表 —— 原版客户端所有 UI 文案、对话、物品名的来源。
 *
 * 0.97 客户端里这些文件是**加密的 .bmd**，而不是明文 txt：
 *
 *   Data/Local/Text.bmd   300000 B = 1000 行 × 300 B   每行一条 null 结尾字符串
 *   Data/Local/item.bmd    32772 B =    4 B + 512 × 64 B  每行一个物品名
 *   Data/Local/NPCName.txt 明文（GBK），`编号 类型 "名字"`
 *
 * 加密方式（`Local/Text_Data.cpp:1-14`，`OpenTextData` → `sub_479830`）：
 * 整块字节与 3 字节滚动密钥 `{0xFC, 0xCF, 0xAB}` 做 XOR，密钥下标 `i % 3`。
 * 解出来第一行是 `Tahoma` —— Text.bmd 第 0 行存的是**字体名**，不是文案。
 *
 *   offset 0  ^ FC = 54 'T'
 *   offset 1  ^ CF = 61 'a'
 *   offset 2  ^ AB = 68 'h'   → Tahoma ✓
 *
 * item.bmd 是**每条记录各自从 key[0] 重新开始**（不是整块连续滚动）。
 * 判断依据：按整块滚动解出来，第 1 条起全是乱码；改为每 64 字节重置后，
 * 依次得到 Kris / Short Sword / Rapier / Katana …，和 `Item.txt` 完全对得上。
 *
 * 索引语义（`globals.h:2231`）：`GlobalText[]` 在客户端里就是一个
 * `char[1000][300]`，所有渲染代码都直接按索引取，比如属性面板：
 *   [200] "Level: %d / %d"   [201] "Experience: %u / %u"
 *   [202] "Strength: %d"     [205] "Agility: %d"   [210] "Vitality: %d"
 *   [212] "Energy: %d"       [211] "Health: %d / %d"  [213] "Mana: %d / %d"
 *   [20..29] 职业名（`4*(upper)+20+(lower)`）
 *
 * ── 同目录其余文件（结构以 `Tools_Source/kayitoTools` 为准）──────────────
 *
 *   Dialog.bmd      204800 B = 200 条 × 1024 B，NPC 对话；每条**各自重置**密钥
 *                   结构：char NPCDialog[300] / int AnswersQuantity /
 *                         int NPCResponse[10] / int NPCCondition[10] /
 *                         char PlayerResponse[10][64]      → 300+4+40+40+640 = 1024
 *   item.bmd         32772 B = 512 条 × 64 B + **末尾** 4 B，物品表（本文件已用）
 *   skill.bmd         2564 B =  64 条 × 40 B + 末尾 4 B，技能表
 *                   char Name[32] / BYTE RequireLevel / BYTE Damage /
 *                   WORD ManaUse / WORD BPUse / BYTE Range / BYTE RequireEnergy
 *   quest.bmd       116800 B = 200 条 × 584 B，任务表（无尾巴）
 *   Gate.bmd           900 B = 100 条 × 9 B，传送门（Flag/Map/StartX/Y/EndX/Y/Target/Dir/ReqLevel）
 *   Filter( Name).bmd 20004 B = 1000 条 × 20 B + 末尾 4 B，聊天屏蔽词
 *   NPCName.txt     明文 GBK：`编号 类型 "名字"`，NPC 头顶名牌
 *
 * 两条密钥规则都要记：Text.bmd 是**整块**滚动，其余 bmd 是**每条**重置
 * （`ItemEditor.cs:734` 对每条单独调 `BuxConvert(subBuffer, 64)`）。
 * 用错的话第一行永远是对的，从第二条开始全乱 —— 这个坑踩过一次。
 *
 * 另外 `512*64 + 4` 里的 4 字节在**文件末尾**，不是开头：
 * `ItemEditor.cs:722` 只校验长度，读的时候 `Array.Copy(buffer, i*64, ...)` 从 0 起。
 * 按「4 字节头」去切的后果和上面一样 —— 第一条对、后面全错位。
 */

import { assetUrl } from '../core/base';

export const LOCAL_DIR = '/Data/Local/';
/**
 * 本地化目录，**中文版优先**。
 *
 * `Data/Local/chs/` 是客户端自带的中文资源（`Text.bmd` 里是「魔法师 / 剑士 /
 * 等级 / 力 量」，`item.bmd` 里是「波刃剑 / 短剑」）；根目录那份是英文
 * （`Dark Wizard` / `Kris`）。以前只读根目录，所以属性面板、物品名全是英文，
 * 界面上那些中文是我们自己写的 —— 用户要的就是回到 `chs/` 这份原文。
 *
 * 读取顺序：`chs/xxx` → `xxx`（缺文件时退回英文，不至于空白）。
 */
export const LOCAL_DIRS = [`${LOCAL_DIR}chs/`, LOCAL_DIR];

/** 按 `LOCAL_DIRS` 顺序找第一个存在的文件（顺便告诉调用方实际用的是哪份） */
async function fetchLocal(name: string): Promise<{ bytes: Uint8Array; path: string }> {
  let lastErr: unknown = null;
  for (const dir of LOCAL_DIRS) {
    const path = `${dir}${name}`;
    try {
      return { bytes: await fetchBytes(path), path };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`${name} 找不到`);
}

/**
 * 本地文本是 **ANSI(GBK)**，不是 UTF-8。
 *
 * 以前 `cstr` 是逐字节 `String.fromCharCode`（等于 latin1），英文文件看不出问题，
 * 一换成 `chs/` 就全是乱码 —— 这是「中文乱码」的另一半原因。
 */
const GBK = (() => {
  try {
    return new TextDecoder('gbk');
  } catch {
    return null;
  }
})();

function decodeAnsi(bytes: Uint8Array): string {
  if (GBK) return GBK.decode(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/** 3 字节滚动密钥（`BuxConvert_0`） */
const XOR_KEY = [0xfc, 0xcf, 0xab] as const;

/** Text.bmd 一行 300 字节、共 1000 行 */
export const GT_ROWS = 1000;
export const GT_ROW_BYTES = 300;

/**
 * 就地 XOR 解密一段字节。
 * `resetEvery > 0` 时每 `resetEvery` 字节把密钥下标归零（item.bmd 的规则）。
 */
export function xorDecode(src: Uint8Array, resetEvery = 0): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const k = resetEvery > 0 ? i % resetEvery : i;
    out[i] = src[i] ^ XOR_KEY[k % 3];
  }
  return out;
}

/** 取一段定长记录里的 null 结尾字符串（ANSI/GBK，见 `decodeAnsi`） */
function cstr(bytes: Uint8Array, start: number, max: number): string {
  let end = start;
  const limit = Math.min(start + max, bytes.length);
  while (end < limit && bytes[end] !== 0) end++;
  return decodeAnsi(bytes.subarray(start, end));
}

/* ------------------------------------------------------------------ */
/* printf 兼容                                                         */
/* ------------------------------------------------------------------ */

/**
 * 复刻 `@@sprintf` 的那几个格式符。Text.bmd 里实际用到的只有
 * `%d %u %s %x %%` 以及少量 `%02d` 之类，够用。
 *
 * 注意 `%%` 必须成对处理 —— 比如 `[582] "Skill damage: %d%%"`。
 */
export function formatText(fmt: string, args: (string | number)[]): string {
  let ai = 0;
  return fmt.replace(/%(-?\d+(?:\.\d+)?)?([dsuxXfc%])/g, (_m, width: string, type: string) => {
    if (type === '%') return '%';
    const v = args[ai++];
    let s: string;
    switch (type) {
      case 's':
        s = v === undefined || v === null ? '' : String(v);
        break;
      case 'x':
        s = (Number(v) >>> 0).toString(16);
        break;
      case 'X':
        s = (Number(v) >>> 0).toString(16).toUpperCase();
        break;
      case 'c':
        s = String.fromCharCode(Number(v) || 0);
        break;
      case 'f':
        s = Number(v || 0).toFixed(1);
        break;
      default:
        // %d / %u：原版对负数也直接打十进制，不做无符号解释
        s = String(Math.trunc(Number(v) || 0));
        break;
    }
    if (width) {
      const w = parseInt(width, 10);
      const pad = width.startsWith('-') ? ' ' : w > 0 && width.startsWith('0') ? '0' : ' ';
      if (Math.abs(w) > s.length) {
        s = width.startsWith('-') ? s.padEnd(Math.abs(w), ' ') : s.padStart(Math.abs(w), pad);
      }
    }
    return s;
  });
  // 编译期警告：args 未用完通常是格式串抄错了
}

/* ------------------------------------------------------------------ */
/* 文本池                                                              */
/* ------------------------------------------------------------------ */

/** 一个已加载的字符串池（Text.bmd），在内存里就是 1000 条字符串 */
export class TextPool {
  constructor(
    readonly rows: string[],
    /** 数据来源，调试用 */
    readonly source = 'Text.bmd'
  ) {}

  /** 原版 `GlobalText[i]`；越界返回空串（原版会读越界，这里保守处理） */
  get(i: number): string {
    return this.rows[i] ?? '';
  }

  /** 原版 `sprintf(buf, GlobalText[i], ...)` */
  fmt(i: number, ...args: (string | number)[]): string {
    return formatText(this.get(i), args);
  }

  /**
   * 职业名。照原版 `RenderCharacterInfoWindow`：
   *
   *     GlobalText[4 * (CA[11] >> 3) + 20 + (CA[11] & 7)]
   *
   * `CA[11]` 是**编码后的职业号**，低 3 位是职业组（0=魔法师 1=剑士 2=弓箭手
   * 3=魔剑士），`>>3` 是**转职次数**（0 未转 / 1 一转 / 2 二转）。
   * 实测 `Data/Local/chs/Text.bmd` 的第 20..27 行正是：
   *
   *     20 魔法师  21 剑士  22 弓箭手  23 魔剑士
   *     24 魔导师  25 骑士  26 圣射手  27 保留：…
   *
   * 也就是说 **+8 = 转职一次**（0→8 就跳到"魔导师"那一行）。
   * 以前这里只取 `20 + 职业组`，所以一转之后名字不会变 —— 转职看起来"没反应"。
   */
  className(classId: number): string {
    const id = Math.max(0, Math.min(31, classId | 0));
    const row = 20 + 4 * (id >> 3) + (id & 7);
    // 越界/空行兜底：退回未转职那一列（至少别显示空白）
    return this.get(row) || this.get(20 + (id & 7));
  }
}

let textPool: TextPool | null = null;
let textLoading: Promise<TextPool> | null = null;

async function fetchBytes(path: string): Promise<Uint8Array> {
  const url = assetUrl(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** 读取 Text.bmd 并切行。失败时返回全空池，UI 退化成无文字而不是崩掉。 */
export async function loadTextPool(): Promise<TextPool> {
  if (textPool) return textPool;
  if (!textLoading) {
    textLoading = (async () => {
      try {
        const { bytes, path } = await fetchLocal('Text.bmd');
        const dec = xorDecode(bytes);
        const rows: string[] = [];
        for (let i = 0; i < dec.length; i += GT_ROW_BYTES) {
          rows.push(cstr(dec, i, GT_ROW_BYTES));
        }
        return new TextPool(rows, path);
      } catch (err) {
        console.warn('[localText] Text.bmd 读取失败，UI 文本将为空', err);
        return new TextPool([]);
      }
    })();
  }
  textPool = await textLoading;
  return textPool;
}

/**
 * 同步取 `GlobalText[i]`（表还没加载完就返回 `fallback`）。
 *
 * 面板大多在异步 `build()` 里拼 DOM，但按钮文案是同步写的，
 * 所以启动时先 `void loadTextPool()` 预热，这里就能直接拿中文原文。
 */
export function textSync(i: number, fallback = ''): string {
  const s = textPool?.get(i);
  return s && s.trim() ? s : fallback;
}

/** 调试/诊断：取 `GlobalText[i]`（会按需加载 Text.bmd） */
export async function textAt(i: number): Promise<string> {
  return (await loadTextPool()).get(i);
}

/** 调试：文本池来源（`chs/Text.bmd` 还是 `Text.bmd`） */
export async function textSource(): Promise<string> {
  return (await loadTextPool()).source;
}

/* ------------------------------------------------------------------ */
/* Dialog.bmd —— NPC 对话（原版 CSQuest + Dialog_Data.cpp）             */
/* ------------------------------------------------------------------ */

/**
 * `Data/Local/Dialog.bmd` = 200 条 × 1024 字节，**每条各自重置密钥**。
 *
 * 结构（`globals.h: DIALOG_SCRIPT`，`static_assert` 到 0x400）：
 *
 *     +0x000  char m_lpszText[300]          NPC 说的话
 *     +0x12C  int  m_iNumAnswer             答案条数（0..10；0 时原版补一条 `GlobalText[609]`）
 *     +0x130  int  m_iLinkForAnswer[10]     选第 i 条 → 跳到哪个对话（>0；-1 不跳）
 *     +0x158  int  m_iReturnForAnswer[10]   选第 i 条 → 交什么给任务系统（1 接受 / 2 关闭 / 3 提交）
 *     +0x180  char m_lpszAnswer[10][64]     答案文本
 *
 * 显示规则照 `CSQuest::ShowDialogText`（`stubs_IDA_ports.cpp:488`）：
 * 正文按 **38 字宽、最多 7 行** 折行；答案显示成 `1) xxx`，也按 38 字折。
 */
export const DIALOG_COUNT = 200;
export const DIALOG_REC_BYTES = 1024;
/** 正文折行宽度（原版 SeparateTextIntoLines(..., 7, 0x26)） */
export const DIALOG_LINE_CHARS = 38;
export const DIALOG_LINES = 7;

export interface DialogEntry {
  index: number;
  text: string;
  numAnswer: number;
  answers: string[];
  /** 选择第 i 条后跳转的对话号（<=0 表示不跳） */
  links: number[];
  /** 选择第 i 条后要发给任务系统的动作（1 接受 / 2 关闭 / 3 提交 / -1 无） */
  returns: number[];
}

let dialogs: DialogEntry[] | null = null;

function parseInts(bytes: Uint8Array, off: number, count: number): number[] {
  const out: number[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset + off, count * 4);
  for (let i = 0; i < count; i++) out.push(view.getInt32(i * 4, true));
  return out;
}

export async function loadDialogs(): Promise<DialogEntry[]> {
  if (dialogs) return dialogs;
  try {
    const { bytes } = await fetchLocal('Dialog.bmd');
    const recs = Math.min(DIALOG_COUNT, Math.floor(bytes.length / DIALOG_REC_BYTES));
    const out: DialogEntry[] = [];
    for (let i = 0; i < recs; i++) {
      // 每条单独重置密钥（DIALOG_SCRIPT 是 0x400 对齐的结构体）
      const rec = xorDecode(bytes.subarray(i * DIALOG_REC_BYTES, (i + 1) * DIALOG_REC_BYTES));
      const text = cstr(rec, 0x000, 300);
      const n = Math.max(0, Math.min(10, parseInts(rec, 0x12c, 1)[0]));
      const links = parseInts(rec, 0x130, 10);
      const returns = parseInts(rec, 0x158, 10);
      const answers: string[] = [];
      for (let k = 0; k < 10; k++) answers.push(cstr(rec, 0x180 + k * 64, 64));
      out.push({ index: i, text, numAnswer: n, answers, links, returns });
    }
    dialogs = out;
  } catch (err) {
    console.warn('[localText] Dialog.bmd 读取失败', err);
    dialogs = [];
  }
  return dialogs;
}

/** 已加载的对话（同步取；没加载时返回 null） */
export function dialogAtSync(i: number): DialogEntry | null {
  return dialogs ? (dialogs[i] ?? null) : null;
}

/* ------------------------------------------------------------------ */
/* quest.bmd —— 任务表（0.97）                                          */
/* ------------------------------------------------------------------ */

/**
 * `Data/Local/quest.bmd` = 200 条 × **584 字节**，每条各自重置 XOR 密钥。
 *
 * 结构来自 `Tools_Source/kayitoTools/Forms/Quest/QuestManager.cs`（注释里就是字段表）：
 *
 *     +000 WORD  QuestConditionNumber
 *     +002 WORD  QuestRequestNumber
 *     +004 BYTE  NpcNumber            ← 接这个任务的 NPC 的 Class（235 = 圣导士塞维娜）
 *     +005 char  QuestName[32]
 *     +037 BYTE  fill
 *     +038 QUEST_CLASS_ACT[16] × 18B
 *            +0 Live  +1 QuestType  +2 ItemType  +3 ItemSubType  +4 ItemNum
 *            +5 RequestType  +6 RequestClass[4]
 *            +10 WORD QuestStartText[4]   ← **4 个对话号**（Dialog.bmd 的索引）
 *     +326 2×fill
 *     +328 QUEST_CLASS_REQUEST[16] × 16B
 *            +0 Live +1 Type +2 WORD CompleteQuestIndex +4/6 LevelMin/Max
 *            +8 DWORD Zen +12 WORD ErrorText
 *
 * 所以「点 NPC → 说什么」这条链是：`NpcNumber` 找到任务 → `QuestStartText[0]`
 * 就是第一句对话，后面的对话靠 `Dialog.bmd` 的 `m_iLinkForAnswer` 串起来。
 */
export const QUEST_COUNT = 200;
export const QUEST_REC_BYTES = 584;
const ACT_OFF = 0x26;
const ACT_SIZE = 18;
const ACT_CLASSES = 16;

export interface QuestEntry {
  index: number;
  npc: number;
  name: string;
  /** 每个职业段（1..16）的「开始对话号」，通常只有第一条有效 */
  dialogs: number[];
  /**
   * 每个职业段的四段对话（`quest.bmd` 职业段 +10 / +12 / +14 / +16，
   * 也就是 `short[5..8]`）。对应原版 `CSQuest::CheckQuestState` 的四个分支：
   *
   *   [0] 开始（state 0/3，`FindQuestContext(act, 0)`）
   *   [1] 进行中、东西还没齐（state 1 且 `FindQuestItemsInInven` 返回非 0，
   *       `FindQuestContext(act, 1)`）—— 文案是「你去找 X 吧」
   *   [2] 东西齐了、可以交了（state 1 且返回 0，`FindQuestContext(act, 2)`）
   *       —— 文案是「你真的找到了 X」
   *   [3] 完成（state 2，`FindQuestContext(act, 3)`）
   *
   * **[1] 和 [2] 很容易搞反**，实测文案能直接看出来：
   *   任务 0 的 texts = `52 / 54 / 55 / 56`
   *     54 =「去找回『帝王之书』吧」  → 没交东西时说的
   *     55 =「您真的找回了『帝王之书』」→ 拿到之后说的
   *   任务 1 的 texts = `60 / 61 / 62 / 72`
   *     61 =「找到『断魂之剑』就回来找我吧」
   *     62 =「您真的找到了『断魂之剑』」
   *   源码里 `CheckActCondition` 在**物品没齐**的分支才 `FindQuestContext(act, 1)`，
   *   齐了反而返回 0 让 `CheckQuestState` 走 `(act, 2)` —— 所以 [1] = 没齐。
   */
  texts: Array<[number, number, number, number]>;
  /**
   * 每个职业段的**任务物品条件**（`quest.bmd` 职业段 +2 / +3 / +4）：
   *
   * ```c
   * // CSQuest::CheckActCondition（Scene_CharSelect_Nav.cpp:103）
   * CSQuest_FindQuestItemsInInven((uint)pbVar4[1] + (uint)*pbVar4 * 0x20,
   *                               (uint)pbVar4[2], 0xffffffff);
   * //                              ↑ 物品 Type          ↑ 需要数量
   * ```
   *
   * 也就是说 **物品 Type = (段+2) << 5 | (段+3)**，数量在 段+4。
   * 实测：任务 0「寻找帝王之书」→ `14<<5|23 = 471` = `帝王之书`；
   * 任务 1「三种宝物」→ 472 `断魂之剑` / 473 `精灵之泪` / 474 `先知之魂`。
   *
   * 没有条件的段（数量为 0）存 `null`。
   */
  items: Array<{ type: number; count: number } | null>;
}

let quests: QuestEntry[] | null = null;

export async function loadQuests(): Promise<QuestEntry[]> {
  if (quests) return quests;
  try {
    const { bytes } = await fetchLocal('quest.bmd');
    const recs = Math.min(QUEST_COUNT, Math.floor(bytes.length / QUEST_REC_BYTES));
    const out: QuestEntry[] = [];
    for (let i = 0; i < recs; i++) {
      const rec = xorDecode(bytes.subarray(i * QUEST_REC_BYTES, (i + 1) * QUEST_REC_BYTES));
      const npc = rec[4];
      const name = cstr(rec, 5, 32);
      const dialogs: number[] = [];
      const texts: Array<[number, number, number, number]> = [];
      const items: Array<{ type: number; count: number } | null> = [];
      for (let j = 0; j < ACT_CLASSES; j++) {
        const o = ACT_OFF + j * ACT_SIZE;
        if (o + ACT_SIZE > rec.length) break;
        // 四段对话连在一起：+10 开始 / +12 可交 / +14 进行中 / +16 完成
        const w = (k: number) => rec[o + k] | (rec[o + k + 1] << 8);
        dialogs.push(w(10));
        texts.push([w(10), w(12), w(14), w(16)]);
        // 物品条件：Type = (+2)<<5 | (+3)，数量在 +4（见接口注释）
        const count = rec[o + 4];
        const type = (rec[o + 2] << 5) | (rec[o + 3] & 0x1f);
        items.push(count > 0 && type > 0 ? { type, count } : null);
      }
      out.push({ index: i, npc, name, dialogs, texts, items });
    }
    quests = out;
  } catch (err) {
    console.warn('[localText] quest.bmd 读取失败', err);
    quests = [];
  }
  return quests;
}

/**
 * 某个 NPC（按 Class）接的任务 → 第一句对话号。
 * 没有对应任务返回 -1（调用方退回到通用招呼）。
 */
export async function questDialogForNpc(npcClass: number): Promise<number> {
  const info = await questForNpc(npcClass);
  return info ? info.dialog : -1;
}

/** 一条任务对话的完整信息（`texts` 是四段：开始/可交/进行中/完成） */
export interface QuestDialogInfo {
  index: number;
  name: string;
  /** 开场对话号（= texts[0]，兼容旧调用） */
  dialog: number;
  texts: [number, number, number, number];
  /** 这一段的物品条件（见 `QuestEntry.items`）；没条件就是 null */
  items: { type: number; count: number } | null;
  /** 用的是第几个职业段（0..15，调试/日志用） */
  act: number;
}

/**
 * 挑「这个角色对应哪一段」。
 *
 * `quest.bmd` 每个任务有最多 16 个职业段，`CSQuest::CheckActCondition` 里
 * `byte[this+4]`（当前职业）参与索引 —— 同一句话，剑士/魔法师/精灵的文案不同，
 * 要的东西也不同（任务 1 三段分别是 60/64/67 号对话）。
 *
 * 没有对应段（`dialogs[cls]` 为空）就退回第一个有对话的段，和以前的行为一致。
 */
function pickAct(q: QuestEntry, cls: number): number {
  if (cls >= 0 && cls < q.dialogs.length) {
    const d = q.dialogs[cls];
    if (d > 0 && d < 200) return cls;
  }
  return q.dialogs.findIndex(v => v > 0 && v < 200);
}

function infoOf(q: QuestEntry, cls: number): QuestDialogInfo | null {
  const j = pickAct(q, cls);
  if (j < 0) return null;
  const texts = q.texts[j];
  return {
    index: q.index,
    name: q.name,
    dialog: texts[0],
    texts,
    items: q.items[j] ?? null,
    act: j,
  };
}

/** 同上的完整信息：任务号 + 任务名 + 开场对话号（接任务发包要用任务号） */
export async function questForNpc(npcClass: number, cls = -1): Promise<QuestDialogInfo | null> {
  const all = await loadQuests();
  for (const q of all) {
    if (q.npc !== npcClass) continue;
    const info = infoOf(q, cls);
    if (info) return info;
  }
  return null;
}

/** 按任务号取（0xA1/0xA2 回执里只有任务号，没有 NPC） */
export async function questByIndex(index: number, cls = -1): Promise<QuestDialogInfo | null> {
  const all = await loadQuests();
  const q = all.find(e => e.index === index);
  if (!q) return null;
  return infoOf(q, cls);
}

/**
 * 任务状态 → 该显示哪条对话（原版 `CSQuest::CheckQuestState` 0x401730）。
 *
 * ```c
 * if (state == 1) {
 *     if ((char)CSQuest_CheckActCondition(this, rec) != 0)   // 齐了 / 没有物品条件
 *         FindQuestContext(this, rec, 2);                    // → 「你真的找到了 X」
 *     // 没齐时 CheckActCondition 自己已经设成 1 了         // → 「你去找 X 吧」
 * } else if (state == 2) FindQuestContext(this, rec, 3);
 * ```
 *
 * | 状态 | 含义 | 原版分支 | 文本 |
 * |---|---|---|---|
 * | 0 / 3 | 未接 / 已取消 | `FindQuestContext(act, 0)` | texts[0] |
 * | 1 | 进行中、东西**没齐** | `CheckActCondition` 里 `(act, 1)` | texts[1] |
 * | 1 | 进行中、东西**齐了** | 返回 0 → `(act, 2)` | texts[2] |
 * | 2 | 已完成 | `FindQuestContext(act, 3)` | texts[3] |
 *
 * `hasItems` 由调用方扫背包得出（`main.ts::questItemsSatisfied`，
 * 对应原版 `CSQuest_FindQuestItemsInInven`）。没有物品条件的任务传 false
 * 更安全：会停在「你去找 X 吧」，而不是骗玩家说已经拿到了。
 */
export function questTextFor(info: QuestDialogInfo, state: number, hasItems = false): number {
  const pick = (k: number) => (info.texts[k] > 0 && info.texts[k] < 200 ? info.texts[k] : info.dialog);
  if (state === 2) return pick(3);
  if (state === 1) return hasItems ? pick(2) : pick(1);
  return pick(0);
}

/* ------------------------------------------------------------------ */
/* NPCName.txt —— 怪物 / NPC 的中文名牌                                 */
/* ------------------------------------------------------------------ */
/**
 * `Data/Local/NPCName.txt` 是**唯一没加密**的文本表（明文 GBK）。
 *
 * 原版读取函数：`Item/NPC_Data.cpp::NPCName_LoadTextData`（IDA `FUN_0047D120`，
 * 调用点 `Scene_AssetLoad.cpp:152`）。它不是「NPC 专用」——**怪物也用这张表**：
 * `Monster.cpp:1396` 的 `CreateMonster` 里 `getMonsterName(Type)` 取名字写进
 * `c+0x1c1`，也就是鼠标悬停时显示的那个名字。所以中文客户端里「骷灵战士」
 * 这种名字来自这里，而不是服务端的 `Monster.txt`（那份是英文）。
 *
 * 文件格式（一行一条，`//` 是注释，空行跳过，遇到 `end` 结束）：
 *
 * ```text
 *  84 1 "假面武士"
 * 235 1 "圣导士塞维娜"
 * end
 * ```
 *
 * 三列 = `Type` / `Idx` / `Name`，第二列原版直接 `TextParser_GetToken()` 跳过
 * （对照 `NPCName_LoadTextData` 里连续三次 GetToken 的写法）。名字带引号，
 * 可能是空串（`234 ""`）——空串当「没有名字」，调用方继续回退。
 */
export async function loadNpcNames(): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  let bytes: Uint8Array;
  try {
    bytes = (await fetchLocal('NPCName.txt')).bytes;
  } catch (err) {
    console.warn('[localText] NPCName.txt 读取失败', err);
    return out;
  }
  // 文件不大（几 KB），整块解 GBK 即可，不用按字节切片
  const text = decodeAnsi(bytes);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('//')) continue;
    if (line.toLowerCase() === 'end') break;
    // 列：Type  Idx  "Name"（名字里的空格原样保留）
    const m = /^(\d+)\s+\d+\s+"(.*)"\s*$/.exec(line);
    if (!m) continue;
    const type = Number(m[1]);
    const name = m[2].trim();
    if (!name) continue; // 空名字：保留调用方的回退
    if (!out.has(type)) out.set(type, name);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* item.bmd —— 物品表                                                  */
/* ------------------------------------------------------------------ */

/**
 * `item.bmd` = 512 条 × 64 字节，**数据从 offset 0 开始**，文件末尾多 4 字节。
 *
 * 结构来源 `Tools_Source/kayitoTools` 的 `ItemManager.cs`（注释里列了完整字段表）
 * 与 `ItemEditor.cs:722` 的读法：
 *
 *     if (buffer.Length != MAX_ITEM * ITEM_BMD_SIZE + 4) → 报错
 *     Array.Copy(buffer, i * ITEM_BMD_SIZE, ...)        → 从 0 起，不跳头
 *
 * 踩过的坑：看到 `512*64 + 4` 就想当然按「4 字节头 + 数据」去切，
 * 结果第一条名字恰好对（`Kris` 就在 offset 0），从第二条起全错位一格。
 * 那 4 字节在**文件末尾**，不是开头。
 *
 * 字段（`pragma pack 4`，小端）：
 *
 *     +00 char[30] Name           +44 WORD RequireStrength   +56..59 RequireDW/DK/ELF/MG
 *     +30 BYTE TwoHand            +46 WORD RequireAgility    +60..63 抗冰/毒/雷/火
 *     +31 BYTE Level              +48 BYTE RequireEnergy
 *     +32 BYTE Width              +49 BYTE RequireLevel
 *     +33 BYTE Height             +50 BYTE Value
 *     +34 BYTE DamageMin          +51 BYTE fill
 *     +35 BYTE DamageMax          +52 DWORD Money
 *     +36 BYTE DefenseRate
 *     +37 BYTE Defense
 *     +38 BYTE MagicDefense
 *     +39 BYTE AttackSpeed
 *     +40 BYTE WalkSpeed
 *     +41 BYTE Durability
 *     +42 BYTE MagicDurability
 *     +43 BYTE MagicPower
 */
export const ITEM_ROWS = 512;
export const ITEM_REC_BYTES = 64;

export interface ItemRecord {
  type: number;
  name: string;
  twoHand: number;
  level: number;
  w: number;
  h: number;
  dmgMin: number;
  dmgMax: number;
  defRate: number;
  def: number;
  magicDef: number;
  attackSpeed: number;
  walkSpeed: number;
  durability: number;
  magicDurability: number;
  magicPower: number;
  reqStrength: number;
  reqAgility: number;
  reqEnergy: number;
  reqLevel: number;
  value: number;
  money: number;
  /** [DW, DK, ELF, MG] 能不能装 */
  reqClass: number[];
  /** [冰, 毒, 雷, 火] */
  resist: number[];
}

function parseItemRecord(d: Uint8Array, off: number, type: number): ItemRecord {
  const u8 = (p: number) => d[off + p] ?? 0;
  const u16 = (p: number) => (d[off + p] ?? 0) | ((d[off + p + 1] ?? 0) << 8);
  const u32 = (p: number) =>
    ((d[off + p] ?? 0) | ((d[off + p + 1] ?? 0) << 8) | ((d[off + p + 2] ?? 0) << 16) |
      ((d[off + p + 3] ?? 0) << 24)) >>> 0;
  return {
    type,
    name: cstr(d, off, 30),
    twoHand: u8(30),
    level: u8(31),
    w: u8(32),
    h: u8(33),
    dmgMin: u8(34),
    dmgMax: u8(35),
    defRate: u8(36),
    def: u8(37),
    magicDef: u8(38),
    attackSpeed: u8(39),
    walkSpeed: u8(40),
    durability: u8(41),
    magicDurability: u8(42),
    magicPower: u8(43),
    reqStrength: u16(44),
    reqAgility: u16(46),
    reqEnergy: u8(48),
    reqLevel: u8(49),
    value: u8(50),
    money: u32(52),
    reqClass: [u8(56), u8(57), u8(58), u8(59)],
    resist: [u8(60), u8(61), u8(62), u8(63)],
  };
}

let itemTable: ItemRecord[] | null = null;

/**
 * 读整张物品表。原版 `ItemAttribute[type]` 就是这张表（`Item/Item_Data.cpp`），
 * 攻击/防御/需求力敏/耐久全在里面 —— 比从 `Item.txt` 正则抠出来的
 * `itemAttrs.ts` 权威，后者只是 UI 层的中文名 + 尺寸缓存。
 */
export async function loadItemTable(): Promise<ItemRecord[]> {
  if (itemTable) return itemTable;
  try {
    const { bytes: raw } = await fetchLocal('item.bmd');
    // 每条记录各自从 key[0] 开始（ItemEditor.cs 对每条单独调 BuxConvert）
    const dec = xorDecode(raw.subarray(0, ITEM_ROWS * ITEM_REC_BYTES), ITEM_REC_BYTES);
    const rows: ItemRecord[] = [];
    for (let i = 0; i < ITEM_ROWS; i++) {
      rows.push(parseItemRecord(dec, i * ITEM_REC_BYTES, i));
    }
    itemTable = rows;
  } catch (err) {
    console.warn('[localText] item.bmd 读取失败，物品数值回退到 itemAttrs', err);
    itemTable = [];
  }
  return itemTable;
}

/**
 * 物品类型 → 名字。`itemAttrs.ts` 里的中文名是从 `Item.txt` 生成的，
 * 这层是给「要显示英文原名」的地方用的。
 */
export class ItemNames {
  constructor(readonly names: string[]) {}
  get(type: number): string {
    return this.names[type] ?? '';
  }
}

/** 已加载的中文物品名（`chs/item.bmd`），未加载时返回空串 */
export function itemNameSync(type: number): string {
  return itemNames ? itemNames.get(type) : '';
}

let itemNames: ItemNames | null = null;

/**
 * 同步读一件物品的 `RequireClass[4]`（`item.bmd` 偏移 +56，值 0/1/2）。
 *
 * 0 = 该职业不能装；1 = 一转职业可以；2 = 二转职业（魔导师/骑士/圣射手）才可以。
 * `RenderItemInfo.cpp:1385` 就是拿这 4 个字节拼「%s 可以使用」那几行的。
 *
 * 表是异步加载的（`loadItemTable()`，`playerAnim.ts` 启动时就会触发），
 * 没读完时返回 `null`，调用方退回 `itemAttrs.ts` 的 `clsMask`。
 */
export function itemReqClassSync(type: number): number[] | null {
  const t = itemTable;
  if (!t || !t[type]) return null;
  const req = t[type].reqClass;
  return req && req.length === 4 ? req : null;
}

/** 名字表装了多少条（0 = 还没读完） */
export function itemNamesSize(): number {
  return itemNames ? itemNames.names.length : 0;
}

export async function loadItemNames(): Promise<ItemNames> {
  if (itemNames) return itemNames;
  const table = await loadItemTable();
  itemNames = new ItemNames(table.map(r => r.name));
  return itemNames;
}
