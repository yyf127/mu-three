/**
 * 任意地图全景截图（检查地面整体观感：发黑 / 发花 / 接缝）。
 *
 *   node tools/map-shot.mjs 3 140 140 noria
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const mapId = Number(process.argv[2] ?? 0);
const x = Number(process.argv[3] ?? 128);
const y = Number(process.argv[4] ?? 128);
const tag = process.argv[5] ?? `m${mapId}`;

const c = await createClient('mapshot');
await c.ev(`__MU_APP__.offline()`);
await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
await c.waitFor('!!window.__MU__ && !!window.__MU__.terrain', 60000, '地形');

if (mapId !== 0) {
  await c.ev(`__MU_APP__.loadMap(${mapId}, ${x}, ${y})`);
  await c.waitFor(`__MU_APP__.state().mapId === ${mapId}`, 90000, `切到地图 ${mapId}`);
  await c.waitFor('!!window.__MU__ && !!window.__MU__.terrain', 60000, '地形');
}
await sleep(2500);

const box = JSON.parse(
  await c.ev(`(() => {
    const cv = document.querySelector('#app canvas');
    const r = cv.getBoundingClientRect();
    return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height });
  })()`)
);
const r = await c.send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 },
});
writeFileSync(`shots/map-${tag}.png`, Buffer.from(r.data, 'base64'));
console.log(`shots/map-${tag}.png  (mapId=${mapId} @ ${x},${y})`);
await c.close();
