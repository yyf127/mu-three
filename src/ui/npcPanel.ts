/**
 * 商店 / 仓库面板 —— 版式逐像素照抄 Win 端 0.97 客户端。
 *
 * 权威实现（客户端源码，两函数结构几乎一样）：
 *
 *   RenderWarehouse        HUD_Pass6.cpp:1654  （0x004F3170，2776 字节）
 *   RenderShopInterface    HUD_Pass6.cpp:1426  （0x004F1F50）
 *   RenderInventoryInterface HUD_Pass6.cpp:216 （底板，两个面板共用）
 *   RenderItemsBoxes       HUD_Pass6.cpp:232  （格子网格，8 列）
 *
 * 版面（全部来自源码，**面板原点固定 (260, 0)**，不是自己摆的）：
 *
 *   dword_7EAA0C8 = 260, dword_7EAA0CC = 0
 *
 *   底板   Item_Back01 (260) @ (260,   0) 190×256
 *          Item_Back02 (261) @ (260, 256) 190×177      总高 433
 *   标题   RenderText(dword+35, dword+12) = (295, 12)   GlobalText[234]+" (Open|Close)"
 *   网格   RenderItemsBoxes(dword+15, dword+50, …, 8, 15) = (275, 50)，8×15，格 20px
 *   金币   Item_Money (271) @ (310, 352.7) 113×18
 *          标签 GlobalText[224] @ (310-30, 355) = (280, 355)
 *          金额 @ (310+10, 355) = (320, 355)
 *   税费   GlobalText[266] @ (310, 374)，金额 @ (380, 374)
 *   按钮   { 26, 76, 126 } + 260 = {286, 336, 386} @ y=390，24×24
 *            0 存入 Zen  Money_01/02
 *            1 取出 Zen  Money_01/02
 *            2 仓库锁    Lock_01/02（开） Lock_03/04（关）
 *
 * 商店（RenderShopInterface）没有 Zen 条和税，底部是一排 24×24 按钮（y=365）：
 * 买(282/283)、卖(284/285)、修一件(286/287)、修全部(286 蓝色)。
 * 本 port 的买卖已经改成「点货架格买 / 点背包物品卖」，所以这里只保留
 * 「修理全部」一个按钮（0x34 type=1）。
 *
 * 文案用中文（和本 port 其它窗口一致），但位置、字号、颜色、贴图全部照原版；
 * 原版对应的 GlobalText 索引写在旁边，要切英文直接换 `TEXT` 表即可。
 */
import { UiLayer } from './frame';
import { textSync } from '../data/localText';
import { uiSprite, preloadUi } from './ozj';
import { itemIcon } from './itemIcon';
import { itemAttr } from '../data/itemAttrs';
import type { InventoryItem } from '../net/game';
import { startItemDrag } from './itemDrag';
import { itemTipHtml, placeTipBeside } from './itemTip';
import { hoverSpin, stopHoverSpin } from './itemSpin';

export type ContainerMode = 'shop' | 'warehouse';

/** 面板原点与尺寸（`dword_7EAA0C8 / 0CC`） */
const PANEL = { x: 260, y: 0, w: 190, h: 433 };
const COLS = 8;
const ROWS = 15;
const CELL = 20;
/** `RenderItemsBoxes(dword + 15, dword + 50, …)` */
const GRID = { x: 15, y: 50 };
/** `RenderText(dword + 35, dword + 12, Title, …)` */
const TITLE = { x: 35, y: 11 };
/** `GL_DrawTexture(271, dword+50, dword+352.7, 113, 18, …)` */
const ZEN_BAR = { x: 50, y: 352.7, w: 113, h: 18 };
/** 金币行文字基线：标签 280、金额 320（相对面板 = 20 / 60） */
const ZEN_TEXT = { y: 355, labelX: 20, valueX: 60 };
/** 税费行：标签 310、金额 380（相对面板 = 50 / 120） */
const TAX_TEXT = { y: 374, labelX: 50, valueX: 120 };
/** 仓库底部 3 个按钮 */
const BTN = { y: 390, xs: [26, 76, 126], size: 24 };
/** 关闭按钮：与背包窗口同一位置（面板右上角） */
const CLOSE = { x: 161, y: 4, size: 24 };

