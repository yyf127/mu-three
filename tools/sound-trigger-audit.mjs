/**
 * 音效**触发点**核对 —— 找「表里登记了、但游戏里从没播」的音效。
 *
 * 与 `sound-coverage.mjs`（源码 ↔ 表）不同：这里查的是 **表 → 运行时触发**。
 * 用户要求「只做加载音频缺失的代码」，所以本脚本找出真正该补的触发点。
 *
 * 只读。
 * 用法：node tools/sound-trigger-audit.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/* ---------- 1. 收集表里的全部 id ---------- */
const soundsTs = readFileSync('src/data/sounds.ts', 'utf8');
const tableIds = new Set();
for (const m of soundsTs.matchAll(/id:\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*file:\s*'([^']+)'/g)) {
  const id = m[1].startsWith('0x') ? parseInt(m[1], 16) : parseInt(m[1], 10);
  tableIds.add(id);
}

/* ---------- 2. 收集运行时触发（扫描 src/ 下所有 ts，除表本身） ---------- */
const srcFiles = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.ts$/.test(e.name)) srcFiles.push(p);
  }
})('src');

const triggered = new Set();
/** 记录每个 id 的触发位置（便于人工核对） */
const where = new Map();

for (const f of srcFiles) {
  if (f.endsWith('data/sounds.ts')) continue;
  const t = readFileSync(f, 'utf8');
  // sfx(0x41) / sfx(65) / sfxRandom([0x28, 0x29]) / preloadSounds([...])
  for (const m of t.matchAll(/\bsfx(?:Random)?\s*\(\s*(0x[0-9a-fA-F]+|\d+)/g)) {
    const id = m[1].startsWith('0x') ? parseInt(m[1], 16) : parseInt(m[1], 10);
    triggered.add(id);
    if (!where.has(id)) where.set(id, f);
  }
  for (const m of t.matchAll(/\[\s*((?:0x[0-9a-fA-F]+|\d+)(?:\s*,\s*(?:0x[0-9a-fA-F]+|\d+))*)\s*\]/g)) {
    for (const n of m[1].split(',')) {
      const s = n.trim();
      const id = s.startsWith('0x') ? parseInt(s, 16) : parseInt(s, 10);
      if (Number.isFinite(id) && id > 0 && id < 0x200) {
        triggered.add(id);
        if (!where.has(id)) where.set(id, f);
      }
    }
  }
  // 对象形式的 id: 0x41
  for (const m of t.matchAll(/\bid:\s*(0x[0-9a-fA-F]+)/g)) {
    const id = parseInt(m[1], 16);
    triggered.add(id);
    if (!where.has(id)) where.set(id, f);
  }
}

/* ---------- 3. SKILL_SOUND 的值也算触发 ---------- */
for (const m of soundsTs.matchAll(/SKILL_SOUND[\s\S]*?\n\};/g)) {
  for (const v of m[0].matchAll(/:\s*(0x[0-9a-fA-F]+)/g)) triggered.add(parseInt(v[1], 16));
}
// 环境音/脚步/BGM 走别的 API，单独算
for (const m of soundsTs.matchAll(/AMBIENT_BY_MAP[\s\S]*?\n\};/g)) {
  for (const v of m[0].matchAll(/:\s*(0x[0-9a-fA-F]+)/g)) triggered.add(parseInt(v[1], 16));
}

/* ---------- 输出 ---------- */
const silent = [...tableIds].filter(id => !triggered.has(id)).sort((a, b) => a - b);

console.log('=== 音效触发点核对（只读）===\n');
console.log(`表内音效 id：${tableIds.size}`);
console.log(`检测到触发：${[...tableIds].filter(id => triggered.has(id)).length}`);
console.log(`\n【登记了但未见触发】（${silent.length} 个）—— 需核对是否漏接\n`);

for (const id of silent) {
  const hex = '0x' + id.toString(16).padStart(2, '0');
  // 找这个 id 对应的文件名
  const re = new RegExp(`id:\\s*(?:${hex}|${id})\\s*,\\s*file:\\s*'([^']+)'`);
  const fm = soundsTs.match(re);
  console.log(`  ${hex.padEnd(6)} ${fm ? fm[1] : '?'}`);
}

if (!silent.length) console.log('  （无 —— 全部音效都有触发点）');
