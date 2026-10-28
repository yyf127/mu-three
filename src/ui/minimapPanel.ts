/**
 * 小地图（`Data/Interface/MiniMap.OZT` 边框 + 客户端自己合成的地形底图）。
 *
 * ⚠️ **0.97 客户端没有小地图** —— 反编译源码里搜不到任何 MiniMap 相关代码，
 * 但 `Data/Interface` 里躺着这张 `MiniMap.OZT`（151×173，龙首边框 + 放大镜按钮
 * + 左侧一列空按钮位），是后期版本共用素材留下的。
 *
 * 所以这是一个**体验增强**，不是还原：边框用它，地图内容自己算，
 * 完全不需要服务端（地形 `EncTerrain*.map` / `TerrainHeight.OZB` 就是全部数据源）。
 *
 * 版式：
 *
 *   ┌──────────────── 151×173 ────────────────┐
 *   │  (4,4) 标题            (124,4) 放大镜 ▸ │
 *   │        ┌──── 31,55 ────┐                │
 *   │        │   112×112     │                │
 *   │        │   地图视口     │                │
 *   │        └───────────────┘                │
 *   └─────────────────────────────────────────┘
 *
 * 视口矩形是量 `MiniMap.OZT` 的 alpha=0 区域得到的（x 29..144 / y 54..166，
 * 四角是圆的，往里收 2px 取 112×112）。
 */
import { UI_W, UiLayer } from './frame';
import { uiSprite } from './ozj';

const FRAME_W = 151;
const FRAME_H = 173;
/** 面板整体缩放（用户要求 0.8；用 CSS transform 缩，内部坐标不动） */
const SCALE = 0.8;
/** 距屏幕边 4 逻辑像素 */
const MARGIN = 4;
/**
 * 画布镜像开关。
 *
 * 世界 `+y` 在屏幕上是「上」（相机 forward = `(-cos yaw, -sin yaw)`，默认 yaw = -45°），
 * 而 canvas 的 y 朝下 —— 所以 **Y 必须翻**，否则地图整个转了 180°，
 * 看着就是「小地图的移动方向反了」。
 *
 * X 不用翻：`+x` 在屏幕上本来就是往右（实测 +x → 屏幕 dx = +480），
 * 小地图 `px = x` 也对得上。留着这个开关是万一以后要「镜像地图」的玩法。
 */
const FLIP_X = false;
const FLIP_Y = true;
const VIEW_X = 31;
const VIEW_Y = 55;
const VIEW_W = 112;
const VIEW_H = 112;

/** 缩放档位：视口里横向显示多少格（256 = 整张地图） */
const ZOOMS = [256, 96, 48] as const;

export interface MinimapMark {
  x: number;
  y: number;
  kind: 'party' | 'npc' | 'target';
}

const MARK_COLOR: Record<MinimapMark['kind'], string> = {
  party: '#ffd76a', // 队友：金色（和头顶血条同一套配色）
  npc: '#8fc7ff', // NPC：淡蓝
  target: '#ff6a4a', // 当前目标：红
};

/** 开关状态存这儿（原版没有选项菜单，网页端就记 localStorage） */
const STORE_KEY = 'mu.minimap';

export class MinimapPanel {
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private title: HTMLDivElement;
  private coord: HTMLDivElement;
  private zoomBtn: HTMLDivElement;
  /** 边框左下角那颗「M」：打开移动命令（等价于按 M 键） */
  private moveBtn: HTMLDivElement;
  /** 点「M」时的回调（由 main.ts 接到 `movePanel.show()`） */
  onMove: (() => void) | null = null;

  private base: HTMLCanvasElement | null = null;
  private mapName = '';
  private openState = false;
  private zoom = 1;
  private lastAt = 0;
  private markCount = 0;
  private playerPx = { x: VIEW_W / 2, y: VIEW_H / 2 };

