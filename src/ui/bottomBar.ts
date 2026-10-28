/**
 * 底栏 —— 照抄 0.97 客户端的 `RenderMainFrameWindow`（IDA 0x004BD2B0）。
 *
 * 来源 `Render/HUD_Pass1.cpp:340`（`Render_BottomHUD` 只是它的别名）。
 * 整条底栏正好铺满 640 宽，贴在逻辑坐标系底部：
 *
 *   0xE9 Menu04.ozt       (  0, 387) 108×45      左下角饰（原版 UV 只取 0.84×0.70）
 *   0xE9 Menu04.ozt       (532, 387) 108×45      右下角饰，水平镜像
 *   0xE6 Menu01_new.ozj   (  0, 432) 256×48      左段：名字凹槽 + 药水计数位
 *   231  Menu02.ozj       (256, 432) 128×48      中段：经验条 + 快捷栏圆孔
 *   232  Menu03_new.ozj   (384, 432) 256×48      右段：技能槽 + 三个功能按钮
 *
 * 三段 256+128+256 = 640，正好一屏宽；4:3 舞台上不会有缝。
 *
 * 这一层只负责「底图 + 三个功能按钮」。压在底图上的数值 —— HP/MP 球
 * （97/489, 432）、经验条（221, 439）、AG 条、角色名、坐标 —— 在
 * `src/ui/hudValues.ts`，坐标同样来自客户端源码，单独一层方便刷新。
 *
 * 按钮命中框来自 `Game/Player_InputTick.cpp:280-330`，全是 640×480 绝对值：
 *
 *   队伍   (348, 452) 24×24   图标 `Menu_Party`     (0xEC)
 *   角色   (379, 452) 24×24   图标 `Menu_Character` (0xED)
 *   背包   (410, 452) 24×24   图标 `Menu_Inventory` (0xEE)
 *   战盟   (582, 459) 52×18   图标 `Guild`          (0xFA)
 *
 * **四个图标都是「面板打开时才画」**（`HUD_Pass5.cpp:308-338`）：
 *
 *     if (PartyOpened)     GL_DrawTexture(236, 348, 452, 24, 24, …);
 *     if (CharacterOpened) GL_DrawTexture(237, 379, 452, 24, 24, …);
 *     if (InventoryOpened) GL_DrawTexture(238, 410, 452, 24, 24, …);
 *     if (GuildOpened)     GL_DrawTexture(250, 582, 459, 52, 18, …);
 *
 * 未打开时底栏上只有 `Menu0x_new` 的凹槽底纹，没有图标 —— 之前本 port
 * 把四个图标常驻，看起来就像「多了一排按钮」，和 Win 端不一样。
 * 现在按钮本体（命中框）常驻但透明，图标只在 `setActive()` 时出现。
 */
import { uiSprite, preloadUi } from './ozj';
import { UiLayer, spriteBox } from './frame';

/** 底栏三段贴图：x / 宽 固定，y 一律 432，高 48 */
const TILES: { key: string; x: number; w: number }[] = [
  { key: 'Menu01_new', x: 0, w: 256 },
  { key: 'Menu02', x: 256, w: 128 },
  { key: 'Menu03_new', x: 384, w: 256 },
];
const TILE_Y = 432;
const TILE_H = 48;

/** 两个角饰 */
const CORNERS: { x: number; flip: boolean }[] = [
  { x: 0, flip: false },
  { x: 532, flip: true },
];
const CORNER_Y = 387;
const CORNER_W = 108;
const CORNER_H = 45;

/** 三个 24×24 图标按钮（原版 Player_InputTick 的命中框） */
interface BottomButton {
  key: string;
  x: number;
  y: number;
  label: string;
  id: string;
  /** 图标尺寸，默认 24×24（战盟是 52×18） */
  w?: number;
  h?: number;
}

