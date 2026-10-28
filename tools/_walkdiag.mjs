import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
const c = await createClient('walkdiag');
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
  await sleep(2500);
  console.log('pos', JSON.stringify((await (async()=>JSON.parse(await ev(`JSON.stringify(__MU_APP__.state())`)))()).player));
  console.log('walk →', await ev(`__MU_APP__.walkTo(180, 124)`));
  for (let i = 0; i < 6; i++) {
    await sleep(900);
    const st = JSON.parse(await ev(`JSON.stringify(__MU_APP__.state())`));
    console.log(`t+${((i+1)*0.9).toFixed(1)} pos=${st.player.x},${st.player.y} pathLeft=${st.pathLeft} dead=${st.dead}`);
  }
  console.log('clickLog', JSON.parse(await ev(`JSON.stringify(__MU_APP__.clickLog())`)).slice(-6).join(' | '));
} finally { await c.close(); }
