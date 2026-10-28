import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePng(buf) {
  let pos = 8, width = 0, height = 0, colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride)); p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) { const s = x * ch, d = (y * width + x) * 4;
      out[d] = line[s]; out[d+1] = line[s+1]; out[d+2] = line[s+2]; out[d+3] = ch === 4 ? line[s+3] : 255; }
    prev = line;
  }
  return { width, height, rgba: out };
}

const a = decodePng(readFileSync('shots/tile-scale-div4.png'));
const b = decodePng(readFileSync('shots/tile-scale-div1.png'));
const W = Math.min(a.width, b.width), H = Math.min(a.height, b.height);
const band = (y0, y1) => {
  let diff = 0, n = 0, changed = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const d = (Math.abs(a.rgba[i]-b.rgba[i]) + Math.abs(a.rgba[i+1]-b.rgba[i+1]) + Math.abs(a.rgba[i+2]-b.rgba[i+2])) / 3;
    diff += d; if (d > 6) changed++; n++;
  }
  return { meanDiff: +(diff/n).toFixed(2), changedPct: +(changed/n*100).toFixed(1) };
};
console.log('整幅    ', JSON.stringify(band(0, H)));
console.log('下半屏  ', JSON.stringify(band(Math.floor(H*0.5), H)));
console.log('天空带  ', JSON.stringify(band(0, Math.floor(H*0.3))));