const SPRITES = [
  'Item_Back01',
  'Item_Back02',
  'Item_box',
  'InventoryBox2',
  'Item_Money',
  'Money_01',
  'Money_02',
  'Lock_01',
  'Lock_02',
  'Lock_03',
  'Lock_04',
  'exit_01',
  'exit_02',
];

/**
 * 面板文案 —— 全部走 `Text.bmd`（`GlobalText`）。
 *
 * 以前这里是一组写死的中文，和原版对不上的地方不少（尤其仓库标题：
 * 原版是 `wsprintfA("%s (%s)", GlobalText[234], GlobalText[240 + lock])`
 * —— 也就是「仓 库 (开启状态)」，不是我们编的「仓库 (开启)」）。
 *
 * 用 getter 而不是常量：`Text.bmd` 是懒加载的，模块加载那一刻 `textSync`
 * 只能返回 fallback，等面板真正显示时表早就读完了 —— 那时再取才是原文。
 * `refreshText()` 在每次 `show()` 里跑一遍，把这些值重新写进 DOM。
 */
const TEXT = {
  /** `GlobalText[230]`「商  人」 */
  get shop() {
    return textSync(230, '商  人');
  },
  /** `"%s (%s)" % (GlobalText[234], GlobalText[240])` =「仓 库 (开启状态)」 */
  get warehouseOpen() {
    return `${textSync(234, '仓 库')} (${textSync(240, '开启状态')})`;
  },
  /** `"%s (%s)" % (GlobalText[234], GlobalText[241])` =「仓 库 (锁定状态)」 */
  get warehouseLocked() {
    return `${textSync(234, '仓 库')} (${textSync(241, '锁定状态')})`;
  },
  /** `GlobalText[224]`「金」（原版金币条前面那个字） */
  get zen() {
    return textSync(224, '金');
  },
  /** `GlobalText[266]`「仓库使用费」 */
  get tax() {
    return textSync(266, '仓库使用费');
  },
  /** `GlobalText[235]`「存款」 */
  get deposit() {
    return textSync(235, '存款');
  },
  /** `GlobalText[236]`「提款」 */
  get withdraw() {
    return textSync(236, '提款');
  },
  /** `GlobalText[242]`「仓库 锁定/开启」 */
  get lock() {
    return textSync(242, '仓库 锁定/开启');
  },
  /** `GlobalText[237]`「全体修理(A)」 */
  get repairAll() {
    return textSync(237, '全体修理(A)');
  },
};

export interface WarehouseInfo {
  /** 仓库里存的钱（0x81 下发的 warehouseMoney） */
  money: number;
  /** 取出手续费（`CItemManager::...` / 客户端 RenderWarehouse 里的同一条公式） */
  tax: number;
  /** 是否上了密码锁 —— 标题会变色，锁按钮换贴图 */
  locked: boolean;
}

export class NpcPanel {
  private el: HTMLDivElement;
  private gridEl: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private closeBtn: HTMLImageElement | null = null;
  private toastEl: HTMLDivElement;

  /** 仓库专属：金币条 + 税费 + 3 个按钮 */
  private whEl: HTMLDivElement;
  private zenBar: HTMLImageElement | null = null;
  private zenLabel: HTMLDivElement;
  private zenValue: HTMLDivElement;
  private taxLabel: HTMLDivElement;
  private taxValue: HTMLDivElement;
  private whBtns: HTMLButtonElement[] = [];

  /** 物品悬停提示（和背包共用 `itemTip.ts` 的 `GlobalText` 模板） */
  private tipEl: HTMLDivElement;
  /** 槽位 → 图标元素（悬停旋转要用它换 src） */
  private iconBySlot = new Map<number, HTMLImageElement>();

  /** 商店专属：修理全部 */
  private shopEl: HTMLDivElement;
  /** 修理按钮（`show()` 时重刷文案用） */
  private repairBtn: HTMLButtonElement | null = null;

  private mode: ContainerMode = 'shop';
  private items: InventoryItem[] = [];
  private iconEls: HTMLImageElement[] = [];
  private open = false;
  private toastTimer = 0;
  private ready: Promise<void>;

