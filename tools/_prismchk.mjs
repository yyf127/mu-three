import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
const c = await createClient('prism');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`__MU_APP__.state().objects > 0`, 90000, '物件');
  for (const m of [0, 1, 2, 3]) {
    if (m) {
      await c.ev(`__MU_APP__.loadMap(${m}, 200, 200)`);
      await c.waitFor(`__MU_APP__.state().mapId === ${m}`, 120000, '切图' + m);
      await c.waitFor(`__MU_APP__.state().objects > 0`, 90000, '就绪' + m);
    }
    await sleep(400);
    console.log(JSON.stringify(JSON.parse(await c.ev(`(() => {
      let add = 0, opaquePrism = 0;
      __MU__.scene.traverse(o => {
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const mm of mats) if (mm && mm.blending === 2) add++;
      });
      const s = __MU_APP__.state();
      return JSON.stringify({ map: s.mapName, additiveMeshes: add, hidden: s.objectsHiddenIds });
    })()`))));
  }
} finally { await c.close(); }
