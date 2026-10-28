/**
 * 把 Interface 里的图标放大画到页面里再截图，用来肉眼确认素材长什么样。
 *
 *   node tools/ui-icons.mjs "Menu_character,Menu_inventory,Menu_party" 5 icons
 *   node tools/ui-icons.mjs "Menu_blue,Menu_red,Menu_green" 4 gems
 *
 * 参数：逗号分隔的贴图名（不带扩展名）/ 放大倍数 / 输出名（存 shots/<名>.png）。
 *
 * 干嘛用的：判断一张 OZJ 到底是「黑底不透明」还是「真带 alpha」，
 * 光看页面上的效果很难分清（底栏本来就暗）。放大后一眼就能看出来。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient, loginAs } from './lib/edge-client.mjs';

const names = (process.argv[2] || 'Menu_character,Menu_inventory,Menu_party,Menu_blue,Menu_red,Menu_green').split(',');
const Z = Number(process.argv[3] || 6);
const out = process.argv[4] || 'icons';

const c = await createClient('iconview');
try {
  await loginAs(c, '1234', '1234');
  await sleep(800);
  await c.ev(`(async () => {
    const names = ${JSON.stringify(names)};
    const Z = ${Z};
    document.querySelectorAll('.iconview').forEach(e => e.remove());
    const box = document.createElement('div');
    box.className = 'iconview';
    box.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#20242c;padding:8px;display:flex;gap:8px;align-items:flex-start';
    for (const n of names) {
      const sp = await __MU_APP__.uiSprite(n);
      const cv = document.createElement('canvas');
      cv.width = sp.image.width * Z;
      cv.height = sp.image.height * Z;
      cv.title = n;
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(sp.image, 0, 0, cv.width, cv.height);
      const wrap = document.createElement('div');
      wrap.style.cssText = 'color:#fff;font:11px monospace;text-align:center';
      wrap.append(n, document.createElement('br'), cv);
      box.appendChild(wrap);
    }
    document.body.appendChild(box);
  })()`);
  await sleep(600);
  const r = await c.ev(`(() => { const b = document.querySelector('.iconview').getBoundingClientRect();
    return JSON.stringify({ x: b.left, y: b.top, width: b.width, height: b.height }); })()`);
  const clip = { ...JSON.parse(r), scale: 1 };
  const shot = await c.send('Page.captureScreenshot', { format: 'png', clip });
  writeFileSync(`shots/${out}.png`, Buffer.from(shot.data, 'base64'));
  console.log('saved shots/' + out + '.png', clip);
} finally { await c.close(); }
