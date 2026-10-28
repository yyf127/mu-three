/**
 * BMD → three.js 网格。
 *
 * MU 的蒙皮是"刚体蒙皮"：每个顶点只属于一根骨骼，顶点坐标存储在骨骼局部空间，
 * 渲染时直接用骨骼的模型空间矩阵变换（相当于 inverseBindMatrix = identity）。
 * 因此这里给每个顶点 skinWeight=1、skinIndex=顶点 node，并把 bindMatrix 设为 identity。
 */
import * as THREE from 'three';
import { Bmd, BmdMesh } from './bmd';
import { loadTexture } from './texture';
import { additiveProps, fxAlpha, useAdditiveBlend } from './additive';

/** MU 模型单位 → 地形格（1 格 ≈ 100 MU 单位） */
export const MODEL_SCALE = 0.01;

/** 顶点色（MU 的固定方向光） */
/**
 * 物件/角色/装备的顶点光照（烘进顶点色，材质是 `MeshBasicMaterial`，不额外挂灯）。
 *
 * 原来是一套手调的假光照：`clamp(0.62, 1.0, 0.68 + d * 0.4)`。
 * 对比 `muonline-bmd-viewer` 的场景灯 —— `AmbientLight(0xffffff, 0.6)` +
 * `DirectionalLight(0xfff8e0, 1.0)`（灯位在世界中心偏西北上方，指向中心）——
 * 我们那套的两个问题很直接：
 *   ① **最高只到 1.0**，而 viewer 是 `0.6 + N·L × 1.0`，受光面能到 1.6
 *      —— 所以它的物件更亮、亮暗反差更大，"有体积感"；
 *   ② 光的方向也不一样（我们是 +x/−y/+z，viewer 是 −x/+y/+z）。
 *
 * 这里直接照 viewer 的灯位把同一套式子烘进顶点色：
 *   灯位 ≈ (中心 − 0.65L, 0.65H, 中心 + 0.29L)，目标 = 世界中心
 *   → 指向光源的单位向量（本项目坐标：x/y 是地面、z 向上）≈ (−0.665, 0.30, 0.665)
 *
 * 想再亮/再暗就调 `sun`（1.0 是 viewer 的原值，0.85 稍保守一点，避免过曝）。
 */
const OBJ_LIGHT = {
  ambient: 0.6,
  sun: 0.85,
  dir: new THREE.Vector3(-0.665, 0.3, 0.665).normalize(),
  /** `0xfff8e0` 的暖色（R 不动，G 0.973，B 0.878） */
  tint: [1.0, 0.973, 0.878],
};

export interface Rig {
  root: THREE.Group;
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  boneIndexByName: Map<string, number>;
  bmd: Bmd;
  scale: number;
  /** 每个动作的循环长度：末帧与首帧相同时为 frameCount-1（与客户端一致） */
  loopLen: number[];
}

/** 判断动作末帧是否与首帧相同（MU 的 walk/run 动作末尾会重复首帧） */
function computeLoopLengths(bmd: Bmd) {
  return bmd.actions.map((action, a) => {
    const keys = action.numKeys;
    if (keys <= 2) return keys;

    for (const bone of bmd.bones) {
      const pos = bone.positions[a];
      const quat = bone.quaternions[a];
      if (!pos || pos.length < 6) continue;

      const last = (keys - 1) * 3;
      const dPos =
        Math.abs(pos[last] - pos[0]) +
        Math.abs(pos[last + 1] - pos[1]) +
        Math.abs(pos[last + 2] - pos[2]);
      const lq = (keys - 1) * 4;
      const dQuat =
        Math.abs(quat[lq] - quat[0]) +
        Math.abs(quat[lq + 1] - quat[1]) +
        Math.abs(quat[lq + 2] - quat[2]) +
        Math.abs(quat[lq + 3] - quat[3]);

      if (dPos > 1e-4 || dQuat > 1e-4) return keys;
    }
    return keys - 1;
  });
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

/** 取做 bind pose 的那一帧（action 0 / frame 0） */
export function createRig(bmd: Bmd, scale = MODEL_SCALE): Rig {
  const root = new THREE.Group();
  root.name = `rig:${bmd.name}`;

  const bones: THREE.Bone[] = [];
  const boneIndexByName = new Map<string, number>();

  for (let i = 0; i < bmd.bones.length; i++) {
    const b = new THREE.Bone();
    b.name = bmd.bones[i].name || `bone_${i}`;
    bones.push(b);
    if (!boneIndexByName.has(b.name)) boneIndexByName.set(b.name, i);
  }

  for (let i = 0; i < bmd.bones.length; i++) {
    const parent = bmd.bones[i].parent;
    if (parent < 0 || parent >= bones.length) root.add(bones[i]);
    else bones[parent].add(bones[i]);
  }

  const skeleton = new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4()));

  const rig: Rig = {
    root,
    bones,
    skeleton,
    boneIndexByName,
    bmd,
    scale,
    loopLen: computeLoopLengths(bmd),
  };
  applyActionFrame(rig, 0, 0);
  root.updateMatrixWorld(true);

  return rig;
}

