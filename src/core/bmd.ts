/**
 * BMD 模型解析器（原版 MU .bmd，版本 10 / 12）。
 *
 * 布局与 muonlinejs 的 BMDReader 一致：
 *   [0..3]   "BMD" + version
 *   [4..36]  name（32 byte ASCII）
 *   [36..]   meshCount / boneCount / actionCount (uint16 ×3)
 *   然后依次是 meshes、actions、bones。
 *
 * version 12 的文件是加密的（前 8 字节为明文头，其后为加密数据）。
 */
import { ByteReader, readStr } from './bytes';
import { decryptMapFile } from './crypto';

const SIZE_VERTEX = 16;
const SIZE_NORMAL = 20;
const SIZE_TEXCOORD = 8;
const SIZE_TRIANGLE = 64;

export interface BmdVertex {
  node: number;
  x: number;
  y: number;
  z: number;
}

export interface BmdNormal {
  node: number;
  x: number;
  y: number;
  z: number;
  bindVertex: number;
}

export interface BmdTriangle {
  polygon: number;
  vertexIndex: number[];
  normalIndex: number[];
  texCoordIndex: number[];
}

export interface BmdMesh {
  vertices: BmdVertex[];
  normals: BmdNormal[];
  texCoords: { u: number; v: number }[];
  triangles: BmdTriangle[];
  texturePath: string;
  /** 蒙皮网格需要骨骼（顶点带 bone 索引） */
  isSkinned: boolean;
}

export interface BmdBone {
  name: string;
  parent: number;
  dummy: boolean;
  /** 每个 action 一组：位置 frames×3（骨骼局部空间） */
  positions: Float32Array[];
  /** 每个 action 一组：四元数 frames×4 */
  quaternions: Float32Array[];
}

export interface BmdAction {
  numKeys: number;
  lockPositions: boolean;
  positions: Float32Array | null;
}

export interface Bmd {
  version: number;
  name: string;
  meshes: BmdMesh[];
  bones: BmdBone[];
  actions: BmdAction[];
}

/** DirectX 风格 yaw-pitch-roll → 四元数（z=yaw, y=pitch, x=roll） */
export function angleToQuaternion(
  rx: number,
  ry: number,
  rz: number,
  out: Float32Array,
  outOffset: number
) {
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

function normalizeBuffer(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 8) throw new Error('BMD: 文件太小');
  const type = readStr(bytes, 0, 3);
  if (type !== 'BMD') throw new Error(`BMD: 文件类型不匹配 (${type})`);

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
    // v15 尾部带 4 字节校验，结构同 v12
    const payload = decryptMapFile(bytes.subarray(8, bytes.length - 4));
    const out = new Uint8Array(4 + payload.length);
    out.set(bytes.subarray(0, 4), 0);
    out.set(payload, 4);
    return out;
  }

  // 其它版本（极少见）按未加密处理，尽量兼容
  return bytes;
}

export function parseBmd(raw: Uint8Array): Bmd {
  const bytes = normalizeBuffer(raw);
  const r = new ByteReader(bytes);

  const version = bytes[3];
  r.seek(4);
  const name = r.str(32);

  const meshCount = r.u16();
  const boneCount = r.u16();
  const actionCount = r.u16();

  const meshes: BmdMesh[] = [];

  for (let i = 0; i < meshCount; i++) {
    const numVertices = r.i16();
    const numNormals = r.i16();
    const numTexCoords = r.i16();
    const numTriangles = r.i16();
    r.i16(); // texture index，忽略

    const vertices: BmdVertex[] = new Array(numVertices);
    for (let v = 0; v < numVertices; v++) {
      const node = r.i16();
      r.skip(2);
      vertices[v] = { node, x: r.f32(), y: r.f32(), z: r.f32() };
    }

    const normals: BmdNormal[] = new Array(numNormals);
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

    const texCoords: { u: number; v: number }[] = new Array(numTexCoords);
    for (let t = 0; t < numTexCoords; t++) {
      texCoords[t] = { u: r.f32(), v: r.f32() };
    }

    const triangles: BmdTriangle[] = new Array(numTriangles);
    for (let t = 0; t < numTriangles; t++) {
      // 三角形是固定 64 字节结构（含 4 组 lightmap uv），必须按固定步长推进
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
      texturePath: '',
      isSkinned: false,
    });

    meshes[meshes.length - 1].texturePath = r.str(32);
    meshes[meshes.length - 1].isSkinned = vertices.some(v => v.node > 0);
  }

  const actions: BmdAction[] = new Array(actionCount);
  for (let i = 0; i < actionCount; i++) {
    const numKeys = r.i16();
    const lockPositions = r.u8() === 1;
    let positions: Float32Array | null = null;
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

  const bones: BmdBone[] = new Array(boneCount);
  for (let i = 0; i < boneCount; i++) {
    const dummy = r.u8() === 1;
    if (dummy) {
      bones[i] = {
        name: `Dummy_${i}`,
        parent: -1,
        dummy: true,
        positions: [],
        quaternions: [],
      };
      continue;
    }

    const boneName = r.str(32);
    const parent = r.i16();

    const positions: Float32Array[] = [];
    const quaternions: Float32Array[] = [];

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
