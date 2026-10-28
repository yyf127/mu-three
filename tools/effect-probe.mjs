/**
 * 三棱柱特效面片 + 混合模式探针（离线）。
 *
 * 覆盖两件事：
 *   ① 6 顶点三角柱（冰风谷 Object101 / 诺利亚 Object39 / World7 Object39 / World8 Object40）
 *      —— 原版当特效面片，我们默认不画，`effects(true)` 可显示；
 *   ② 混合模式由 `core/blendHeuristic` 按**像素**判定（不是文件名正则）。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
let pass = 0, fail = 0;
const check = (l, ok, d='') => { ok ? (pass++, console.log(`  ✓ ${l}${d?'  '+d:''}`)) : (fail++, console.log(`  ✗ ${l}${d?'  '+d:''}`)); };
const c = await createClient('fx');
const go = async m => {
  if (m) {
    await c.ev(`__MU_APP__.loadMap(${m}, 200, 200)`);
    await c.waitFor(`__MU_APP__.state().mapId === ${m}`, 120000, '切图' + m);
  }
  await c.waitFor(`__MU_APP__.state().objects > 0`, 90000, '物件' + m);
  await sleep(400);
};
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await go(0);

  // 洛兰不该有三角柱（那里的 PoseBox 走 id 表）
  const l0 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.effectState())'));
  check('洛兰没有三角柱面片（不误伤火把）', l0.total === 0, JSON.stringify(l0));

  for (const [m, name] of [[2, '冰风谷 Object101'], [3, '诺利亚 Object39'], [6, 'World7 Object39'], [7, 'World8 Object40']]) {
    await go(m);
    const st = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.effectState())'));
    const hid = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state().objectsHiddenIds)'));
    console.log(`\n[${name}] 面片 ${st.total} 个，默认可见 ${st.visible}，隐藏类型 ${JSON.stringify(hid)}`);
    // 要么按几何藏（total>0 且 visible=0），要么按地图类型表藏（hidden 里有对应 id）
    check(`${name}：默认不显示（几何或类型表）`, st.visible === 0, `${st.visible} 可见`);
    if (st.total > 0) {
      await c.ev(`__MU_APP__.effects(true)`);
      await sleep(200);
      const on = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.effectState())'));
      check(`${name}：effects(true) 能显示`, on.visible === on.total, JSON.stringify(on));
      await c.ev(`__MU_APP__.effects(false)`);
    }
  }

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally { await c.close(); }
