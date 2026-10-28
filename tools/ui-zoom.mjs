/**
 * 放大截图：按 **640×480 逻辑坐标** 裁一块出来再放大。
 *
 *   node tools/ui-zoom.mjs <x> <y> <w> <h> <scale> <输出名>
 *
 * 例：
 *   OPEN=char node tools/ui-zoom.mjs 450 0 190 433 3 chr-zoom   # 属性面板
 *   node tools/ui-zoom.mjs 330 435 120 45 8 btns-zoom            # 底栏按钮
 *
 * `OPEN` 环境变量：char / inv / 不设 —— 截图前先打开对应面板。
 *
 * 为什么不用 `ui-shot.mjs`：那个按 DOM 元素算区域，拿不到元素外部的空白，
 * 而这个按逻辑坐标算，校验「原版坐标对不对」时更直接。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient, loginAs } from './lib/edge-client.mjs';

const [x, y, w, h, sc, name] = process.argv.slice(2);
if (!name) {
  console.error('用法: node tools/ui-zoom.mjs <x> <y> <w> <h> <scale> <输出名>');
  process.exit(1);
}
const c = await createClient('zoom');
try {
  await loginAs(c, '1234', '1234');
  await c.waitFor('__MU_APP__.inventory().length > 0', 30000, '背包');
  await sleep(800);
  if (process.env.OPEN === 'char') await c.ev('__MU_APP__.toggleCharacter(true)');
  if (process.env.OPEN === 'inv') await c.ev('__MU_APP__.toggleInventory(true)');
  await sleep(1500);
  const box = JSON.parse(await c.ev(`(() => {
    const st = document.getElementById('stage') || document.querySelector('.stage') || document.body;
    const b = st.getBoundingClientRect();
    const s = b.width / 640;
    return JSON.stringify({ x: b.left + ${x} * s, y: b.top + ${y} * s, w: ${w} * s, h: ${h} * s, scale: Number(${sc || 3}) });
  })()`));
  const shot = await c.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: box.scale },
  });
  writeFileSync(`shots/${name || 'zoom'}.png`, Buffer.from(shot.data, 'base64'));
  console.log('saved', name, box);
} finally { await c.close(); }
