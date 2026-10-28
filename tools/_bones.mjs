// tools/_bones.ts
import { readFileSync } from "node:fs";

// src/core/bytes.ts
var ByteReader = class {
  constructor(bytes, offset = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = offset;
  }
  view;
  pos = 0;
  seek(p) {
    this.pos = p;
    return this;
  }
  skip(n) {
    this.pos += n;
    return this;
  }
  u8() {
    return this.view.getUint8(this.pos++);
  }
  i8() {
    return this.view.getInt8(this.pos++);
  }
  u16() {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i16() {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i32() {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u32() {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32() {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  /** 固定长度、以 \0 结尾的 ASCII 字符串 */
  str(len) {
    const start = this.pos;
    const end = start + len;
    let out = "";
    for (let i = start; i < end; i++) {
      const c = this.bytes[i];
      if (c === 0) break;
      out += String.fromCharCode(c);
    }
    this.pos = end;
    return out;
  }
  get remaining() {
    return this.bytes.length - this.pos;
  }
};
function readStr(bytes, from, to) {
  let out = "";
  for (let i = from; i < to; i++) {
    const c = bytes[i];
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

// src/core/crypto.ts
var XOR_KEY = new Uint8Array([
  209,
  115,
  82,
  246,
  210,
  154,
  203,
  39,
  62,
  175,
  89,
  49,
  55,
  179,
  231,
  162
]);
var BUX_CODE = new Uint8Array([252, 207, 171]);
function decryptMapFile(src, size = src.length) {
  const dst = new Uint8Array(size);
  let key = 94;
  for (let i = 0; i < size; i++) {
    const b = src[i];
    dst[i] = (b ^ XOR_KEY[i % 16]) - (key & 255) & 255;
    key = b + 61 & 255;
  }
  return dst;
}

// src/core/bmd.ts
var SIZE_TRIANGLE = 64;
function angleToQuaternion(rx, ry, rz, out, outOffset) {
  const sr = Math.sin(rx * 0.5);
  const cr = Math.cos(rx * 0.5);
  const sp = Math.sin(ry * 0.5);
  const cp = Math.cos(ry * 0.5);
  const sy = Math.sin(rz * 0.5);
  const cy = Math.cos(rz * 0.5);
  out[outOffset + 0] = sr * cp * cy - cr * sp * sy;
  out[outOffset + 1] = cr * sp * cy + sr * cp * sy;
  out[outOffset + 2] = cr * cp * sy - sr * sp * cy;
  out[outOffset + 3] = cr * cp * cy + sr * sp * sy;
}
function normalizeBuffer(bytes) {
  if (bytes.length < 8) throw new Error("BMD: \u6587\u4EF6\u592A\u5C0F");
  const type = readStr(bytes, 0, 3);
  if (type !== "BMD") throw new Error(`BMD: \u6587\u4EF6\u7C7B\u578B\u4E0D\u5339\u914D (${type})`);
  const version = bytes[3];
  if (version === 10) return bytes;
  if (version === 12) {
    const payload = decryptMapFile(bytes.subarray(8));
    const out = new Uint8Array(4 + payload.length);
    out.set(bytes.subarray(0, 4), 0);
    out.set(payload, 4);
    return out;
  }
  if (version === 15) {
    const payload = decryptMapFile(bytes.subarray(8, bytes.length - 4));
    const out = new Uint8Array(4 + payload.length);
    out.set(bytes.subarray(0, 4), 0);
    out.set(payload, 4);
    return out;
  }
  return bytes;
}
function parseBmd(raw) {
  const bytes = normalizeBuffer(raw);
  const r = new ByteReader(bytes);
  const version = bytes[3];
  r.seek(4);
  const name = r.str(32);
  const meshCount = r.u16();
  const boneCount = r.u16();
  const actionCount = r.u16();
  const meshes = [];
  for (let i = 0; i < meshCount; i++) {
    const numVertices = r.i16();
    const numNormals = r.i16();
    const numTexCoords = r.i16();
    const numTriangles = r.i16();
    r.i16();
    const vertices = new Array(numVertices);
    for (let v = 0; v < numVertices; v++) {
      const node = r.i16();
      r.skip(2);
      vertices[v] = { node, x: r.f32(), y: r.f32(), z: r.f32() };
    }
    const normals = new Array(numNormals);
    for (let n = 0; n < numNormals; n++) {
      const node = r.i16();
      r.skip(2);
      const x = r.f32();
      const y = r.f32();
      const z = r.f32();
      const bindVertex = r.i16();
      r.skip(2);
      normals[n] = { node, x, y, z, bindVertex };
    }
    const texCoords = new Array(numTexCoords);
    for (let t = 0; t < numTexCoords; t++) {
      texCoords[t] = { u: r.f32(), v: r.f32() };
    }
    const triangles = new Array(numTriangles);
    for (let t = 0; t < numTriangles; t++) {
      const start = r.pos;
      const polygon = r.u8();
      r.skip(1);
      const vertexIndex = [r.i16(), r.i16(), r.i16(), r.i16()];
      const normalIndex = [r.i16(), r.i16(), r.i16(), r.i16()];
      const texCoordIndex = [r.i16(), r.i16(), r.i16(), r.i16()];
      triangles[t] = { polygon, vertexIndex, normalIndex, texCoordIndex };
      r.seek(start + SIZE_TRIANGLE);
    }
    meshes.push({
      vertices,
      normals,
      texCoords,
      triangles,
      texturePath: "",
      isSkinned: false
    });
    meshes[meshes.length - 1].texturePath = r.str(32);
    meshes[meshes.length - 1].isSkinned = vertices.some((v) => v.node > 0);
  }
  const actions = new Array(actionCount);
  for (let i = 0; i < actionCount; i++) {
    const numKeys = r.i16();
    const lockPositions = r.u8() === 1;
    let positions = null;
    if (lockPositions && numKeys > 0) {
      positions = new Float32Array(numKeys * 3);
      for (let k = 0; k < numKeys; k++) {
        positions[k * 3 + 0] = r.f32();
        positions[k * 3 + 1] = r.f32();
        positions[k * 3 + 2] = r.f32();
      }
    }
    actions[i] = { numKeys, lockPositions, positions };
  }
  const bones = new Array(boneCount);
  for (let i = 0; i < boneCount; i++) {
    const dummy = r.u8() === 1;
    if (dummy) {
      bones[i] = {
        name: `Dummy_${i}`,
        parent: -1,
        dummy: true,
        positions: [],
        quaternions: []
      };
      continue;
    }
    const boneName = r.str(32);
    const parent = r.i16();
    const positions = [];
    const quaternions = [];
    for (let a = 0; a < actionCount; a++) {
      const numKeys = actions[a].numKeys;
      const pos = new Float32Array(numKeys * 3);
      for (let k = 0; k < numKeys; k++) {
        pos[k * 3 + 0] = r.f32();
        pos[k * 3 + 1] = r.f32();
        pos[k * 3 + 2] = r.f32();
      }
      const quat = new Float32Array(numKeys * 4);
      for (let k = 0; k < numKeys; k++) {
        const rx = r.f32();
        const ry = r.f32();
        const rz = r.f32();
        angleToQuaternion(rx, ry, rz, quat, k * 4);
      }
      positions.push(pos);
      quaternions.push(quat);
    }
    bones[i] = { name: boneName, parent, dummy: false, positions, quaternions };
  }
  return { version, name, meshes, bones, actions };
}

// tools/_bones.ts
var ROOT = "D:/Project/H5_mu/muonlinejs-master/public/Data/";
var rels = process.argv.slice(2);
for (const rel of rels) {
  try {
    const b = parseBmd(new Uint8Array(readFileSync(ROOT + rel)));
    console.log(`== ${rel}  bones=${b.bones.length} meshes=${b.meshes.length} actions=${b.actions.length}`);
    if (b.bones.length < 80) {
      b.bones.forEach((bone, i) => {
        console.log(`   ${String(i).padStart(3)} ${bone.name} parent=${bone.parent}`);
      });
    } else {
      for (const i of [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50]) {
        const bone = b.bones[i];
        console.log(`   ${i} ${bone?.name} parent=${bone?.parent}`);
      }
    }
    console.log("   actions:", b.actions.map((a, i) => `${i}:${a.numKeys}`).join(" "));
  } catch (e) {
    console.log(`== ${rel} FAIL ${e.message}`);
  }
}
