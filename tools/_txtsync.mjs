import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
const c = await createClient('txtsync');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await sleep(800);
  const r = JSON.parse(await c.ev(`(async () => JSON.stringify({
    ok: (await __MU_APP__.text(228)).text,
    cancel: (await __MU_APP__.text(229)).text,
    repairAll: (await __MU_APP__.text(237)).text,
    close: (await __MU_APP__.text(247)).text,
    src: (await __MU_APP__.text(0)).source,
  }))()`));
  console.log(JSON.stringify(r));
} finally { await c.close(); }
