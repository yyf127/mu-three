/**
 * 物品图标的「悬停 3D 旋转」。
 *
 * ## 原版依据（CONFIRMED_SOURCE）
 *
 * `Render/BMD_LegacyDraw.cpp::RenderObjectScreen`（0x004E13A0）：
 *
 * ```c
 * // RenderItem3D 先做一次命中测试
 * if (!DAT_07e91388 || PickUp) {
 *     if (fMouseX >= sx && fMouseX < sx + Width &&
 *         fMouseY >= sy && fMouseY < sy + Height) Success = true;
 * }
 * ...
 * if (Select == 1)                       // ← Success 传进来的就是它
 *     angle[1] = (float)DAT_05826e08 * 0.45f;
 * ```
 *
 * 也就是说**鼠标压在哪件物品的格子上，那件物品的 yaw 就被 `WorldTime*0.45`
 * 直接接管**（不是叠加，是把角度表里那个 yaw 整段盖掉）。`DAT_05826e08` 是
 * `WorldTime`，单位毫秒，所以转速 450°/秒。
 *
 * 同理还有一处细节：`angle[2]`（roll）在 `Type in [400,592)` 时是
 * **有厚度的物品用 25°、其它 15°**（`*(BYTE*)(itemAttr + ...) ? 25 : 15`），
 * 这条 `itemIcon.ts::anglesFor` 里按 15 处理（差别只在一度级的倾斜，先不动）。
 *
 * ## 为什么是「画一圈帧」而不是实时渲染
 *
 * `itemIcon.ts` 的缩略图是**离线渲一次、缓存 dataURL**（背包里有几十格，
 * 每帧重画几十个 BMD 是不可能的）。旋转也一样：悬停某件物品时先把这一圈
 * （`SPIN_FRAMES` 张）渲好缓存起来，播放时按时间索引换 `img.src`，
 * 后续再悬停同一件物品就是零渲染。
 *
 * 渲染 16 帧大概几十毫秒，所以**悬停 110ms 后才开始**：鼠标快速划过
 * 整排物品时不会把每件都渲一遍。
 */
import { itemSpinFrames, SPIN_DEG_PER_MS, SPIN_FRAMES } from './itemIcon';

/** 悬停多久才开始转（毫秒）。太快会把划过的每一格都渲一遍 */
const START_DELAY = 110;

interface Active {
  img: HTMLImageElement;
  /** 静态图（鼠标离开时恢复） */
  base: string;
  frames: string[];
  frame: number;
  type: number;
  level: number;
  startedAt: number;
}

let token = 0;
let timer = 0;
let raf = 0;
let active: Active | null = null;

/**
 * 鼠标进入某件物品：开始转。
 *
 * @param img   这件物品的图标元素（换 `src` 的就是它）
 * @param type  物品 type
 * @param level 物品等级（只有翅膀那类模型的角度分档，照传就行）
 */
export function hoverSpin(img: HTMLImageElement | null | undefined, type: number, level = 0) {
  if (!img) return;
  if (active?.img === img && active.type === type) return;
  stopHoverSpin();

  const my = ++token;
  const base = img.currentSrc || img.src;
  timer = window.setTimeout(() => {
    timer = 0;
    void itemSpinFrames(type, level).then(frames => {
      // 这段时间里鼠标已经移开 / 换了别的物品
      if (my !== token || !frames.length) return;
      active = { img, base, frames, frame: -1, type, level, startedAt: performance.now() };
      tick(my);
    });
  }, START_DELAY);
}

function tick(my: number) {
  if (my !== token || !active) return;
  const a = active;
  /*
   * 角度 = 经过毫秒 × 0.45（原版 `WorldTime * 0.45f`）。
   * 索引 = 角度 / 每帧角度；每帧 360/16 = 22.5°，也就是 20 帧/秒。
   */
  const deg = (performance.now() - a.startedAt) * SPIN_DEG_PER_MS;
  const idx = Math.floor(deg / (360 / SPIN_FRAMES)) % a.frames.length;
  if (idx !== a.frame) {
    a.frame = idx;
    a.img.src = a.frames[idx];
  }
  raf = window.requestAnimationFrame(() => tick(my));
}

/** 鼠标离开 / 面板关闭：停转并恢复静态图 */
export function stopHoverSpin(img?: HTMLImageElement | null) {
  if (img && active && active.img !== img) return;
  token++;
  if (timer) {
    window.clearTimeout(timer);
    timer = 0;
  }
  if (raf) {
    window.cancelAnimationFrame(raf);
    raf = 0;
  }
  if (active) {
    const a = active;
    active = null;
    // 元素可能已经被 `paint()` 重建掉了，写回旧节点无害
    if (a.base) a.img.src = a.base;
  }
}

/** 调试快照（探针断言用） */
export function spinState() {
  return active
    ? {
        active: true,
        type: active.type,
        level: active.level,
        frames: active.frames.length,
        frame: active.frame,
        // 当前 yaw（度），应该随时间是线性增长的
        yaw: Math.round((performance.now() - active.startedAt) * SPIN_DEG_PER_MS) % 360,
      }
    : { active: false, type: -1, level: 0, frames: 0, frame: -1, yaw: 0 };
}
