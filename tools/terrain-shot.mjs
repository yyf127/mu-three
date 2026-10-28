/**
 * 地形截图 + 量化：暗像素比例 / 平均亮度 / 边缘密度。
 *
 *   node tools/terrain-shot.mjs before
 *   node tools/terrain-shot.mjs after
 *
 * 「暗像素」用来抓**地面发黑**（layer2 = 255 越界采样）；
 * 「边缘密度」只能当**粗指标**：它受贴图自身细节和相机距离影响，
 * 实测 div=1 与 div=4 只差 1.8 倍左右（不是理论上的 4 倍，因为 NEAREST 缩放
 * 在密集一侧会糊成噪点、边缘反而被抹平）。要判定「一张 tile 铺几格」，
 * 用 tools/terrain-div-probe.mjs —— 它直接读 uniform 并与源码公式对账。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const tag = process.argv[2] || 'shot';
const c = await createClient('terrainshot');

await c.ev(`__MU_APP__.offline()`);
await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
await c.waitFor(`!!window.__MU__ && !!window.__MU__.terrain`, 60000, '地形');
await sleep(3000);

// 只截 3D 画布：整页截图会把页面黑边和 UI 面板算进去，亮度统计完全失真
const box = JSON.parse(
  await c.ev(`(() => {
    const cv = document.querySelector('#app canvas');
    const r = cv.getBoundingClientRect();
    return JSON.stringify({ x: Math.max(0, r.x), y: Math.max(0, r.y), w: r.width, h: r.height });
  })()`)
);
const r = await c.send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 },
});
const b64 = r.data;
writeFileSync(`shots/terrain-${tag}.png`, Buffer.from(b64, 'base64'));

const stat = JSON.parse(
  await c.ev(`(async () => {
    const im = new Image(); im.src = 'data:image/png;base64,' + ${JSON.stringify(b64)};
    await im.decode();
    const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
    const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
    // 画面分三段统计：天空 / 远景 / 地面
    const band = (a, b) => {
      const y0 = Math.floor(im.height * a), y1 = Math.floor(im.height * b);
      const d = g.getImageData(0, y0, im.width, y1 - y0);
      let dark = 0, sum = 0, edge = 0, n = 0, max = 0;
      const hist = new Uint32Array(256);
      for (let y = 1; y < d.height; y++) {
        for (let x = 1; x < d.width; x++) {
          const i = (y * d.width + x) * 4;
          const l = (d.data[i] + d.data[i+1] + d.data[i+2]) / 3;
          sum += l; if (l < 18) dark++;
          hist[Math.min(255, Math.round(l))]++; if (l > max) max = l;
          const li = (y * d.width + x - 1) * 4;
          const l2 = (d.data[li] + d.data[li+1] + d.data[li+2]) / 3;
          if (Math.abs(l - l2) > 12) edge++;
          n++;
        }
      }
      let acc = 0, p99 = 0;
      for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.01) { p99 = v; break; } }
      return { dark: +(dark / n * 100).toFixed(1), luma: +(sum / n).toFixed(1), edge: +(edge / n * 100).toFixed(1),
        max, p99 };
    };
    return JSON.stringify({ size: [im.width, im.height], sky: band(0, 0.35), mid: band(0.35, 0.62), ground: band(0.62, 1) });
    const y0 = 0;
    const d = null;
    let dark = 0, sum = 0, edge = 0, n = 0;
    for (let y = 1; y < d.height; y++) {
      for (let x = 1; x < d.width; x++) {
        const i = (y * d.width + x) * 4;
        const l = (d.data[i] + d.data[i+1] + d.data[i+2]) / 3;
        sum += l;
        if (l < 18) dark++;
        // 和左/上邻居的亮度差 > 12 记一次边缘
        const li = (y * d.width + x - 1) * 4;
        const l2 = (d.data[li] + d.data[li+1] + d.data[li+2]) / 3;
        if (Math.abs(l - l2) > 12) edge++;
        n++;
      }
    }

  })()`)
);

console.log(`${tag}: ${JSON.stringify(stat)}`);
const warn = c.logs.filter(l => /terrain|texture/i.test(l)).slice(0, 4);
if (warn.length) console.log('warn:', warn.join(' | '));
await c.close?.();
process.exit(0);
