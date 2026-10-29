/**
 * 生成 `src/data/monsterSounds.ts` —— 怪物 type → 音效文件名。
 *
 * 数据源：`Mu-97k-Client-Source-main/src/Monster/Monster_Data.cpp` 的
 * `OpenMonsterModel`，里面按 `switch (param_1)` 给每个怪物 type 挂
 * 5 条 `LoadWaveFile`（idle×2 / attack×2 / die）。
 *
 * 几个必须注意的点：
 *
 *   1. `param_1` 是**怪物 type**（0..59），也就是 `Monster.txt` 的 `Class`，
 *      客户端 `0x13` 视野包里的 `type` 字段直接就是它 —— 不需要再映射。
 *   2. `LoadWaveFile` 的**第一个参数（0xaa..0x6b）不是稳定 id**：原版每次进图
 *      都把 120..419 重新分配（`OpenWorldModels` 会释放这段）。所以表里只存
 *      文件名，运行时用 `sfxFile()` 按名播放。
 *   3. 文件数量不固定（3~5 个），所以**按文件名分类**而不是按位置：
 *      `*Die*` → die，`*Attack*` → attack，其余 → idle。名字规律很稳定。
 *   4. `Model_SetAnimationSlots` 的参数是**动画槽**，不是音效 id，别拿来对。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, '..', 'Mu-97k-Client-Source-main', 'src', 'Monster', 'Monster_Data.cpp');
const SOUND_DIR = join(ROOT, 'dist', 'Data', 'Sound');
const OUT = join(ROOT, 'src', 'data', 'monsterSounds.ts');

const text = readFileSync(SRC, 'utf8');
const lines = text.split(/\r?\n/);

/** @type {Map<number, string[]>} */
const table = new Map();
let cases = [];
let files = [];
let outsideSwitch = 0;

for (const ln of lines) {
  const c = ln.match(/\bcase\s+(0x[0-9a-fA-F]+|\d+)\s*:/);
  if (c) {
    cases.push(Number(c[1]));
    continue;
  }
  // default: 也结束一组
  if (/^\s*default\s*:/.test(ln) && cases.length) {
    cases = [];
    files = [];
    continue;
  }
  const w = ln.match(/LoadWaveFile\([^,]+,\s*"([^"]+)"/);
  if (w) {
    files.push(w[1].split('\\').pop());
    continue;
  }
  // 每个 case 块以 Model_SetAnimationSlots 收尾
  if (/Model_SetAnimationSlots/.test(ln)) {
    if (!cases.length || !files.length) {
      cases = [];
      files = [];
      continue;
    }
    for (const t of cases) table.set(t, files.slice());
    cases = [];
    files = [];
  }
}
void outsideSwitch;

function classify(list) {
  const idle = [];
  const attack = [];
  let die = null;
  for (const f of list) {
    const base = f.replace(/\.wav$/i, '');
    if (/die$/i.test(base)) die = f;
    else if (/attack\d*$/i.test(base)) attack.push(f);
    else idle.push(f);
  }
  return { idle, attack, die };
}

const types = [...table.keys()].sort((a, b) => a - b);
const rows = [];
const missingFiles = [];
const noDie = [];
const noAttack = [];

for (const t of types) {
  const list = table.get(t);
  const own = list.filter((f, i) => list.indexOf(f) === i);
  const s = classify(own);
  for (const f of own) if (!existsSync(join(SOUND_DIR, f))) missingFiles.push(`${t}:${f}`);
  if (!s.die) noDie.push(t);
  if (!s.attack.length) noAttack.push(t);
  rows.push([t, s]);
}

if (missingFiles.length) {
  console.error(`[gen-monster-sounds] 磁盘上缺 ${missingFiles.length} 个文件：\n  ${missingFiles.join('\n  ')}`);
}

/** @param {string} s */
const q = s => `'${s}'`;

const body = rows
  .map(([t, s]) => {
    const parts = [];
    parts.push(`idle: [${s.idle.map(q).join(', ')}]`);
    parts.push(`attack: [${s.attack.map(q).join(', ')}]`);
    parts.push(`die: ${s.die ? q(s.die) : 'null'}`);
    return `  ${t}: { ${parts.join(', ')} },`;
  })
  .join('\n');

const out = `/**
 * 怪物音效表 —— **自动生成**，别手改。改数据源请跑：
 *
 *     node tools/gen-monster-sounds.mjs
 *
 * 数据源：\`Mu-97k-Client-Source-main/src/Monster/Monster_Data.cpp\` 的
 * \`OpenMonsterModel\`（按怪物 type 挂 5 条 \`LoadWaveFile\`）。
 *
 * 索引是**怪物 type**，也就是 \`Monster.txt\` 的 \`Class\`、视野包里的 \`type\`。
 * 覆盖 ${types.length} 个 type（${types[0]}..${types[types.length - 1]}）。
 *
 * 原版这些音效**没有固定 id**（每次进图重新分配 120..419），所以表里存文件名，
 * 播放走 \`sfxFile()\`。
 */

export interface MonsterSoundSet {
  /** 待机叫声（原版随机播，两个变体） */
  idle: string[];
  /** 攻击时（两个变体） */
  attack: string[];
  /** 死亡时；个别 type 没有 */
  die: string | null;
}

export const MONSTER_SOUNDS: Record<number, MonsterSoundSet> = {
${body}
};

/** type → 音效集；没登记返回 null（客户端会用默认静音，不报错） */
export function monsterSoundSet(cls: number): MonsterSoundSet | null {
  return MONSTER_SOUNDS[cls] ?? null;
}
`;

writeFileSync(OUT, out, 'utf8');
console.log(`[gen-monster-sounds] ${OUT}`);
console.log(`  type ${types.length} 个（${types[0]}..${types[types.length - 1]}）`);
console.log(`  缺文件 ${missingFiles.length}，无死亡音 ${noDie.length}，无攻击音 ${noAttack.length}`);
if (noDie.length) console.log(`  无死亡音: ${noDie.join(',')}`);