  onBuy: ((slot: number) => void) | null = null;
  onTakeOut: ((slot: number) => void) | null = null;
  /**
   * 把货架 / 仓库格子里的东西**拖到背包面板**上。
   *
   * 原版就是这样：商店 `RenderShopInterface` 里按住货 → 拖进背包窗口松手 = 买；
   * 仓库 `RenderWarehouse` 里按住格 → 拖进背包 = 取回。点一下格子不再算数
   * （以前是单击买/取，容易手滑）。
   */
  onDropToInventory: ((slot: number) => void) | null = null;
  onClose: (() => void) | null = null;
  onRepairAll: (() => void) | null = null;
  onDepositAll: (() => void) | null = null;
  onWithdrawAll: (() => void) | null = null;
  /** 仓库锁：本 port 还没做密码输入界面，先给出提示 */
  onToggleLock: (() => void) | null = null;

  constructor(private layer: UiLayer) {
    this.el = document.createElement('div');
    this.el.className = 'npc-panel hidden';
    this.el.style.left = `${PANEL.x}px`;
    this.el.style.top = `${PANEL.y}px`;
    this.el.style.width = `${PANEL.w}px`;
    this.el.style.height = `${PANEL.h}px`;
    layer.add(this.el);
    this.el.addEventListener('contextmenu', e => e.preventDefault());

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'npc-title';
    this.titleEl.style.left = `${TITLE.x}px`;
    this.titleEl.style.top = `${TITLE.y}px`;
    this.el.appendChild(this.titleEl);

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'npc-grid';
    this.gridEl.style.left = `${GRID.x}px`;
    this.gridEl.style.top = `${GRID.y}px`;
    this.gridEl.style.width = `${COLS * CELL}px`;
    this.gridEl.style.height = `${ROWS * CELL}px`;
    this.el.appendChild(this.gridEl);

    /* ---- 仓库区 ---- */
    this.whEl = document.createElement('div');
    this.whEl.className = 'npc-wh hidden';
    this.el.appendChild(this.whEl);

    this.zenLabel = document.createElement('div');
    this.zenLabel.className = 'npc-text npc-zen-label';
    this.zenLabel.style.left = `${ZEN_TEXT.labelX}px`;
    this.zenLabel.style.top = `${ZEN_TEXT.y - 1}px`;
    this.zenLabel.textContent = TEXT.zen;
    this.whEl.appendChild(this.zenLabel);

    this.zenValue = document.createElement('div');
    this.zenValue.className = 'npc-text npc-zen-value';
    this.zenValue.style.left = `${ZEN_TEXT.valueX}px`;
    this.zenValue.style.top = `${ZEN_TEXT.y - 1}px`;
    this.zenValue.textContent = '0';
    this.whEl.appendChild(this.zenValue);

    this.taxLabel = document.createElement('div');
    this.taxLabel.className = 'npc-text npc-tax-label';
    this.taxLabel.style.left = `${TAX_TEXT.labelX}px`;
    this.taxLabel.style.top = `${TAX_TEXT.y - 1}px`;
    this.taxLabel.textContent = TEXT.tax;
    this.whEl.appendChild(this.taxLabel);

    this.taxValue = document.createElement('div');
    this.taxValue.className = 'npc-text npc-tax-value';
    this.taxValue.style.left = `${TAX_TEXT.valueX}px`;
    this.taxValue.style.top = `${TAX_TEXT.y - 1}px`;
    this.taxValue.textContent = '0';
    this.whEl.appendChild(this.taxValue);

    /* ---- 商店区 ---- */
    this.shopEl = document.createElement('div');
    this.shopEl.className = 'npc-shop hidden';
    this.el.appendChild(this.shopEl);

    /* ---- 悬停提示 ---- */
    this.tipEl = document.createElement('div');
    this.tipEl.className = 'ui-tip hidden';
    this.el.appendChild(this.tipEl);

    /* ---- 反馈 ---- */
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'npc-toast hidden';
    this.el.appendChild(this.toastEl);

    this.buildGrid();

    // 贴图版式是异步的（走网络），但开关状态同步生效
    this.ready = this.build();
  }

