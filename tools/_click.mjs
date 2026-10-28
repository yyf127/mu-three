import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
const c = await createClient('click');
const PROJ = (x, y) => `(() => {
  const cam = __MU__.muCamera.camera;
  const V = cam.position.constructor;
  const h = __MU__.terrain.getHeight(${x}, ${y});
  const v = new V(${x}, ${y}, h).project(cam);
  const cv = document.querySelector('#app canvas');
  const r = cv.getBoundingClientRect();
  return JSON.stringify([Math.round(r.left + (v.x * 0.5 + 0.5) * r.width), Math.round(r.top + (-v.y * 0.5 + 0.5) * r.height)]);
})()`;
const INFO = `JSON.stringify((() => {
  const s = __MU_APP__.state(); const m = __MU_APP__.moveInfo();
  return { x: s.player.x, y: s.player.y, focus: s.focus, goal: m.goal, len: m.len, clear: m.clearReason };
})())`;
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!document.getElementById('sandbox').classList.contains('hidden')`, 120000);
  await sleep(2500);
  await c.ev(`document.getElementById('sandbox').classList.add('hidden')`);
  await sleep(600);

  for (const yaw of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
    for (const [tx, ty] of [[132, 131], [134, 131], [133, 132], [133, 130]]) {
      await c.ev(`__MU_APP__.setPos(133, 131)`);
      await c.ev(`__MU__.player.yaw = ${yaw}`);
      await sleep(500);
      const scr = JSON.parse(await c.ev(PROJ(tx + 0.5, ty + 0.5)));
      const before = JSON.parse(await c.ev(INFO));
      await c.dragTo(scr[0], scr[1], scr[0], scr[1], 2);
      await sleep(250);
      const imm = JSON.parse(await c.ev(INFO));
      await sleep(1200);
      const after = JSON.parse(await c.ev(INFO));
      const hit = after.x === tx && after.y === ty;
      console.log(
        `yaw=${yaw.toFixed(2)} 点(${tx},${ty}) 屏幕${JSON.stringify(scr)} → goal=${JSON.stringify(imm.goal)} len=${imm.len} focus=${imm.focus} 之后(${after.x},${after.y}) clear=${after.clear} ${hit ? 'OK' : '<<<' }`
      );
    }
  }
} finally { await c.close(); }
