/**
 * 解码扫描：把 `Data/Effect` 下所有贴图丢给**浏览器原生解码**（`new Image()+decode()`），
 * 报「能解 / 解不出」+ 尺寸。
 *
 *   node tools/tex-decode-scan.mjs
 *   node tools/tex-decode-scan.mjs Data/Effect Data/Object1   # 指定目录（相对 public/）
 *
 * 用途：确认 `src/core/texture.ts` 里 `decodeOzj()` 那条「从最后一个 SOI 试起」
 * 到底救回了哪些文件 —— 本脚本走的是**原始**解码路径，不经过我们的兜底，
 * 所以它报 `BAD` 的就是「不修就一定是坏图」的那批。
 */
import { readdirSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const PUBLIC = '../muonlinejs-master/public';
const dirs = process.argv.slice(2);
if (!dirs.length) dirs.push('Data/Effect');

// Node 侧拿清单（静态站点没有目录索引）
const plan = dirs.map(d => ({
  dir: d,
  files: readdirSync(`${PUBLIC}/${d}`)
    .filter(f => /\.(ozj|ozt|jpg|jpeg|png)$/i.test(f))
    .sort(),
}));

const c = await createClient('texscan');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');

  const rows = [];
  for (const { dir, files } of plan) {
    for (const name of files) {
      const r = JSON.parse(
        await c.ev(`(async () => {
          const im = new Image();
          im.src = '/' + ${JSON.stringify(`${dir}/${name}`)};
          try { await im.decode(); return JSON.stringify({ ok: true, w: im.width, h: im.height }); }
          catch (e) { return JSON.stringify({ ok: false, err: String((e && e.name) || e) }); }
        })()`)
      );
      rows.push({ dir, name, ...r });
    }
  }

  const bad = rows.filter(r => !r.ok);
  const good = rows.filter(r => r.ok);
  for (const r of good) console.log(`OK   ${r.name.padEnd(20)} ${r.w}x${r.h}`);
  for (const r of bad) console.log(`BAD  ${r.name.padEnd(20)} ${r.err}`);
  console.log(`\n合计 ${rows.length}：OK ${good.length} / BAD ${bad.length}`);
  if (bad.length) console.log('BAD 清单: ' + bad.map(r => r.name).join(' '));
} finally {
  await c.close?.();
}
