/**
 * 一次性目视检查：安全区背挂 vs 野外手持，各转 4 个朝向拍特写。
 * 只用来人眼看姿态，不进断言。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('backlook');

async function clip(scale = 4) {
  const p = JSON.parse(
    await c.ev(`(() => { const a = __MU_APP__.playerActor();
      const p = __MU_DEBUG__.project(a.x, a.y, a.z + 1.1);
      return JSON.stringify({ x: Math.round(p.x), y: Math.round(p.y) }); })()`)
  );
  const W = 150, H = 210;
  return { x: Math.max(0, p.x - W / 2), y: Math.max(0, p.y - H * 0.55), width: W, height: H, scale };
}

async function shot(name) {
  await sleep(600);
  const r = await c.send('Page.captureScreenshot', { format: 'png', clip: await clip() });
  writeFileSync(`shots/${name}.png`, Buffer.from(r.data, 'base64'));
}

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`!!__MU_APP__.playerActor()`, 60000, '角色');
  await c.ev(`__MU_APP__.mockInventory([{ slot: 0, type: 0 }, { slot: 1, type: 192 },
    { slot: 2, type: 224 }, { slot: 3, type: 256 }, { slot: 4, type: 288 },
    { slot: 5, type: 320 }, { slot: 6, type: 352 }])`);
  await c.waitFor(`__MU_APP__.playerActor().props.length >= 2`, 30000, '换装');
  await sleep(800);

  for (const [i, yaw] of [0, Math.PI / 2, Math.PI, -Math.PI / 2].entries()) {
    await c.ev(`__MU_APP__.playerActor().yaw = ${yaw}`);
    await shot(`look-safe-${i}`);
  }

  await c.ev(`__MU_APP__.setPos(170, 170)`);
  await c.waitFor(`__MU_APP__.safeZone() === false && __MU_APP__.playerActor().props.every(g => g.parent && /knife_gdf|hand_bofdgne01/.test(g.parent.name))`, 30000, '手持');
  for (const [i, yaw] of [0, Math.PI / 2, Math.PI, -Math.PI / 2].entries()) {
    await c.ev(`__MU_APP__.playerActor().yaw = ${yaw}`);
    await shot(`look-field-${i}`);
  }
  console.log('ok');
} finally {
  await c.close();
}
