/**
 * 贴图混合模式判定（opaque / normal / additive）—— 从 `muonline-bmd-viewer` 移植。
 *
 * 为什么需要它：MU 的贴图是 JPEG(OZJ) 或 TGA(OZT)，**没有统一的 alpha 约定**。
 * 以前我们靠两件事猜：
 *   ① `tex.tag === 'blend'`（OZT 带 alpha 通道就当 cutout）；
 *   ② 文件名正则（`/aurora|cobweb|light/…`）。
 * 第二种很脆：`flower2.jpg` 是花的实体贴图，被正则误判成特效 → 整片花发光；
 * 而 `bfish072.jpg` 这种名字根本不带关键字 → 该透明的又画成实心。
 *
 * 这里改成**看像素**：统计透明比例、边缘黑边、亮度分布、暗部占比，
 * 再加一点文件名提示，最后给三种模式打分取最高。规则和权重照抄 viewer 的
 * `utils/TextureBlendHeuristics.ts`（468 行），只留渲染要用的部分。
 */
import * as THREE from 'three';

export type BlendMode = 'opaque' | 'normal' | 'additive';
export type AlphaStyle = 'none' | 'cutout' | 'soft';

export interface BlendVerdict {
  mode: BlendMode;
  alphaStyle: AlphaStyle;
  confidence: number;
  reason: string;
}

const FALLBACK: BlendVerdict = { mode: 'opaque', alphaStyle: 'none', confidence: 0, reason: 'no-image' };

const ADDITIVE_HINTS = [
  'glow', 'flare', 'spark', 'fire', 'flame', 'smoke', 'trail', 'aura', 'halo', 'effect', 'fx',
  'energy', 'beam', 'light', 'shine', 'flash', 'particle',
  'candle', 'torch', 'lamp', 'aurora', 'cobweb', 'web', 'laser', 'magic', 'star',
];
const NORMAL_HINTS = ['alpha', 'mask', 'decal', 'leaf', 'foliage', 'hair', 'cape', 'cloth', 'shadow', 'smoke', 'wing'];
const OPAQUE_HINTS = ['skin', 'body', 'armor', 'armour', 'face', 'helm', 'helmet', 'pants', 'gloves', 'boots', 'shield', 'sword', 'weapon'];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function keywordHits(text: string, words: string[]) {
  let n = 0;
  for (const w of words) if (text.includes(w)) n++;
  return n;
}

const cache = new WeakMap<THREE.Texture, BlendVerdict>();

export interface Metrics {
  pixelCount: number;
  blackRatio: number;
  veryDarkRatio: number;
  brightRatio: number;
  contentCoverage: number;
  borderBlackRatio: number;
  borderTransparentRatio: number;
  transparentRatio: number;
  semiTransparentRatio: number;
  binaryAlphaRatio: number;
  averageLuma: number;
  lumaStdDev: number;
  brightEnergyRatio: number;
  /**
   * 内容（非黑）连通块统计。
   *
   * 发光贴图的内容是**一整块**（光斑/光条），而「UV 摊在黑色底上」的模型贴图
   * （木头、铁栅、马车）是**十几块互不相连的小岛**。这条是把两者分开的关键：
   * 只靠「黑占比 / 边框黑」完全分不开（实测 wood02 边框黑 0.95、squid01 0.97，
   * 比真发光的 light01 还高）。
   */
  islandCount: number;
  largestIslandShare: number;
}

