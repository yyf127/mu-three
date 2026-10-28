import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
const c = await createClient('shopdiag');
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
  const npc = JSON.parse(await ev(`JSON.stringify(__MU_APP__.npcs().find(n => n.cls === 250))`));
  console.log('NPC', JSON.stringify(npc));
  await ev(`__MU_APP__.walkToNpc(${npc.x}, ${npc.y})`);
  await sleep(5000);
  console.log('pos', JSON.stringify(JSON.parse(await ev(`JSON.stringify(__MU_APP__.state())`)).player));
  await ev(`__MU_APP__.talk(${npc.id})`);
  for (let i = 0; i < 6; i++) {
    await sleep(1200);
    const p = JSON.parse(await ev(`JSON.stringify(__MU_APP__.npcPanel())`));
    console.log(`t+${(i + 1) * 1.2}s open=${p.open} mode=${p.mode} items=${p.items.length}`);
  }
  console.log('heads', JSON.parse(await ev(`JSON.stringify(__MU_APP__.state())`)).heads.slice(-12).join(' '));
} finally { await c.close(); }
