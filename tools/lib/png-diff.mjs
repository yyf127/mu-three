/**
 * 极简 PNG 解码 + 截图差异统计（无第三方依赖，只用 node 内置 zlib）。
 *
 * 用途：探针里没法「用眼睛看」，就用量化指标判断 ——
 *   · 两张截图有多少像素变了（`changed`）
 *   · 变化集中在哪块区域（`bbox`，用来确认改动确实落在角色身上而不是整屏）
 *   · 目标区域的平均亮度变化（`meanLumDelta`，判断「变亮」而不是「变色」）
 *
 * 只支持 8bit 非隔行的 RGB/RGBA/灰度（CDP 截图就是 8bit RGBA）。
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function decodePng(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');

  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  const idat = [];

  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('不支持隔行 PNG');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }

  if (depth !== 8) throw new Error(`不支持的位深 ${depth}`);
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!bpp) throw new Error(`不支持的颜色类型 ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const cc = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      switch (ft) {
        case 0:
          break;
        case 1:
          v = (v + a) & 255;
          break;
        case 2:
          v = (v + b) & 255;
          break;
        case 3:
          v = (v + ((a + b) >> 1)) & 255;
          break;
        case 4: {
          const p = a + b - cc;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - cc);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc)) & 255;
          break;
        }
        default:
          throw new Error(`未知滤波器 ${ft}`);
      }
      cur[i] = v;
    }
    for (let x = 0; x < width; x++) {
      const s = x * bpp;
      const d = (y * width + x) * 4;
      out[d] = cur[s];
      out[d + 1] = bpp >= 3 ? cur[s + 1] : cur[s];
      out[d + 2] = bpp >= 3 ? cur[s + 2] : cur[s];
      out[d + 3] = bpp === 4 ? cur[s + 3] : 255;
    }
    prev = cur;
  }

  return { width, height, data: out };
}

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * 两张同尺寸截图的差异。
 *
 * @param {ReturnType<typeof decodePng>} a
 * @param {ReturnType<typeof decodePng>} b
 * @param {number} [threshold] 单像素亮度差超过多少算「变了」（0..255）
 */
export function diffPng(a, b, threshold = 8) {
  // 视口高度可能因为地址栏/缩放差几个像素，按公共区域比就行
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  let changed = 0;
  let sumDelta = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * a.width + x) * 4;
      const j = (y * b.width + x) * 4;
      const d = Math.abs(
        lum(a.data[i], a.data[i + 1], a.data[i + 2]) - lum(b.data[j], b.data[j + 1], b.data[j + 2])
      );
      if (d <= threshold) continue;
      changed++;
      sumDelta += d;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  return {
    width,
    height,
    total: width * height,
    changed,
    ratio: changed / (width * height),
    meanDelta: changed ? +(sumDelta / changed).toFixed(2) : 0,
    bbox: maxX >= 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
  };
}

/** 矩形区域的 RGB 均值（用来比较「同一块地方谁更亮」） */
export function meanRgb(img, rect) {
  const { width } = img;
  const x0 = Math.max(0, rect.x | 0);
  const y0 = Math.max(0, rect.y | 0);
  const x1 = Math.min(width, x0 + rect.w);
  const y1 = Math.min(img.height, y0 + rect.h);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
      n++;
    }
  }
  if (!n) return { r: 0, g: 0, b: 0, lum: 0, n: 0 };
  r /= n;
  g /= n;
  b /= n;
  return { r: +r.toFixed(1), g: +g.toFixed(1), b: +b.toFixed(1), lum: +lum(r, g, b).toFixed(2), n };
}