/** 应用某个 action 的某一帧（沿骨骼层级写入局部变换） */
export function applyActionFrame(rig: Rig, actionIndex: number, frame: number) {
  const { bmd, bones, scale } = rig;
  const action = bmd.actions[actionIndex];
  if (!action) return;

  const keys = action.numKeys;
  const f = Math.min(Math.max(frame, 0), Math.max(keys - 1, 0));

  const lockRoot = action.lockPositions;

  for (let i = 0; i < bmd.bones.length; i++) {
    const bone = bones[i];
    const def = bmd.bones[i];
    const posArr = def.positions[actionIndex];
    const quatArr = def.quaternions[actionIndex];
    /*
     * 数据不足的骨骼保持绑定姿态（= 单位变换）。
     *
     * **dummy 骨**（`BmdBone.dummy`）在解析时 `positions/quaternions` 是
     * **空数组** —— 不是 undefined，所以只判 `!posArr` 会漏过去，随后
     * `posArr[frame*3]` 读到 undefined，乘 scale 变 NaN，整条骨链连带顶点
     * 全变 NaN。现象是「场景物件整片消失、骨骼矩阵全是 NaN」。
     * 场景物件（树/窗帘）里 dummy 骨很常见，角色身上几乎没有。
     */
    if (
      keys === 0 ||
      !posArr ||
      !quatArr ||
      posArr.length < keys * 3 ||
      quatArr.length < keys * 4
    ) {
      bone.position.set(0, 0, 0);
      bone.quaternion.identity();
      continue;
    }

    // LockPositions 的动作（走/跑/骑乘）里根骨带着整段位移，
    // 客户端会锁住根骨的 XY 水平位移，改由实体移动逻辑推进。
    const k = lockRoot && i === 0 ? 0 : f;

    /*
     * 关键帧数组用的是 `numKeys` 长度，但 frame 可能因为调用方传了 NaN
     * （例如物件动画的帧计数出问题）而越界；越界读到的是 undefined，
     * 乘完 scale 就是 NaN，整个骨架连带顶点全变 NaN（模型整片消失）。
     * 原版对越界帧是 clamp，这里等价地兜成 0。
     */
    const px = posArr[k * 3 + 0];
    const py = posArr[k * 3 + 1];
    const pz = posArr[k * 3 + 2];
    bone.position.set(
      (Number.isFinite(px) ? px : 0) * scale,
      (Number.isFinite(py) ? py : 0) * scale,
      (Number.isFinite(pz) ? pz : 0) * scale
    );
    /*
     * 有些 BMD（尤其是场景物件：树、窗帘）里，某个骨骼在某个 action 上的
     * 四元数是全 0 —— 原版的处理是「没有关键帧就保持绑定姿态」。
     * 直接 `normalize()` 会 0/0 得到 NaN，整个骨架子树连带顶点全变 NaN
     * （现象：模型整片消失、骨骼矩阵求和是 NaN）。这里兜成单位四元数。
     */
    const qx = quatArr[f * 4 + 0];
    const qy = quatArr[f * 4 + 1];
    const qz = quatArr[f * 4 + 2];
    const qw = quatArr[f * 4 + 3];
    if (qx * qx + qy * qy + qz * qz + qw * qw > 1e-8) {
      bone.quaternion.set(qx, qy, qz, qw).normalize();
    } else {
      bone.quaternion.identity();
    }
  }
}