const BUTTONS: BottomButton[] = [
  { key: 'Menu_Party', x: 348, y: 452, label: '队伍 (P)', id: 'party' },
  { key: 'Menu_Character', x: 379, y: 452, label: '角色 (C)', id: 'character' },
  { key: 'Menu_Inventory', x: 410, y: 452, label: '背包 (I)', id: 'inventory' },
  // 战盟是 52×18 的长条图标（`Interface/Guild.jpg`），不是 24×24
  { key: 'Guild', x: 582, y: 459, label: '战盟 (G)', id: 'guild', w: 52, h: 18 },
];

const SPRITES = [...TILES.map(t => t.key), 'Menu04', ...BUTTONS.map(b => b.key)];

export class BottomBar {
  private el: HTMLDivElement;
  private ready: Promise<void>;
  private open = false;
  private buttons = new Map<string, HTMLElement>();

  /** 点按钮的回调；`id` 是 'party' / 'character' / 'inventory' */
  onButton: ((id: string) => void) | null = null;

  constructor(private layer: UiLayer) {
    this.el = document.createElement('div');
    this.el.className = 'bottom-bar hidden';
    layer.add(this.el);
    this.ready = this.build();
  }

  private async build() {
    await preloadUi(SPRITES);

    // 角饰先画（原版也是先 0xE9 再铺三段）
    const corner = await uiSprite('Menu04');
    if (corner) {
      for (const c of CORNERS) {
        const img = spriteBox({
          url: corner.url,
          x: c.x,
          y: CORNER_Y,
          w: CORNER_W,
          h: CORNER_H,
          className: 'bar-corner',
        });
        // 右侧是同一张图水平镜像（原版 u 从 0.84 走到 -0.84）
        if (c.flip) img.style.transform = 'scaleX(-1)';
        this.el.appendChild(img);
      }
    }

    for (const t of TILES) {
      const spr = await uiSprite(t.key);
      if (!spr) console.warn(`[bar] 底图 ${t.key} 载入失败`);
      if (spr) {
        this.el.appendChild(
          spriteBox({ url: spr.url, x: t.x, y: TILE_Y, w: t.w, h: TILE_H, className: 'bar-tile' })
        );
      }
    }

    /*
     * 四个按钮都是「透明命中框 + 图标只在打开时显示」：
     * 命中框常驻（原版 `Player_InputTick` 的 rect 一直有效），
     * 但图标 `opacity: 0`，由 `setActive()` 点亮。
     */
    for (const b of BUTTONS) {
      const w = b.w ?? 24;
      const h = b.h ?? 24;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bar-btn';
      btn.dataset.btn = b.id;
      btn.title = b.label;
      btn.style.left = `${b.x}px`;
      btn.style.top = `${b.y}px`;
      btn.style.width = `${w}px`;
      btn.style.height = `${h}px`;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this.onButton?.(b.id);
      });

      const spr = await uiSprite(b.key);
      if (!spr) console.warn(`[bar] 图标 ${b.key} 载入失败`);
      if (spr) {
        const img = document.createElement('img');
        img.src = spr.url;
        img.draggable = false;
        img.style.imageRendering = 'pixelated';
        img.style.width = '100%';
        img.style.height = '100%';
        btn.appendChild(img);
      }

      this.el.appendChild(btn);
      this.buttons.set(b.id, btn);
    }
  }

  /**
   * 点亮某个按钮 —— 等价于原版的 `if (PartyOpened) GL_DrawTexture(...)`。
   *
   * 同一时刻只可能有一个面板开着（原版打开一个会 `XxxOpened = 0` 掉别的），
   * 所以直接单值，不做集合。
   */
  setActive(id: string | null) {
    for (const [key, el] of this.buttons) {
      el.classList.toggle('active', key === id);
    }
  }

  show() {
    this.open = true;
    this.el.classList.remove('hidden');
  }

  hide() {
    this.open = false;
    this.el.classList.add('hidden');
  }

  get isOpen() {
    return this.open;
  }
}
