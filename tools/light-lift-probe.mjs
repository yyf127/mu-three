/**
 * 地形亮度定标探针。
 *
 * 背景：`TerrainLight.OZJ` 每张图的基准亮度差很多（洛兰 mean 0.56、亚特兰蒂斯 0.30），
 * 用同一套 `floor + gain × rl` 会导致暗图整体只有 0.44，实机上"闷在深蓝里"；
 * 而 `muonline-bmd-viewer` 因为找的是 `TerrainLight.ozb`（这批资源里没有），
 * 干脆**没上光照图**（顶点色 = 1.0），所以它看什么都亮。
 *
 * 现在的做法：按各图光照图均值抬到同一档位（`LIGHT_LEVEL_TARGET`），只抬不压。
 *
 * 断言：
 *   1. 洛兰 / 冰风谷（本来就亮的图）lift = 1.0（不回归）
 *   2. 亚特兰蒂斯 / 失落塔 / 地下城（暗图）lift > 1.2
 *   3. 抬完之后每张图的"等效亮度"都落在 0.68 附近
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

let pass = 0;
let fail = 0;
const check = (l, ok, d = '') => {
  ok ? (pass++, console.log(`  ✓ ${l}${d ? '  ' + d : ''}`))
     : (fail++, console.log(`  ✗ ${l}${d ? '  ' + d : ''}`));
};

const c = await createClient('lift');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`typeof __MU_DEBUG__ === 'object'`, 60000, 'debug api');
  const seen = {};
  for (const [mid, name] of [[0, '洛兰'], [2, '冰风谷'], [7, '亚特兰蒂斯'], [4, '失落塔'], [1, '地下城']]) {
    if (mid !== 0) {
      await c.ev(`window.__ld=false; __MU_APP__.loadMap(${mid},128,128).then(()=>window.__ld=true)`);
      await c.waitFor(`window.__ld === true`, 300000, 'load' + mid);
      await sleep(600);
    }
    const t = await c.ev(`__MU_DEBUG__.terrainInfo()`);
    const base = 0.16 + 0.92 * t.lightStats.mean;
    const eff = base * t.lightLift;
    seen[name] = { lift: t.lightLift, mean: t.lightStats.mean, eff: +eff.toFixed(3) };
    console.log(`${name.padEnd(6)} lightMean=${t.lightStats.mean}  lift=${t.lightLift}  等效亮度=${eff.toFixed(3)}`);
  }

  // 洛兰的 mean 0.561 略低于目标，lift 会是 1.006 —— 允许 1.02 以内都算"不动"
  check('洛兰基本不动（lift ≤ 1.02）', seen['洛兰'].lift <= 1.02, JSON.stringify(seen['洛兰']));
  check('冰风谷基本不动（lift ≤ 1.02）', seen['冰风谷'].lift <= 1.02, JSON.stringify(seen['冰风谷']));
  check('亚特兰蒂斯被抬起（lift ≥ 1.4）', seen['亚特兰蒂斯'].lift >= 1.4, JSON.stringify(seen['亚特兰蒂斯']));
  check('失落塔被抬起（lift ≥ 1.3）', seen['失落塔'].lift >= 1.3, JSON.stringify(seen['失落塔']));
  const allClose = Object.values(seen).every(s => Math.abs(s.eff - 0.68) < 0.02);
  check('所有图等效亮度都落在 0.68±0.02', allClose, JSON.stringify(seen));

  /*
   * 亚特兰蒂斯 A/B：同一批采样点，开/关「按图定标」各测一次。
   * 只比"同一批像素的相对提升"，不做跨版本绝对值比较（采样点不同就没法比）。
   */
  await c.ev(`window.__ld=false; __MU_APP__.loadMap(7,20,17).then(()=>window.__ld=true)`);
  await c.waitFor(`window.__ld === true`, 300000, 'load7 again');
  await sleep(1200);
  const wet = await c.ev(`(() => { const p=__MU_APP__.state().player;
    for (let r=1;r<60;r++) for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++) {
      if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
      const x=Math.round(p.x)+dx,y=Math.round(p.y)+dy;
      if (__MU_APP__.isWater(x,y)) return {x,y}; } return null; })()`);
  if (wet) { await c.ev(`__MU_APP__.setPos(${wet.x},${wet.y})`); await sleep(1800); }

  const pts = `(() => { const out = [];
    for (const fx of [0.35, 0.5, 0.65]) for (const fy of [0.45, 0.6, 0.75]) {
      out.push({ x: Math.round(window.innerWidth * fx), y: Math.round(window.innerHeight * fy) });
    }
    return out; })()`;
  const luma = r => r.reduce((a, p) => a + (0.2126 * p.rgb[0] + 0.7152 * p.rgb[1] + 0.0722 * p.rgb[2]), 0) / r.length;
  await c.ev(`__MU_APP__.lightLift(true)`);
  await sleep(400);
  const onPix = luma(await c.ev(`(() => { const pts = ${pts}; return __MU_DEBUG__.probePixels(pts); })()`));
  await c.ev(`__MU_APP__.lightLift(false)`);
  await sleep(400);
  const offPix = luma(await c.ev(`(() => { const pts = ${pts}; return __MU_DEBUG__.probePixels(pts); })()`));
  await c.ev(`__MU_APP__.lightLift(true)`);
  console.log(`亚特兰蒂斯 9 点平均 luma：定标开 ${onPix.toFixed(1)} / 关 ${offPix.toFixed(1)}（+${((onPix / Math.max(1, offPix) - 1) * 100).toFixed(0)}%）`);
  check('亚特兰蒂斯明显变亮（≥ +25%）', onPix > offPix * 1.25, `${onPix.toFixed(1)} vs ${offPix.toFixed(1)}`);

  await c.shot('atlans-lift');
  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
