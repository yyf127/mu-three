/**
 * 从服务端 `Data/Move/Move.txt` + `Gate.txt` 生成 `src/data/warpTable.generated.ts`。
 *
 * 这两张是**服务端**的表，客户端只是抄一份快照当默认值：
 *
 *   Move.txt  //Index Name Money MinLvl MaxLvl MinRes MaxRes AccLvl Gate
 *   Gate.txt  //Index Flag Map X Y TX TY Target Dir MinLvl MaxLvl MinRes MaxRes AccountLvl
 *
 * Move.txt 的 `Gate` 列指向 Gate.txt 的 Index，落点就是那个门的矩形
 * `(X,Y)..(TX,TY)` —— 服务端 `CGate::GetGateMapNumber` / `MapServerMng` 就是这么取落点的
 * （在矩形里随机挑一格），所以客户端不需要再自己猜「安全区中心」。
 *
 * 运行期真正用的是 `src/world/warp.ts`：它既能吃这份快照，也能吃服务端下发的原文
 * （`applyWarpTable` / `setWarpTableLoader`），所以表更新了只要重跑本脚本即可。
 *
 * 用法：node tools/gen-warp-table.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MOVE_SRC = resolve(ROOT, '../MuServer/Data/Move/Move.txt');
const GATE_SRC = resolve(ROOT, '../MuServer/Data/Move/Gate.txt');
const OUT = join(ROOT, 'src/data/warpTable.generated.ts');

/** `*` = 不限制，统一折算成 0 */
function num(v, dflt = 0) {
  const s = String(v ?? '').trim();
  if (!s || s === '*') return dflt;
  const n = Number(s);
  return Number.isFinite(n) ? n : dflt;
}

function unquote(s) {
  return String(s ?? '')
    .trim()
    .replace(/^"(.*)"$/, '$1');
}

/**
 * 按 tab 切，但允许 Name 后面那串**对齐用的空 tab**。
 * 只丢掉「名字之后」的空字段，中间的 `*` 不会被误删（`*` 不是空串）。
 */
function fields(line) {
  const parts = line.split('\t');
  return [parts[0] ?? '', parts[1] ?? '', ...parts.slice(2).map(s => s.trim()).filter(Boolean)];
}

function readLines(path) {
  return readFileSync(path, 'latin1').split(/\r?\n/);
}

/* ---------------- Move.txt ---------------- */
const moves = [];
for (const raw of readLines(MOVE_SRC)) {
  const line = raw.trim();
  if (!line || line.startsWith('//')) continue;
  if (/^end$/i.test(line)) break;
  const f = fields(line);
  const index = num(f[0], -1);
  if (index <= 0) continue;
  moves.push({
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

/* ---------------- Gate.txt ---------------- */
const gates = [];
for (const raw of readLines(GATE_SRC)) {
  const line = raw.trim();
  if (!line || line.startsWith('//')) continue;
  if (/^end$/i.test(line)) break;
  const f = fields(line);
  const index = num(f[0], -1);
  if (index <= 0) continue;
  gates.push({
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

/* ---------------- 交叉校验 ---------------- */
const gateIndex = new Set(gates.map(g => g.index));
const orphans = moves.filter(m => !gateIndex.has(m.gate));
const used = new Set(moves.map(m => m.gate));
const unusedGates = gates.filter(g => !used.has(g.index));

const q = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const moveLines = moves.map(
  m =>
    `  { index: ${m.index}, name: ${q(m.name)}, money: ${m.money}, ` +
    `minLevel: ${m.minLevel}, maxLevel: ${m.maxLevel}, minReset: ${m.minReset}, maxReset: ${m.maxReset}, ` +
    `accLevel: ${m.accLevel}, gate: ${m.gate} },`
);
const gateLines = gates.map(
  g =>
    `  { index: ${g.index}, flag: ${g.flag}, map: ${g.map}, x1: ${g.x1}, y1: ${g.y1}, x2: ${g.x2}, y2: ${g.y2}, ` +
    `target: ${g.target}, dir: ${g.dir}, minLevel: ${g.minLevel}, maxLevel: ${g.maxLevel}, ` +
    `minReset: ${g.minReset}, maxReset: ${g.maxReset}, accLevel: ${g.accLevel} },`
);

const out = `/* 本文件由 tools/gen-warp-table.mjs 生成，勿手改。
 * 数据源：MuServer/Data/Move/Move.txt（${moves.length} 条）
 *         MuServer/Data/Move/Gate.txt（${gates.length} 条）
 *
 * 这两张表**归服务端所有**，客户端这里只是「没有服务端时的默认快照」。
 * 服务端同步走 \`src/world/warp.ts\` 的 applyWarpTable / setWarpTableLoader，
 * 同步成功后本文件的内容会被整表替换（不会改这里）。
 *
 * 字段说明见 src/world/warp.ts 的 MoveRecord / GateRecord。
 */
import type { MoveRecord, GateRecord } from '../world/warp';

/** Move.txt：Index Name Money MinLvl MaxLvl MinRes MaxRes AccLvl Gate */
export const MOVE_ROWS: MoveRecord[] = [
${moveLines.join('\n')}
];

/** Gate.txt：Index Flag Map X Y TX TY Target Dir MinLvl MaxLvl MinRes MaxRes AccountLvl */
export const GATE_ROWS: GateRecord[] = [
${gateLines.join('\n')}
];

export const WARP_TABLE_INFO = {
  moveFile: 'MuServer/Data/Move/Move.txt',
  gateFile: 'MuServer/Data/Move/Gate.txt',
  moves: ${moves.length},
  gates: ${gates.length},
} as const;
`;

writeFileSync(OUT, out, 'utf8');

console.log(`Move.txt: ${moves.length} 条`);
console.log(`Gate.txt: ${gates.length} 条`);
if (orphans.length) {
  console.log(`⚠ Move 引用了不存在的 Gate:`, orphans.map(m => `${m.name}#${m.gate}`).join(', '));
}
console.log(`未被 Move 引用的 Gate: ${unusedGates.length} 条（普通出入口，正常）`);
console.log(`写出 ${OUT}`);
