/**
 * 背包面板成品截图（裁出面板区域）。
 * node tools/ui-shot.mjs [输出名]
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient, loginAs } from './lib/edge-client.mjs';

const name = process.argv[2] || 'ui-panel';
const c = await createClient('shot');
try {
  await loginAs(c, '1234', '1234');
  await c.waitFor('__MU_APP__.inventory().length > 0', 30000, '背包');
  await c.ev('__MU_APP__.toggleInventory(true)');
  await sleep(3000); // 等所有缩略图渲完

  await c.ev(`window.__SHOT_SEL__ = ${JSON.stringify(process.env.SHOT_SEL || ".inv-panel")}`);
  const r = await c.ev(`(() => {
    const el = document.querySelector('' + (window.__SHOT_SEL__ || '.inv-panel'));
    const b = el.getBoundingClientRect();
    return JSON.stringify({ x: b.left, y: b.top, width: b.width, height: b.height });
  })()`);
  const clip = { ...JSON.parse(r), scale: Number(process.env.SCALE || 2) };
  const shot = await c.send('Page.captureScreenshot', { format: 'png', clip });
  writeFileSync(`shots/${name}.png`, Buffer.from(shot.data, 'base64'));
  console.log('已保存 shots/' + name + '.png  区域', clip);
} finally { await c.close(); }
