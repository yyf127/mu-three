import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
const c = await createClient('backdir');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, 'offline');
  await c.waitFor(`!!__MU_APP__.playerActor()`, 60000, 'player');
  await sleep(1200);
  for (const out of [0, 0.14, -0.14, 0.6, -0.6]) {
    await c.ev(`__MU_APP__.backPose(${JSON.stringify({ tilt: 0.42, out, up: -0.12 })})`);
    await c.ev(`__MU_APP__.previewEquip({ cls: 1, safeZone: true, weapon: 0, shield: 192 })`);
    await sleep(900);
    const r = await c.ev(`(() => {
      const a = __MU_APP__.playerActor();
      const root = a.root;
      root.updateWorldMatrix(true, true);
      const fwd = new a.root.position.constructor(0, -1, 0).applyQuaternion(root.quaternion).normalize();
      const body = new a.root.position.constructor();
      root.getWorldPosition(body);
      const g = a.props[0];
      g.updateWorldMatrix(true, false);
      const p = new a.root.position.constructor();
      g.getWorldPosition(p);
      const d = p.clone().sub(body);
      return JSON.stringify({ out: ${out}, dotFwd: +d.dot(fwd).toFixed(3), dist: +d.length().toFixed(3), y: +p.y.toFixed(2), z: +p.z.toFixed(2) });
    })()`);
    console.log(r);
  }
} finally { await c.close(); }
