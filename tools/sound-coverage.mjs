/**
 * 音效接入覆盖核对 —— 对比 0.97k 源码 `LoadWaveFile` 表 vs mu-three `sounds.ts`。
 *
 * 目的：找出「源码登记了、但 mu-three 没接」的音效，据此补全使用代码
 * （用户要求：未使用的音频是尚未接入游戏，应照源码补全后再上传）。
 *
 * 只读。
 * 用法：node tools/sound-coverage.mjs
 */
import { readFileSync } from 'node:fs';

const CPP = '../Mu-97k-Client-Source-main/src/Model/Model_Gates.cpp';
const SCENE = '../Mu-97k-Client-Source-main/src/Scene/Scene_AssetLoad.cpp';
/** 怪物专属音效表（id 0xfb..0x14f，194 条）——最容易漏的第三个加载器 */
const MONSTER = '../Mu-97k-Client-Source-main/src/Monster/Monster_Data.cpp';
const TS = 'src/data/sounds.ts';

/* 源码：提取 id + 文件名 */
function cppTable(path) {
  const t = readFileSync(path, 'utf8');
  const out = [];
  for (const m of t.matchAll(
    /LoadWaveFile\s*\(\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*"[^"]*?([^\\/"]+\.(?:wav|WAV|mp3))"/g
  )) {
    const id = m[1].startsWith('0x') ? parseInt(m[1], 16) : parseInt(m[1], 10);
    out.push({ id, file: m[2] });
  }
  return out;
}

/**
 * `Monster_Data.cpp` 的写法是 `LoadWaveFile(0x14a, s_Data_Sound_xxx_wav_0055ce2c, ...)`，
 * 文件名在 `globals.cpp` 的字符串常量里，不在调用点。所以要把常量表解析出来。
 */
function monsterTable(cppPath, globalsPath) {
  const g = readFileSync(globalsPath, 'utf8');
  const map = new Map(); // 常量名 → 文件名
  for (const m of g.matchAll(/(s_Data_Sound_[A-Za-z0-9_]+)\[\]\s*=\s*"[^"]*?([^\\/"]+\.(?:wav|WAV|mp3))"/g)) {
    map.set(m[1], m[2]);
  }
  const t = readFileSync(cppPath, 'utf8');
  const out = [];
  for (const m of t.matchAll(/LoadWaveFile\s*\(\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*(s_Data_Sound_[A-Za-z0-9_]+)/g)) {
    const id = m[1].startsWith('0x') ? parseInt(m[1], 16) : parseInt(m[1], 10);
    const file = map.get(m[2]);
    if (file) out.push({ id, file });
  }
  return out;
}

/* TS：提取表里的 file 字段（`sounds.ts` + 怪物音效表） */
function tsTable() {
  const out = new Set();
  for (const f of [TS, 'src/data/monsterSounds.ts']) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/'([^'"]+\.(?:wav|WAV|mp3))'/gi)) out.add(m[1].toLowerCase());
  }
  return out;
}

const cpp1 = cppTable(CPP);
const cpp2 = cppTable(SCENE);
const cpp3 = monsterTable(MONSTER, '../Mu-97k-Client-Source-main/src/globals.cpp');
const cppAll = [...cpp1, ...cpp2, ...cpp3];
const ts = tsTable();

const cppFiles = new Set(cppAll.map(x => x.file.toLowerCase()));
console.log('=== 音效接入覆盖核对（只读）===\n');
console.log(`源码 LoadWaveFile：${cpp1.length}(Model_Gates) + ${cpp2.length}(Scene_AssetLoad) + ${cpp3.length}(Monster_Data) = ${cppAll.length}`);
console.log(`源码登记的不重复文件：${cppFiles.size}`);
console.log(`mu-three 表内文件：${ts.size}`);

const missing = [...cppFiles].filter(f => !ts.has(f));
console.log(`\n【源码有、表里没有】（${missing.length} 个）—— 需按源码补入表`);
missing.sort().forEach(f => {
  const ids = cppAll.filter(x => x.file.toLowerCase() === f).map(x => '0x' + x.id.toString(16));
  console.log(`  ${f}  (id ${ids.join(',')})`);
});

const extra = [...ts].filter(f => !cppFiles.has(f));
console.log(`\n【表里有、源码没有】（${extra.length} 个）—— 需核对是否自造`);
extra.sort().forEach(f => console.log(`  ${f}`));
