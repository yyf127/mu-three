/**
 * 交易窗口（0x36–0x3D）。
 *
 * 版式（640×480 逻辑坐标）：上下两个 8×4 网格 —— 上面是**我的交易格**，
 * 下面是**对方放进来的**；中间金币行，底部「确定 / 取消」。
 *
 * 服务端语义（`Trade.cpp`，三条容易踩的）：
 *   1. 发起交易要求两人**同图且 X/Y 相差 ≤ 2 格**（`CGTradeRequestRecv`），
 *      所以窗口只在对方就在旁边时才有意义；
 *   2. 物品进出交易格走的是 **0x24 物品移动**（`SourceFlag/TargetFlag = 1`），
 *      不是 0x38/0x39 —— 那两条是服务端**发给对方**的同步包
 *      （`GCTradeItemAddSend(lpObj->TargetNumber, …)`）；
 *   3. 任何一方改动物品，服务端会给双方发 `0x3C flag=0` 清掉「确定」状态，
 *      所以改完必须重新点确定。
 */
import type { UiLayer } from './frame';
import { textSync } from '../data/localText';
import { itemAttr } from '../data/itemAttrs';
import { itemIcon } from './itemIcon';
import type { InventoryItem } from '../net/game';

const PANEL = { x: 214, y: 74, w: 204, h: 322 };
const CELL = 20;
const COLS = 8;
const ROWS = 4;
const GRID_W = COLS * CELL; // 160
const GRID_H = ROWS * CELL; // 80

export class TradePanel {
  private el: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private partnerEl: HTMLDivElement;
  private mineGrid: HTMLDivElement;
  private theirsGrid: HTMLDivElement;
  private moneyLabel: HTMLDivElement;
  private moneyInput: HTMLInputElement;
  private moneyBtn: HTMLButtonElement;
  private okBtn: HTMLButtonElement;
  private cancelBtn: HTMLButtonElement;
  private stateEl: HTMLDivElement;
  private reqEl: HTMLDivElement;
  private reqText: HTMLDivElement;
  private acceptBtn: HTMLButtonElement;
  private declineBtn: HTMLButtonElement;

  private mine = new Map<number, InventoryItem>();
  private theirs = new Map<number, InventoryItem>();
  private myMoney = 0;
  private tradeMoney = 0;
  private open = false;
  private request: { index: number; name: string } | null = null;

  /** 点自己的交易格（把物品退回背包） */
  onTakeBack: ((slot: number) => void) | null = null;
  /** 设定交易金币 */
  onSetMoney: ((money: number) => void) | null = null;
  /** 确定（flag 1 = 确定，0 = 取消确定） */
  onOk: ((flag: boolean) => void) | null = null;
  onCancel: (() => void) | null = null;
  onAccept: ((index: number) => void) | null = null;
  onDecline: ((index: number) => void) | null = null;

