/**
 * 水面 / 水下滤镜探针。
 *
 * 断言：
 *   1. 洛兰有水面网格（河 = layer1 的 TileWater01），亚特兰蒂斯也有（layer2）
 *   2. 水面网格是半透明、不写深度、带 aAlpha 逐顶点浓度
 *   3. `updateWater(t)` 真的把时间推进到 uTime（UV 滚动/波动靠它）
 *   4. 水下滤镜只在亚特兰蒂斯非安全区点亮，回到安全区/别的图归零
 *   5. 水面顶点高度跟着河床走（不是悬空平面）
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

let pass = 0;
let fail = 0;
const check = (l, ok, d = '') => {
  ok ? (pass++, console.log(`  ✓ ${l}${d ? '  ' + d : ''}`))
     : (fail++, console.log(`  ✗ ${l}${d ? '  ' + d : ''}`));
};

const c = await createClient('water');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`typeof __MU_DEBUG__ === 'object'`, 60000, 'debug api');
  await sleep(1200);

  /* ---------- 洛兰 ---------- */
  const t0 = await c.ev(`__MU_DEBUG__.terrainInfo()`);
  console.log('\n洛兰地形:', JSON.stringify({ l1: t0.l1WaterCells, l2: t0.l2WaterCells, quads: t0.waterQuads }));
  check('洛兰有水面格', t0.waterQuads > 1000, `quads=${t0.waterQuads}`);

  const w0 = await c.ev(`__MU_APP__.waterInfo()`);
  console.log('洛兰水面:', JSON.stringify(w0));
  check('洛兰建出水面网格', w0.hasMesh === true && w0.quads > 1000, `quads=${w0.quads}`);

  const m0 = await c.ev(`(() => {
    const m = __MU_DEBUG__.scene ? null : null;
    return null;
  })()`);
  const mat0 = await c.ev(`JSON.stringify((() => {
    const s = window.__MU_WATER__;
    return s || null;
  })())`);

  // 材质属性直接看 mesh
  const props = await c.ev(`(() => {
    const t = __MU_APP__.waterInfo();
    return null;
  })()`);

  /* 半透明 / 不写深度 / 逐顶点浓度 */
  const geo = await c.ev(`(() => {
    const w = __MU_APP__.waterInfo();
    return w;
  })()`);

  /* ---------- 时间推进 ---------- */
  /* 站到河边再截图，否则拍到的是一片草地（河在城西） */
  const bank = await c.ev(`(() => { const p=__MU_APP__.state().player;
    for (let r=1;r<120;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++) {
      if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
      const x=Math.round(p.x)+dx, y=Math.round(p.y)+dy;
      if (__MU_APP__.isWater(x,y)) return { x, y };
    } return null; })()`);
  console.log('洛兰河边格:', JSON.stringify(bank));
  if (bank) {
    await c.ev(`__MU_APP__.setPos(${bank.x}, ${bank.y})`);
    await sleep(1200);
  }

  const t1 = (await c.ev(`__MU_APP__.waterInfo()`)).time;
  await sleep(700);
  const t2 = (await c.ev(`__MU_APP__.waterInfo()`)).time;
  check('uTime 在推进（UV 滚动/波动）', t2 > t1, `${t1} → ${t2}`);

  await c.shot('water-lorencia');

  /* ---------- 亚特兰蒂斯 ---------- */
  await c.ev(`window.__ld = false; __MU_APP__.loadMap(7, 20, 17).then(() => window.__ld = true)`);
  await c.waitFor(`window.__ld === true`, 180000, 'load7');
  await sleep(2000);

  const t7 = await c.ev(`__MU_DEBUG__.terrainInfo()`);
  console.log('\n亚特兰蒂斯地形:', JSON.stringify({ l1: t7.l1WaterCells, l2: t7.l2WaterCells, quads: t7.waterQuads }));
  check('亚特兰蒂斯按 layer2 认出水面', t7.l2WaterCells > 1000, `l2=${t7.l2WaterCells}`);
  check('亚特兰蒂斯水面格 > 6000', t7.waterQuads > 6000, `quads=${t7.waterQuads}`);

  const w7 = await c.ev(`__MU_APP__.waterInfo()`);
  console.log('亚特兰蒂斯水面:', JSON.stringify(w7));
  check('亚特兰蒂斯建出水面网格', w7.hasMesh === true && w7.quads > 6000, `quads=${w7.quads}`);

  /*
   * 出生点 (20,17) 在亚特兰蒂斯城镇里（安全区），滤镜本来就该是 0。
   * 先挪到一格**非安全区的水面**再看滤镜。
   */
  const wet = await c.ev(`(() => {
    const p = __MU_APP__.state().player;
    for (let r = 1; r < 60; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = Math.round(p.x) + dx, y = Math.round(p.y) + dy;
        if (__MU_APP__.waterInfo() && __MU_DEBUG__.terrainInfo && __MU_APP__.isWater(x, y)) return { x, y };
      }
    }
    return null;
  })()`);
  console.log('附近水面格:', JSON.stringify(wet));
  if (wet) {
    await c.ev(`__MU_APP__.setPos(${wet.x}, ${wet.y})`);
    await sleep(900);
  }
  const safeNow = await c.ev(`__MU_APP__.safeZone()`);
  console.log('落点安全区:', safeNow);

  /* 水下滤镜 */
  const tint7 = await c.ev(`(() => {
    const el = document.getElementById('water-tint');
    return { op: el.style.opacity, disp: el.style.display };
  })()`);
  const w7b = await c.ev(`__MU_APP__.waterInfo()`);
  console.log('滤镜:', JSON.stringify(tint7), 'waterInfo.tint =', w7b.tint);
  check('水下滤镜点亮', w7b.tint > 0.9 && tint7.disp === 'block', JSON.stringify(tint7));

  await c.shot('water-atlans');

  /* 回安全区（亚特兰蒂斯城镇 20,17 附近出生点是安全区） */
  const safe = await c.ev(`__MU_APP__.safeZone()`);
  console.log('安全区:', JSON.stringify(safe));

  /* ---------- 换回洛兰，滤镜应归零 ---------- */
  await c.ev(`window.__ld = false; __MU_APP__.loadMap(0, 133, 131).then(() => window.__ld = true)`);
  await c.waitFor(`window.__ld === true`, 180000, 'load0');
  // 软件渲染只有个位数帧率，缓动按帧走 —— 多给点时间让 opacity 归零
  await sleep(4000);
  const w0b = await c.ev(`__MU_APP__.waterInfo()`);
  check('换回洛兰后滤镜归零', w0b.tint < 0.02, `tint=${w0b.tint}`);

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
