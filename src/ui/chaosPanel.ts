/**
 * 混沌机器面板（混沌哥布林 238 · 0x30 result=3）。
 *
 * 版式照抄 Win 端 `RenderChaosMix`（HUD_Pass6.cpp:1548，IDA 0x004F27F0 附近）：
 *
 *   dword_7EAA0C8 = 260, dword_7EAA0CC = 0    ← 和仓库/商店同一个原点
 *   底板   RenderInventoryInterface(260, 0)   Item_Back01 190×256 + Item_Back02 190×177
 *   网格   RenderItemsBoxes(x+15, y+110, …, 8, 4)   ← 8 列 4 行，和仓库的 8×15 不同
 *   标题   RenderText(x+35, y+12)
 *   配方   RenderText(x+20, y+50)   GlobalText[601..608]
 *   成功率 RenderText(x+20, y+70)   GlobalText[584] "Success rate: %d%%"
 *   费用   RenderText(x+20, y+90)   GlobalText[585] "Required zen : %s"
 *   提示   RenderText(x+20, y+210 / +225 / +240 / +255 / +270)
 *   按钮   GL_DrawTexture(292|293, x+75, y+300, 44, 32)   ← Mix_button1/2，悬停换 293
 *
 * ── 和仓库/商店最大的区别：合成结果会**留在箱子里** ────────────────────
 *
 * 服务端 `DGCreateItemRecv`（DSProtocol.cpp:927）在 map == 0xFF 时做的是：
 *
 *     gChaosBox.ChaosBoxInit(lpObj);          // 先清空箱子
 *     gItemManager.ChaosBoxAddItem(…, item, 0); // 产物放到箱子第 0 格
 *     gChaosBox.GCChaosMixSend(lpObj, 1, &item);
 *
 * 也就是说产物**不在背包里**，还在混沌箱第 0 格；而关闭混沌机的
 * `CGChaosMixCloseRecv` 只做 `ChaosBoxInit` + `gObjInventoryCommit`，
 * **箱子里剩下的东西直接Clear()掉，不会退回背包**。
 *
 * 所以客户端必须：
 *   1. 拿到 0x86 result=1 后把产物画在格 0 上；
 *   2. 玩家得自己把它点回背包（0x24 SourceFlag=3 → TargetFlag=0）；
 *   3. 箱子里还有东西时**拒绝关闭**，对应原版 `ChaosBoxRequestClose`
 *      （GlobalText[593] "Close inventory after moving your items…"）。
 */
import type { UiLayer } from './frame';
import { uiSprite, preloadUi } from './ozj';
import { itemIcon } from './itemIcon';
import { itemAttr } from '../data/itemAttrs';
import { MIX_LABEL, mixErrorText } from '../data/chaosRecipe';
import type { InventoryItem } from '../net/game';

/** 面板原点与尺寸（`dword_7EAA0C8 / 0CC`，和仓库一致） */
const PANEL = { x: 260, y: 0, w: 190, h: 433 };
const COLS = 8;
const ROWS = 4;
const CELL = 20;
/** `RenderItemsBoxes(dword + 15, dword + 110, …, 8, 4)` */
const GRID = { x: 15, y: 110 };
const TITLE = { x: 35, y: 11 };
/** 配方 / 成功率 / 费用三行 */
const LINE = { recipe: 50, rate: 70, money: 90, x: 20 };
/** 提示行（原版最多 5 行，y = 210 + 15n） */
const HINT = { x: 20, y0: 210, dy: 15 };
/** `GL_DrawTexture(292, x+75, y+300, 44, 32)` */
const MIX_BTN = { x: 75, y: 300, w: 44, h: 32 };
/** 关闭按钮：和仓库/商店同一位置 */
const CLOSE = { x: 161, y: 4, size: 24 };

const SPRITES = [
  'Item_Back01',
  'Item_Back02',
  'Item_box',
  'InventoryBox2',
  'Mix_button1',
  'Mix_button2',
  'exit_01',
  'exit_02',
];

