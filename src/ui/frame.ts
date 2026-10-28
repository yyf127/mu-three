/**
 * 原版 UI 层：640×480 逻辑坐标，整层等比缩放到 4:3 舞台。
 *
 * 为什么是 640×480：客户端源码里所有面板坐标都是这个基线上的绝对值 ——
 * 背包面板 `RenderInventoryWindow`（HUD_Pass6.cpp:377）写死 `sx = 450`，
 * 面板宽 190 → 450+190 = 640 正好贴右边缘；标题字号换算的
 * `120 * WindowWidth / 0x280` 里 `0x280` 也是 640。
 *
 * 所以这里不跟舞台像素走，而是保持 640×480 的整数坐标系，
 * 用 transform: scale() 放大 —— 画面里的 1 个单位永远等于原版 1 像素，
 * 抄布局时可以一个数一个数地照搬，不会因为窗口大小走样。
 */

export const UI_W = 640;
export const UI_H = 480;

export class UiLayer {
  readonly root: HTMLDivElement;
  private scale = 1;

  constructor(stage: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'mu-ui';
    this.root.className = 'hidden';
    stage.appendChild(this.root);
    this.resize();
  }

  /** JPEG 载入的 190×256 底板等素材一律按逻辑像素摆，缩放交给这一层 */
  resize() {
    const stage = this.root.parentElement;
    if (!stage) return;
    const w = stage.clientWidth || 1;
    this.scale = w / UI_W;
    this.root.style.transform = `scale(${this.scale})`;
  }

  /** 逻辑坐标 → 舞台 CSS 像素（DOM 事件用，命中测试要换算） */
  toStage(x: number, y: number) {
    return { x: x * this.scale, y: y * this.scale };
  }

  get scaleFactor() {
    return this.scale;
  }

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
  }

  get visible() {
    return !this.root.classList.contains('hidden');
  }

  add<T extends HTMLElement>(el: T): T {
    this.root.appendChild(el);
    return el;
  }
}

/**
 * 造一个绝对定位的原版贴图元素。
 *
 * `sprite` 是 OZJ 的原始像素尺寸，`w/h` 是原版代码里 `RenderBitmap` 传入的
 * 显示尺寸 —— 两者经常不等（Item_Back01 是 190×256，但底栏那种 256×64 的图
 * 只画 256×48），所以必须显式拉伸。
 */
export function spriteBox(opts: {
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
  className?: string;
}): HTMLImageElement {
  const img = document.createElement('img');
  img.src = opts.url;
  img.draggable = false;
  img.className = `ui-sprite ${opts.className ?? ''}`.trim();
  img.style.left = `${opts.x}px`;
  img.style.top = `${opts.y}px`;
  img.style.width = `${opts.w}px`;
  img.style.height = `${opts.h}px`;
  // 原版是最近邻采样（GL_NEAREST），用 pixelated 才能保住那种锐利边缘
  img.style.imageRendering = 'pixelated';
  return img;
}
