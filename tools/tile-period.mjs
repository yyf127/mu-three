/**
 * 量「地面纹理的重复周期」——判断一张 tile 到底铺几格。
 *
 *   node tools/tile-period.mjs shots/terrain-atlas.png shots/terrain-quarter.png
 *
 * 原理：把地面上一条水平带的亮度序列做**自相关**，找最强周期。
 *   一张 tile 铺 1 格 → 周期 = 1 个格子
 *   一张 tile 铺 4 格 → 周期 = 4 个格子 ≈ 4 倍像素
 * 相机、出生点、截图流程都和 terrain-shot.mjs 一致，所以两张图的
 * 「一格 = 多少像素」是同一个尺度，周期可以直接比。
 *
 * 这里自带一个最小 PNG 解码（zlib + 5 种 filter），不引入新依赖。
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** 解 8 位 RGB/RGBA 的 PNG，返回 { width, height, rgba } */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported png depth=${bitDepth} color=${colorType}`);
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

/** 对若干行的亮度做归一化自相关，返回最强周期（像素）与强度 */
function dominantPeriod(img, y0, y1) {
  const { width, rgba } = img;
  const rows = [];
  for (let y = y0; y < y1; y += 2) {
    const row = new Float64Array(width);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      row[x] = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114) / 255;
    }
    // 去均值 + 去线性趋势（远处到近处本身是渐变的，否则自相关被低频吞掉）
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (let x = 0; x < width; x++) {
      sx += x;
      sy += row[x];
      sxx += x * x;
      sxy += x * row[x];
    }
    const n = width;
    const den = n * sxx - sx * sx || 1;
    const slope = (n * sxy - sx * sy) / den;
    const icept = (sy - slope * sx) / n;
    let mean = 0;
    for (let x = 0; x < width; x++) {
      row[x] -= slope * x + icept;
      mean += row[x];
    }
    mean /= n;
    for (let x = 0; x < n; x++) row[x] -= mean;
    rows.push(row);
  }

  const maxLag = Math.min(240, Math.floor(width / 3));
  const score = new Float64Array(maxLag + 1);
  for (let lag = 4; lag <= maxLag; lag++) {
    let s = 0;
    let c1 = 0;
    let c2 = 0;
    for (const row of rows) {
      for (let x = 0; x + lag < row.length; x++) {
        s += row[x] * row[x + lag];
        c1 += row[x] * row[x];
        c2 += row[x + lag] * row[x + lag];
      }
    }
    score[lag] = s / Math.sqrt((c1 || 1) * (c2 || 1));
  }

  // 找局部极大
  const peaks = [];
  for (let lag = 5; lag < maxLag; lag++) {
    if (score[lag] > score[lag - 1] && score[lag] >= score[lag + 1]) {
      peaks.push({ lag, v: score[lag] });
    }
  }
  peaks.sort((a, b) => b.v - a.v);
  return peaks.slice(0, 4);
}

for (const file of process.argv.slice(2)) {
  const img = decodePng(readFileSync(file));
  const y0 = Math.floor(img.height * 0.66);
  const y1 = Math.floor(img.height * 0.80);
  const peaks = dominantPeriod(img, y0, y1);
  console.log(
    `${file}  ${img.width}x${img.height}  带 y=${y0}..${y1}\n  ` +
      peaks.map(p => `lag=${p.lag}px 相关=${p.v.toFixed(3)}`).join('   ')
  );
}
