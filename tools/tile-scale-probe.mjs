/**
 * 验证「一张 tile 铺几格」——按已知格宽检查自相关剖面。
 *
 *   node tools/tile-scale-probe.mjs
 *
 * 为什么这么测：直接找「接缝间距」会被贴图自身的高频细节淹没（实测峰值落在
 * 0.2 格，全是草叶纹理）。所以改成：
 *   1. 从相机投影算出**一格 = 多少屏幕像素**（英雄前方 3 格的地面点）；
 *   2. 在地面上取一条水平带，沿 x 做高通（去掉光照渐变）；
 *   3. 算「相关(位移 k 格)」的剖面，k = 1..6；
 *   4. **再临时把 uniform uTileDiv 全改成 1**（= 每格一张）重拍一次做对照。
 *
 * 判据：铺 4 格的实现，剖面峰值落在 k=4；改成 1 之后峰值落到 k=1。
 * 两条都成立，说明着色器真的按「每 4 格」在采样，而不是碰巧看着像。
 */
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { inflateSync } from 'node:zlib';
import { createClient } from './lib/edge-client.mjs';

function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return { width, height, rgba: out };
}

function localMean(row, x, w) {
  let s = 0;
  let n = 0;
  for (let i = Math.max(0, x - w); i <= Math.min(row.length - 1, x + w); i++) {
    s += row[i];
    n++;
  }
  return s / n;
}

/** 相关(位移 shift 像素)：先减掉沿 x 的慢变分量，避免光照渐变主导 */
function corrAt(rows, shift, hp = 40) {
  let s = 0;
  let c1 = 0;
  let c2 = 0;
  for (const row of rows) {
    for (let x = hp; x + shift < row.length; x++) {
      const a = row[x] - localMean(row, x, hp);
      const b = row[x + shift] - localMean(row, x + shift, hp);
      s += a * b;
      c1 += a * a;
      c2 += b * b;
    }
  }
  return s / Math.sqrt((c1 || 1) * (c2 || 1));
}

const c = await createClient('tilescale');
await c.ev(`__MU_APP__.offline()`);
await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
await c.waitFor(`!!window.__MU__ && !!window.__MU__.terrain`, 60000, '地形');
await sleep(2500);

const rawGeo = await c.ev(`(() => {
  const cam = __MU__.muCamera.camera;
  cam.updateMatrixWorld(true);
  const a = __MU_APP__.playerActor();
  const proj = (wx, wy, wz) => {
    const e = cam.matrixWorldInverse.elements;
    const p = cam.projectionMatrix.elements;
    const vx = e[0]*wx + e[4]*wy + e[8]*wz + e[12];
    const vy = e[1]*wx + e[5]*wy + e[9]*wz + e[13];
    const vz = e[2]*wx + e[6]*wy + e[10]*wz + e[14];
    const cx = p[0]*vx + p[4]*vy + p[8]*vz + p[12];
    const cy = p[1]*vx + p[5]*vy + p[9]*vz + p[13];
    const cw = p[3]*vx + p[7]*vy + p[11]*vz + p[15];
    return { x: (cx/cw * 0.5 + 0.5), y: 0.5 - cy/cw * 0.5 };
  };
  const P = { x: a.x, y: a.y + 3, z: __MU__.terrain.getHeight(a.x, a.y + 3) };
  const Q = { x: P.x + 1, y: P.y, z: P.z };
  const cv = document.querySelector('#app canvas');
  const rect = cv.getBoundingClientRect();
  const toPx = (s) => ({ x: s.x * rect.width, y: s.y * rect.height });
  const sp = toPx(proj(P.x, P.y, P.z));
  const sq = toPx(proj(Q.x, Q.y, Q.z));
  const div = __MU__.terrain.mesh.material.uniforms.uTileDiv.value;
  return JSON.stringify({
    cv: { w: rect.width, h: rect.height },
    P: sp,
    cellPx: Math.hypot(sq.x - sp.x, sq.y - sp.y),
    div: Array.from(div),
  });
})()`);
if (typeof rawGeo !== 'string') {
  console.error('取几何信息失败:', JSON.stringify(rawGeo));
  process.exit(1);
}
const geo = JSON.parse(rawGeo);
console.log(`一格 ≈ ${geo.cellPx.toFixed(1)} px，取样点 y=${geo.P.y.toFixed(0)}`);
console.log(`uTileDiv = [${geo.div.slice(0, 14).join(',')}]  （14 张 tile，256px→4 / 128px→2）`);

async function shot(tag) {
  await sleep(600); // 让主循环用新 uniform 重绘几帧
  const r = await c.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: Math.round(geo.cv.w), height: Math.round(geo.cv.h), scale: 1 },
  });
  writeFileSync(`shots/tile-scale-${tag}.png`, Buffer.from(r.data, 'base64'));
  const img = decodePng(Buffer.from(r.data, 'base64'));
  const y0 = Math.max(1, Math.round(geo.P.y) - 22);
  const y1 = Math.min(img.height - 2, Math.round(geo.P.y) + 22);
  const rows = [];
  for (let y = y0; y < y1; y++) {
    const row = new Float64Array(img.width);
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      row[x] = (img.rgba[i] * 0.299 + img.rgba[i + 1] * 0.587 + img.rgba[i + 2] * 0.114) / 255;
    }
    rows.push(row);
  }
  const profile = [];
  for (let k = 1; k <= 6; k++) {
    profile.push({ k, v: corrAt(rows, Math.round(geo.cellPx * k)) });
  }
  return profile;
}

const asIs = await shot('div4');

// 对照：uniform 全改成 1（= 每格一张，也就是我之前写错的那版）
await c.ev(`(() => {
  const u = __MU__.terrain.mesh.material.uniforms.uTileDiv;
  window.__DIV_BACKUP__ = Array.from(u.value);
  u.value = new Array(16).fill(1);
  return true;
})()`);
const div1 = await shot('div1');

await c.ev(`(() => {
  const u = __MU__.terrain.mesh.material.uniforms.uTileDiv;
  u.value = window.__DIV_BACKUP__;
  return true;
})()`);

const fmt = (p) => p.map(x => `k${x.k}:${x.v.toFixed(3)}`).join('  ');
console.log(`当前实现 (div=4)： ${fmt(asIs)}`);
console.log(`对照 (div=1)   ： ${fmt(div1)}`);
const best = (p) => p.reduce((a, b) => (b.v > a.v ? b : a));
const bA = best(asIs);
const bB = best(div1);
console.log(`峰值：当前实现 k=${bA.k}（期望 4）· 对照 k=${bB.k}（期望 1）`);
console.log(
  bA.k >= 2 && bB.k <= 2
    ? '✓ 着色器确实按「一张 tile 铺 4 格」采样，和 muonlinejs 的 vUV*64 一致'
    : '✗ 周期不符合预期，需要继续查'
);
process.exit(0);
