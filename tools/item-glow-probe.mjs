/** 地面物品发光底斑（离线） */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
let pass = 0, fail = 0;
const check = (l, ok, d='') => { ok ? (pass++, console.log(`  ✓ ${l}${d?'  '+d:''}`)) : (fail++, console.log(`  ✗ ${l}${d?'  '+d:''}`)); };
const c = await createClient('itemglow');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`__MU_APP__.state().objects > 0`, 90000, '物件');
  await sleep(800);

  const made = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.spawnItem(0))`));
  console.log('\n放置物品:', JSON.stringify(made));
  await sleep(900);

  const st = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.itemGlowState())'));
  console.log('发光统计:', JSON.stringify(st));
  check('地面上生成了一件物品', st.total >= 1, JSON.stringify(st));
  check('带发光底斑且可见', st.visible >= 1, `${st.visible}/${st.total}`);

  const mat = JSON.parse(await c.ev(`(() => {
    const o = __MU__.scene.getObjectByName('item-glow-' + ${made.id});
    if (!o) return JSON.stringify(null);
    const m = o.material;
    return JSON.stringify({ blending: m.blending, fog: m.fog, depthWrite: m.depthWrite, opacity: m.opacity });
  })()`));
  console.log('材质:', JSON.stringify(mat));
  check('加色混合（AdditiveBlending = 2）', mat && mat.blending === 2, String(mat && mat.blending));
  check('不吃雾（fog=false）', mat && mat.fog === false, String(mat && mat.fog));
  check('不写深度', mat && mat.depthWrite === false, String(mat && mat.depthWrite));

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally { await c.close(); }