/** 插值版本（用于播放动画） */
export function applyActionPose(
  rig: Rig,
  actionIndex: number,
  frameFloat: number,
  loop = true
) {
  const { bmd, bones, scale } = rig;
  const action = bmd.actions[actionIndex];
  if (!action) return;

  const keys = action.numKeys;
  if (keys === 0) return;

  let f0: number;
  let f1: number;
  let t: number;

  if (loop) {
    const total = Math.max(1, rig.loopLen[actionIndex] ?? keys);
    const f = ((frameFloat % total) + total) % total;
    f0 = Math.floor(f);
    f1 = (f0 + 1) % total;
    t = f - f0;
  } else {
    const f = Math.min(frameFloat, keys - 1);
    f0 = Math.floor(f);
    f1 = Math.min(f0 + 1, keys - 1);
    t = f - f0;
  }

  for (let i = 0; i < bmd.bones.length; i++) {
    const bone = bones[i];
    const def = bmd.bones[i];
    const posArr = def.positions[actionIndex];
    const quatArr = def.quaternions[actionIndex];
    // 同上：dummy 骨是空数组，必须一起兜住
    if (!posArr || !quatArr || posArr.length < keys * 3 || quatArr.length < keys * 4) {
      bone.position.set(0, 0, 0);
      bone.quaternion.identity();
      continue;
    }

    // 锁定水平位移：xy 固定用第 0 帧，z（高度起伏）保留动画
    const lockRoot = bmd.actions[actionIndex]?.lockPositions && i === 0;
    const i0 = lockRoot ? 0 : f0;
    const i1 = lockRoot ? 0 : f1;

    const p0x = posArr[i0 * 3 + 0];
    const p0y = posArr[i0 * 3 + 1];
    const p0z = posArr[i0 * 3 + 2];
    const p1x = posArr[i1 * 3 + 0];
    const p1y = posArr[i1 * 3 + 1];
    const p1z = posArr[i1 * 3 + 2];

    bone.position.set(
      (p0x + (p1x - p0x) * t) * scale,
      (p0y + (p1y - p0y) * t) * scale,
      (p0z + (p1z - p0z) * t) * scale
    );

    _q.set(
      quatArr[f0 * 4 + 0],
      quatArr[f0 * 4 + 1],
      quatArr[f0 * 4 + 2],
      quatArr[f0 * 4 + 3]
    );
    _q1.set(
      quatArr[f1 * 4 + 0],
      quatArr[f1 * 4 + 1],
      quatArr[f1 * 4 + 2],
      quatArr[f1 * 4 + 3]
    );
    _q.slerp(_q1, t);
    // 同上：全 0 四元数会让 slerp/normalize 出 NaN，兜成单位四元数
    if (Number.isFinite(_q.x) && _q.lengthSq() > 1e-8) bone.quaternion.copy(_q);
    else bone.quaternion.identity();
  }
}

/* ------------------------------------------------------------------ */
/* 材质                                                                */
/* ------------------------------------------------------------------ */

const materialCache = new Map<string, THREE.Material>();

/**
 * 加色材质的整体亮度上限。
 *
 * 叠加混合用的贴图全是**没有 alpha 的全亮 JPEG**，直接 add 会过曝成一片白，
 * 原版这类贴图本身画得比较暗，这里统一压到 0.7。
 */
const ADDITIVE_BRIGHTNESS = 0.7;

