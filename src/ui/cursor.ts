/**
 * 游戏内鼠标光标（原版 `Data/Interface/Cursor*.ozt`）。
 *
 * 0.97 客户端是**自己画光标**的（`Render/Cursor_Render.cpp::Cursor_Render`），
 * 位图号在 `Scene/Scene_AssetLoad.cpp` 里固定成 2..10：
 *
 *   | 位图 | 文件 | 什么时候用 |
 *   | --- | --- | --- |
 *   | 2 | `Cursor.ozt` | 默认箭头 |
 *   | 3 | `Cursorpush.ozt` | 按住左键、目标格能走（"推着走"） |
 *   | 4 | `Cursorattack.ozt` | 指到可攻击的角色 |
 *   | 5 | `Cursorget.ozt` | 指到地上的物品 |
 *   | 6 | `Cursortalk.ozt` | 指到 NPC（**64×64 的 2×2 动画**） |
 *   | 7 | `Cursorrepair.ozt` | 修理模式（铁匠那个转动的钻头） |
 *   | 8 | `Cursorleanagainst.ozt` | 指到可交互的世界物件（原版按地图匹配 type） |
 *   | 9 | `Cursorsitdown.ozt` | 同上，通用兜底（"坐下/使用"） |
 *   | 10 | `Cursordontmove.ozt` | 按住左键、目标格走不了 |
 *
 * 原版画的时候是 `MouseX-2, MouseY-2` 贴一张 24×24，所以热点在 (2,2)；
 * 这里用浏览器原生光标（CSS `cursor: url(...) hx hy`）实现同一个效果，
 * 尺寸跟着 UI 缩放走（原版 800×600 下是 24px，我们的逻辑分辨率是 640×480）。
 *
 * `Cursoreye.ozt`（64×64）在 0.97 的位图表里没有，是"查看/鉴定"用的，
 * 一并载入备用（`eye`），暂时没有触发点。
 */
import { uiSprite } from './ozj';

export type CursorKind =
  | 'arrow'
  | 'push'
  | 'attack'
  | 'get'
  | 'talk'
  | 'repair'
  | 'lean'
  | 'sit'
  | 'dontmove'
  | 'eye';

/** 原版 24×24 逻辑像素 */
const LOGICAL = 24;
/** 原版绘制偏移 -2,-2 */
const HOTSPOT = 2;
/** 动画帧间隔：原版 `WorldTime*0.01 % 6`（worldtime 单位是 10ms → 100ms/帧） */
const FRAME_MS = 100;

/** 2×2 图集的取帧顺序，照抄 `Cursor_Render.cpp` 的 u/v 组合 */
const QUAD_CYCLE = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [1, 1],
  [1, 0],
] as const;

interface Spec {
  file: string;
  /** 64×64 = 2×2 帧；32×32 就是单帧 */
  quad?: boolean;
}

const SPECS: Record<CursorKind, Spec> = {
  arrow: { file: 'Cursor.ozt' },
  push: { file: 'Cursorpush.ozt' },
  attack: { file: 'Cursorattack.ozt' },
  get: { file: 'Cursorget.ozt' },
  talk: { file: 'Cursortalk.ozt', quad: true },
  repair: { file: 'Cursorrepair.ozt' },
  lean: { file: 'Cursorleanagainst.ozt' },
  sit: { file: 'Cursorsitdown.ozt' },
  dontmove: { file: 'Cursordontmove.ozt' },
  eye: { file: 'Cursoreye.ozt', quad: true },
};

/**
 * 光标贴在哪个元素上。
 *
 * 原版是**自绘光标**（`ShowCursor(FALSE)` 之后自己在最上层画），所以鼠标移到
 * 仓库/商店/背包面板上时，看到的还是这个游戏光标。CSS 光标只设在 canvas 上的话，
 * 一进面板就变回系统箭头了 —— 因此统一贴在 `<body>`，并用一条样式把子元素
 * 的 `cursor` 全部改回 `inherit`（按钮上的 pointer、抓手的 grab 都被盖掉，
 * 只有输入框保留 I 形光标）。
 */
let target: HTMLElement | null = null;
let styleInjected = false;