export function metricsOf(image: CanvasImageSource & { width: number; height: number }): Metrics | null {
  const w = Math.max(1, Math.floor(image.width));
  const h = Math.max(1, Math.floor(image.height));
  // 最多采样 192×192，够判断且不吃内存
  const scale = Math.min(1, Math.sqrt((192 * 192) / (w * h)));
  const sw = Math.max(1, Math.floor(w * scale));
  const sh = Math.max(1, Math.floor(h * scale));

  const cv = document.createElement('canvas');
  cv.width = sw;
  cv.height = sh;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.clearRect(0, 0, sw, sh);
    /*
     * OZT/TGA 解出来是 `THREE.DataTexture`（`image = {data, width, height}`），
     * **不是** `CanvasImageSource`，`drawImage` 会直接抛异常 —— 以前这里就
     * catch 成 `no-image` 然后一律当不透明。改成走 `putImageData`（等比缩到采样尺寸）。
     */
    const raw = (image as unknown as { data?: Uint8Array }).data;
    if (raw && raw.length >= w * h * 4) {
      const full = document.createElement('canvas');
      full.width = w;
      full.height = h;
      const fctx = full.getContext('2d', { willReadFrequently: true })!;
      // 不用 `new ImageData(...)`：TS 的 lib.dom 在部分版本里只接受 (w,h) 重载
      const src = new Uint8ClampedArray(w * h * 4);
      src.set(raw.subarray(0, w * h * 4));
      const id = fctx.createImageData(w, h);
      id.data.set(src);
      fctx.putImageData(id, 0, 0);
      ctx.drawImage(full, 0, 0, sw, sh);
    } else {
      ctx.drawImage(image, 0, 0, sw, sh);
    }
  } catch {
    return null;
  }
  const px = ctx.getImageData(0, 0, sw, sh).data;
  const total = px.length / 4;
  if (!total) return null;

  const border = Math.max(1, Math.floor(Math.min(sw, sh) * 0.03));
  let black = 0, veryDark = 0, bright = 0, content = 0;
  let transparent = 0, semiTransparent = 0, nearZero = 0, nearFull = 0;
  let borderCount = 0, borderBlack = 0, borderTransparent = 0;
  let lumaSum = 0, lumaSq = 0, brightLuma = 0, visible = 0;

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const a = px[i + 3] / 255;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;

      const isTransparent = a < 0.06;
      const isSemi = !isTransparent && a < 0.95;
      const isVeryDark = a > 0.02 && maxC < 42 && luma < 0.12;
      const isBlack = a > 0.02 && maxC < 28 && luma < 0.08;
      const isBright = a > 0.12 && maxC > 168 && luma > 0.46;
      const isContent = a > 0.14 && (luma > 0.11 || sat > 0.16);

      if (isTransparent) transparent++;
      if (isSemi) semiTransparent++;
      if (a < 0.04) nearZero++;
      if (a > 0.96) nearFull++;
      if (isBlack) black++;
      if (isVeryDark) veryDark++;
      if (isBright) bright++;
      if (isContent) content++;

      if (a > 0.02) {
        const wl = luma * a;
        lumaSum += wl;
        lumaSq += wl * wl;
        visible++;
        if (isBright) brightLuma += wl;
      }

      const isBorder = x < border || y < border || x >= sw - border || y >= sh - border;
      if (isBorder) {
        borderCount++;
        if (isBlack || isVeryDark) borderBlack++;
        if (isTransparent) borderTransparent++;
      }
    }
  }

  /*
   * ── 连通块（4 邻域洪泛）──
   * 内容判据比 `isContent` 宽一点：亮度或饱和度明显不为黑的像素，
   * 然后把「最大一块占全部内容的比例」算出来。
   */
  const mask = new Uint8Array(sw * sh);
  let maskCount = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      const a = px[i + 3];
      const maxC = Math.max(px[i], px[i + 1], px[i + 2]);
      if (a > 16 && maxC > 40) {
        mask[y * sw + x] = 1;
        maskCount++;
      }
    }
  }
  let islandCount = 0;
  let largest = 0;
  if (maskCount) {
    const seen = new Uint8Array(sw * sh);
    const stack = new Int32Array(sw * sh);
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || seen[start]) continue;
      islandCount++;
      let sp = 0;
      let size = 0;
      stack[sp++] = start;
      seen[start] = 1;
      while (sp) {
        const p = stack[--sp];
        size++;
        const px_ = p % sw;
        const py_ = (p / sw) | 0;
        if (px_ > 0) { const q = p - 1; if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; } }
        if (px_ < sw - 1) { const q = p + 1; if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; } }
        if (py_ > 0) { const q = p - sw; if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; } }
        if (py_ < sh - 1) { const q = p + sw; if (mask[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; } }
      }
      if (size > largest) largest = size;
    }
  }

  const averageLuma = visible > 0 ? lumaSum / visible : 0;
  const variance = visible > 0 ? lumaSq / visible - averageLuma * averageLuma : 0;
  return {
    pixelCount: total,
    blackRatio: black / total,
    veryDarkRatio: veryDark / total,
    brightRatio: bright / total,
    contentCoverage: content / total,
    borderBlackRatio: borderCount ? borderBlack / borderCount : 0,
    borderTransparentRatio: borderCount ? borderTransparent / borderCount : 0,
    transparentRatio: transparent / total,
    semiTransparentRatio: semiTransparent / total,
    binaryAlphaRatio: (nearZero + nearFull) / total,
    averageLuma,
    lumaStdDev: Math.sqrt(Math.max(0, variance)),
    brightEnergyRatio: lumaSum > 0 ? brightLuma / lumaSum : 0,
    islandCount,
    largestIslandShare: maskCount ? largest / maskCount : 0,
  };
}