  constructor(layer: UiLayer) {
    this.el = document.createElement('div');
    this.el.className = 'trade-panel hidden';
    this.el.style.left = `${PANEL.x}px`;
    this.el.style.top = `${PANEL.y}px`;
    this.el.style.width = `${PANEL.w}px`;
    this.el.style.height = `${PANEL.h}px`;

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'trade-title';
    this.titleEl.textContent = '交易';

    this.partnerEl = document.createElement('div');
    this.partnerEl.className = 'trade-partner';

    const mkLabel = (text: string, top: number) => {
      const d = document.createElement('div');
      d.className = 'trade-label';
      d.textContent = text;
      d.style.top = `${top}px`;
      return d;
    };

    this.mineGrid = document.createElement('div');
    this.mineGrid.className = 'trade-grid';
    this.mineGrid.style.top = '60px';
    this.mineGrid.style.width = `${GRID_W}px`;
    this.mineGrid.style.height = `${GRID_H}px`;

    this.theirsGrid = document.createElement('div');
    this.theirsGrid.className = 'trade-grid';
    this.theirsGrid.style.top = '166px';
    this.theirsGrid.style.width = `${GRID_W}px`;
    this.theirsGrid.style.height = `${GRID_H}px`;

    this.moneyLabel = document.createElement('div');
    this.moneyLabel.className = 'trade-money-label';
    this.moneyLabel.textContent = '金币：0';

    this.moneyInput = document.createElement('input');
    this.moneyInput.className = 'trade-money-input';
    this.moneyInput.inputMode = 'numeric';
    this.moneyInput.placeholder = '0';
    this.moneyInput.addEventListener('input', () => {
      const cleaned = this.moneyInput.value.replace(/\D+/g, '');
      if (cleaned !== this.moneyInput.value) this.moneyInput.value = cleaned;
    });
    this.moneyInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.applyMoney();
      }
      e.stopPropagation();
    });

    this.moneyBtn = document.createElement('button');
    this.moneyBtn.className = 'trade-btn trade-money-set';
    this.moneyBtn.textContent = '放入';
    this.moneyBtn.addEventListener('click', () => this.applyMoney());

    this.okBtn = document.createElement('button');
    this.okBtn.className = 'trade-btn trade-ok';
    this.okBtn.textContent = textSync(228, '确认');
    this.okBtn.addEventListener('click', () => this.onOk?.(true));

    this.cancelBtn = document.createElement('button');
    this.cancelBtn.className = 'trade-btn trade-cancel';
    this.cancelBtn.textContent = textSync(229, '取消');
    this.cancelBtn.addEventListener('click', () => this.onCancel?.());

    this.stateEl = document.createElement('div');
    this.stateEl.className = 'trade-state';

    this.reqEl = document.createElement('div');
    this.reqEl.className = 'trade-request hidden';
    this.reqText = document.createElement('div');
    this.reqText.className = 'trade-request-text';
    this.acceptBtn = document.createElement('button');
    this.acceptBtn.className = 'trade-btn trade-accept';
    this.acceptBtn.textContent = '接受';
    this.declineBtn = document.createElement('button');
    this.declineBtn.className = 'trade-btn trade-decline';
    this.declineBtn.textContent = '拒绝';
    this.acceptBtn.addEventListener('click', () => {
      const r = this.request;
      this.hideRequest();
      if (r) this.onAccept?.(r.index);
    });
    this.declineBtn.addEventListener('click', () => {
      const r = this.request;
      this.hideRequest();
      if (r) this.onDecline?.(r.index);
    });
    this.reqEl.append(this.reqText, this.acceptBtn, this.declineBtn);

    this.el.append(
      this.titleEl,
      this.partnerEl,
      mkLabel('我的物品', 44),
      this.mineGrid,
      mkLabel('对方物品', 150),
      this.theirsGrid,
      this.moneyLabel,
      this.moneyInput,
      this.moneyBtn,
      this.okBtn,
      this.cancelBtn,
      this.stateEl,
      this.reqEl
    );
    layer.root.appendChild(this.el);
  }

  get isOpen() {
    return this.open;
  }

  get pendingRequest() {
    return this.request;
  }

  show(partnerName: string, level: number) {
    this.open = true;
    this.mine.clear();
    this.theirs.clear();
    this.tradeMoney = 0;
    this.moneyInput.value = '';
    this.partnerEl.textContent = `对方：${partnerName}${level ? `（Lv ${level}）` : ''}`;
    this.stateEl.textContent = '';
    this.el.classList.remove('hidden');
    this.paint();
  }

  hide() {
    this.open = false;
    this.request = null;
    this.reqEl.classList.add('hidden');
    this.el.classList.add('hidden');
    this.mine.clear();
    this.theirs.clear();
  }

  setMine(items: InventoryItem[]) {
    this.mine = new Map(items.map(i => [i.slot, i]));
    if (this.open) this.paint();
  }

  setTheirs(items: InventoryItem[]) {
    this.theirs = new Map(items.map(i => [i.slot, i]));
    if (this.open) this.paint();
  }

  setMoney(myMoney: number, tradeMoney: number) {
    this.myMoney = myMoney;
    this.tradeMoney = tradeMoney;
    this.moneyLabel.textContent = `金币：${myMoney.toLocaleString('en-US')} / 交易 ${tradeMoney.toLocaleString('en-US')}`;
    if (this.open) this.paint();
  }

  /** 0x3C：mine = 我点了确定，theirs = 对方点了确定 */
  setOk(mine: boolean, theirs: boolean) {
    this.stateEl.textContent = `${mine ? '已确定' : ''}${mine && theirs ? ' · ' : ''}${theirs ? '对方已确定' : ''}`;
    this.okBtn.textContent = mine ? textSync(229, '取消') : textSync(228, '确认');
    this.okBtn.dataset.ok = mine ? '1' : '0';
  }

  showRequest(index: number, name: string) {
    this.request = { index, name };
    this.reqText.textContent = `${name} 请求交易`;
    this.reqEl.classList.remove('hidden');
    this.el.classList.remove('hidden');
  }

  hideRequest() {
    this.request = null;
    this.reqEl.classList.add('hidden');
    // 没有正在进行的交易时，整个窗口收起
    if (!this.open) this.el.classList.add('hidden');
  }

  private applyMoney() {
    const n = Number(this.moneyInput.value || '0');
    if (!Number.isFinite(n) || n < 0) return;
    this.onSetMoney?.(n);
    this.moneyInput.value = '';
  }

  private paint() {
    this.paintGrid(this.mineGrid, this.mine, true);
    this.paintGrid(this.theirsGrid, this.theirs, false);
  }

  private paintGrid(box: HTMLDivElement, items: Map<number, InventoryItem>, clickable: boolean) {
    box.textContent = '';
    for (let i = 0; i < COLS * ROWS; i++) {
      const cell = document.createElement('div');
      cell.className = 'trade-cell';
      cell.style.left = `${(i % COLS) * CELL}px`;
      cell.style.top = `${Math.floor(i / COLS) * CELL}px`;
      box.appendChild(cell);
    }

    for (const it of items.values()) {
      const attr = itemAttr(it.type);
      const icon = document.createElement('img');
      icon.className = 'trade-icon';
      icon.style.left = `${(it.slot % COLS) * CELL}px`;
      icon.style.top = `${Math.floor(it.slot / COLS) * CELL}px`;
      icon.style.width = `${attr.w * CELL}px`;
      icon.style.height = `${attr.h * CELL}px`;
      box.appendChild(icon);
      void itemIcon(it.type, it.level).then(url => {
        if (url) icon.src = url;
      });
      if (clickable) {
        icon.style.pointerEvents = 'auto';
        icon.style.cursor = 'pointer';
        icon.title = '点击退回背包';
        icon.addEventListener('click', () => this.onTakeBack?.(it.slot));
      }
    }
  }

  /** 探针快照 */
  snapshot() {
    return {
      open: this.open,
      partner: this.partnerEl.textContent,
      mine: [...this.mine.values()].map(i => `${i.slot}:${i.type}`),
      theirs: [...this.theirs.values()].map(i => `${i.slot}:${i.type}`),
      state: this.stateEl.textContent,
      okText: this.okBtn.textContent,
      request: this.request,
    };
  }
}