const TEXT = {
  title: '混沌合成', // GlobalText[735] "General combination" / [583] "Chaos"
  rate: '成功率', // GlobalText[584] "Success rate: %d%%"
  money: '需要 Zen', // GlobalText[585] "Required zen : %s"
  mix: '合成', // GlobalText[591] "Combination"（悬停提示）
  /** 原版 586+587：合成必须要有混沌之石 */
  hintChaos: ['合成需要「混沌之石」', '（Jewel of Chaos）'],
  /** 原版 606/607/608：+10/+11 失败会掉物品 */
  hintPlus: ['+10 ~ +11 合成失败时', '有丢失物品的可能'],
  /** 原版 610/611 */
  hintLose: ['合成失败时', '可能丢失材料'],
  /** 原版 588/589/590 */
  hintChaosWeapon: ['注意：合成失败时', '物品等级可能下降'],
  /** 本 port 加的鼠标操作说明（原版靠拖拽，这里点一下就移动） */
  hintMouse: '点背包物品放入 · 点箱子物品取回',
};

/** 合成状态的三种视觉状态 */
export type ChaosPhase = 'idle' | 'mixing' | 'result';

export class ChaosPanel {
  private el: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private recipeEl: HTMLDivElement;
  private rateEl: HTMLDivElement;
  private moneyEl: HTMLDivElement;
  private hintEls: HTMLDivElement[] = [];
  private mouseHint: HTMLDivElement;
  private gridEl: HTMLDivElement;
  private mixBtnWrap: HTMLButtonElement;
  private mixImg: HTMLImageElement;
  private toastEl: HTMLDivElement;

  private emptyUrl: string | null = null;
  private filledUrl: string | null = null;
  private cellEls: HTMLDivElement[] = [];
  private iconEls: HTMLImageElement[] = [];
  private mixIcons: [string | null, string | null] = [null, null];

  private items: InventoryItem[] = [];
  private recipeType = 0;
  private rate: number | null = null;
  private money: number | null = null;
  private phase: ChaosPhase = 'idle';
  private open = false;
  private toastTimer = 0;
  private ready: Promise<void>;

  /** 点箱子里的物品 → 取回背包（0x24 SourceFlag=3 → TargetFlag=0） */
  onTakeOut: ((slot: number) => void) | null = null;
  /** 点「合成」按钮（0x86 type） */
  onMix: ((type: number) => void) | null = null;
  /** 关面板（0x87）。箱子里有东西时本面板会先拦下，不触发 */
  onClose: (() => void) | null = null;
  /** 材料变化 → 主程序发 0x88 查成功率 */
  onQueryRate: ((type: number) => void) | null = null;

  constructor(layer: UiLayer) {
    this.el = document.createElement('div');
    this.el.className = 'npc-panel chaos-panel hidden';
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
    this.titleEl.textContent = TEXT.title;
    this.el.appendChild(this.titleEl);

    this.recipeEl = this.textLine(LINE.x, LINE.recipe, 'chaos-recipe');
    this.rateEl = this.textLine(LINE.x, LINE.rate, 'chaos-rate');
    this.moneyEl = this.textLine(LINE.x, LINE.money, 'chaos-money');

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'npc-grid';
    this.gridEl.style.left = `${GRID.x}px`;
    this.gridEl.style.top = `${GRID.y}px`;
    this.gridEl.style.width = `${COLS * CELL}px`;
    this.gridEl.style.height = `${ROWS * CELL}px`;
    this.el.appendChild(this.gridEl);

    for (let i = 0; i < 5; i++) {
      const d = this.textLine(HINT.x, HINT.y0 + i * HINT.dy, 'chaos-hint');
      this.hintEls.push(d);
    }

    this.mouseHint = document.createElement('div');
    this.mouseHint.className = 'chaos-mouse-hint';
    this.mouseHint.textContent = TEXT.hintMouse;
    this.el.appendChild(this.mouseHint);

    this.mixBtnWrap = document.createElement('button');
    this.mixBtnWrap.type = 'button';
    this.mixBtnWrap.className = 'chaos-mix-btn';
    this.mixBtnWrap.style.left = `${MIX_BTN.x}px`;
    this.mixBtnWrap.style.top = `${MIX_BTN.y}px`;
    this.mixBtnWrap.style.width = `${MIX_BTN.w}px`;
    this.mixBtnWrap.style.height = `${MIX_BTN.h}px`;
    this.mixBtnWrap.title = TEXT.mix;
    this.mixImg = document.createElement('img');
    this.mixImg.draggable = false;
    this.mixBtnWrap.appendChild(this.mixImg);
    this.mixBtnWrap.addEventListener('click', e => {
      e.stopPropagation();
      this.tryMix();
    });
    this.el.appendChild(this.mixBtnWrap);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'npc-toast hidden';
    this.el.appendChild(this.toastEl);

    this.buildGrid();
    this.ready = this.build();
  }