function alphaStyleOf(m: Metrics): AlphaStyle {
  const presence = m.transparentRatio + m.semiTransparentRatio;
  if (presence < 0.015) return 'none';
  if (m.semiTransparentRatio > 0.11) return 'soft';
  if (m.transparentRatio > 0.08 && m.binaryAlphaRatio > 0.88 && m.semiTransparentRatio < 0.075) return 'cutout';
  if (m.semiTransparentRatio > 0.045) return 'soft';
  return 'cutout';
}

/**
 * 各模式的原始得分（`detectBlend` 与调试口 `blendMetrics` 共用一份）。
 *
 * 打分权重照抄 viewer 的 `utils/TextureBlendHeuristics.ts`；
 * `glowScore` 是我们自己补的第四条判据（见下面的注释）。
 */
function scoreOf(m: Metrics, hintText: string) {
  const hints = {
    additive: Math.min(0.16, keywordHits(hintText, ADDITIVE_HINTS) * 0.055),
    normal: Math.min(0.12, keywordHits(hintText, NORMAL_HINTS) * 0.045),
    opaque: Math.min(0.1, keywordHits(hintText, OPAQUE_HINTS) * 0.04),
  };

  const alphaPresence = clamp01(m.transparentRatio * 2.35 + m.semiTransparentRatio * 1.85 + m.borderTransparentRatio * 0.72);
  const softAlpha = clamp01(m.semiTransparentRatio * 2.15 + (1 - m.binaryAlphaRatio) * 0.55);
  const cutoutAlpha = clamp01(m.transparentRatio * 1.8 + m.borderTransparentRatio * 0.9 + m.binaryAlphaRatio * 0.42 - m.semiTransparentRatio * 1.5);

  let additive = 0;
  additive += m.borderBlackRatio * 0.28;
  additive += m.blackRatio * 0.2;
  additive += m.veryDarkRatio * 0.08;
  additive += clamp01((0.48 - m.contentCoverage) / 0.48) * 0.2;
  additive += clamp01((m.brightEnergyRatio - 0.22) / 0.45) * 0.16;
  additive += clamp01((m.lumaStdDev - 0.16) / 0.42) * 0.08;
  additive += hints.additive;
  let penalty = alphaPresence * 0.85 + m.semiTransparentRatio * 1.4;
  if (m.brightRatio < 0.004) penalty += 0.22;
  if (m.contentCoverage > 0.62) penalty += 0.18;
  if (m.averageLuma > 0.46) penalty += 0.15;
  additive = clamp01(additive - penalty);
  /*
   * `glowScore`：**黑底发光**（把黑色当透明色用）的专门判据。
   *
   * 这是原版加色贴图的实际形态：整张图大部分是**纯黑**，内容是一小片
   * 高亮度光晕/光条，四周一圈是黑的。`Object4/light01.jpg`（16×128 的发光条）
   * 就是典型 —— 它太细长，上面那套按覆盖率的加权给它算出了 opaque。
   *
   * 为什么是「边框黑」而不是「覆盖率低」：
   *   实测 `contentCoverage` 对这类图完全失效（`isContent` 里 `sat > 0.16` 就算内容，
   *   JPEG 噪声让发光条覆盖到 0.79），而**四周一圈纯黑**是它们真正的共同点：
   *     发光类   light01 1.00 / cobweb 0.95 / fire01 1.00 / aurora 1.00
   *     实体类   FArmor 0.00 / flower2 0.11 / Kni000 0.36 / birdnpc 0.37
   * 另外两条是防御：
   *   ① 纯黑占比要过半（不然「深色但正常」的贴图会被误判）；
   *   ② 图里得真有内容（`averageLuma`/`lumaStdDev`）—— `ston03.jpg` 是 2×2 全黑占位图，
   *      按前两条会判成发光，加这一条就排除了。
   */
  const glowRaw = (() => {
    if (alphaPresence > 0.12) return 0;
    if (m.averageLuma < 0.02 || m.lumaStdDev < 0.02) return 0;
    const border = clamp01((m.borderBlackRatio - 0.5) / 0.5);
    const dark = clamp01((m.blackRatio - 0.25) / 0.5);
    return clamp01(border * 0.55 + dark * 0.45);
  })();
  /*
   * 名字闸门：像素不过关的一律 0；像素过关但没有特效词的也 0
   * （木头/铁栅/马车这些「UV 摊在黑底上」的实体贴图就靠这一条挡掉）。
   */
  const glowScore = keywordHits(hintText, ADDITIVE_HINTS) > 0 ? glowRaw : 0;

  /*
   * 全黑/纯色占位图（`Object1/ston03.jpg` 是 2×2 全黑）不能走加色：
   * 它没有任何内容可加，画成半透明只是把物体变没了。压回不透明的分档。
   */
  if (m.averageLuma < 0.02 || m.lumaStdDev < 0.02) additive = Math.min(additive, 0.3);
  /*
   * **没有特效词就不给加色**（名字闸门的第二处）。
   *
   * 加权那套（黑边/黑占比/亮度分布）单独就能把 `gearB.jpg`（机械齿轮 ×8）、
   * `R.jpg` 这类「黑底 + 小块内容」的实体贴图推到 0.5 以上 —— 它们在像素上
   * 和发光贴图没法区分，只能靠命名。命中特效词的一律不受这条限制。
   */
  if (keywordHits(hintText, ADDITIVE_HINTS) === 0) additive = Math.min(additive, 0.35);

  let normal = 0;
  normal += alphaPresence * 0.68 + softAlpha * 0.18 + cutoutAlpha * 0.11 + hints.normal;
  if (additive > 0.72 && alphaPresence < 0.05) normal -= 0.12;
  normal = clamp01(normal);

  let opaque = 0;
  opaque += (1 - alphaPresence) * 0.56;
  opaque += clamp01((m.contentCoverage - 0.33) / 0.67) * 0.24;
  opaque += clamp01((m.averageLuma - 0.09) / 0.75) * 0.1;
  opaque += (1 - additive) * 0.1 + hints.opaque;
  opaque = clamp01(opaque);

  return { additive, normal, opaque, glowScore, glowRaw, alphaPresence };
}

