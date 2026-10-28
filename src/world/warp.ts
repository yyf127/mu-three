/**
 * 移动命令的数据层：服务端 `Data/Move/Move.txt` + `Gate.txt`。
 *
 * 两张表的关系（服务端 `MapServerMng::LoadMove` / `CGate::Load`）：
 *
 *   Move.txt   //Index Name Money MinLvl MaxLvl MinRes MaxRes AccLvl Gate
 *   Gate.txt   //Index Flag Map X Y TX TY Target Dir MinLvl MaxLvl MinRes MaxRes AccountLvl
 *
 *   `Move.Gate` → `Gate.Index`；地图号取 `Gate.Map`，落点取 `Gate` 的矩形
 *   `(X,Y)..(TX,TY)`（服务端在这个矩形里随机挑一格，不是挑中心）。
 *
 * 这就是为什么以前「按安全区重心猜落点」在冰风谷会把人扔到城外：
 * 真正的落点一直写在 Gate.txt 里，只是客户端拿不到。现在拿到表了，
 * 就走 `findSpawnTileInRect` 严格按矩形挑，猜的那套只当兜底。
 *
 * ## 为什么要留一层「数据源」
 *
 * 这两张表**归服务端**（改一次全服生效），客户端不能写死在代码里。
 * 所以这里把「表」和「从哪来」分开：
 *
 *   - `MOVE_ROWS` / `GATE_ROWS`（`data/warpTable.generated.ts`）是编译期快照，
 *     服务端没接上之前就用它（离线演示、单机调试）。
 *   - 服务端能下发之后，注册一个 `WarpTableLoader` 调 `syncWarpTable()`，
 *     或者直接把原文丢给 `applyWarpTable()`，整表替换 + 通知窗口重画。
 *     **不用改窗口代码**，`movePanel` 订阅了 `warpTable.onChange`。
 *
 * 以后接 0.97 的协议时，`MapSvrMoveReq`（客户端→服务端 `0xC1/0xB0`）只需要
 * `entry.index`，也就是 Move.txt 的 Index —— 所以 `WarpEntry` 把它原样留着。
 */

import { GATE_ROWS, MOVE_ROWS, WARP_TABLE_INFO } from '../data/warpTable.generated';
import type { SpawnRect } from './terrain';

/* ------------------------------------------------------------------ */
/* 原始表结构                                                          */
/* ------------------------------------------------------------------ */

/** `Move.txt` 一行。`*`（不限制）在解析时折算成 0。 */
export interface MoveRecord {
  /** 服务端 `MapSvrMoveReq` 里的 iMoveNum */
  index: number;
  /** 英文名（Stadium / Devias2 …），中文显示名见 `AREA_NAMES` */
  name: string;
  /** 传送费（Zen） */
  money: number;
  minLevel: number;
  maxLevel: number;
  minReset: number;
  maxReset: number;
  accLevel: number;
  /** 指向 Gate.txt 的 Index */
  gate: number;
}

/**
 * `Gate.txt` 一行。
 *
 * `flag`：0 = 普通传送点，1 = 入口（`target` 指向对面的出口门），
 * 2 = 出口。客户端只用 `map` + 矩形，flag 只作记录 —— 因为 Move.txt 有些
 * 条目直接引用 flag=2 的出口门（地下城、天空之城），照矩形用就对了。
 */
export interface GateRecord {
  index: number;
  flag: number;
  map: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  target: number;
  /** 落地朝向 0..7（和 `DIR_VECTORS` 一致，0 = 西北） */
  dir: number;
  minLevel: number;
  maxLevel: number;
  minReset: number;
  maxReset: number;
  accLevel: number;
}

/* ------------------------------------------------------------------ */
/* 给界面用的合并视图                                                  */
/* ------------------------------------------------------------------ */

