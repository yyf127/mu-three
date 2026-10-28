/**
 * 一次性迁移脚本：把所有探针的临时 profile 切到 tools/lib/profile.mjs。
 *
 *   node tools/lib/migrate-profiles.mjs          # 只看会改什么（dry-run）
 *   node tools/lib/migrate-profiles.mjs --write  # 真的写
 *
 * 改三件事：
 *   1. `--user-data-dir=${...}\\prefix-${Date.now()}` → `--user-data-dir=${makeProfile('prefix')}`
 *   2. `const profile = `${...}\\prefix-${Date.now()}`;` → `const profile = makeProfile('prefix');`
 *   3. 文件头补一行 import
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WRITE = process.argv.includes('--write');
const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TOOLS = join(HERE, '..');

const INLINE = /--user-data-dir=\$\{process\.env\.TEMP(?:\s*\|\|\s*'\.')?\}\\\\([A-Za-z0-9_-]+?)-\$\{Date\.now\(\)\}/g;
const DEFINE = /const profile = `\$\{process\.env\.TEMP(?:\s*\|\|\s*'\.')?\}\\\\([A-Za-z0-9_-]+?)-\$\{Date\.now\(\)\}`;/g;
const IMPORT_LINE = "import { makeProfile } from './lib/profile.mjs';";

let touched = 0;
for (const name of readdirSync(TOOLS)) {
  if (!name.endsWith('.mjs')) continue;
  const file = join(TOOLS, name);
  const before = readFileSync(file, 'utf8');
  if (!/user-data-dir/.test(before)) continue;

  let after = before;
  const hits = [];
  after = after.replace(INLINE, (_m, prefix) => {
    hits.push(`inline:${prefix}`);
    return `--user-data-dir=\${makeProfile('${prefix}')}`;
  });
  after = after.replace(DEFINE, (_m, prefix) => {
    hits.push(`define:${prefix}`);
    return `const profile = makeProfile('${prefix}');`;
  });
  if (!hits.length) continue;

  if (!after.includes(IMPORT_LINE)) {
    // 插在最后一条 import 之后；没有 import 就插在文件最前面
    const lines = after.split('\n');
    let last = -1;
    for (let i = 0; i < lines.length; i++) if (/^import\s.+;?\s*$/.test(lines[i])) last = i;
    if (last >= 0) lines.splice(last + 1, 0, IMPORT_LINE);
    else lines.unshift(IMPORT_LINE);
    after = lines.join('\n');
  }

  touched++;
  console.log(`${WRITE ? '改' : '将改'} ${name.padEnd(24)} ${hits.join(' ')}`);
  if (WRITE) writeFileSync(file, after);
}

console.log(`\n${WRITE ? '已改' : '待改'} ${touched} 个文件${WRITE ? '' : '，加 --write 落盘'}`);