/** 调试用：把原始统计也吐出来（`__MU_DEBUG__.blendMetrics`） */
export function blendMetrics(texture: THREE.Texture | null, hint = '') {
  const image = texture?.image as (CanvasImageSource & { width: number; height: number }) | null;
  const metrics = image && image.width ? metricsOf(image) : null;
  const verdict = detectBlend(texture, hint);
  const scores = metrics ? scoreOf(metrics, `${texture?.name ?? ''} ${hint}`.toLowerCase()) : null;
  return { metrics, verdict, scores, alphaStyle: verdict.alphaStyle };
}

/**
 * **模型贴图该怎么画** —— 物件 / 装备 / 怪物 / NPC / 玩家共用的唯一入口。
 *
 * 和原版 `BMD__RenderMesh` 的对应关系（`Render/BMD_LegacyDraw.cpp`）：
 *
 *   ```c
 *   if (blendMesh 命中)              GL_SetBlendAdditive();          // 调用方指定
 *   else if (fl & 2) {
 *     if (fl & 0x40)                 GL_SetBlendAdditive();          // RENDER_BRIGHT
 *     else if (fl & 0x80)            GL_SetBlendSrcAlpha();          // RENDER_DARK
 *     else if (alpha < 1 || Bits[tex].bpp == 4)  GL_SetBlendSrcOver(1);  // 有 alpha → alphaTest
 *     else                           GL_ResetState();                // 不透明
 *   }
 *   ```
 *
 * 也就是说原版**按贴图自动判的只有一件事**：`bpp == 4`（OZT/TGA 带 alpha 通道）
 * 就走 alphaTest，否则不透明；加色是调用方给 `0x40` 标志的（`RENDER_BRIGHT`）。
 *
 * 我们多补一条自动规则：**黑底发光**（见 `scoreOf` 的 `glowScore`）——
 * 这类贴图没有 alpha，用纯黑当透明色，不透明画出来就是一块黑方块，
 * 而原版是靠调用方逐类型传 `0x40` 才画对的。用像素判出来以后，
 * 装备/怪物/NPC 里同类的发光贴图就不用一条条加名单了。
 *
 * @param texture 已加载的贴图
 * @param hasAlpha 文件本身带 alpha 通道（`tex.tag === 'blend'`，即 TGA/OZT）
 * @param hint bmd 里写的贴图路径（给文件名提示用）
 */