export interface WarpEntry {
  /** Move.txt 的 Index（服务端要的就是这个数） */
  index: number;
  /** Move.txt 的英文名 */
  key: string;
  /** 窗口显示名 */
  name: string;
  mapId: number;
  money: number;
  minLevel: number;
  maxLevel: number;
  minReset: number;
  maxReset: number;
  accLevel: number;
  gate: number;
  /** 落点矩形；Gate 缺表时为 null（退回 `findSpawnTile` 自己挑） */
  spawn: SpawnRect | null;
  /** 落地朝向 0..7 */
  dir: number;
  /** 纷争区（可自由 PK） */
  conflict: boolean;
  /** 必须装备翅膀（天空之城） */
  needWings: boolean;
  /**
   * 服务端 `F3/E5` 下发的「这一级到底能不能去」（`MOVE_LIST_INFO.CanMove`）。
   *
   * `CMove::GCMoveListSend` 里每个条目都 `info.CanMove = true` 先置真，
   * 只对**过滤掉**的条目才是 false —— 服务端用 `gGate.GetMoveLevel(lpObj, ...)`
   * 按角色等级/VIP 重算过门槛，比本地 `Move.txt` 那份准。
   * `undefined` = 还没收到表（用本地的等级判断）。
   */
  canMove?: boolean;
}

/** Move.txt 的英文名 → 中文显示名（中文客户端的叫法） */
const AREA_NAMES: Record<string, string> = {
  Stadium: '足球场',
  Lorencia: '勇者大陆',
  Noria: '仙踪林',
  Devias: '冰风谷',
  Devias2: '冰风谷2',
  Devias3: '冰风谷3',
  Devias4: '冰风谷4',
  Dungeon: '地下城1',
  Dungeon2: '地下城2',
  Dungeon3: '地下城3',
  Atlans: '亚特兰蒂斯',
  Atlans2: '亚特兰蒂斯2',
  Atlans3: '亚特兰蒂斯3',
  LostTower: '失落之塔1',
  LostTower2: '失落之塔2',
  LostTower3: '失落之塔3',
  LostTower4: '失落之塔4',
  LostTower5: '失落之塔5',
  LostTower6: '失落之塔6',
  LostTower7: '失落之塔7',
  Tarkan: '死亡沙漠',
  Tarkan2: '死亡沙漠2',
  Icarus: '天空之城',
};

/**
 * 纷争区。Move.txt 没有这一列，按地图性质补：足球场本来就是竞技场，
 * 亚特兰蒂斯 / 死亡沙漠 / 天空之城是自由 PK 区。
 */
const CONFLICT_MAPS = new Set([6, 7, 8, 10]);

/** 必须装备翅膀才能进的地图（原版进天空之城会被风刮下来，服务端也校验） */
const NEED_WINGS_MAPS = new Set([10]);

function displayName(key: string, mapId: number) {
  const hit = AREA_NAMES[key];
  if (hit) return hit;
  // 表里出现没登记过的名字：直接用英文 + 地图号，至少能看出来是哪个
  return `${key || '可移动'}·${mapId}`;
}

/* ------------------------------------------------------------------ */
/* 解析（服务端同步时同样走这两个函数）                                */
/* ------------------------------------------------------------------ */

/** `*` / 空 → 0；非法数字 → 默认值 */
function num(v: string | undefined, dflt = 0) {
  const s = String(v ?? '').trim();
  if (!s || s === '*') return dflt;
  const n = Number(s);
  return Number.isFinite(n) ? n : dflt;
}

function unquote(s: string | undefined) {
  return String(s ?? '')
    .trim()
    .replace(/^"(.*)"$/, '$1');
}

/**
 * 按 tab 切列，同时容忍 `Name` 后面那串**对齐用的空 tab**
 * （`1\t"Stadium"\t\t3000\t…`）。只丢掉名字之后紧跟的空字段，
 * 中间的 `*` 不受影响（`*` 不是空串）。
 */
function splitFields(line: string): string[] {
  const parts = line.split('\t');
  return [parts[0] ?? '', parts[1] ?? '', ...parts.slice(2).map(s => s.trim()).filter(Boolean)];
}

