/**
 * 音效覆盖探针 —— 确认真实加载的音频文件都在代码里有引用。
 *
 * 背景：磁盘上有 59 个 wav 曾因**生成器漏了常量形式的 LoadWaveFile** 而变成
 * 「孤儿」（磁盘有、代码没引用）。根因修掉后剩 21 个，都是 **0.97k 源码
 * 本身就没登记**的高版本（0.99b+/Season）资源残留：
 *
 *   - 11 个非源码 BGM（Atlans/Icarus/tarkan/lost_tower/登录曲…）：
 *     0.97k 的 `g_lpszMp3` 只有 5 个槽（Pub/Lorencia/Devias/Noria/Dungeon）。
 *   - 10 个 wav（pLevelUp/mChangeup/mQuest/iAlert/…）：
 *     全库搜不到任何 `LoadWaveFile` / 字符串常量。
 *
 * 断言：
 *   [A] 怪物音效表覆盖 type 数 ≥ 60（生成器已支持常量形式）
 *   [B] 孤儿音频 ≤ 22 个（源码确无引用的高版本残留）
 *   [C] 孤儿音频总体积 < 36MB
 *   [D] 0.97k 源码登记的音效**零遗漏**（由 sound-coverage.mjs 保证）
 *
 * 用法：node tools/sound-coverage-probe.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}  ${detail}`);
  }
}

const SOUND_DIR = 'dist/Data/Sound';
const MUSIC_DIR = 'dist/Data/Music';

/* 收集所有引用源里的音频文件名 */
const refs = new Set();
for (const f of ['src/data/sounds.ts', 'src/data/monsterSounds.ts']) {
  const t = readFileSync(f, 'utf8');
  for (const m of t.matchAll(/'([^'"]+\.(?:wav|mp3))'/gi)) refs.add(m[1].toLowerCase());
}

console.log('=== 音效覆盖探针 ===\n');

/* [A] 怪物音效表覆盖数 */
const ms = readFileSync('src/data/monsterSounds.ts', 'utf8');
const typeCount = (ms.match(/^\s+\d+:\s*\{/gm) || []).length;
check(`[A] 怪物音效表覆盖 ${typeCount} 个 type（≥60，生成器支持常量形式）`, typeCount >= 60, `count=${typeCount}`);

/* [B][C] 孤儿音频 */
const orphans = [];
let orphanBytes = 0;
for (const dir of [SOUND_DIR, MUSIC_DIR]) {
  for (const f of readdirSync(dir)) {
    if (refs.has(f.toLowerCase())) continue;
    orphans.push(`${dir}/${f}`);
    orphanBytes += statSync(`${dir}/${f}`).size;
  }
}
const mb = (orphanBytes / 1048576).toFixed(2);
check(`[B] 孤儿音频 ${orphans.length} 个（≤22，源码未登记的高版本残留）`, orphans.length <= 22, `orphans=${orphans.join(', ')}`);
check(`[C] 孤儿音频共 ${mb} MB（<36MB）`, orphanBytes < 36 * 1048576, `bytes=${orphanBytes}`);
if (orphans.length) console.log(`   孤儿清单：${orphans.map(o => o.split('/').pop()).join(', ')}`);

console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