  /* ---------------------------------------------------------------- */
  /* 骨架                                                              */
  /* ---------------------------------------------------------------- */
  private async build() {
    await preloadUi(SPRITES);

    const [back1, back2, box, box2, money, m1, m2, l1, l2, l3, l4, ex1, ex2] = await Promise.all([
      uiSprite('Item_Back01'),
      uiSprite('Item_Back02'),
      uiSprite('Item_box'),
      uiSprite('InventoryBox2'),
      uiSprite('Item_Money'),
      uiSprite('Money_01'),
      uiSprite('Money_02'),
      uiSprite('Lock_01'),
      uiSprite('Lock_02'),
      uiSprite('Lock_03'),
      uiSprite('Lock_04'),
      uiSprite('exit_01'),
      uiSprite('exit_02'),
    ]);

    // 底板：Item_Back01 190×256 + Item_Back02 190×177（RenderInventoryInterface）
    if (back1) this.el.appendChild(makePlate(back1.url, 0, 0, 190, 256));
    if (back2) this.el.appendChild(makePlate(back2.url, 0, 256, 190, 177));

    // 格子底色（RenderItemsBoxes：277 空 / 278 占用，都是 20×20）
    this.emptyUrl = box?.url ?? null;
    this.filledUrl = box2?.url ?? null;
    for (const cell of this.cellEls) {
      const img = cell.querySelector('.npc-cell-bg') as HTMLImageElement | null;
      if (img && this.emptyUrl) img.src = this.emptyUrl;
    }

    // 金币条（Item_Money @ 50, 352.7 113×18）
    if (money) {
      const bar = makePlate(money.url, ZEN_BAR.x, ZEN_BAR.y, ZEN_BAR.w, ZEN_BAR.h);
      bar.className = 'npc-sprite npc-zen-bar';
      this.whEl.appendChild(bar);
      this.zenBar = bar;
    }

    // 仓库 3 个按钮
    const mkBtn = (
      x: number,
      normal: string | null,
      pressed: string | null,
      tip: string,
      fn: () => void
    ) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'npc-btn';
      b.style.left = `${x}px`;
      b.style.top = `${BTN.y}px`;
      b.style.width = `${BTN.size}px`;
      b.style.height = `${BTN.size}px`;
      b.title = tip;
      const img = document.createElement('img');
      img.draggable = false;
      img.style.imageRendering = 'pixelated';
      if (normal) img.src = normal;
      if (normal && pressed) {
        b.addEventListener('mouseenter', () => (img.src = pressed));
        b.addEventListener('mouseleave', () => (img.src = normal));
      }
      b.addEventListener('click', e => {
        e.stopPropagation();
        fn();
      });
      b.appendChild(img);
      this.whEl.appendChild(b);
      return b;
    };

    this.whBtns = [
      mkBtn(BTN.xs[0], m1?.url ?? null, m2?.url ?? null, TEXT.deposit, () => this.onDepositAll?.()),
      mkBtn(BTN.xs[1], m1?.url ?? null, m2?.url ?? null, TEXT.withdraw, () => this.onWithdrawAll?.()),
      mkBtn(BTN.xs[2], l1?.url ?? null, l2?.url ?? null, TEXT.lock, () => this.onToggleLock?.()),
    ];
    // 锁定时换成 Lock_03/04
    this.lockIcons = {
      open: [l1?.url ?? null, l2?.url ?? null],
      closed: [l3?.url ?? null, l4?.url ?? null],
    };

    // 商店：修理全部（原版 y=365 那一排里的最后一个）
    const repair = document.createElement('button');
    repair.type = 'button';
    repair.className = 'npc-btn npc-btn-wide';
    repair.style.left = '25px';
    repair.style.top = '365px';
    repair.textContent = TEXT.repairAll;
    repair.title = TEXT.repairAll;
    this.repairBtn = repair;
    repair.addEventListener('click', e => {
      e.stopPropagation();
      this.onRepairAll?.();
    });
    this.shopEl.appendChild(repair);

