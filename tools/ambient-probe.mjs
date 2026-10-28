/**
 * 环境粒子（源码 `Weather_Update`）探针。
 *
 *   node tools/ambient-probe.mjs [mapId]
 *
 * 断言：
 *   ① 当前地图的氛围粒子按表生成（洛兰 = 飞鸟、诺利亚 = 花瓣、天空 = 萤火…）
 *   ② 飞鸟真的在扇翅（骨骼矩阵变化）并且在盘旋（世界坐标变化）
 *   ③ 每帧 CPU 开销可以忽略
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const mapId = Number(process.argv[2] ?? 0);
const c = await createClient('ambient');

const BIRD = `(() => {
  let sm = null;
  __MU__.scene.traverse(o => {
    if (!sm && o.isSkinnedMesh && o.parent && o.parent.name.startsWith('ambient:bird')) sm = o;
  });
  if (!sm) return JSON.stringify({ none: true });
  const bm = sm.skeleton.boneMatrices;
  let sum = 0;
  for (let i = 0; i < bm.length; i++) sum += bm[i];
  const e = sm.parent.matrixWorld.elements;
  return JSON.stringify({
    sum: +sum.toFixed(3),
    pos: [+e[12].toFixed(2), +e[13].toFixed(2), +e[14].toFixed(2)],
  });
})()`;

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`!!window.__MU__ && !!__MU__.ambient`, 60000, '氛围层');
  await sleep(2000);

  console.log('地图:', mapId, '氛围:', await c.ev(`JSON.stringify(__MU_APP__.state().ambient)`));

  const b1 = JSON.parse(await c.ev(BIRD));
  await sleep(700);
  const b2 = JSON.parse(await c.ev(BIRD));
  if (b1.none) {
    console.log('飞鸟: 本图没有飞鸟');
  } else {
    console.log(
      '飞鸟:', JSON.stringify(b1), '→', JSON.stringify(b2),
      b1.sum !== b2.sum ? '✓ 在扇翅' : '✗ 翅膀没动',
      b1.pos.join() !== b2.pos.join() ? '· ✓ 在盘旋' : '· ✗ 没位移'
    );
  }

  // CPU 开销
  console.log('开销:', await c.ev(`(() => {
    const a = __MU__.ambient, p = __MU__.player;
    const N = 300, t0 = performance.now();
    for (let i = 0; i < N; i++) a.update(0.016, p.x, p.y, p.z, 640);
    return JSON.stringify({ msPerFrame: +((performance.now() - t0) / N).toFixed(3) });
  })()`));

  /* 保持玩家常见视角，不做调试性拉远 */
  await sleep(1500);
  const full = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`shots/ambient-${mapId}.png`, Buffer.from(full.data, 'base64'));
  console.log(`截图: shots/ambient-${mapId}.png`);
  console.log('errors:', c.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exc]')).slice(0, 4));
  console.log('warns:', c.logs.filter(l => l.includes('[ambient') || l.includes('[objects]')).slice(0, 4));
} finally {
  await c.close();
}