function* dataLines(text: string) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (/^end$/i.test(line)) return;
    yield line;
  }
}

export function parseMoveText(text: string): MoveRecord[] {
  const out: MoveRecord[] = [];
  for (const line of dataLines(text)) {
    const f = splitFields(line);
    const index = num(f[0], -1);
    if (index <= 0) continue;
    out.push({
      index,
      name: unquote(f[1]),
      money: num(f[2]),
      minLevel: num(f[3]),
      maxLevel: num(f[4]),
      minReset: num(f[5]),
      maxReset: num(f[6]),
      accLevel: num(f[7]),
      gate: num(f[8]),
    });
  }
  return out;
}

export function parseGateText(text: string): GateRecord[] {
  const out: GateRecord[] = [];
  for (const line of dataLines(text)) {
    const f = splitFields(line);
    const index = num(f[0], -1);
    if (index <= 0) continue;
    out.push({
      index,
      flag: num(f[1]),
      map: num(f[2], -1),
      x1: num(f[3]),
      y1: num(f[4]),
      x2: num(f[5]),
      y2: num(f[6]),
      target: num(f[7]),
      dir: num(f[8]),
      minLevel: num(f[9]),
      maxLevel: num(f[10]),
      minReset: num(f[11]),
      maxReset: num(f[12]),
      accLevel: num(f[13]),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 表                                                                  */
/* ------------------------------------------------------------------ */

export type WarpTableSource = 'builtin' | 'server';

export interface WarpTableSnapshot {
  source: WarpTableSource;
  moveFile: string;
  gateFile: string;
  moves: number;
  gates: number;
  /** 合并出来的可传送条目 */
  entries: number;
  /** Move 引用了但在 Gate 里找不到的条数 */
  orphans: number;
}

export class WarpTable {
  moves: MoveRecord[] = [];
  gates = new Map<number, GateRecord>();
  entries: WarpEntry[] = [];
  source: WarpTableSource = 'builtin';
  /** 上次整表替换的时间戳（服务端同步用来判断新旧） */
  updatedAt = 0;
  orphans = 0;

  private listeners = new Set<() => void>();

  /** 整表替换（解析结果已经是结构化的） */
  load(moves: MoveRecord[], gates: GateRecord[], source: WarpTableSource) {
    this.moves = moves.slice();
    this.gates = new Map(gates.map(g => [g.index, g]));
    this.orphans = 0;
    this.entries = [];
    for (const m of this.moves) {
      const g = this.gates.get(m.gate);
      if (!g || g.map < 0) {
        // 门号对不上就没法知道去哪张图，只能丢 —— 计入 orphans，窗口里不显示
        this.orphans++;
        continue;
      }
      this.entries.push({
        index: m.index,
        key: m.name,
        name: displayName(m.name, g.map),
        mapId: g.map,
        money: m.money,
        minLevel: m.minLevel,
        maxLevel: m.maxLevel,
        minReset: m.minReset,
        maxReset: m.maxReset,
        accLevel: m.accLevel,
        gate: m.gate,
        spawn: { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2 },
        dir: g.dir,
        conflict: CONFLICT_MAPS.has(g.map),
        needWings: NEED_WINGS_MAPS.has(g.map),
      });
    }
    this.source = source;
    this.updatedAt = Date.now();
    for (const cb of this.listeners) cb();
  }

  /** 整表替换（服务端下发的原文，两张表都要） */
  applyText(moveText: string, gateText: string, source: WarpTableSource = 'server') {
    this.load(parseMoveText(moveText), parseGateText(gateText), source);
  }

  /** 手工通知一次（`applyServerMoveList` 改的是条目字段，不是整表） */
  notify() {
    this.updatedAt = Date.now();
    for (const cb of this.listeners) cb();
  }

  /** 窗口订阅：表变了就重画 */
  onChange(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  byIndex(index: number) {
    return this.entries.find(e => e.index === index) ?? null;
  }

  /** 同一张图可能有多个落点（冰风谷 1..4），取第一条 */
  byMap(mapId: number) {
    return this.entries.find(e => e.mapId === mapId) ?? null;
  }

  snapshot(): WarpTableSnapshot {
    return {
      source: this.source,
      moveFile: WARP_TABLE_INFO.moveFile,
      gateFile: WARP_TABLE_INFO.gateFile,
      moves: this.moves.length,
      gates: this.gates.size,
      entries: this.entries.length,
      orphans: this.orphans,
    };
  }
}

/**
 * 服务端 `F3/E5` 到达：把门槛/价格/能不能去覆盖到本地表上。
 *
 * 服务端只给 `MapName` + `MapNumber`，**没有 Index 也没有 Gate 落点矩形**，
 * 所以不能整表替换（那样会丢 `spawn`，`/move` 之后就不知道该站哪）。
 * 做法是拿英文名去匹配本地那 23 条，命中就覆盖四个门槛 + 价格 + `canMove`。
 *
 * 这一步的意义在于：`gGate.GetMoveLevel(lpObj, map, minLevel)` 会按角色的
 * VIP 账号等级调整门槛，本地 `Move.txt` 是「没算过」的原始值 —— 玩家明明
 * 能去，窗口却置灰（或者反过来），都出在这。
 */
export function applyServerMoveList(
  list: readonly { mapName: string; canMove: boolean; minLevel: number; maxLevel: number; minReset: number; maxReset: number; accountLevel: number; money: number }[]
): number {
  const byName = new Map(list.map(m => [m.mapName.trim().toLowerCase(), m]));
  let hit = 0;
  for (const e of warpTable.entries) {
    const srv = byName.get(e.key.toLowerCase());
    if (!srv) continue;
    e.minLevel = srv.minLevel;
    e.maxLevel = srv.maxLevel;
    e.minReset = srv.minReset;
    e.maxReset = srv.maxReset;
    e.accLevel = srv.accountLevel;
    e.money = srv.money;
    e.canMove = srv.canMove;
    hit++;
  }
  if (hit) warpTable.notify();
  return hit;
}

export const warpTable = new WarpTable();

// 启动时先吃编译期快照（服务端接上之后会被整表替换）
warpTable.load(MOVE_ROWS, GATE_ROWS, 'builtin');

/* ------------------------------------------------------------------ */
/* 服务端同步                                                          */
/* ------------------------------------------------------------------ */

export interface WarpTablePayload {
  /** Move.txt 原文（服务端原样下发即可，注释行会自动跳过） */
  moveText: string;
  gateText: string;
}

/**
 * 取表的方式。以后接服务端时换成「请求 → 等应答」的实现即可：
 *
 * ```ts
 * setWarpTableLoader(async () => {
 *   const res = await fetch('Data/Move/Move.txt');  // 或从网关/WS 取
 *   ...
 *   return { moveText, gateText };
 * });
 * await syncWarpTable();
 * ```
 *
 * 返回 null = 这次没有新表（服务端还没准备好 / 离线演示），保持现状。
 */
export type WarpTableLoader = () => Promise<WarpTablePayload | null>;

let loader: WarpTableLoader | null = null;

export function setWarpTableLoader(fn: WarpTableLoader | null) {
  loader = fn;
}

/** 拉一次表；成功整表替换并返回 true */
export async function syncWarpTable(): Promise<boolean> {
  if (!loader) return false;
  try {
    const payload = await loader();
    if (!payload) return false;
    // 空表当失败处理：宁可用旧快照，也不要让窗口变空
    if (parseMoveText(payload.moveText).length === 0) return false;
    warpTable.applyText(payload.moveText, payload.gateText, 'server');
    return true;
  } catch (err) {
    console.warn('[warp] 移动表同步失败，继续用本地快照', err);
    return false;
  }
}