  private textLine(x: number, y: number, cls: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = `npc-text ${cls}`;
    d.style.left = `${x}px`;
    d.style.top = `${y - 1}px`;
    this.el.appendChild(d);
    return d;
  }

  private buildGrid() {
    for (let i = 0; i < COLS * ROWS; i++) {
      const cell = document.createElement('div');
      cell.className = 'npc-cell';
      cell.dataset.cell = String(i);
      cell.style.left = `${(i % COLS) * CELL}px`;
      cell.style.top = `${Math.floor(i / COLS) * CELL}px`;
      cell.style.width = `${CELL}px`;
      cell.style.height = `${CELL}px`;

      const bg = document.createElement('img');
      bg.className = 'npc-cell-bg';
      bg.draggable = false;
      bg.style.imageRendering = 'pixelated';
      cell.appendChild(bg);

      cell.addEventListener('click', () => {
        if (!this.open) return;
        const item = this.itemAtCell(i);
        if (item) this.onTakeOut?.(item.slot);
      });

      this.gridEl.appendChild(cell);
      this.cellEls.push(cell);
    }
  }

  private async build() {
    await preloadUi(SPRITES);

    const [back1, back2, box, box2, mix1, mix2, ex1, ex2] = await Promise.all([
      uiSprite('Item_Back01'),
      uiSprite('Item_Back02'),
      uiSprite('Item_box'),
      uiSprite('InventoryBox2'),
      uiSprite('Mix_button1'),
      uiSprite('Mix_button2'),
      uiSprite('exit_01'),
      uiSprite('exit_02'),
    ]);

    if (back1) this.el.appendChild(plate(back1.url, 0, 0, 190, 256));
    if (back2) this.el.appendChild(plate(back2.url, 0, 256, 190, 177));

    this.emptyUrl = box?.url ?? null;
    this.filledUrl = box2?.url ?? null;
    for (const cell of this.cellEls) {
      const img = cell.querySelector('.npc-cell-bg') as HTMLImageElement | null;
      if (img && this.emptyUrl) img.src = this.emptyUrl;
    }

    this.mixIcons = [mix1?.url ?? null, mix2?.url ?? null];
    if (this.mixIcons[0]) this.mixImg.src = this.mixIcons[0];
    this.mixBtnWrap.addEventListener('mouseenter', () => {
      if (this.mixIcons[1]) this.mixImg.src = this.mixIcons[1]!;
    });
    this.mixBtnWrap.addEventListener('mouseleave', () => {
      if (this.mixIcons[0]) this.mixImg.src = this.mixIcons[0]!;
    });

    if (ex1) {
      const close = document.createElement('img');
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
        this.requestClose();
      });
      this.el.appendChild(close);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 对外                                                              */
  /* ---------------------------------------------------------------- */

  get isOpen() {
    return this.open;
  }

  get currentType() {
    return this.recipeType;
  }

  get isEmpty() {
    return this.items.length === 0;
  }

  show() {
    this.open = true;
    this.phase = 'idle';
    this.el.classList.remove('hidden');
    void this.ready.then(() => this.paint());
  }

  hide() {
    this.open = false;
    this.items = [];
    this.recipeType = 0;
    this.rate = null;
    this.money = null;
    this.phase = 'idle';
    this.el.classList.add('hidden');
    this.clearIcons();
  }

  itemAt(slot: number): InventoryItem | null {
    return this.items.find(i => i.slot === slot) ?? null;
  }

  setItems(items: InventoryItem[]) {
    this.items = items.slice();
    if (this.open) this.paint();
  }

  /**
   * 材料变化后由主程序调用：`type` 是本地推导出来的配方（0 = 材料不匹配）。
   * 配方为 0 时清掉成功率，避免显示上一次的残留数字。
   */
  setRecipe(type: number) {
    this.recipeType = type;
    if (type <= 0) {
      this.rate = null;
      this.money = null;
    }
    this.paintText();
  }

  /**
   * 0x88 回执。
   *
   * `(0, 0)` 要按「未知」处理：服务端 `GetChaosMixRateAndMoney` 在配方不成立时
   * 只填 0（`switch` 的 default 直接 return false，rate/money 保持初值 0），
   * 和「成功率真的是 0%」分不开。显示 `--` 比显示一个假的 `0%` 诚实。
   */
  setRate(rate: number, money: number) {
    if (!this.open) return;
    const unknown = rate === 0 && money === 0;
    this.rate = unknown ? null : rate;
    this.money = unknown ? null : money;
    this.paintText();
  }

