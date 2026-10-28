/** 贴图混合判定（像素启发式）探针：离线 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
let pass = 0, fail = 0;
const check = (l, ok, d='') => { ok ? (pass++, console.log(`  ✓ ${l}${d?'  '+d:''}`)) : (fail++, console.log(`  ✗ ${l}${d?'  '+d:''}`)); };
const c = await createClient('blend');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await sleep(800);

  /*
   * 期望值来自实测：这几张都是**填满画幅的实心图**（不是黑底光斑），
   * 所以判定 opaque 才是对的 —— 之前按文件名把它们当"特效"才是错的那一侧。
   */
  const cases = [
    ['Object1', 'streetlight.jpg', 'opaque', '路灯实体'],
    ['Object3', 'aurora.jpg', 'opaque', '冰风谷极光面板'],
    ['Object2', 'cobweb.jpg', 'opaque', '地下城蛛网面板'],
    ['Object4', 'flower2.jpg', 'opaque', '诺利亚真花'],
    ['Object8', 'bfish072.jpg', 'opaque', 'World8 三角柱贴图'],
  ];
  for (const [dir, file, want, note] of cases) {
    const v = JSON.parse(await c.ev(`(async () => JSON.stringify(await __MU_APP__.blendOf(${JSON.stringify(dir)}, ${JSON.stringify(file)})))()`));
    if (!v) { console.log(`  · ${dir}/${file} 读不到，跳过`); continue; }
    console.log(`  ${dir}/${file} → ${v.mode}/${v.alphaStyle}  (${v.reason})  ${note}`);
    check(`${note} 期望 ${want}`, v.mode === want, `${v.mode}`);
  }

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally { await c.close(); }
