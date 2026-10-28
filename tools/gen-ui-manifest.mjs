/**
 * 扫描 `Data/Interface` 生成文件名清单 `src/data/uiManifest.ts`。
 *
 * 为什么需要：原版资源的大小写是混着来的（`Item_Back02.OZJ`、`Item_back01.ozj`、
 * `Menu01_new.ozj`），而 Vite 的静态服务**大小写敏感** —— 猜错大小写不会 404，
 * 而是回落成 index.html（HTTP 200 + 6KB HTML），`<img>` 拿到的就是一堆乱码。
 * 所以这里把真实文件名固化下来，运行时按 name 查表，一次命中。
 *
 * 用法：node tools/gen-ui-manifest.mjs
 */
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DIR = resolve(ROOT, '../muonlinejs-master/public/Data/Interface');
const OUT = join(ROOT, 'src/data/uiManifest.ts');

const files = readdirSync(DIR).filter(f => /\.(ozj|ozt)$/i.test(f));

/** key = 小写去扩展名，value = 磁盘上的真实文件名（含扩展名） */
const map = new Map();
for (const f of files) {
  const key = f.replace(/\.(ozj|ozt)$/i, '').toLowerCase();
  // 同名不同扩展名时优先 OZJ（UI 面板都是 OZJ，OZT 只有光标/字体/小地图）
  const prev = map.get(key);
  if (!prev || (!/ozt$/i.test(f) && /ozt$/i.test(prev))) {
    map.set(key, f);
  }
}

const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const rows = entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');

const out = `/* 本文件由 tools/gen-ui-manifest.mjs 生成，勿手改。
 * 数据源：muonlinejs-master/public/Data/Interface
 *
 * key 是小写去扩展名，value 是磁盘上的真实文件名 —— Vite 静态服务大小写敏感，
 * 猜错就静默回落到 index.html，所以必须查表。
 */
export const UI_FILES: Record<string, string> = {
${rows}
};
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out, 'utf8');
console.log(`已生成 ${OUT}（${entries.length} 个文件）`);