    // 关闭按钮（原版底栏图标也能关，H5 里给鼠标用户一个显式出口）
    if (ex1) {
      const close = document.createElement('img') as HTMLImageElement;
      close.src = ex1.url;
      close.className = 'npc-close';
      close.draggable = false;
      close.title = '关闭 (Esc)';
      close.style.left = `${CLOSE.x}px`;
      close.style.top = `${CLOSE.y}px`;
      close.style.width = `${CLOSE.size}px`;
      close.style.height = `${CLOSE.size}px`;
      close.style.imageRendering = 'pixelated';
      if (ex2) {
        close.addEventListener('mouseenter', () => (close.src = ex2!.url));
        close.addEventListener('mouseleave', () => (close.src = ex1.url));
      }
      close.addEventListener('click', e => {
        e.stopPropagation();
        this.onClose?.();
      });
      this.el.appendChild(close);
      this.closeBtn = close;
    }

    this.applyMode();
  }

  private emptyUrl: string | null = null;
  private filledUrl: string | null = null;
  private lockIcons: { open: (string | null)[]; closed: (string | null)[] } = {
    open: [null, null],
    closed: [null, null],
  };
  private cellEls: HTMLDivElement[] = [];

  private buildGrid() {
    for (let i = 0; i < COLS * ROWS; i++) {
      const cell = document.createElement('div');
      cell.className = 'npc-cell';
      cell.dataset.cell = String(i);
      cell.style.left = `${(i % COLS) * CELL}px`;
      cell.style.top = `${Math.floor(i / COLS) * CELL}px`;
      cell.style.width = `${CELL}px`;
      cell.style.height = `${CELL}px`;
      // 跨面板拖拽的落点判定读这个（`ui/itemDrag.ts`），容器格号 == 服务端槽位
      cell.dataset.slot = String(i);

      const bg = document.createElement('img');
      bg.className = 'npc-cell-bg';
      bg.draggable = false;
      bg.style.imageRendering = 'pixelated';
      cell.appendChild(bg);

      cell.addEventListener('click', () => this.onCellClick(i));
      cell.addEventListener('pointerdown', e => this.onCellPointerDown(e, i));
      cell.addEventListener('pointerenter', () => this.onCellHover(i));
      cell.addEventListener('pointerleave', () => this.onCellLeave());
      this.gridEl.appendChild(cell);
      this.cellEls.push(cell);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 交互                                                              */
  /* ---------------------------------------------------------------- */
  /**
   * 悬停：出 tooltip + 让图标转起来。
   *
   * - tooltip 内容走 `itemTip.ts`（`GlobalText` 的原版模板）。商店里额外带
   *   买卖价格行 —— 原版那句价格是包在 `if (ShopOpened != 0)` 里的，
   *   仓库/背包都不显示。
   * - 旋转是原版 `RenderObjectScreen` 的 `Select == 1` 分支
   *   （`angle[1] = WorldTime * 0.45`），和背包同一套 `itemSpin.ts`。
   */
  private onCellHover(cellIndex: number) {
    if (!this.open) return;
    const item = this.itemAtCell(cellIndex);
    if (!item) {
      this.onCellLeave();
      return;
    }
    this.tipEl.innerHTML = itemTipHtml(item, this.mode === 'shop');
    this.tipEl.classList.remove('hidden');
    /*
     * 摆到物品**左边**（这里左边就是游戏画面，空间足够），放不下才换右边 / 上方。
     * 以前钉在格子正上方，1×3 的武器一悬停就被自己的词条盖住。
     */
    const attr = itemAttr(item.type);
    const col = item.slot % COLS;
    const row = Math.floor(item.slot / COLS);
    const pos = placeTipBeside(
      { w: this.tipEl.offsetWidth, h: this.tipEl.offsetHeight },
      { x: GRID.x + col * CELL, y: GRID.y + row * CELL, w: attr.w * CELL, h: attr.h * CELL },
      { w: PANEL.w, h: PANEL.h },
      PANEL.x
    );
    this.tipEl.style.left = `${pos.left}px`;
    this.tipEl.style.top = `${pos.top}px`;

    hoverSpin(this.iconBySlot.get(item.slot), item.type, item.level);
  }

  private onCellLeave() {
    this.tipEl.classList.add('hidden');
    stopHoverSpin();
  }

  /**
   * 格子点击：**不再**直接买/取，只给一句提示。
   *
   * 原版这两件事都是拖拽（按住货拖进背包 / 按住仓库格拖进背包），
   * 单击在源码里没有对应动作 —— 以前我们图省事做成单击，结果误触率很高
   * （点歪一下就买下来 / 取出来）。
   */
  private onCellClick(cellIndex: number) {
    if (!this.open) return;
    const item = this.itemAtCell(cellIndex);
    if (!item) return;
    this.toast(
      this.mode === 'shop' ? '拖到背包面板购买（按住左键拖过去）' : '拖到背包面板取回（按住左键拖过去）',
      ''
    );
  }

  /** 按住格子里的物品开始拖（松手落在背包面板上才算买/取） */
  private onCellPointerDown(e: PointerEvent, cellIndex: number) {
    if (!this.open || e.button !== 0) return;
    /*
     * `itemAtCell` 按「物品矩形覆盖」找 —— 多格物品压在哪个格子上按下都能拖，
     * 不是只有它左上角那一格。拖拽 ghost 的图也要按**物品自己的槽位**取
     * （`iconBySlot`），否则从覆盖格按下时查不到图标，ghost 是个透明的空盒子
     * —— 看起来就像「这件东西拖不动」。
     */
    const item = this.itemAtCell(cellIndex);
    if (!item) return;
    e.preventDefault();

    const iconEl = this.iconBySlot.get(item.slot) ?? null;
    startItemDrag(
      e,
      {
        panel: this.mode === 'shop' ? 'shop' : 'warehouse',
        slot: item.slot,
        type: item.type,
        iconSrc: iconEl?.src || null,
      },
      {
        onStart: () => this.el.classList.add('dragging'),
        onEnd: () => this.el.classList.remove('dragging'),
        onDrop: (_dragItem, target) => {
          if (target.kind === 'panel' || target.kind === 'cell') {
            if (target.panel === 'inventory') this.onDropToInventory?.(item.slot);
            return;
          }
          if (target.kind === 'floor') {
            this.toast(this.mode === 'shop' ? '商店的物品不能丢在地上' : '仓库的物品不能直接丢在地上', 'error');
          }
        },
      },
      // 面板挂在 `#mu-ui` 上，拖拽 ghost 按屏幕像素画，所以乘这一层的缩放比
      this.layer.scaleFactor
    );
  }

  private itemAtCell(cellIndex: number): InventoryItem | null {
    const col = cellIndex % COLS;
    const row = Math.floor(cellIndex / COLS);
    for (const it of this.items) {
      const attr = itemAttr(it.type);
      const c0 = it.slot % COLS;
      const r0 = Math.floor(it.slot / COLS);
      if (col >= c0 && col < c0 + attr.w && row >= r0 && row < r0 + attr.h) return it;
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* 对外                                                              */
  /* ---------------------------------------------------------------- */
  get isOpen() {
    return this.open;
  }

  get currentMode() {
    return this.mode;
  }

  /** 按容器格号取物品（发 0x24 时要拿它的 ItemInfo 做服务端校验） */
  itemAt(slot: number): InventoryItem | null {
    return this.items.find(i => i.slot === slot) ?? null;
  }

  /** 调试快照（探针断言用） */
  snapshot() {
    const rect = (el: HTMLElement | null) =>
      el
        ? (() => {
            const r = el.getBoundingClientRect();
            return { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
          })()
        : null;
    return {
      open: this.open,
      mode: this.mode,
      title: this.titleEl.textContent ?? '',
      zen: this.zenValue.textContent ?? '',
      tax: this.taxValue.textContent ?? '',
      /** 金币条贴图（原版 `GL_DrawTexture(271, x+50, y+352.7, 113, 18)`） */
      zenBar: this.zenBar
        ? { nat: `${this.zenBar.naturalWidth}x${this.zenBar.naturalHeight}`, box: rect(this.zenBar) }
        : null,
      /** 仓库三个图标按钮：必须仍有 `<img>` 子节点 */
      buttons: this.whBtns.map(b => {
        const img = b.querySelector('img');
        return {
          tip: b.title,
          kids: b.children.length,
          icon: img ? `${img.naturalWidth}x${img.naturalHeight}` : null,
          box: rect(b),
        };
      }),
      /** 悬停提示当前内容（没显示就是 null） */
      tip: this.tipEl.classList.contains('hidden') ? null : (this.tipEl.innerText.split('\n').filter(Boolean) as string[]),
      items: this.items.map(i => ({
        slot: i.slot,
        type: i.type,
        name: itemAttr(i.type).name,
        level: i.level,
        durability: i.durability,
      })),
    };
  }

  show(mode: ContainerMode) {
    this.mode = mode;
    this.open = true;
    this.el.classList.remove('hidden');
    void this.ready.then(() => {
      this.refreshText();
      this.applyMode();
    });
  }

  /**
   * 把 `Text.bmd` 的文案重新写进 DOM。
   *
   * 构造那一刻 `Text.bmd` 还没读完（`textSync` 返回 fallback），所以不能只在
   * 构造时设一次 —— 每次打开面板都是「表早就就位」的状态，那时刷才对。
   */
  private refreshText() {
    this.zenLabel.textContent = TEXT.zen;
    this.taxLabel.textContent = TEXT.tax;
    /*
     * 三个按钮是**图标按钮**（原版就是 24×24 的贴图，没有文字）。
     * 以前这里写 `b.textContent = t` 会把里面的 `<img>` 整个顶掉 ——
     * 结果按钮变成 24×24 的空盒子里塞三个汉字（溢出到格子上），
     * 用户看到的「仓库下面按钮坏了」就是这个。
     * 文案只放在 `title`（浏览器提示）里，DOM 结构一概不动。
     */
    const labels = [TEXT.deposit, TEXT.withdraw, TEXT.lock];
    this.whBtns.forEach((b, i) => {
      const t = labels[i];
      if (t) b.title = t;
    });
    // 修理按钮是**文字按钮**（原版 `GlobalText[237]`），这里两样都写
    if (this.repairBtn) {
      this.repairBtn.textContent = TEXT.repairAll;
      this.repairBtn.title = TEXT.repairAll;
    }
  }

  hide() {
    this.open = false;
    this.el.classList.add('hidden');
    this.onCellLeave();
    this.items = [];
    this.clearIcons();
  }

  /** 模式切换：标题、显示哪块附属 UI */
  private applyMode() {
    if (!this.open) return;
    const warehouse = this.mode === 'warehouse';
    // 拖拽落点判定用：这个面板现在是仓库还是商店
    this.el.dataset.dragPanel = warehouse ? 'warehouse' : 'shop';
    // 标题是**固定文案**（原版就是 GlobalText[230] "Merchant" / GlobalText[234] "Storage"），
    // 不显示 NPC 名字 —— 名字只在对话那一句里出现。
    this.titleEl.textContent = warehouse
      ? this.whInfo.locked
        ? TEXT.warehouseLocked
        : TEXT.warehouseOpen
      : TEXT.shop;
    // 原版锁定时标题变黄（`if (lock) glColor3f(1,1,0)`）
    this.titleEl.classList.toggle('locked', warehouse && this.whInfo.locked);

    this.whEl.classList.toggle('hidden', !warehouse);
    this.shopEl.classList.toggle('hidden', warehouse);
    this.paint();
  }

  private whInfo: WarehouseInfo = { money: 0, tax: 0, locked: false };

  /** 仓库数据（金币 / 税费 / 锁）。仓库模式下调用 */
  setWarehouseInfo(info: WarehouseInfo) {
    this.whInfo = info;
    this.zenValue.textContent = formatZen(info.money);
    // 原版按金额改颜色：>=10M 红、>=1M 橙、>=100K 绿、其余浅金
    this.zenValue.className =
      'npc-text npc-zen-value' +
      (info.money >= 10_000_000
        ? ' lv4'
        : info.money >= 1_000_000
          ? ' lv3'
          : info.money >= 100_000
            ? ' lv2'
            : '');
    this.taxValue.textContent = formatZen(info.tax);

    // 锁按钮图标
    const lockBtn = this.whBtns[2];
    if (lockBtn) {
      const img = lockBtn.querySelector('img');
      const icons = info.locked ? this.lockIcons.closed : this.lockIcons.open;
      if (img && icons[0]) {
        img.src = icons[0];
        if (icons[1]) {
          lockBtn.onmouseenter = () => (img.src = icons[1]!);
          lockBtn.onmouseleave = () => (img.src = icons[0]!);
        }
      }
    }
    if (this.open && this.mode === 'warehouse') this.applyMode();
  }

  setItems(items: InventoryItem[]) {
    this.items = items;
    if (this.open) this.paint();
  }

  /** 操作反馈（2 秒后消失）。放在面板下方，不遮原版元素 */
  toast(text: string, kind: 'ok' | 'error' | '' = '') {
    this.toastEl.textContent = text;
    this.toastEl.className = `npc-toast ${kind}`.trim();
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.className = 'npc-toast hidden';
    }, 2200);
  }

  /* ---------------------------------------------------------------- */
  /* 绘制                                                              */
  /* ---------------------------------------------------------------- */
  private clearIcons() {
    for (const el of this.iconEls) el.remove();
    this.iconEls = [];
    this.iconBySlot.clear();
    this.gridEl.querySelectorAll('.npc-count').forEach(el => el.remove());
  }

  private paint() {
    if (!this.open) return;
    this.clearIcons();

    // 1) 格子底色：空 = Item_box，占用 = InventoryBox2
    const occupied = new Set<number>();
    for (const it of this.items) {
      const attr = itemAttr(it.type);
      const c0 = it.slot % COLS;
      const r0 = Math.floor(it.slot / COLS);
      for (let dy = 0; dy < attr.h; dy++) {
        for (let dx = 0; dx < attr.w; dx++) {
          const c = c0 + dx;
          const r = r0 + dy;
          if (c < COLS && r < ROWS) occupied.add(r * COLS + c);
        }
      }
    }
    for (let i = 0; i < this.cellEls.length; i++) {
      const cell = this.cellEls[i];
      const taken = occupied.has(i);
      cell.classList.toggle('taken', taken);
      const bg = cell.querySelector('.npc-cell-bg') as HTMLImageElement | null;
      const url = taken ? this.filledUrl : this.emptyUrl;
      if (bg && url && bg.src !== url) bg.src = url;
    }

    // 2) 物品图标
    for (const it of this.items) {
      const attr = itemAttr(it.type);
      const img = document.createElement('img');
      img.className = 'npc-item-icon';
      img.draggable = false;
      img.title = `${attr.name}${it.level ? ` +${it.level}` : ''}`;
      img.style.left = `${(it.slot % COLS) * CELL}px`;
      img.style.top = `${Math.floor(it.slot / COLS) * CELL}px`;
      img.style.width = `${attr.w * CELL}px`;
      img.style.height = `${attr.h * CELL}px`;
      img.style.imageRendering = 'pixelated';
      this.gridEl.appendChild(img);
      this.iconEls.push(img);
      this.iconBySlot.set(it.slot, img);

      // 药水/卷轴的堆叠数（448..456，与背包同一套规则）
      const stack = Math.round(it.durability || 0);
      if (it.type >= 448 && it.type <= 456 && stack > 1) {
        const num = document.createElement('span');
        num.className = 'npc-count';
        num.textContent = String(stack);
        num.style.left = `${(it.slot % COLS) * CELL + 13}px`;
        num.style.top = `${Math.floor(it.slot / COLS) * CELL}px`;
        this.gridEl.appendChild(num);
      }

      void itemIcon(it.type, it.level).then(url => {
        if (!this.iconEls.includes(img)) return;
        if (url) img.src = url;
        else img.classList.add('missing');
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function makePlate(
  url: string,
  x: number,
  y: number,
  w: number,
  h: number
): HTMLImageElement {
  const img = document.createElement('img');
  img.src = url;
  img.draggable = false;
  img.className = 'npc-sprite';
  img.style.left = `${x}px`;
  img.style.top = `${y}px`;
  img.style.width = `${w}px`;
  img.style.height = `${h}px`;
  img.style.imageRendering = 'pixelated';
  return img;
}

/** 千分位（原版 `%d,%03d` 手工分组，结果和 toLocaleString 一致） */
function formatZen(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
