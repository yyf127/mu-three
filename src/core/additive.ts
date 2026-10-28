/**
 * 加色混合（加法混合）的统一开关。
 *
 * 原版 `Render/GL_State.cpp::GL_SetBlendAdditive`：
 *
 * ```c
 * glEnable(GL_BLEND); glBlendFunc(GL_ONE, GL_ONE);   // 纯加色，**不看 alpha**
 * GL_DisableCullFace(); GL_DisableDepthWrites(); glDisable(GL_ALPHA_TEST);
 * glDisable(GL_FOG);
 * ```
 *
 * three 的 `AdditiveBlending` 是 `SRC_ALPHA, ONE`（乘了 alpha），比原版暗一档；
 * 原版是 `ONE, ONE`，光更冲、叠加出来更亮。
 *
 * 但 `ONE,ONE` 有个副作用：**alpha 完全失效**，`material.opacity` 不再影响亮度，
 * 于是「靠 opacity 淡出」的特效会突然消失。原版的解法是淡出时把 `glColor3f`
 * 往黑压 —— 所以这里也提供 `fxAlpha()`：在 one 模式下同时缩放 `color`。
 */
import * as THREE from 'three';

export type AdditiveMode = 'one' | 'alpha';

let mode: AdditiveMode = 'one';
const registry = new Set<THREE.Material>();

/** 当前模式与登记数量（诊断用） */
export function additiveInfo() {
  return { mode, materials: registry.size };
}

function apply(mat: THREE.Material) {
  mat.transparent = true;
  mat.depthWrite = false;
  // 原版在 GL_SetBlendAdditive 里明确关雾（不是所有 Material 都有 fog 字段）
  (mat as THREE.Material & { fog?: boolean }).fog = false;
  if (mode === 'one') {
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneFactor;
  } else {
    mat.blending = THREE.AdditiveBlending;
    mat.blendEquation = THREE.AddEquation;
  }
  /*
   * 亮度系数要**跟着模式搬家**：
   *   one  → `ONE/ONE` 不看 alpha，只能把它乘进 color
   *   alpha → 回到用 alpha（opacity）表达，color 要还原成原色
   * 不搬的话切一次模式就会「乘两遍」或者「一点不乘」
   * （`fxAlpha` 记下的 `fxK` / `baseColor` 就是给这里用的）。
   */
  const k = mat.userData.fxK as number | undefined;
  const base = mat.userData.baseColor as THREE.Color | undefined;
  const color = (mat as THREE.Material & { color?: THREE.Color }).color;
  if (base && color) {
    if (mode === 'one') color.copy(base).multiplyScalar(k ?? 1);
    else {
      color.copy(base);
      if (k !== undefined) mat.opacity = k;
    }
  }
  mat.needsUpdate = true;
}

/** 材质字面量里直接展开用：`new MeshBasicMaterial({ ...additiveProps() })` */
export function additiveProps() {
  return mode === 'one'
    ? {
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      }
    : { blending: THREE.AdditiveBlending, blendEquation: THREE.AddEquation };
}

/** 建材质时调用：登记 + 按当前模式配置 */
export function useAdditiveBlend<T extends THREE.Material>(mat: T): T {
  registry.add(mat);
  apply(mat);
  return mat;
}

/** 运行时切换 `one`（原版）↔ `alpha`（three 默认、更柔和） */
export function setAdditiveMode(next: AdditiveMode) {
  mode = next;
  for (const mat of registry) apply(mat);
  return { mode, materials: registry.size };
}

/**
 * 特效淡出 / 呼吸统一入口。
 *
 * `alpha` 模式：只改 opacity（three 的加色会乘 alpha）。
 * `one` 模式：opacity 不起作用，必须**同时把 color 乘上同一个系数**
 * （相当于原版的 `glColor3f(r*k, g*k, b*k)`）。
 */
export function fxAlpha(
  mat: THREE.Material & { opacity: number; color?: THREE.Color },
  k: number
) {
  const v = Math.max(0, Math.min(1, k));
  mat.opacity = v;
  mat.userData.fxK = v;
  if (mode !== 'one' || !mat.color) return;
  let base = mat.userData.baseColor as THREE.Color | undefined;
  if (!base) {
    base = mat.color.clone();
    mat.userData.baseColor = base;
  }
  mat.color.copy(base).multiplyScalar(v);
}
