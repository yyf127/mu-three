/**
 * 贴图体检：把 `Data/Effect/*.OZJ` 丢进页面解码，报尺寸与「4×4 切分后每格的均值」。
 *
 *   node tools/tex-audit.mjs Effect/Explotion01.OZJ
 *   node tools/tex-audit.mjs Effect/Explotion01.OZJ Effect/Flame01.OZJ
 *
 * 用来判断「图集是不是 4×4」「某一格是不是整片白」——
 * 图集切错了 / 帧内容是白底，加色混合出来就是一大块白斑。
 */
import { createClient } from './lib/edge-client.mjs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('用法: node tools/tex-audit.mjs <Effect/xxx.OZJ> [...]');
  process.exit(1);
}

const c = await createClient('texaudit');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');

  for (const file of files) {
    const r = await c.ev(`(async () => {
      const url = '/Data/' + ${JSON.stringify(file)};
      const im = new Image();
      im.src = url;
      try { await im.decode(); } catch (e) { return JSON.stringify({ error: 'decode', url }); }
      const cv = document.createElement('canvas');
      cv.width = im.width; cv.height = im.height;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(im, 0, 0);

      // 4×4 切分
      const cw = Math.floor(im.width / 4), ch = Math.floor(im.height / 4);
      const cells = [];
      for (let ry = 0; ry < 4; ry++) {
        for (let rx = 0; rx < 4; rx++) {
          const d = g.getImageData(rx * cw, ry * ch, cw, ch).data;
          let sr = 0, sg = 0, sb = 0, n = 0, bright = 0;
          for (let i = 0; i < d.length; i += 4) {
            const l = (d[i] + d[i+1] + d[i+2]) / 3;
            sr += d[i]; sg += d[i+1]; sb += d[i+2]; n++;
            if (l > 240) bright++;
          }
          cells.push({
            cell: [rx, ry],
            rgb: [Math.round(sr/n), Math.round(sg/n), Math.round(sb/n)],
            white: +(bright/n*100).toFixed(1),
          });
        }
      }
      // 整图
      const all = g.getImageData(0, 0, im.width, im.height).data;
      let br = 0, tot = 0;
      for (let i = 0; i < all.length; i += 4) {
        if ((all[i]+all[i+1]+all[i+2])/3 > 240) br++;
        tot++;
      }
      return JSON.stringify({ w: im.width, h: im.height, whiteAll: +(br/tot*100).toFixed(1), cells });
    })()`);
    const info = JSON.parse(r);
    console.log(`\n== ${file}`);
    if (info.error) { console.log('  解码失败', info.url); continue; }
    console.log(`  尺寸 ${info.w}x${info.h}  纯白占比 ${info.whiteAll}%`);
    for (const cell of info.cells) {
      console.log(`  格[${cell.cell}] 均值 rgb(${cell.rgb.join(',')})  纯白 ${cell.white}%`);
    }
  }
} finally {
  await c.close?.();
}
