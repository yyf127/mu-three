/**
 * 地面接缝探针（离线）。
 *
 * 思路：接缝出现在**格边界**（vUv 跨整数处）。这里沿一条世界直线，
 * 分别在「格边界 x=k」「格心 x=k+0.5」投影采样，比较两者的平均亮度差。
 * 如果接缝存在，边界那批点会系统性偏暗。
 *
 * 注意：MU 地形本身有「贴图索引突变 + alpha=0」的硬边（草地/道路交界），
 * 所以只比较**平均值差**，不看单点跳变。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
let pass = 0, fail = 0;
const check = (l, ok, d='') => { ok ? (pass++, console.log(`  ✓ ${l}${d?'  '+d:''}`)) : (fail++, console.log(`  ✗ ${l}${d?'  '+d:''}`)); };
const c = await createClient('seam');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`__MU_APP__.state().objects > 0`, 90000, '物件');
  await c.waitFor('!!window.__MU_DEBUG__', 20000, '调试口');
  await sleep(900);

  for (const [m, name] of [[0, '洛兰'], [2, '冰风谷']]) {
    if (m) {
      await c.ev(`__MU_APP__.loadMap(${m}, 210, 210)`);
      await c.waitFor(`__MU_APP__.state().mapId === ${m}`, 120000, '切图' + m);
      await c.waitFor(`__MU_APP__.state().objects > 0`, 90000, '物件' + m);
      await sleep(700);
    }
    const r = JSON.parse(await c.ev(`(() => {
      const objs = __MU__.world.objects.group, pl = __MU__.player;
      objs.visible = false; pl.root.visible = false;
      const p = __MU_APP__.state().player;
      const cx = Math.round(p.x), cy = Math.round(p.y);
      const edges = [], mids = [];
      for (let k = 0; k < 40; k++) {
        const x = cx - 20 + k;
        const z0 = __MU__.terrain.getHeight(x, cy + 6);
        const z1 = __MU__.terrain.getHeight(x + 0.5, cy + 6);
        edges.push({ ...__MU_DEBUG__.project(x, cy + 6, z0), });
        mids.push({ ...__MU_DEBUG__.project(x + 0.5, cy + 6, z1), });
      }
      const keep = a => a.filter(q => q.inFront);
      const e = __MU_DEBUG__.probePixels(keep(edges));
      const mi = __MU_DEBUG__.probePixels(keep(mids));
      objs.visible = true; pl.root.visible = true;
      const lum = a => a.reduce((s, q) => s + (q.rgb[0] + q.rgb[1] + q.rgb[2]) / 3, 0) / Math.max(1, a.length);
      return JSON.stringify({ edge: +lum(e).toFixed(2), mid: +lum(mi).toFixed(2), n: e.length });
    })()`));
    const diff = Math.abs(r.edge - r.mid);
    console.log(`\n[${name}] 格边界均值 ${r.edge} / 格心均值 ${r.mid}，差 ${diff.toFixed(2)}（${r.n} 点）`);
    check(`${name}：格边界没有系统性偏暗（差 < 6）`, diff < 6, `差 ${diff.toFixed(2)}`);
  }

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally { await c.close(); }