export function getBmdMaterial(
  texture: THREE.Texture | null,
  blend: boolean,
  doubleSide = true,
  /**
   * 叠加混合（光柱/极光/蜘蛛网这类特效模型）。
   *
   * 它们的贴图是 JPEG（没有 alpha），按不透明画出来就是**一根实心三棱柱**；
   * 原版用的是 add 混合，看着是发光/半透明的。`Object3/Object101`（冰风谷极光）、
   * `Object2/Object53`（地下城蜘蛛网）就是这类。
   */
  additive = false,
  /**
   * 软透明（烟雾/玻璃这类半透贴图）：`transparent` 但不做 alphaTest。
   * 由 `core/blendHeuristic` 的 `alphaStyle === 'soft'` 决定。
   */
  soft = false
): THREE.Material {
  const key = `${texture?.uuid ?? 'none'}|${blend}|${doubleSide}|${additive ? 'add' : 'opa'}|${soft ? 'soft' : ''}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  const mat = new THREE.MeshBasicMaterial({
    map: texture ?? null,
    color: 0xffffff,
    vertexColors: true,
    side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    transparent: additive || soft,
    // 原版 `Camera.cpp`: glAlphaFunc(GL_GREATER, 0.25)。之前写 0.45 会多切掉
    // 发丝/布边这类半透明像素，人物边缘看着就没那么「细」。
    alphaTest: soft ? 0.01 : blend ? 0.25 : 0,
    depthWrite: !additive && !soft,
    // 加色走统一开关：`one`（原版 ONE/ONE）↔ `alpha`（three 默认），见 core/additive
    ...(additive ? additiveProps() : { blending: THREE.NormalBlending }),
    // 叠加混合下贴图是全亮的 JPEG，直接 add 容易过曝成一片白，压到 0.7
    opacity: additive ? ADDITIVE_BRIGHTNESS : 1,
    toneMapped: false,
  });
  mat.name = key;
  if (additive) {
    /*
     * 登记进加色注册表：这样 `__MU_APP__.additive('alpha')` 对**物件**也生效
     * （不只是特效），并且会一并关雾、不写深度。
     * 0.7 的压暗通过 `fxAlpha` 落到 color（one 模式）或 opacity（alpha 模式）。
     */
    useAdditiveBlend(mat);
    fxAlpha(mat as THREE.MeshBasicMaterial, ADDITIVE_BRIGHTNESS);
  }
  materialCache.set(key, mat);
  return mat;
}

/* ------------------------------------------------------------------ */
/* 几何体构建                                                          */
/* ------------------------------------------------------------------ */

interface MeshBuildOptions {
  scale: number;
  /** 静态模型：bake 时使用的骨骼矩阵（frame 0） */
  boneMatrices?: THREE.Matrix4[];
  /** 蒙皮模型：顶点 node → 目标骨架索引 */
  boneIndexRemap?: (node: number) => number;
}

function pushVertexColor(
  colors: number[],
  nx: number,
  ny: number,
  nz: number
) {
  // 半兰伯特：背光面吃满环境光，受光面 = 环境 + N·L（见 OBJ_LIGHT 的注释）
  const d = nx * OBJ_LIGHT.dir.x + ny * OBJ_LIGHT.dir.y + nz * OBJ_LIGHT.dir.z;
  const lit = OBJ_LIGHT.ambient + OBJ_LIGHT.sun * Math.max(0, d);
  colors.push(
    lit * OBJ_LIGHT.tint[0],
    lit * OBJ_LIGHT.tint[1],
    lit * OBJ_LIGHT.tint[2]
  );
}

export function buildGeometry(
  mesh: BmdMesh,
  opts: MeshBuildOptions
): THREE.BufferGeometry {
  const { scale, boneMatrices, boneIndexRemap } = opts;
  const skinned = !!boneIndexRemap;

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const indices: number[] = [];

  const normalMatrix = new THREE.Matrix3();
  const tmpN = new THREE.Vector3();
  const tmpV = new THREE.Vector3();

  // 顶点去重：相同 (vertex, normal, texcoord) 组合共享一个顶点，显著降低内存
  const dedupe = new Map<number, number>();

  function addVertex(
    vIndex: number,
    nIndex: number,
    tIndex: number
  ): number {
    const key = vIndex * 4294967296 + nIndex * 65536 + tIndex;
    const hit = dedupe.get(key);
    if (hit !== undefined) return hit;

    const v = mesh.vertices[vIndex];
    const n = mesh.normals[nIndex] ?? mesh.normals[vIndex];
    const t = mesh.texCoords[tIndex];

    tmpV.set(v.x * scale, v.y * scale, v.z * scale);
    tmpN.set(n ? n.x : 0, n ? n.y : 0, n ? n.z : 1);

    const mat = boneMatrices ? boneMatrices[v.node] : undefined;
    if (mat) {
      tmpV.applyMatrix4(mat);
      normalMatrix.getNormalMatrix(mat);
      tmpN.applyMatrix3(normalMatrix).normalize();
    } else {
      tmpN.normalize();
    }

    const index = positions.length / 3;
    positions.push(tmpV.x, tmpV.y, tmpV.z);
    uvs.push(t ? t.u : 0, t ? t.v : 0);
    pushVertexColor(colors, tmpN.x, tmpN.y, tmpN.z);

    if (skinned) {
      skinIndices.push(boneIndexRemap!(v.node), 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }

    dedupe.set(key, index);
    return index;
  }

  for (const tri of mesh.triangles) {
    const count = tri.polygon === 4 ? 4 : 3;

    // 扇形拆分成三角形
    for (let k = 1; k < count - 1; k++) {
      const corners = [0, k, k + 1];
      const idx = [0, 0, 0];
      let valid = true;

      for (let c = 0; c < 3; c++) {
        const corner = corners[c];
        const vIndex = tri.vertexIndex[corner];
        const nIndex = tri.normalIndex[corner];
        const tIndex = tri.texCoordIndex[corner];
        if (vIndex < 0 || vIndex >= mesh.vertices.length) {
          valid = false;
          break;
        }
        idx[c] = addVertex(
          vIndex,
          nIndex < 0 || nIndex >= mesh.normals.length ? vIndex : nIndex,
          tIndex < 0 || tIndex >= mesh.texCoords.length ? 0 : tIndex
        );
      }

      if (!valid) continue;
      indices.push(idx[0], idx[1], idx[2]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (skinned) {
    geo.setAttribute(
      'skinIndex',
      new THREE.Uint16BufferAttribute(skinIndices, 4)
    );
    geo.setAttribute(
      'skinWeight',
      new THREE.Float32BufferAttribute(skinWeights, 4)
    );
  }
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/** 蒙皮网格 */
export function createSkinnedMesh(
  bmd: Bmd,
  mesh: BmdMesh,
  rig: Rig,
  remap: (node: number) => number,
  texture: THREE.Texture | null,
  blend: boolean,
  /**
   * 软透明（烟雾/玻璃）、加法混合（黑底发光贴图）。
   * 一般不用手填：直接传 `modelBlend()` 的结果（`core/blendHeuristic`）。
   */
  soft = false,
  additive = false
) {
  const geo = buildGeometry(mesh, {
    scale: rig.scale,
    boneIndexRemap: remap,
  });
  const mat = getBmdMaterial(texture, blend, true, additive, soft);
  const skinned = new THREE.SkinnedMesh(geo, mat);
  skinned.bind(rig.skeleton, new THREE.Matrix4());
  skinned.frustumCulled = false;
  skinned.matrixAutoUpdate = false;
  skinned.updateMatrix();
  return skinned;
}

/** 静态网格（把 bind pose 的骨骼变换烘进顶点） */
export function createStaticMeshes(
  bmd: Bmd,
  boneMatrices: THREE.Matrix4[],
  texture: THREE.Texture | null,
  blend: boolean,
  scale = MODEL_SCALE,
  additive = false,
  soft = false
) {
  const out: THREE.BufferGeometry[] = [];
  for (const mesh of bmd.meshes) {
    out.push(buildGeometry(mesh, { scale, boneMatrices }));
  }
  return { geometries: out, material: getBmdMaterial(texture, blend, true, additive, soft) };
}

/** 依据骨骼名把装备的骨骼索引映射到主角骨架 */
export function createBoneRemap(
  bmd: Bmd,
  rig: Rig
): (node: number) => number {
  const local: number[] = bmd.bones.map((b, i) => {
    const idx = rig.boneIndexByName.get(b.name);
    return idx !== undefined ? idx : i;
  });
  return (node: number) => {
    if (node < 0 || node >= local.length) return 0;
    return local[node];
  };
}

/** 取某帧的骨骼模型空间矩阵（用于静态模型烘焙） */
export function getBoneMatrices(rig: Rig): THREE.Matrix4[] {
  rig.root.updateMatrixWorld(true);
  return rig.bones.map(b => b.matrixWorld.clone());
}
