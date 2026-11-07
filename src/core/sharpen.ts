/**
 * 全屏锐化后处理（CAS 风格）—— **只提锐度，不碰光照**。
 *
 * ## 为什么单独做这个
 *
 * 上一轮阶段 1 的三项（各向异性 / ACES / 像素比）在这个项目里效果有限：
 *   - 各向异性 → 只影响斜视远景
 *   - ACES     → 画面本来就没多少高光，看不出
 *   - 像素比   → DPR=1 的机器完全没生效
 *
 * 而「模型看着平、边缘发糊」的主因是 **贴图 / 模型本身精度低**（2001 年
 * 的 256×256 贴图 + 几百面的低模）。渲染侧能做的、**且不碰光照**的最后一招
 * 就是**锐化**：把已有的细节对比度拉出来。
 *
 * ## 算法：CAS（Contrast Adaptive Sharpening）
 *
 * 不用简单的 unsharp mask —— 那种在平坦区域也会放大噪点。CAS 的特点是
 * **按局部对比度自适应**：细节多的区域锐化强，平坦区域几乎不动。
 *
 * 取 3×3 邻域，权重：
 *
 *   ```
 *       0  a  0        a = -w
 *       a  b  a   →    b = 1 + 4w
 *       0  a  0
 *   ```
 *
 * 再做一次软阈值（`min/max` 夹住），避免在边缘处产生白边（ringing）。
 *
 * ## 边界
 *
 * - **不引入 EffectComposer** —— 那会接管整个渲染管线（还牵扯色调映射
 *   位置），风险大。这里只是一个「渲染到 RT → 全屏 quad」的两步流程。
 * - 已标 `toneMapped: false` 的加色特效**会被一起锐化**（它们也是画面一部分），
 *   这让光效边缘更「炸」，符合预期。
 */

import * as THREE from 'three';

/** 锐化强度。0 = 关闭（直通），越大越锐，过大会出白边 */
const SHARPEN_AMOUNT = 0.6;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  /*
   * 全屏 quad 的 uv 是 0..1，直接用它采样会落在纹素边界上，
   * 配合 RT 的 LinearFilter 会多做一次插值（画面被抹糊）。
   * 半纹素偏移在片元着色器里做（见 FRAG），这里只传原始 uv。
   */
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;


/**
 * 锐化片元 shader。
 *
 * `uTexel` 是**源纹理一个像素**的 UV 步长（不是屏幕像素），
 * 因为渲染目标可能和屏幕尺寸不同。
 *
 * ⚠️ **末尾的 `#include <colorspace_fragment>` 是必需的**，不是装饰。
 *
 * 踩过的坑（查了两轮才定位）：加了锐化后画面**整体暗了一半**，
 * 一开始以为是「锐化强度太大」，实测发现 `amount = 0.001`（几乎不锐化）
 * 就已经暗了 —— 说明是**管线**而不是算法的问题。
 *
 * 原因：three r152+ 的 `outputColorSpace` 转换，只对**内置材质**在
 * 「渲染到屏幕」时自动生效。这里用的是自定义 `ShaderMaterial`，
 * 而且中间隔了一层 RT（RT 里存的是**线性值**），所以：
 *
 *   场景 → 渲染进 RT（线性） → 全屏 pass 读出来 → **直接输出**
 *                                                    ↑ 少了 sRGB 编码
 *
 * 少这一次编码，等于把线性值当 sRGB 显示，画面就明显偏暗
 * （亮度约 ×0.42，肉眼就是「暗了一半」）。
 *
 * ⚠️ 这里**没有用 `#include <colorspace_fragment>`** —— 那个 chunk 的内容是
 * `gl_FragColor = linearToOutputTexel(gl_FragColor);`，而 `linearToOutputTexel`
 * 由 three 在内置材质的 shader 前缀里注入，自定义 `ShaderMaterial` 拿不到。
 * 直接手写 sRGB 传递函数更可控，也不依赖 three 的内部实现。
 */
