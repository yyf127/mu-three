/**
 * 跨面板拖拽物品（背包 / 仓库 / 商店 / 混沌箱）。
 *
 * 为什么单独抽一个模块：0.97 原版所有箱子类操作都是「**按住物品拖到目标窗口**」
 * ——`Item/Item_Move.cpp` 里 `RenderItemsBoxes` + `GetItemsBoxItem` 那套，
 * 松手时才按「源窗口 flag → 目标窗口 flag」发 `0x24`：
 *
 *   | 动作 | 源 → 目标 | flag |
 *   |---|---|---|
 *   | 仓库取回 | 仓库 → 背包 | 2 → 0 |
 *   | 存进仓库 | 背包 → 仓库 | 0 → 2 |
 *   | 商店购买 | 货架 → 背包 | 只发 `0x32` |
 *   | 商店出售 | 背包 → 货架 | 只发 `0x33` |
 *   | 丢在地上 | 背包 → 3D 画面 | 只发 `0x23` |
 *
 * 之前我们的实现是「点一下格子」：点货架就买、点仓库格就取、点背包就卖/存。
 * 手感和原版差太远，也容易误触（点错一下就卖出去了）。现在统一成拖拽，
 * 点击只留提示。
 *
 * 命中判定不靠每个面板自己算坐标，而是看落点 DOM：
 *
 *   ```html
 *   <div data-drag-panel="inventory"> … <div data-slot="12"> … </div></div>
 *   ```
 *
 * 松手时 `elementFromPoint` → 最近的 `[data-drag-panel]` 就是目标面板，
 * 再往下的 `[data-slot]` 就是具体格子（背包内换位要用）。
 * **落在 `#stage` 的 canvas 上**才算「丢到地上」，落在其它 HUD 上一律当无效，
 * 免得把东西丢进聊天框里。
 */
import { itemAttr } from '../data/itemAttrs';

export type PanelId = 'inventory' | 'warehouse' | 'shop' | 'chaos';

/** 探针用：记录最近几次拖拽落点（只写内存，不参与逻辑） */
declare global {
  interface Window {
    __MU_DRAG_LOG__?: unknown[];
  }
}

export interface DragItem {
  /** 来源面板 */
  panel: PanelId;
  /** 来源槽位（背包 0..75；容器格 0..119 / 0..31） */
  slot: number;
  /** 物品 type（决定占几格、图标） */
  type: number;
  /** 已经渲染好的图标（有就直接复用，没有再异步补） */
  iconSrc?: string | null;
}

export type DropTarget =
  /** 落在某个具体格子上（背包内换位） */
  | { kind: 'cell'; panel: PanelId; slot: number }
  /** 落在面板空白处（「拖进这个面板」） */
  | { kind: 'panel'; panel: PanelId }
  /** 落在 3D 画面上 → 丢在地上 */
  | { kind: 'floor' }
  /** 落在别的 HUD 上 → 当没发生 */
  | { kind: 'none' };

export interface DragHandlers {
  onDrop: (item: DragItem, target: DropTarget) => void;
  /** 拖起来了（面板可以把自己标成 dragging） */
  onStart?: () => void;
  /** 拖拽被取消 / 结束（无论有没有落点） */
  onEnd?: () => void;
}

// 探针用的落点记录（只保留最近 40 条）
if (typeof window !== 'undefined' && !window.__MU_DRAG_LOG__) window.__MU_DRAG_LOG__ = [];

/** 抖动阈值：小于它算单击 */
const THRESHOLD = 4;

function targetAt(x: number, y: number): DropTarget {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return { kind: 'none' };

  const panelEl = el.closest('[data-drag-panel]') as HTMLElement | null;
  if (panelEl) {
    const panel = (panelEl.dataset.dragPanel ?? '') as PanelId;
    const cellEl = el.closest('[data-slot]') as HTMLElement | null;
    const slot = cellEl ? Number(cellEl.dataset.slot) : NaN;
    if (Number.isFinite(slot)) return { kind: 'cell', panel, slot };
    return { kind: 'panel', panel };
  }

  // 只有直接落在 3D 画布上才算「丢地上」
  if (el.tagName === 'CANVAS') return { kind: 'floor' };
  return { kind: 'none' };
}

/**
 * 开始拖一件物品。调用点在 `pointerdown` 里。
 *
 * @param scale `#mu-ui` 当前的缩放比（ghost 是按屏幕像素画的，得乘上去）
 */
export function startItemDrag(
  ev: PointerEvent,
  item: DragItem,
  handlers: DragHandlers,
  scale: number
): void {
  const startX = ev.clientX;
  const startY = ev.clientY;
  const attr = itemAttr(item.type);
  let active = false;
  let ghost: HTMLImageElement | null = null;
  let hotEl: HTMLElement | null = null;

  const paintGhost = (x: number, y: number) => {
    if (!ghost) return;
    ghost.style.left = `${x - (attr.w * 20 * scale) / 2}px`;
    ghost.style.top = `${y - (attr.h * 20 * scale) / 2}px`;
  };

  const markHot = (target: DropTarget) => {
    const want =
      target.kind === 'panel' || target.kind === 'cell'
        ? (document.querySelector(`[data-drag-panel="${target.panel}"]`) as HTMLElement | null)
        : null;
    if (hotEl && hotEl !== want) hotEl.classList.remove('drop-hot');
    hotEl = want;
    if (hotEl) hotEl.classList.add('drop-hot');
  };

  const onMove = (e: PointerEvent) => {
    if (!active) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < THRESHOLD) return;
      active = true;
      ghost = document.createElement('img');
      ghost.className = 'inv-drag-ghost';
      ghost.draggable = false;
      ghost.style.width = `${attr.w * 20 * scale}px`;
      ghost.style.height = `${attr.h * 20 * scale}px`;
      ghost.style.imageRendering = 'pixelated';
      if (item.iconSrc) ghost.src = item.iconSrc;
      // 没有图标（模型缺失 / 调用方拿不到）时给一个金色占位，别让玩家
      // 拖着一个**透明空盒子**满屏跑（看起来就像「没拖起来」）
      else ghost.classList.add('no-icon');
      document.body.appendChild(ghost);
      document.body.classList.add('item-dragging');
      handlers.onStart?.();
    }
    paintGhost(e.clientX, e.clientY);
    markHot(targetAt(e.clientX, e.clientY));
  };

  const finish = () => {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    if (ghost) ghost.remove();
    if (hotEl) hotEl.classList.remove('drop-hot');
    document.body.classList.remove('item-dragging');
    handlers.onEnd?.();
  };

  const onUp = (e: PointerEvent) => {
    const wasActive = active;
    const target = wasActive ? targetAt(e.clientX ?? 0, e.clientY ?? 0) : null;
    finish();
    if (!wasActive) return; // 单击：交给各面板自己的 click 逻辑（不在这里处理）
    if (target) {
      // 探针用：拖拽落点留一份记录（`__MU_DRAG_LOG__`，只在内存里）
      const log = (window as unknown as { __MU_DRAG_LOG__?: unknown[] }).__MU_DRAG_LOG__;
      if (log) {
        log.push({
          from: item.panel,
          slot: item.slot,
          type: item.type,
          target,
          // 落点的 DOM 描述（排查「明明拖到面板上却判成地面」时看这个）
          at: [Math.round(e.clientX ?? -1), Math.round(e.clientY ?? -1)],
          hit: (document.elementFromPoint(e.clientX ?? 0, e.clientY ?? 0) as HTMLElement | null)?.className ?? '',
        });
        if (log.length > 40) log.shift();
      }
      handlers.onDrop(item, target);
    }
  };

  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
}
