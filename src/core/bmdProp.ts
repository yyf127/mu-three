/**
 * 把一只 BMD 烘成静态 `THREE.Group`（登录/选角这类「摆件」共用）。
 *
 * 和 `world/objects.ts` 的静态物件路径同一套：按 mesh 取贴图 →
 * `modelBlend` 判混合 → `createStaticMeshes` 烘顶点光照。区别是这些摆件
 * 不参与地形合批，也不做蒙皮，所以单独抽出来给 `loginScene` / `charScene` 用。
 */

import * as THREE from 'three';
import { type Bmd, parseBmd } from '../core/bmd';
import { MODEL_SCALE, createRig, createStaticMeshes, getBoneMatrices } from '../core/model';
import { modelBlend } from '../core/blendHeuristic';
import { fetchBytes, loadTexture } from '../core/texture';

export interface PropOptions {
  /** 整只走加色（水花、太阳这种黑底发光图） */
  additive?: boolean;
  /** 不吃顶点光照：天空盒、字标这类「原画自带光照」的贴图 */
  unlit?: boolean;
  /** 光晕层：后画、不写深度（但保留深度测试，别糊到前面的东西上） */
  glow?: boolean;
  /** blend 判断闸门：名字里带这些的 mesh 才允许走加色 */
  additiveMatch?: RegExp;
  /** 跳过这些贴图的 mesh（布景里个别横梁/幕布摆位不对，画出来挡住视线） */
  skipMatch?: RegExp;
  /**
   * 单面渲染（只画正面）。
   *
   * 原版 `Camera.cpp` 里 `glEnable(GL_CULL_FACE)` 是全局开着的，BMD 一律单面；
   * 我们默认 `doubleSide: true`，遇到「把整个场景包在里面的大圆筒/天穹」时
   * 会画出它的内壁，把角色全挡住 —— 选角布景的 `main_wood6.jpg` 就是这种。
   */
  cull?: boolean;
  /** 手动指定渲染面（默认双面）。'back' 用来救「法线朝内」的背景壳 */
  side?: 'front' | 'back' | 'double';
  /**
   * 按贴图名给单个 mesh 指定渲染面。
   *
   * 布景里有个别 mesh 是「从里面往外看」的壳（法线朝内，比如 `main_wood6.jpg`
   * 那圈半径 5 个单位的树墙）。原版开着 `GL_CULL_FACE`，从外面看它的背面会被剔掉，
   * 所以不挡人；我们如果用双面画，就会把整块壳糊在镜头和角色之间。
   */
  sideRules?: { match: RegExp; side: 'front' | 'back' | 'double' }[];
}

export async function loadBmdFile(dir: string, file: string): Promise<Bmd | null> {
  for (const name of [`${dir}${file}.bmd`, `${dir}${file}.BMD`]) {
    try {
      return parseBmd(await fetchBytes(name));
    } catch {
      /* 换下一个大小写 */
    }
  }
  console.warn(`[prop] 读不到 ${dir}${file}.bmd`);
  return null;
}

export async function buildBmdGroup(
  dir: string,
  file: string,
  opts: PropOptions = {}
): Promise<{ group: THREE.Group; bmd: Bmd } | null> {
  const bmd = await loadBmdFile(dir, file);
  if (!bmd) return null;

  const rig = createRig(bmd, MODEL_SCALE);
  const boneMatrices = getBoneMatrices(rig);

  const group = new THREE.Group();
  group.name = `prop:${file}`;

  for (const mesh of bmd.meshes) {
    if (opts.skipMatch?.test(mesh.texturePath)) continue;
    const tex = await loadTexture(dir, mesh.texturePath);
    const mb = modelBlend(tex?.texture ?? null, tex?.tag === 'blend', mesh.texturePath);
    const matched = opts.additiveMatch ? opts.additiveMatch.test(mesh.texturePath) : false;
    const additive = !!(opts.additive || matched || mb.additive);
    const one = { ...bmd, meshes: [mesh] };
    const s = createStaticMeshes(
      one,
      boneMatrices,
      tex?.texture ?? null,
      mb.cutout && !additive,
      undefined,
      additive,
      mb.soft
    );
    let mat = s.material as THREE.MeshBasicMaterial;
    const rule = opts.sideRules?.find(r => r.match.test(mesh.texturePath));
    const sideName = rule?.side ?? opts.side;
    const wantSide =
      sideName === 'back'
        ? THREE.BackSide
        : sideName === 'front' || opts.cull
          ? THREE.FrontSide
          : sideName === 'double'
            ? THREE.DoubleSide
            : null;
    if (wantSide !== null && mat.side !== wantSide) {
      // 材质按贴图全局缓存，改 side 会波及别处 —— 克隆一份再改
      mat = mat.clone();
      mat.side = wantSide;
    }
    if (opts.unlit) {
      mat.vertexColors = false;
      mat.toneMapped = false;
    }
    if (opts.glow) {
      mat.depthWrite = false;
      mat.opacity = 1;
    }
    for (const geo of s.geometries) {
      const m = new THREE.Mesh(geo, mat);
      // 名字留给调试用（选角那边射线探测「是谁挡着角色」）
      m.name = mesh.texturePath;
      m.frustumCulled = false;
      if (opts.glow) m.renderOrder = 1;
      group.add(m);
    }
  }

  return { group, bmd };
}