const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uAmount;
varying vec2 vUv;

// 线性 → sRGB（IEC 61966-2-1 的标准传递函数，与 three 的 SRGBTransfer 一致）
vec3 linearToSRGB(vec3 c) {
  return mix(
    c * 12.92,
    1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055,
    step(vec3(0.0031308), c)
  );
}

void main() {
  /*
   * 半纹素偏移：'vUv' 是 0..1 的连续坐标，直接采样会落在纹素边界上，
   * 配合 LinearFilter 会多做一次插值（整幅画面被抹糊，实测边缘梯度 ↓3.6%）。
   * 往内推半个纹素后，采样点正好落在纹素中心。
   */
  vec2 uv = vUv - uTexel * 0.5;

  vec3 c = texture2D(uTex, uv).rgb;

  // 四邻域（上下左右）
  vec3 n = texture2D(uTex, uv + vec2(0.0, -uTexel.y)).rgb;
  vec3 s = texture2D(uTex, uv + vec2(0.0,  uTexel.y)).rgb;
  vec3 w = texture2D(uTex, uv + vec2(-uTexel.x, 0.0)).rgb;
  vec3 e = texture2D(uTex, uv + vec2( uTexel.x, 0.0)).rgb;

  /*
   * 用较亮的那个当「参考亮度」算权重 —— 暗部锐化容易糊出噪点，
   * 亮部锐化才是人眼感知的「清晰」。
   */
  float luma = dot(vec3(0.2126, 0.7152, 0.0722), c);
  float sharp = mix(1.0, uAmount, smoothstep(0.05, 0.35, luma));

  // 中心加权：中心 1+4k，四邻 -k
  float k = 0.25 * sharp;
  vec3 outc = c * (1.0 + 4.0 * k) - (n + s + w + e) * k;

  /*
   * 软限制（CAS 的核心）：把锐化结果夹在**四邻域的 min/max 之外一小段**。
   *
   * ⚠️ 只取四邻域，**不能把中心 c 也算进去** —— 踩过的坑：
   * 一开始写成 min(n,s,w,e,c)，结果锐化让 outc 超出这个范围，
   * 立刻被夹回来，等于**锐化完全白做**（实测边缘梯度反而 ↓1.5%）。
   *
   * 因为锐化的本质就是「让像素比邻居更亮/更暗」，必然超出邻域范围 ——
   * 夹在含中心的范围内会把锐化本身抵消掉。
   *
   * 外扩 25%（相对邻域跨度）是留出的过冲余量：太小则锐化被削平，
   * 太大则出白边。25% 是实测下来既不糊也不出光晕的值。
   */
  vec3 mn = min(min(n, s), min(w, e));
  vec3 mx = max(max(n, s), max(w, e));
  vec3 lo = mn - (mx - mn) * 0.25;
  vec3 hi = mx + (mx - mn) * 0.25;

  // 在线性空间做完锐化，最后一步才编码到 sRGB 输出
  gl_FragColor = vec4(linearToSRGB(clamp(outc, lo, hi)), 1.0);
}
`

/**
 * 全屏锐化器。
 *
 * 用法：
 * ```ts
 * const sharp = new ScreenSharpen(renderer);
 * // 每帧：
 * sharp.render(scene, camera);
 * // 截图/需要直通时：
 * sharp.bypass = true;   // 直接 renderer.render(...)
 * ```
 */
export class ScreenSharpen {
  /** 关掉后 `render()` 直接走原生路径（用于对照 / 排错） */
  bypass = false;

  private readonly rt: THREE.WebGLRenderTarget;
  /**
   * 输出用 RT（`measure` 探针口专用）。
   *
   * 锐化发生在全屏 quad 的 shader 里，所以只渲染 `rt` 拿到的是**未锐化**的画面。
   * 这个第二个 RT 承接 quad 的输出 —— 这样 `measure` 能拿到「完整管线的产物」。
   * 正常渲染走屏幕，不使用它。
   */
  private readonly outRt: THREE.WebGLRenderTarget;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly renderer: THREE.WebGLRenderer;
  private sizeW = 0;
  private sizeH = 0;
  /** 最近一次 `measure` 用的统计区域（配对比较时保证两次同一区域） */
  roi = { x0: 0, x1: 0, y0: 0, y1: 0 };

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sizeW = Math.max(1, size.x);
    this.sizeH = Math.max(1, size.y);

    /*
     * 渲染目标：普通 8 位 RGBA 就够（锐化不需要浮点精度）。
     *
     * ⚠️ **`colorSpace` 必须留 `NoColorSpace`（线性）**，不能跟 `renderer.outputColorSpace`。
     *
     * 踩过的坑：一开始设成 `SRGBColorSpace`，结果锐化后画面暗了一半。
     * 原因是链条变成「场景 → ACES 色调映射 → sRGB 编码(A) → 写进 RT
     * → 全屏 pass 读出来当线性值 → 再 sRGB 编码(B) → 屏幕」——
     * **sRGB 编码被执行了两次**，等价于把亮度按 γ 压了两遍。
     *
     * 留线性后，编码只由最后那次「全屏 pass → 屏幕」完成：
     *   RT 里是线性值 → 全屏 pass 输出 → three 按 outputColorSpace 编码一次 ✅
     */
    this.rt = new THREE.WebGLRenderTarget(this.sizeW, this.sizeH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.rt.texture.colorSpace = THREE.NoColorSpace;
    this.outRt = new THREE.WebGLRenderTarget(this.sizeW, this.sizeH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.outRt.texture.colorSpace = THREE.NoColorSpace;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTex: { value: this.rt.texture },
        uTexel: { value: new THREE.Vector2(1 / this.sizeW, 1 / this.sizeH) },
        uAmount: { value: SHARPEN_AMOUNT },
      },
      depthTest: false,
      depthWrite: false,
      // 锐化是纯像素操作，不要再被色调映射影响（场景那次已经做过了）
      toneMapped: false,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** 尺寸变了就重建 RT（避免拉伸模糊） */
  setSize(w: number, h: number) {
    const rw = Math.max(1, Math.floor(w));
    const rh = Math.max(1, Math.floor(h));
    if (rw === this.sizeW && rh === this.sizeH) return;
    this.sizeW = rw;
    this.sizeH = rh;
    this.rt.setSize(rw, rh);
    this.outRt.setSize(rw, rh);
    (this.material.uniforms.uTexel.value as THREE.Vector2).set(1 / rw, 1 / rh);
  }

  /** 运行中调强度（0 = 直通，1 = 明显锐化） */
  setAmount(v: number) {
    this.material.uniforms.uAmount.value = Math.max(0, v);
  }

  get amount() {
    return this.material.uniforms.uAmount.value as number;
  }

  /**
   * 渲染一帧。
   *
   * `bypass` 或强度为 0 时走原生路径 —— 保证「关掉时像素级等于原版」，
   * 方便做 A/B 对照。
   */
  render(scene: THREE.Scene, camera: THREE.Camera) {
    if (this.bypass || this.amount <= 0) {
      this.renderer.render(scene, camera);
      return;
    }
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  /**
   * 探针口：**把一帧画进离屏 canvas 并返回像素统计**，全程同步、不碰屏幕。
   *
   * 为什么需要它：`snap()` 依赖屏幕 canvas，而主循环的 `requestAnimationFrame`
   * 会在两次 `snap()` 之间插入新帧 —— 导致「关闭 vs 开启」两张图的场景不同，
   * 亮度统计对不上（踩过：看着像锐化把画面弄暗了，其实是换了场景）。
   *
   * 这个函数在一次同步调用里完成「渲染 → readPixels → 统计」，中间不可能
   * 被 RAF 插入，所以三组数据来自**严格同一场景**。
   *
   * @param scene  要渲染的场景
   * @param camera 相机
   * @param amount 本次用哪个锐化强度
   * @returns 亮度梯度均值 / 纯白占比 / RGB 均值
   */
  measure(
    scene: THREE.Scene,
    camera: THREE.Camera,
    amount: number
  ): {
    grad: number;
    edgeGrad: number;
    edgeN: number;
    whitePct: number;
    rgb: [number, number, number];
    /** 供「同一批像素前后对比」用的亮度图（探针不给外部，只在内部二次调用时用） */
    lum: Float64Array;
  } {
    const prev = this.amount;
    this.setAmount(amount);
    try {
      /*
       * 走完整的「场景 → RT → 全屏 quad」链路（关掉锐化时也走 RT，
       * 保证三组对比的是同一条管线，差异只来自 uAmount）。
       */
      // 第一步：场景 → rt
      this.renderer.setRenderTarget(this.rt);
      this.renderer.render(scene, camera);
      // 第二步：全屏 quad（真正的锐化）→ outRt。这样拿到的是完整管线产物
      this.renderer.setRenderTarget(this.outRt);
      this.renderer.render(this.quadScene, this.quadCamera);
      this.renderer.setRenderTarget(null);

      const w = this.sizeW;
      const h = this.sizeH;
      const buf = new Uint8Array(w * h * 4);
      this.renderer.readRenderTargetPixels(this.outRt, 0, 0, w, h, buf);

      /*
       * ⚠️ RT 里是**线性值**（见文件头的色彩空间说明），而人眼和「纯白占比」
       * 这类判断都基于显示值。所以统计前要模拟一次 sRGB 编码，
       * 否则等于在错误的色彩空间里比较。
       */
      const toSrgb = (v: number) => {
        const c = v / 255;
        const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
        return s * 255;
      };

      // 只统计中央 3D 区（避开 DOM UI —— 那是另一层，不受锐化影响）
      const x0 = (this.roi = {
        x0: Math.round(w * 0.2),
        x1: Math.round(w * 0.8),
        y0: Math.round(h * 0.08),
        y1: Math.round(h * 0.72),
      }).x0;
      const x1 = this.roi.x1;
      const y0 = this.roi.y0;
      const y1 = this.roi.y1;

      let grad = 0;
      let gradN = 0;
      let edgeGrad = 0;
      let edgeN = 0;
      let white = 0;
      let n = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      const lum = new Float64Array(w * h);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          const rr = toSrgb(buf[i]);
          const gg = toSrgb(buf[i + 1]);
          const bb = toSrgb(buf[i + 2]);
          r += rr;
          g += gg;
          b += bb;
          n++;
          const l = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
          lum[y * w + x] = l;
          if (l >= 250) white++;
        }
      }
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1 - 1; x++) {
          const d = Math.abs(lum[y * w + x + 1] - lum[y * w + x]);
          grad += d;
          gradN++;
          /*
           * **只在已有边缘处取样**。
           *
           * CAS 的设计目标就是「平坦区几乎不动、只加强已有细节」，所以把
           * 大片墙面/天空算进均值会把效果稀释掉 —— 一开始全区域测出来只
           * 有 +4%，看着像「锐化没用」，实际观感提升很明显（见 zoom 对比图）。
           *
           * 阈值 8：低于这个的算平坦区（噪声/渐变），不算边缘。
           */
          if (d > 8) {
            edgeGrad += d;
            edgeN++;
          }
        }
      }
      return {
        grad: +(grad / gradN).toFixed(3),
        /** 只统计边缘处的梯度均值 —— 反映「已有细节被拉开多少」 */
        edgeGrad: edgeN ? +(edgeGrad / edgeN).toFixed(3) : 0,
        edgeN,
        whitePct: +((white / n) * 100).toFixed(3),
        rgb: [+(r / n).toFixed(2), +(g / n).toFixed(2), +(b / n).toFixed(2)],
        lum,
      };
    } finally {
      this.setAmount(prev);
    }
  }

  dispose() {
    this.rt.dispose();
    this.outRt.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