export interface ModelBlend {
  /** 走 alphaTest 抠图 */
  cutout: boolean;
  /** 半透明软边（烟雾/玻璃） */
  soft: boolean;
  /** 加法混合（黑底发光贴图） */
  additive: boolean;
  verdict: BlendVerdict;
}

export function modelBlend(texture: THREE.Texture | null, hasAlpha: boolean, hint = ''): ModelBlend {
  const verdict = detectBlend(texture, hint);
  const additive = verdict.mode === 'additive';
  // 加色和 alphaTest / 软透明互斥：加色根本不看 alpha
  const cutout = !additive && (hasAlpha || (verdict.mode === 'normal' && verdict.alphaStyle === 'cutout'));
  /*
   * 软透明（`transparent` + 不写深度）**只给没有 alpha 通道的贴图**。
   *
   * 原版对 `bpp == 4`（OZT/TGA 带 alpha）的模型一律 `GL_SetBlendSrcOver(1)`
   * —— 也就是 **alphaTest**，从来不做真正的 alpha 混合；`GL_SetBlendSrcAlpha`
   * 只出现在 `RENDER_DARK`（0x80）那条分支上。毛发/披风这类贴图如果改成
   * 不写深度的 alpha 混合，会立刻出现「头发盖在身体上」的排序错乱。
   * 所以有 alpha 通道就走 cutout，别乱升级成 soft。
   */
  const soft = !hasAlpha && !additive && verdict.mode === 'normal' && verdict.alphaStyle === 'soft';
  return { cutout, soft, additive, verdict };
}

/**
 * 判定一张贴图该怎么混合。
 * @param hint 额外的文件名提示（BMD 里 mesh 的 texturePath）
 */