  constructor(parent: UiLayer) {
    this.root = document.createElement('div');
    this.root.className = 'minimap hidden';
    // 右上角（缩放后视觉宽度是 FRAME_W×SCALE，所以要按缩放后的尺寸算右边缘）
    this.root.style.left = `${UI_W - FRAME_W * SCALE - MARGIN}px`;
    this.root.style.top = `${MARGIN}px`;
    this.root.style.width = `${FRAME_W}px`;
    this.root.style.height = `${FRAME_H}px`;
    this.root.style.transform = `scale(${SCALE})`;

    this.title = document.createElement('div');
    this.title.className = 'minimap-title';
    this.root.appendChild(this.title);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap-view';
    this.canvas.width = VIEW_W;
    this.canvas.height = VIEW_H;
    this.canvas.style.left = `${VIEW_X}px`;
    this.canvas.style.top = `${VIEW_Y}px`;
    this.root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.coord = document.createElement('div');
    this.coord.className = 'minimap-coord';
    this.root.appendChild(this.coord);

    // 边框右上角那个圆形放大镜 = 切换缩放（整张 / 96 格 / 48 格）
    this.zoomBtn = document.createElement('div');
    this.zoomBtn.className = 'minimap-zoom';
    this.zoomBtn.style.left = '122px';
    this.zoomBtn.style.top = '4px';
    this.zoomBtn.title = '放大 / 缩小（也可以按 Tab 关掉小地图）';
    this.zoomBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.cycleZoom();
    });
    this.root.appendChild(this.zoomBtn);

    parent.add(this.root);

    /*
     * 左下角那颗「M」= 移动命令面板（0.97 没有，给触屏补的入口）。
     *
     * **挂在 UI 层、不放进小地图框里**：小地图 z-index 只有 3，而背包 / 商店面板是 10，
     * 一旦它们展开就会盖住小地图下半截，按钮跟着点不到（实测 elementFromPoint 命中的是
     * `inv-equip-slot`）。所以这里自己算一个绝对位置贴在边框左下角那块空格上，
     * 层级放到面板之上、读条层之下。
     */
    this.moveBtn = document.createElement('div');
    this.moveBtn.className = 'minimap-move hidden';
    this.moveBtn.textContent = 'M';
    this.moveBtn.title = '移动命令（快捷键 M）';
    const frameLeft = UI_W - FRAME_W * SCALE - MARGIN;
    this.moveBtn.style.left = `${frameLeft + 6 * SCALE}px`;
    this.moveBtn.style.top = `${MARGIN + 150 * SCALE}px`;
    this.moveBtn.style.width = `${22 * SCALE}px`;
    this.moveBtn.style.height = `${18 * SCALE}px`;
    this.moveBtn.style.lineHeight = `${18 * SCALE}px`;
    this.moveBtn.style.fontSize = `${12 * SCALE}px`;
    this.moveBtn.addEventListener('click', e => {
      // 别让点击漏给 3D 画布（否则顺手点走一格）
      e.stopPropagation();
      e.preventDefault();
      this.onMove?.();
    });
    for (const type of ['pointerdown', 'mousedown'] as const) {
      this.moveBtn.addEventListener(type, e => e.stopPropagation());
    }
    parent.add(this.moveBtn);

    void uiSprite('MiniMap.OZT').then(sprite => {
      if (sprite) this.root.style.backgroundImage = `url("${sprite.url}")`;
    });

    // 默认开（这是给玩家用的功能），关掉过就记住
    let saved = '1';
    try {
      saved = localStorage.getItem(STORE_KEY) ?? '1';
    } catch {
      /* 隐私模式读不到，按默认开 */
    }
    this.setVisible(saved !== '0');
  }

  get isOpen() {
    return this.openState;
  }

  setVisible(on: boolean) {
    this.openState = on;
    this.root.classList.toggle('hidden', !on);
    // 「M」按钮跟着小地图一起显隐（它挂在 UI 层，不在 `root` 里）
    this.moveBtn.classList.toggle('hidden', !on);
  }

  toggle() {
    this.setVisible(!this.openState);
    try {
      localStorage.setItem(STORE_KEY, this.openState ? '1' : '0');
    } catch {
      /* 写不进去就只在本次会话生效 */
    }
    return this.openState;
  }

  cycleZoom() {
    this.zoom = (this.zoom + 1) % ZOOMS.length;
    this.lastAt = 0; // 下一帧强制重画
    return ZOOMS[this.zoom];
  }

  /** 换图：底图 + 名字（底图由 `terrain.buildMinimap()` 生成，切图时换掉） */
  setMap(name: string, base: HTMLCanvasElement | null) {
    this.mapName = name;
    this.base = base;
    this.title.textContent = name;
    this.lastAt = 0;
  }

  clear() {
    this.base = null;
    this.mapName = '';
    this.title.textContent = '';
    this.coord.textContent = '';
    this.ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  }

  /**
   * 每帧调用（内部节流 25fps）。
   *
   * `yaw` 用玩家模型的 yaw（`atan2(dy,dx) + MODEL_YAW_OFFSET`），
   * 箭头角度要减掉那个 π/2 偏移才是世界朝向。
   */
  update(x: number, y: number, yaw: number, marks: MinimapMark[], yawOffset: number, force = false) {
    if (!this.openState || !this.base) return;
    const now = performance.now();
    if (!force && now - this.lastAt < 40) return;
    this.lastAt = now;

    const cells = ZOOMS[this.zoom];
    const scale = VIEW_W / cells;
    /*
     * 整张图那一档**不跟随玩家**：`sx/sy` 固定成 0..256，
     * 否则玩家站在地图东侧时右半边会全是黑边（源矩形越界）。
     */
    const whole = cells >= 256;
    const sx = whole ? 0 : x - cells / 2;
    const sy = whole ? 0 : y - cells / 2;
    const ctx = this.ctx;

    // 视口外（地图边界之外）先铺暗底，再贴地图
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    /*
     * **纵向翻转**：世界 `+y` 在屏幕上是「上」（相机朝 +y 看，见
     * `camera.ts` 的 forward = `(-cos yaw, -sin yaw)`，默认 yaw = -45°），
     * 而 canvas 的 y 朝下。不翻的话地图整个转了 180°，人往右上方走、点却往
     * 右下方走 —— 就是「小地图左右反了」的观感。
     *
     * 做法是把整块画布翻过来再按**世界坐标**画：地图、标记、箭头都在同一套
     * 坐标里，不会出现「图翻了但点没翻」的错位。
     */
    ctx.save();
    ctx.translate(FLIP_X ? VIEW_W : 0, FLIP_Y ? VIEW_H : 0);
    ctx.scale(FLIP_X ? -1 : 1, FLIP_Y ? -1 : 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, sx, sy, cells, cells, 0, 0, VIEW_W, VIEW_H);

    // 标记（超出视口的直接跳过，drawImage 已经裁过地图，标记要自己判）
    this.markCount = 0;
    for (const m of marks) {
      const px = (m.x - sx) * scale;
      const py = (m.y - sy) * scale;
      if (px < -4 || py < -4 || px > VIEW_W + 4 || py > VIEW_H + 4) continue;
      ctx.fillStyle = MARK_COLOR[m.kind];
      if (m.kind === 'party') {
        ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 3, 3);
      } else {
        ctx.fillRect(Math.round(px), Math.round(py), 2, 2);
      }
      this.markCount++;
    }

    /*
     * 自己：一枚箭头，指向朝向。
     *
     * 画在翻转后的坐标系里，所以还是用 `yaw - yawOffset`（世界朝向角）；
     * 翻转会同时把箭头的 y 分量镜像过来，正好和地图一致。
     */
    const cx = Math.round((x - sx) * scale);
    const cy = Math.round((y - sy) * scale);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(yaw - yawOffset);
    ctx.beginPath();
    ctx.moveTo(5.5, 0);
    ctx.lineTo(-4, 4);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-4, -4);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    // 探针要看的是**最终画布坐标**（翻转后的），所以要再换回来
    this.playerPx = { x: FLIP_X ? VIEW_W - cx : cx, y: FLIP_Y ? VIEW_H - cy : cy };
    this.coord.textContent = `${Math.round(x)},${Math.round(y)}`;
  }

  /** 探针用快照（顺带给出视口矩形，方便核对版式） */
  snapshot() {
    return {
      open: this.openState,
      zoom: this.zoom,
      cells: ZOOMS[this.zoom],
      map: this.mapName,
      base: this.base ? [this.base.width, this.base.height] : null,
      canvas: [this.canvas.width, this.canvas.height],
      view: [VIEW_X, VIEW_Y, VIEW_W, VIEW_H],
      frame: [FRAME_W, FRAME_H],
      /** 面板 CSS 缩放（0.8） */
      scale: SCALE,
      /** 画面镜像开关（见文件头的 FLIP_X / FLIP_Y） */
      flipX: FLIP_X,
      flipY: FLIP_Y,
      left: parseFloat(this.root.style.left || '0'),
      top: parseFloat(this.root.style.top || '0'),
      player: this.playerPx,
      marks: this.markCount,
      coord: this.coord.textContent,
      hasFrame: !!this.root.style.backgroundImage,
    };
  }
}
