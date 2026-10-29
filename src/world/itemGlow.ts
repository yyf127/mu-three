/**
 * 装备强化光效 —— 原版 `RenderPartObjectEffect` 的「第二遍渲染」。
 *
 * 0.97 的 +N 发光**不是粒子**，也不是贴图叠加：`Entity_DrawSetup.cpp:390-480`
 * 的做法是把**同一份网格再画一遍**，只是把模型颜色乘数（`model+0x48..0x50`）
 * 换成一个偏色/偏亮的组合，再走 `RenderPartObjectBodyColor` 的加色混合。
 * 分档是这样的（`ItemLevelFx` = 物品强化等级）：
 *
 *   +0..+2  只画一遍，颜色 = 光照原值                  → 没有明显光
 *   +3,+4   第二遍：R 全亮、G/B ×0.6                    → 暖黄
 *   +5,+6   第二遍：R ×0.5、G ×0.7、B 全亮              → 冷蓝
 *   +7,+8   主体 ×0.8 + 一遍加色渲染                    → 白光
 *   +9,+10  主体 ×0.9 + **两遍**加色渲染                → 更亮的白光
 *   +11     同上 + `Entity_SetModelColorAlt` 的额外网格 → 最亮
 *
 * 亮度还会随动画帧脉冲（`DAT_083a45d4`），这里用同周期的正弦代替。
 *
 * three.js 侧的等价做法：几何体共享（不复制顶点数据）、材质换成
 * `AdditiveBlending` 的 `MeshBasicMaterial`、`depthWrite = false`，
 * 颜色按档位给，`opacity` 按脉冲统一推进 —— 视觉上就是「整件装备罩一层光」。
 * 每次换装都会重建成对的副本，所以只给「有强化等级的部件」建，+0 装备零开销。
 */
import * as THREE from 'three';

/** 一档强化光效 */
export interface GlowSpec {
  /** 叠加遍数（原版 +9 以上画两遍） */
  passes: number;
  /** 叠加色，0..1 */
  color: [number, number, number];
  /** 单遍基础不透明度 */
  strength: number;
}

/** 等级 → 光效档位；+0..+2 返回 null（原版这段完全不额外渲染） */
export function glowSpecFor(level: number): GlowSpec | null {
  const L = level | 0;
  if (L < 3) return null;
  if (L < 5) return { passes: 1, color: [1, 0.62, 0.55], strength: 0.46 }; // +3 / +4 暖黄
  if (L < 7) return { passes: 1, color: [0.5, 0.72, 1], strength: 0.5 }; // +5 / +6 冷蓝
  if (L < 9) return { passes: 1, color: [1, 1, 1], strength: 0.5 }; // +7 / +8 白光
  if (L < 11) return { passes: 2, color: [1, 1, 1], strength: 0.42 }; // +9 / +10 双遍
  return { passes: 2, color: [1, 1, 1], strength: 0.55 }; // +11 双遍加强
}

/* ------------------------------------------------------------------ */
/* 材质 + 脉冲                                                          */
/* ------------------------------------------------------------------ */

/** 所有光效材质（共享，按「贴图 + 档位 + 遍次」缓存），tick 时统一改透明度 */
const glowMats: THREE.MeshBasicMaterial[] = [];
const glowMatCache = new Map<string, THREE.MeshBasicMaterial>();

function glowMaterial(
  texture: THREE.Texture | null,
  spec: GlowSpec,
  pass: number
): THREE.MeshBasicMaterial {
  const key = `${texture?.uuid ?? 'none'}|${spec.color.join(',')}|${spec.strength}|${pass}`;
  const hit = glowMatCache.get(key);
  if (hit) return hit;

  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    color: new THREE.Color(spec.color[0], spec.color[1], spec.color[2]),
    vertexColors: true,
    transparent: true,
    opacity: spec.strength,
    // 加色混合不写深度，否则同一件装备的第二遍会把第一遍挡掉
    depthWrite: false,
    side: THREE.DoubleSide,
    // 和主材质同一个 alpha 门槛（`Camera.cpp` 的 GL_GREATER 0.25），
    // 免得剑身镂空的边缘被光效糊回来
    alphaTest: 0.25,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  mat.userData.baseOpacity = spec.strength;
  glowMats.push(mat);
  glowMatCache.set(key, mat);
  return mat;
}

/**
 * 光效脉冲：原版 `(sin(t) + 1) * 0.5` 的亮度摆动。
 * 每帧调用一次（全局一次即可，材质是共享的）。
 */
export function tickItemGlow(nowMs: number) {
  const pulse = 0.82 + 0.18 * Math.sin(nowMs * 0.0067);
  for (const m of glowMats) {
    m.opacity = (m.userData.baseOpacity as number) * pulse;
  }
}

/* ------------------------------------------------------------------ */
/* 副本构建                                                             */
/* ------------------------------------------------------------------ */

function sourceTexture(src: THREE.Mesh): THREE.Texture | null {
  const mat = src.material as THREE.MeshBasicMaterial;
  return mat?.map ?? null;
}

/**
 * 给一个已经建好的网格生成光效副本（0..passes 遍）。
 *
 * - 蒙皮网格（防具 / 翅膀）：新建 `SkinnedMesh` 共享同一份几何与同一个 `Skeleton`，
 *   `bindMatrix` 照抄（都是 identity），所以骨骼一动副本跟着动。
 * - 静态网格（武器 / 盾）：几何是烘焙过的，直接共享，局部变换照抄。
 *
 * 返回的副本**不持有几何体的所有权** —— 销毁时只能 `removeFromParent()`，
 * 千万别 `geometry.dispose()`，否则原件一起报废。
 */
export function buildGlowCopies(src: THREE.Mesh, spec: GlowSpec): THREE.Mesh[] {
  const tex = sourceTexture(src);
  const out: THREE.Mesh[] = [];

  for (let pass = 0; pass < spec.passes; pass++) {
    const mat = glowMaterial(tex, spec, pass);
    let copy: THREE.Mesh;

    if ((src as THREE.SkinnedMesh).isSkinnedMesh) {
      const s = src as THREE.SkinnedMesh;
      const sk = new THREE.SkinnedMesh(s.geometry, mat);
      sk.bind(s.skeleton, s.bindMatrix);
      sk.frustumCulled = false;
      sk.matrixAutoUpdate = false;
      sk.updateMatrix();
      copy = sk;
    } else {
      copy = new THREE.Mesh(src.geometry, mat);
      copy.matrixAutoUpdate = src.matrixAutoUpdate;
      copy.matrix.copy(src.matrix);
      copy.position.copy(src.position);
      copy.quaternion.copy(src.quaternion);
      copy.scale.copy(src.scale);
    }

    copy.name = `${src.name}|glow${pass}`;
    copy.renderOrder = 2;
    copy.visible = src.visible;
    copy.userData.glow = true;
    out.push(copy);
  }
  return out;
}

/**
 * 把 `src` 的光效副本挂到它所在的父节点上，返回副本列表。
 * 没有父节点（还没入场景）时返回空，由调用方在 attach 时补。
 */
export function attachGlow(src: THREE.Mesh, spec: GlowSpec | null): THREE.Mesh[] {
  if (!spec || !src.parent) return [];
  const copies = buildGlowCopies(src, spec);
  for (const c of copies) src.parent.add(c);
  return copies;
}
