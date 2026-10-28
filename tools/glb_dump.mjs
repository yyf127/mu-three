import { readFileSync } from 'node:fs';

const buf = readFileSync(process.argv[2]);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// GLB header
const magic = dv.getUint32(0, true);
const len = dv.getUint32(8, true);
let off = 12;
let json = null, bin = null;
while (off < len) {
  const clen = dv.getUint32(off, true);
  const ctype = dv.getUint32(off + 4, false); // chunk type 是大端 ASCII
  const data = buf.subarray(off + 8, off + 8 + clen);
  if (ctype === 0x4a534f4e) json = JSON.parse(new TextDecoder().decode(data));
  else if (ctype === 0x004e4942 || ctype === 0x42494e00) bin = data;
  off += 8 + clen + ((4 - (clen % 4)) % 4);
}
console.log('nodes', json.nodes?.length, 'meshes', json.meshes?.length ?? 0, 'anims', json.animations?.length, 'skins', json.skins?.length);

const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(i) {
  const acc = json.accessors[i];
  const bv = json.bufferViews[acc.bufferView];
  const TA = CT[acc.componentType];
  const n = NC[acc.type];
  const start = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || 0;
  const out = [];
  if (!stride || stride === n * TA.BYTES_PER_ELEMENT) {
    const arr = new TA(bin.buffer, bin.byteOffset + start, acc.count * n);
    return Array.from(arr);
  }
  for (let k = 0; k < acc.count; k++) {
    const a = new TA(bin.buffer, bin.byteOffset + start + k * stride, n);
    out.push(...a);
  }
  return out;
}

// 找 skin 关节名
const skin = json.skins?.[0];
const jointNames = skin ? skin.joints.map(j => json.nodes[j].name) : [];
console.log('joints', jointNames.length, jointNames.slice(0, 8));

// 找指定动画（传参：动画名 / 节点名）
const animName = process.argv[3];
const nodeName = process.argv[4];
const anim = json.animations.find(a => a.name === animName);
if (!anim) {
  console.log('animation not found; sample names:', json.animations.slice(0, 5).map(a => a.name));
  process.exit(0);
}
const nodeIdx = json.nodes.findIndex(n => n.name === nodeName);
console.log('anim', anim.name, 'channels', anim.channels.length, 'node', nodeName, nodeIdx);

for (const ch of anim.channels) {
  if (ch.target.node !== nodeIdx) continue;
  const sampler = anim.samplers[ch.sampler];
  const t = readAccessor(sampler.input);
  const v = readAccessor(sampler.output);
  const n = NC[json.accessors[sampler.output].type];
  console.log('  path', ch.target.path, 'interp', sampler.interpolation, 'keys', t.length, 'first3times', t.slice(0, 3).map(x => +x.toFixed(4)));
  const show = [];
  for (let k = 0; k < Math.min(4, t.length); k++) show.push(v.slice(k * n, k * n + n).map(x => +x.toFixed(5)));
  console.log('  first values', JSON.stringify(show));
}