function ensureTarget(el?: HTMLElement | null) {
  const host = el || document.body;
  if (target === host && styleInjected) return host;
  target = host;
  if (!styleInjected) {
    styleInjected = true;
    const st = document.createElement('style');
    st.id = 'mu-custom-cursor';
    /*
     * 注意**不能把 body 自己写进这条规则**：`!important` 的 `inherit` 会压过
     * body 的行内光标，body 就继承回 `html` 的 `auto` —— 结果全站又变回系统光标
     * （这一步踩过一次）。只约束后代。
     */
    st.textContent = `
      body.mu-custom-cursor *:not(input):not(textarea):not(select) { cursor: inherit !important; }
      body.mu-custom-cursor input,
      body.mu-custom-cursor textarea { cursor: text !important; }
    `;
    document.head.appendChild(st);
  }
  return host;
}

/** 真正贴样式：顺便给 body 打上标记类，让子元素统一 inherit */
function applyCss(host: HTMLElement, css: string) {
  applied = css;
  host.style.cursor = css;
  if (!document.body.classList.contains('mu-custom-cursor')) {
    document.body.classList.add('mu-custom-cursor');
  }
}

/** kind → 每一帧的 dataURL */
const built = new Map<CursorKind, string[]>();
let scale = 1;
let ready = false;
/** 当前贴在 canvas 上的样式串（同一个串不重复赋值） */
let applied = '';
let current: CursorKind = 'arrow';
let startedAt = performance.now();

function drawFrame(img: HTMLImageElement, quad: readonly [number, number] | null, size: number) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (quad) {
    const cw = img.width / 2;
    const ch = img.height / 2;
    ctx.drawImage(img, quad[0] * cw, quad[1] * ch, cw, ch, 0, 0, size, size);
  } else {
    ctx.drawImage(img, 0, 0, size, size);
  }
  return cv.toDataURL('image/png');
}

/** 载入并烘焙（按当前 UI 缩放）。可重复调用，缩放变了就重新烘焙。 */
export async function initCursors(uiScale: number) {
  scale = Math.max(0.75, Math.min(3, uiScale || 1));
  const size = Math.round(LOGICAL * scale);
  const kinds = Object.keys(SPECS) as CursorKind[];

  await Promise.all(
    kinds.map(async kind => {
      const spec = SPECS[kind];
      if (built.has(kind) && built.get(kind)!.length) return;
      const sprite = await uiSprite(spec.file);
      if (!sprite) {
        console.warn(`[cursor] 缺贴图 ${spec.file}`);
        built.set(kind, []);
        return;
      }
      const frames = spec.quad
        ? QUAD_CYCLE.map(q => drawFrame(sprite.image, q, size))
        : [drawFrame(sprite.image, null, size)];
      built.set(kind, frames.filter(Boolean));
    })
  );
  ready = [...built.values()].some(f => f.length);
  applied = ''; // 强制下一帧重贴
  ensureTarget();
}

/** 缩放变化（窗口 resize）后重新烘焙 */
export async function rescaleCursors(uiScale: number) {
  const next = Math.max(0.75, Math.min(3, uiScale || 1));
  if (Math.abs(next - scale) < 0.02) return;
  built.clear();
  await initCursors(next);
}

function styleFor(kind: CursorKind, elapsedMs: number) {
  const frames = built.get(kind);
  if (!frames || !frames.length) return '';
  const idx =
    frames.length > 1 ? Math.floor(elapsedMs / FRAME_MS) % frames.length : 0;
  const hx = Math.round(HOTSPOT * scale);
  return `url(${frames[idx]}) ${hx} ${hx}, auto`;
}

/** 换一种光标。同一种连续调用不会产生多余样式赋值。 */
export function setCursor(kind: CursorKind, el?: HTMLElement | null) {
  const host = ensureTarget(el);
  current = kind;
  if (!ready) return;
  const css = styleFor(kind, performance.now() - startedAt);
  if (css && css !== applied) applyCss(host, css);
}

/** 每帧调一次：只负责让 talk / eye 这类 2×2 动画换帧 */
export function tickCursor() {
  if (!ready || !target) return;
  const frames = built.get(current);
  if (!frames || frames.length < 2) return;
  const css = styleFor(current, performance.now() - startedAt);
  if (css && css !== applied) applyCss(target, css);
}

/** 诊断：已载入的光标 */
export function cursorInfo() {
  return {
    ready,
    scale,
    kinds: [...built.entries()].map(([k, v]) => `${k}:${v.length}`),
    current,
  };
}
