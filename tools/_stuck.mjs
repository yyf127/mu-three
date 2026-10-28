import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
const c = await createClient('stuck');
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
  const p = JSON.parse(await ev(`JSON.stringify(__MU_APP__.state())`)).player;
  console.log('pos', p.x, p.y);
  // 3x3 邻域能不能站
  const rows = [];
  for (let dy = -2; dy <= 2; dy++) {
    const r = [];
    for (let dx = -2; dx <= 2; dx++) r.push(await ev(`__MU_APP__.canStandAt(${p.x + dx}, ${p.y + dy})`) ? 'O' : 'X');
    rows.push(`${p.y + dy}: ${r.join(' ')}`);
  }
  console.log(rows.join('\n'));
} finally { await c.close(); }
