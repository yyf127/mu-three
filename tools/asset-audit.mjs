/**
 * 资源体检：找出 `dist/Data` 里**代码从未引用**的文件。
 *
 * 用于「只推送部署必需的资源」——先量化哪些是真冗余，再决定是否裁剪。
 * 只读，不删任何东西。输出分类报告。
 *
 * 用法：node tools/asset-audit.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const DATA = 'dist/Data';
/**
 * 音频引用源：**必须涵盖所有**会引用 `Data/Sound`、`Data/Music` 的表，
 * 漏一个就会把在用的文件误判成冗余。
 */
const SOUND_TS = 'src/data/sounds.ts';
const MONSTER_SOUNDS_TS = 'src/data/monsterSounds.ts';

function walk(dir, base = DATA, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}
const mb = n => (n / 1048576).toFixed(2) + ' MB';

/**
 * 汇总所有引用源里的音频文件名。
 * 除了 `file: 'x.wav'` / `'x.mp3'` 这类字面量，怪物音效表里是裸文件名数组
 * （`idle: ['mBull1.wav']`），所以直接扫「带 .wav/.mp3 后缀的字符串」。
 */
function collectAudioRefs() {
  const refs = new Set();
  for (const f of [SOUND_TS, MONSTER_SOUNDS_TS]) {
    if (!existsSync(f)) continue;
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/'([^'"]+\.(?:wav|mp3))'/gi)) refs.add(m[1].toLowerCase());
  }
  return refs;
}

const st = readFileSync(SOUND_TS, 'utf8');
const audioRefs = collectAudioRefs();

/* ---------- 1. Music ---------- */
const diskMusic = readdirSync(join(DATA, 'Music'));
const unusedMusic = diskMusic.filter(f => !audioRefs.has(f.toLowerCase()));
let muBytes = 0;
for (const f of unusedMusic) muBytes += statSync(join(DATA, 'Music', f)).size;

/* ---------- 2. Sound ---------- */
const diskSfx = readdirSync(join(DATA, 'Sound'));
const unusedSfx = diskSfx.filter(f => !audioRefs.has(f.toLowerCase()));
let suBytes = 0;
for (const f of unusedSfx) suBytes += statSync(join(DATA, 'Sound', f)).size;

/* ---------- 3. 索引覆盖情况（模型/贴图） ---------- */
const idxFiles = new Set();
for (const idxName of ['models-index.json', 'textures-index.json']) {
  const p = join(DATA, idxName);
  if (!existsSync(p)) continue;
  const m = JSON.parse(readFileSync(p, 'utf8'));
  for (const k in m) for (const v of m[k]) idxFiles.add(v.toLowerCase());
}
const all = walk(DATA);
const uncovered = all.filter(f => {
  const low = f.toLowerCase();
  if (low.startsWith('music/') || low.startsWith('sound/')) return false; // 音频单独算
  return !idxFiles.has(low);
});
const byDir = {};
let unconBytes = 0;
for (const f of uncovered) {
  const d = f.split('/')[0];
  const s = statSync(join(DATA, f)).size;
  byDir[d] = (byDir[d] || 0) + s;
  unconBytes += s;
}

/* ---------- 输出 ---------- */
console.log('=== dist/Data 资源体检（只读）===\n');
console.log(`资源文件总数：${all.length}`);

console.log('\n【Music】');
console.log(`  磁盘 ${diskMusic.length} 首 / 代码引用命中 ${diskMusic.length - unusedMusic.length} 首`);
console.log(`  未被引用：${unusedMusic.length} 首，共 ${mb(muBytes)}`);
if (unusedMusic.length) console.log(`  列表：${unusedMusic.join(', ')}`);

console.log('\n【Sound】');
console.log(`  磁盘 ${diskSfx.length} 个 / 代码引用命中 ${diskSfx.length - unusedSfx.length} 个`);
console.log(`  未被引用：${unusedSfx.length} 个，共 ${mb(suBytes)}`);
if (unusedSfx.length) console.log(`  样例：${unusedSfx.slice(0, 12).join(', ')}${unusedSfx.length > 12 ? ' …' : ''}`);

console.log('\n【模型/贴图（不含音频）】');
console.log(`  ⚠️ 下列「未被索引覆盖」多数**不是**冗余 —— World 下的 Terrain*.att /`);
console.log(`     EncTerrain*.map / TerrainHeight.OZB / Sky.bmp 走硬编码路径，是地形本体。`);
console.log(`  索引覆盖 ${idxFiles.size} 个；未被索引覆盖 ${uncovered.length} 个，共 ${mb(unconBytes)}`);
Object.entries(byDir)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .forEach(([d, s]) => console.log(`    ${d.padEnd(12)} ${mb(s)}`));

const totalUnused = muBytes + suBytes + unconBytes;
console.log(`\n=== 可裁剪候选合计：${mb(totalUnused)} ===`);
console.log('（注意：未引用 ≠ 一定可删；World 下的 .att/.obj 等可能被非索引路径引用，需逐个确认）');
