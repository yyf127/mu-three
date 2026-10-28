import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
const c = await createClient('act');
const ev = e => c.ev(e);
try {
  await c.waitFor(`!!document.getElementById('login-account')`, 20000, '登录');
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 60000, '选角');
  await sleep(2500);
  await ev(`(() => { const b = document.querySelectorAll('.char-card')[3]; b && b.click(); })()`);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);
  await c.waitFor(`__MU_APP__.state().mapId !== null`, 120000, '地图');
  await sleep(1500);
  console.log(await ev(`JSON.stringify(__MU_APP__.playerActions())`));
  console.log('sit →', await ev(`(async () => JSON.stringify(__MU_APP__.operate(${0})))()`));
  await sleep(600);
  console.log('after', await ev(`JSON.stringify(__MU_APP__.playerActions())`));
} finally { await c.close(); }
