/**
 * 技能特效「强度」盘点：生成了 ≠ 看得见。
 *
 * 对每个技能：先截一张无特效的基准图，cast 之后连拍几张，取变化最大的那张，
 * 报三个数：
 *   - `pct`   变化像素占画面的比例（> 1% 才算明显）
 *   - `gain`  变化像素的平均亮度增量（加色特效应该 > 20）
 *   - `px`    变化像素的包围盒边长（< 20 px 基本看不出来）
 *
 *   node tools/fx-strength.mjs            # 默认查一批代表性技能
 *   node tools/fx-strength.mjs 4 5 12     # 指定技能号
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('fxstrength');

const DEFAULT_IDS = [1, 2, 4, 5, 9, 12, 14, 16, 27, 42, 43, 48, 56];

await c.ev(`__MU_APP__.offline()`);
await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
await c.waitFor(`!!__MU_APP__.playerActor()`, 60000, '角色');
await c.waitFor(`!!__MU_APP__.skillTarget()`, 30000, '靶子');
await sleep(1500);
await c.ev(`__MU_APP__.previewEquip({ cls: 1, safeZone: false, weapon: 0 })`);
await sleep(400);

const all = await c.ev(`__MU_APP__.skills()`);
const only = process.argv.slice(2).map(Number).filter(Number.isFinite);
const list = only.length ? all.filter(s => only.includes(s.id)) : all.filter(s => DEFAULT_IDS.includes(s.id));

/** 靶子附近的取景框 */
async function clipAt(w = 520, h = 460, lift = 1.2) {
  const raw = await c.ev(`(() => {
    const t = __MU_APP__.skillTarget();
    const p = __MU_DEBUG__.project(t.x, t.y, t.z + ${lift});
    return JSON.stringify(p);
  })()`);
  const p = JSON.parse(raw);
  return { x: Math.max(0, p.x - w / 2), y: Math.max(0, p.y - h * 0.6), width: w, height: h, scale: 1 };
}

/** 页面内比两帧：返回变化像素数、平均亮度增量、包围盒 */
async function measure(a, b) {
  return JSON.parse(
    await c.ev(`(async () => {
      const load = async (b64) => {
        const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
        const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
        const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
        return { d: g.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height };
      };
      const x = await load(${JSON.stringify(a)}), y = await load(${JSON.stringify(b)});
      let n = 0, gain = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
      for (let i = 0; i < x.d.length; i += 4) {
        const dx = Math.abs(x.d[i]-y.d[i]) + Math.abs(x.d[i+1]-y.d[i+1]) + Math.abs(x.d[i+2]-y.d[i+2]);
        if (dx > 40) {
          n++;
          gain += ((y.d[i]+y.d[i+1]+y.d[i+2]) - (x.d[i]+x.d[i+1]+x.d[i+2])) / 3;
          const px = (i / 4) % x.w, py = Math.floor((i / 4) / x.w);
          if (px < minX) minX = px; if (px > maxX) maxX = px;
          if (py < minY) minY = py; if (py > maxY) maxY = py;
        }
      }
      return JSON.stringify({
        n, total: x.d.length / 4, gain: n ? Math.round(gain / n) : 0,
        bw: n ? maxX - minX : 0, bh: n ? maxY - minY : 0,
      });
    })()`)
  );
}

console.log('id 技能          占比%   亮度增量  包围盒    判定');
const rows = [];

for (const s of list) {
  if (s.source === 'none') {
    console.log(`${String(s.id).padStart(2)} ${s.name.padEnd(10)} —       —          —        源码无视觉`);
    continue;
  }
  await c.ev(`__MU_APP__.fxClear()`);
  await sleep(260);
  const clip = await clipAt();
  const base = (await c.send('Page.captureScreenshot', { format: 'png', clip })).data;

  await c.ev(`__MU_APP__.castSkill(${s.id})`);
  let best = { n: 0, gain: 0, bw: 0, bh: 0, total: 1 };
  const times = [220, 160, 160, 160, 200];
  for (const wait of times) {
    await sleep(wait);
    const cur = (await c.send('Page.captureScreenshot', { format: 'png', clip })).data;
    const m = await measure(base, cur);
    if (m.n > best.n) best = m;
  }
  const pct = (best.n / best.total) * 100;
  const biggest = Math.max(best.bw, best.bh);
  const verdict =
    pct < 0.4 || biggest < 24 ? '几乎看不见' : pct < 1.2 ? '偏弱' : '正常';
  console.log(
    `${String(s.id).padStart(2)} ${s.name.padEnd(10)} ${pct.toFixed(2).padStart(6)}  ` +
      `${String(best.gain).padStart(6)}  ${String(best.bw)}×${String(best.bh)}`.padEnd(10) +
      `  ${verdict}`
  );
  rows.push({ id: s.id, name: s.name, pct, gain: best.gain, bw: best.bw, bh: best.bh, verdict });
  await sleep(400);
}

const weak = rows.filter(r => r.verdict !== '正常');
console.log(`\n偏弱/看不见 ${weak.length} / ${rows.length}: ${weak.map(r => `${r.id}:${r.name}`).join(', ') || '无'}`);
writeFileSync('shots/fx-strength.json', JSON.stringify(rows, null, 2));
await c.close?.();
process.exit(0);