export function detectBlend(texture: THREE.Texture | null, hint = ''): BlendVerdict {
  if (!texture) return FALLBACK;
  const hit = cache.get(texture);
  if (hit) return hit;

  const image = texture.image as (CanvasImageSource & { width: number; height: number }) | null;
  if (!image || typeof document === 'undefined' || !image.width) {
    cache.set(texture, FALLBACK);
    return FALLBACK;
  }
  const m = metricsOf(image);
  if (!m) {
    cache.set(texture, FALLBACK);
    return FALLBACK;
  }

  const hintText = `${texture.name || ''} ${hint}`.toLowerCase();
  const { additive, normal, opaque, glowScore, alphaPresence } = scoreOf(m, hintText);

  /*
   * 「黑底发光」是**硬判据**：命中就直接加色。
   *
   * 只靠加权的话它会被 opaque 的基分压过去（opaque 恒有 `(1-alphaPresence)*0.56`
   * 的底分，而发光贴图本身覆盖率低、alphaPresence 也是 0，两边基础分很接近）。
   * 而这类贴图**必须**加色：它们用纯黑当透明色，按不透明画就是一块黑方块。
   */
  /*
   * 「黑底发光」要**同时**满足两条才判加色：
   *   ① 像素形态对得上（`glowScore`：一圈纯黑 + 黑占过半 + 里面有内容）；
   *   ② 贴图名带特效词（`ADDITIVE_HINTS`：light / fire / candle / glow / aurora…）。
   *
   * 为什么非要②：**光靠像素分不出来**。实测这几张 32×32 的「实体」贴图
   * 和真发光贴图的统计几乎一模一样（边框纯黑 0.95~1.00、黑占 0.44~0.78、
   * 内容还是一整块）：
   *
   *     Object4/wood02.jpg    木头（17 个实例）  glow 0.67
   *     Object1/tile_space01  方形砖             glow 0.79
   *     Object1/steel_barred  铁栅栏             glow 0.65
   *     Object1/horse_drawn03 马车               glow 0.94
   *     Object4/light01.jpg   蝴蝶发光条         glow 1.00   ← 真发光
   *
   * 它们本质都是「UV 摊在黑色底上」，像素上区分不开；而 MU 对这类**发光效果**
   * 的贴图命名非常规律（light/fire/candle/glow…），加上名字这一条就干净了。
   * 名字命中的还必须过像素闸 —— `light.jpg`（路灯柱）、`streetlight.jpg`
   * 这种名字命中但整张是实体表面的，仍然是不透明。
   */
  const glowAdditive = glowScore >= 0.58 && alphaPresence < 0.12;
  const addScore = Math.max(additive, glowScore);

  let mode: BlendMode;
  if (glowAdditive) mode = 'additive';
  else if (alphaPresence > 0.18 && additive < 0.82) mode = 'normal';
  else if (additive > 0.72 && alphaPresence < 0.09) mode = 'additive';
  else if (normal >= addScore + 0.08 && normal >= 0.36) mode = 'normal';
  else if (addScore >= normal + 0.06 && addScore >= 0.44) mode = 'additive';
  else if (opaque >= normal && opaque >= addScore) mode = 'opaque';
  else mode = normal >= addScore ? 'normal' : 'additive';

  const verdict: BlendVerdict = {
    mode,
    alphaStyle: mode === 'normal' ? alphaStyleOf(m) : 'none',
    confidence: clamp01((mode === 'additive' ? addScore : mode === 'normal' ? normal : opaque) * 0.72),
    reason:
      mode === 'additive'
        ? glowAdditive
          ? `black-background glow (glow=${glowScore.toFixed(2)})`
          : 'dark border + sparse bright energy'
        : mode === 'normal'
          ? `alpha detected (${alphaStyleOf(m)})`
          : 'solid surface profile',
  };
  cache.set(texture, verdict);
  return verdict;
}
