/** 加色混合模式（ONE/ONE vs SRC_ALPHA）探针 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
let pass = 0, fail = 0;
const check = (l, ok, d='') => { ok ? (pass++, console.log(`  ✓ ${l}${d?'  '+d:''}`)) : (fail++, console.log(`  ✗ ${l}${d?'  '+d:''}`)); };
const c = await createClient('additive');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`__MU_APP__.state().objects > 0`, 90000, '物件');
  await sleep(800);

  await c.ev(`__MU_APP__.spawnItem(0)`);
  await sleep(600);

  const one = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.additive('one'))`));
  console.log('\n切到 one:', JSON.stringify(one));
  check('切成 ONE/ONE（有材质被刷新）', one.mode === 'one' && one.existing > 0, JSON.stringify(one));

  const m1 = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.fxSample('item-glow-990000'))`));
  console.log('  材质:', JSON.stringify(m1));
  // three: CustomBlending = 5、OneFactor = 201
  check('物品光斑 = CustomBlending + One/One', m1 && m1.blending === 5 && m1.blendSrc === 201 && m1.blendDst === 201, JSON.stringify(m1));

  const a = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.additive('alpha'))`));
  console.log('\n切回 alpha:', JSON.stringify(a));
  const m2 = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.fxSample('item-glow-990000'))`));
  check('切回 AdditiveBlending(2)', m2 && m2.blending === 2, JSON.stringify(m2));

  await c.ev(`__MU_APP__.additive('one')`);
  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally { await c.close(); }
