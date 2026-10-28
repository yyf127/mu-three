/** 同名前缀贴图的候选顺序（离线） */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
let pass = 0, fail = 0;
const check = (l, ok, d='') => { ok ? (pass++, console.log(`  ✓ ${l}${d?'  '+d:''}`)) : (fail++, console.log(`  ✗ ${l}${d?'  '+d:''}`)); };
const c = await createClient('texcand');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await sleep(600);

  const cases = [
    ['ston02.tga', '.OZT', 'BMD 声明 .tga → 必须优先 OZT（带 alpha）'],
    ['Tree_a.tga', '.OZT', '同上'],
    ['tree.jpg', '.OZJ', '声明 .jpg → 优先 OZJ'],
    ['ston01.jpg', '.OZJ', '同上'],
  ];
  for (const [path, want, note] of cases) {
    const r = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.texCandidates('Object1', ${JSON.stringify(path)}))`));
    const first = r.candidates[0] || '';
    console.log(`  ${path} → ${first}`);
    check(`${note}`, first.toLowerCase().endsWith(want.toLowerCase()), `${first.split('/').pop()}`);
  }
  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally { await c.close(); }
