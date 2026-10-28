import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
const c = await createClient('wd2');
const ev = e => c.ev(e);
try {
  await c.waitFor(`!!document.getElementById('login-account')`, 20000, '登录');
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 60000, '选角');
  await sleep(2500);
  await ev(`(() => { const b = document.querySelector('.char-card'); b && b.click(); })()`);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);
  await c.waitFor(`__MU_APP__.state().mapId !== null`, 120000, '地图');
  await sleep(3000);
  const st = JSON.parse(await ev(`JSON.stringify(__MU_APP__.state())`));
  console.log('玩家', JSON.stringify(st.player), 'map', st.mapId);
  for (const [x, y] of [[180,124],[176,120],[170,130],[160,130]]) {
    const ok = await ev(`__MU_APP__.walkTo(${x}, ${y})`);
    const why = await ev(`__MU_APP__.walkWhy()`);
    await sleep(1200);
    const p = JSON.parse(await ev(`JSON.stringify(__MU_APP__.state())`)).player;
    console.log(`walkTo(${x},${y}) = ${ok} why=${why} → pos ${p.x},${p.y}`);
  }
  console.log('isWater/canStand 探测:');
  for (const [x, y] of [[174,124],[175,124],[180,124]]) {
    console.log(`  (${x},${y}) water=${await ev(`__MU_APP__.isWater(${x},${y})`)}`);
  }
} finally { await c.close(); }