  /** 发出 0x86 后进入「合成中」，服务端回执（0x86）再切到 result */
  setPhase(phase: ChaosPhase) {
    this.phase = phase;
    this.paintText();
  }

  toast(text: string, kind: 'ok' | 'error' | '' = '') {
    this.toastEl.textContent = text;
    this.toastEl.className = `npc-toast ${kind}`.trim();
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.className = 'npc-toast hidden';
    }, 2400);
  }

  /** 原版 `ChaosBoxRequestClose`：箱子里还有东西就拒绝关闭 + 弹 593 */
  requestClose() {
    if (!this.isEmpty) {
      this.toast('先把箱子里的物品取回背包（关闭会丢失）', 'error');
      return;
    }
    this.onClose?.();
  }

  snapshot() {
    return {
      open: this.open,
      phase: this.phase,
      recipe: this.recipeType,
      recipeText: this.recipeEl.textContent ?? '',
      rate: this.rate,
      money: this.money,
      items: this.items.map(i => ({
        slot: i.slot,
        type: i.type,
        name: itemAttr(i.type).name,
        level: i.level,
      })),
    };
  }

  /* ---------------------------------------------------------------- */
  /* 内部                                                              */
  /* ---------------------------------------------------------------- */

  private tryMix() {
    if (!this.open || this.phase === 'mixing') return;
    if (this.recipeType <= 0) {
      this.toast(
        this.recipeType < 0 ? mixErrorText(this.recipeType) : '材料不匹配，无法合成',
        'error'
      );
      return;
    }
    /*
     * 成功率还没回来也允许点：合成结果由服务端定，
     * 0x88 只是给玩家看的参考值（材料刚放进去的几百毫秒里可能是 `--`）。
     */
    if (this.rate === null) this.onQueryRate?.(this.recipeType);
    this.onMix?.(this.recipeType);
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

  private clearIcons() {
    for (const el of this.iconEls) el.remove();
    this.iconEls = [];
    this.gridEl.querySelectorAll('.npc-count').forEach(el => el.remove());
  }

  private paintText() {
    // 标题：原版在没有具体配方时显示 GlobalText[735] "General combination"
    this.titleEl.textContent = TEXT.title;

    const t = this.recipeType;
    this.recipeEl.textContent = t < 0 ? mixErrorText(t) : MIX_LABEL[t] ?? MIX_LABEL[0];
    this.recipeEl.classList.toggle('bad', t <= 0);

    this.rateEl.textContent =
      this.rate === null ? `${TEXT.rate}：--` : `${TEXT.rate}：${Math.round(this.rate)}%`;
    this.moneyEl.textContent =
      this.money === null ? `${TEXT.money}：--` : `${TEXT.money}：${formatZen(this.money)}`;

    // 合成中：按钮变灰、提示换成等待
    this.mixBtnWrap.classList.toggle('busy', this.phase === 'mixing');
    this.mixBtnWrap.disabled = this.phase === 'mixing';

    // 提示行（原版按配方分支）
    let lines: string[] = [];
    if (this.phase === 'mixing') lines = ['合成中…'];
    else if (t === 3 || t === 4) lines = TEXT.hintPlus;
    else if (t === 5 || t === 6) lines = TEXT.hintLose;
    else if (t === 1 || t === 11) lines = TEXT.hintChaosWeapon;
    lines = lines.concat(TEXT.hintChaos);

    for (let i = 0; i < this.hintEls.length; i++) {
      this.hintEls[i].textContent = lines[i] ?? '';
    }
  }

  private paint() {
    if (!this.open) return;
    this.paintText();
    this.clearIcons();

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
      if (this.phase === 'result' && it.slot === 0) img.classList.add('chaos-fresh');
      this.gridEl.appendChild(img);
      this.iconEls.push(img);

      void itemIcon(it.type, it.level).then(url => {
        if (!this.iconEls.includes(img)) return;
        if (url) img.src = url;
        else img.classList.add('missing');
      });
    }
  }
}

function plate(url: string, x: number, y: number, w: number, h: number): HTMLImageElement {
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

function formatZen(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
