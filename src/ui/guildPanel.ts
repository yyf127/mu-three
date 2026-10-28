/**
 * 战盟窗口（0x50–0x64）。
 *
 * 版式照 Win 端 `RenderGuildList`（HUD_Pass6.cpp:1147）：
 *
 *   RenderGuildList(450, 0)                      ← **面板在 450，不是 260**
 *   底板  Item_Back01 (260) 190×256 + Item_Back02 (261) 190×177
 *   标题  (x+35, y+12)   "公会名 (Score:总分)"  /  GlobalText[180] "Guild"
 *   公告  RenderCenteredText(x+95, y+44 / y+58)  金色 0xFFC8FF64
 *   无盟  (x+20, y+50 / 65 / 80)  GlobalText[185..187]
 *         "Type /guild in front of the guild master you want to join the guild"
 *   成员  列表控件（13 字节/条：name[10] + connected + party）
 *
 * 创建框 `RenderGuildCreation`（同文件 1227）：
 *   名字输入框  Item_Money(271) @ (x+55, y+60) 113×18
 *   标志画板    8×8 格，从 (x+50, y+100) 起，每格 15px
 *   当前色      (x+16, y+231) 23×23
 *   调色板      2 行 × 8 色，从 (x+15, y+260) 起，每格 20px
 *   提示        (x+50, y+230 / y+245)  GlobalText[183 / 184]
 *
 * 注意面板和背包**抢同一个位置**（都在 450），所以打开战盟要关背包，反之亦然
 * —— 原版也是这么做的（`Player_InputTick.cpp` 里点背包按钮会 `GuildOpened = 0`）。
 */
import type { UiLayer } from './frame';
import { textSync } from '../data/localText';
import { uiSprite, preloadUi } from './ozj';
import { GUILD_MARK_COLORS, GUILD_MAX_MEMBER, type GuildListReply, type GuildMember } from '../net/game';

const PANEL = { x: 450, y: 0, w: 190, h: 433 };
const TITLE = { x: 35, y: 11 };
const NOTICE = { x: 95, y: 44, dy: 14 };
const NOGUILD = { x: 20, y: 50, dy: 15 };
const LIST = { x: 8, y: 86, w: 174, rowH: 18, rows: 15 };
const BTN = { y: 396, w: 56, h: 18 };
const REQ = { y: 414 };
const CLOSE = { x: 161, y: 4, size: 24 };

/** 创建框坐标（相对面板） */
const CREATE = {
  nameX: 55,
  nameY: 60,
  gridX: 50,
  gridY: 100,
  cell: 15,
  swatchX: 16,
  swatchY: 231,
  swatchSize: 23,
  paletteX: 15,
  paletteY: 260,
  paletteCell: 20,
  hintX: 50,
  hintY: 230,
  btnY: 310,
};

const SPRITES = ['Item_Back01', 'Item_Back02', 'Item_Money', 'exit_01', 'exit_02'];

const TEXT = {
  title: '战盟', // GlobalText[180] "Guild"
  noGuild1: '走到想加入的会长面前', // GlobalText[185..187]
  noGuild2: '输入 /guild 申请入盟',
  noGuild3: '（会长接受后即可加入）',
  create: '创建战盟',
  disband: '解散战盟', // GlobalText[188] "Disband"
  leave: '退出战盟', // GlobalText[189] "Leave"
  refresh: '刷新',
  kick: '驱逐',
  online: '在线',
  offline: '离线',
  nameLabel: '名称', // GlobalText[182] "Name"
  hintDraw1: '先用鼠标选颜色', // GlobalText[183]
  hintDraw2: '再在格子里画', // GlobalText[184]
  ok: textSync(228, '确认'),
  cancel: textSync(229, '取消'),
  request: '申请加入战盟',
  accept: '接受',
  decline: '拒绝',
};

export interface GuildState {
  /** 我的角色名（用于判断「哪一行是我」） */
  self: string;
  /** 0x52 的结果；null = 还没拉到 */
  list: GuildListReply | null;
}

export class GuildPanel {
  private el: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private noticeEls: HTMLDivElement[] = [];
  private noGuildEls: HTMLDivElement[] = [];
  private listEl: HTMLDivElement;
  private btnRow: HTMLDivElement;
  private createBtn: HTMLButtonElement;
  private leaveBtn: HTMLButtonElement;
  private reqEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private createEl: HTMLDivElement;
  private nameInput!: HTMLInputElement;
  private gridEl!: HTMLDivElement;
  private swatchEl!: HTMLDivElement;
  private paletteEl!: HTMLDivElement;
  private createOk!: HTMLButtonElement;
  private createCancel!: HTMLButtonElement;

  private open = false;
  private creating = false;
  private state: GuildState = { self: '', list: null };
  /**
   * 自己的战盟名 + 标志。
   * **0x52 成员表里没有盟名**（`PMSG_GUILD_LIST_SEND` 只有 result/count/
   * TotalScore/score/成员行），盟名是登录/入盟时服务端用 0x5C 单独推的，
   * 所以这里单独存一份。
   */
  private myGuildName = '';
  private myMark: Uint8Array | null = null;
  private cells: number[] = new Array(64).fill(0);
  private color = 12; // 默认红色（16 色里的 12 号）
  private scroll = 0;
  private toastTimer = 0;
  private ready: Promise<void>;

  /** 刷新（0x52） */
  onRefresh: (() => void) | null = null;
  /** 点「创建战盟」（0x54） */
  onOpenCreate: (() => void) | null = null;
  /** 创建框「确定」（0x55：名字 + 打包后的标志） */
  onCreate: ((name: string, mark: number[]) => void) | null = null;
  /** 创建框「取消」（0x57） */
  onCreateCancel: (() => void) | null = null;
  /** 退出 / 解散 / 驱逐（0x53）。名字 + 是否自己 */
  onDelete: ((name: string) => void) | null = null;
  /** 应答入盟申请（0x51） */
  onJoinAnswer: ((accept: boolean, index: number) => void) | null = null;

  private request: { name: string; index: number } | null = null;
  private closeBtn: HTMLImageElement | null = null;

  constructor(layer: UiLayer) {
    this.el = document.createElement('div');
    this.el.className = 'npc-panel guild-panel hidden';
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

    for (let i = 0; i < 2; i++) {
      const d = document.createElement('div');
      d.className = 'guild-notice';
      d.style.left = `${NOTICE.x}px`;
      d.style.top = `${NOTICE.y + i * NOTICE.dy - 1}px`;
      this.el.appendChild(d);
      this.noticeEls.push(d);
    }

    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div');
      d.className = 'npc-text guild-noguild';
      d.style.left = `${NOGUILD.x}px`;
      d.style.top = `${NOGUILD.y + i * NOGUILD.dy - 1}px`;
      d.textContent = [TEXT.noGuild1, TEXT.noGuild2, TEXT.noGuild3][i];
      this.el.appendChild(d);
      this.noGuildEls.push(d);
    }

    this.listEl = document.createElement('div');
    this.listEl.className = 'guild-list';
    this.listEl.style.left = `${LIST.x}px`;
    this.listEl.style.top = `${LIST.y}px`;
    this.listEl.style.width = `${LIST.w}px`;
    this.listEl.style.height = `${LIST.rowH * LIST.rows}px`;
    this.listEl.addEventListener('wheel', e => {
      e.preventDefault();
      this.scrollBy(e.deltaY > 0 ? 1 : -1);
    });
    this.el.appendChild(this.listEl);

    this.btnRow = document.createElement('div');
    this.btnRow.className = 'guild-btns';
    this.el.appendChild(this.btnRow);

    this.createBtn = this.mkBtn(6, TEXT.create, () => this.onOpenCreate?.());
    this.leaveBtn = this.mkBtn(6, TEXT.leave, () => this.onLeaveClick());
    const refreshBtn = this.mkBtn(120, TEXT.refresh, () => this.onRefresh?.());
    void refreshBtn;

    this.reqEl = document.createElement('div');
    this.reqEl.className = 'guild-req hidden';
    this.el.appendChild(this.reqEl);
    this.buildRequestBar();

    this.createEl = document.createElement('div');
    this.createEl.className = 'guild-create hidden';
    this.el.appendChild(this.createEl);
    this.buildCreate();

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'npc-toast hidden';
    this.el.appendChild(this.toastEl);

    this.ready = this.build();
  }

  /* ---------------------------------------------------------------- */
  /* 骨架                                                              */
  /* ---------------------------------------------------------------- */

  private build(): Promise<void> {
    return preloadUi(SPRITES).then(async () => {
      const [back1, back2, money, ex1, ex2] = await Promise.all([
        uiSprite('Item_Back01'),
        uiSprite('Item_Back02'),
        uiSprite('Item_Money'),
        uiSprite('exit_01'),
        uiSprite('exit_02'),
      ]);
      if (back1) this.el.insertBefore(plate(back1.url, 0, 0, 190, 256), this.el.firstChild);
      if (back2) this.el.insertBefore(plate(back2.url, 0, 256, 190, 177), this.el.firstChild);
      if (money) this.nameBar.src = money.url;

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
          this.hide();
        });
        this.el.appendChild(close);
        this.closeBtn = close;
      }
      this.paint();
    });
  }

  private nameBar!: HTMLImageElement;

  private buildCreate() {
    const bg = document.createElement('div');
    bg.className = 'guild-create-bg';
    this.createEl.appendChild(bg);

    const label = document.createElement('div');
    label.className = 'npc-text guild-name-label';
    label.textContent = TEXT.nameLabel;
    label.style.left = `${CREATE.nameX - 38}px`;
    label.style.top = `${CREATE.nameY + 1}px`;
    this.createEl.appendChild(label);

    this.nameBar = document.createElement('img');
    this.nameBar.className = 'guild-name-bar';
    this.nameBar.draggable = false;
    this.nameBar.style.left = `${CREATE.nameX}px`;
    this.nameBar.style.top = `${CREATE.nameY}px`;
    this.nameBar.style.width = '113px';
    this.nameBar.style.height = '18px';
    this.nameBar.style.imageRendering = 'pixelated';
    this.createEl.appendChild(this.nameBar);

    this.nameInput = document.createElement('input');
    this.nameInput.className = 'guild-name-input';
    this.nameInput.maxLength = 8;
    this.nameInput.style.left = `${CREATE.nameX + 5}px`;
    this.nameInput.style.top = `${CREATE.nameY + 2}px`;
    this.nameInput.addEventListener('input', () => {
      this.nameInput.value = this.nameInput.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
    });
    this.nameInput.addEventListener('keydown', e => e.stopPropagation());
    this.createEl.appendChild(this.nameInput);

    // 8×8 画板
    this.gridEl = document.createElement('div');
    this.gridEl.className = 'guild-mark-grid';
    this.gridEl.style.left = `${CREATE.gridX}px`;
    this.gridEl.style.top = `${CREATE.gridY}px`;
    this.gridEl.style.width = `${CREATE.cell * 8}px`;
    this.gridEl.style.height = `${CREATE.cell * 8}px`;
    for (let i = 0; i < 64; i++) {
      const c = document.createElement('div');
      c.className = 'guild-mark-cell';
      c.style.left = `${(i % 8) * CREATE.cell}px`;
      c.style.top = `${Math.floor(i / 8) * CREATE.cell}px`;
      c.style.width = `${CREATE.cell}px`;
      c.style.height = `${CREATE.cell}px`;
      c.dataset.cell = String(i);
      c.addEventListener('click', () => {
        this.cells[i] = this.color;
        this.paintMark();
      });
      this.gridEl.appendChild(c);
    }
    this.createEl.appendChild(this.gridEl);

    this.swatchEl = document.createElement('div');
    this.swatchEl.className = 'guild-mark-swatch';
    this.swatchEl.style.left = `${CREATE.swatchX}px`;
    this.swatchEl.style.top = `${CREATE.swatchY}px`;
    this.swatchEl.style.width = `${CREATE.swatchSize}px`;
    this.swatchEl.style.height = `${CREATE.swatchSize}px`;
    this.createEl.appendChild(this.swatchEl);

    this.paletteEl = document.createElement('div');
    this.paletteEl.className = 'guild-mark-palette';
    this.paletteEl.style.left = `${CREATE.paletteX}px`;
    this.paletteEl.style.top = `${CREATE.paletteY}px`;
    this.paletteEl.style.width = `${CREATE.paletteCell * 8}px`;
    this.paletteEl.style.height = `${CREATE.paletteCell * 2}px`;
    for (let i = 0; i < 16; i++) {
      const sw = document.createElement('div');
      sw.className = 'guild-mark-color';
      sw.style.left = `${(i % 8) * CREATE.paletteCell}px`;
      sw.style.top = `${Math.floor(i / 8) * CREATE.paletteCell}px`;
      sw.style.width = `${CREATE.paletteCell - 2}px`;
      sw.style.height = `${CREATE.paletteCell - 2}px`;
      sw.style.background = GUILD_MARK_COLORS[i];
      sw.dataset.color = String(i);
      sw.title = i === 0 ? '橡皮（透明）' : `颜色 ${i}`;
      sw.addEventListener('click', () => {
        this.color = i;
        this.paintMark();
      });
      this.paletteEl.appendChild(sw);
    }
    this.createEl.appendChild(this.paletteEl);

    const h1 = document.createElement('div');
    h1.className = 'npc-text guild-create-hint';
    h1.textContent = TEXT.hintDraw1;
    h1.style.left = `${CREATE.hintX}px`;
    h1.style.top = `${CREATE.hintY - 1}px`;
    this.createEl.appendChild(h1);

    const h2 = document.createElement('div');
    h2.className = 'npc-text guild-create-hint';
    h2.textContent = TEXT.hintDraw2;
    h2.style.left = `${CREATE.hintX}px`;
    h2.style.top = `${CREATE.hintY + 14}px`;
    this.createEl.appendChild(h2);

    this.createOk = document.createElement('button');
    this.createOk.type = 'button';
    this.createOk.className = 'npc-btn npc-btn-wide guild-create-btn';
    this.createOk.textContent = TEXT.ok;
    this.createOk.style.left = `${CREATE.gridX - 34}px`;
    this.createOk.style.top = `${CREATE.btnY}px`;
    this.createOk.addEventListener('click', e => {
      e.stopPropagation();
      const name = this.nameInput.value.trim();
      if (name.length < 2) {
        this.toast('名称至少 2 个字符', 'error');
        return;
      }
      this.onCreate?.(name, this.cells.slice());
    });
    this.createEl.appendChild(this.createOk);

    this.createCancel = document.createElement('button');
    this.createCancel.type = 'button';
    this.createCancel.className = 'npc-btn npc-btn-wide guild-create-btn';
    this.createCancel.textContent = TEXT.cancel;
    this.createCancel.style.left = `${CREATE.gridX + 50}px`;
    this.createCancel.style.top = `${CREATE.btnY}px`;
    this.createCancel.addEventListener('click', e => {
      e.stopPropagation();
      this.closeCreate(true);
    });
    this.createEl.appendChild(this.createCancel);
  }

  private buildRequestBar() {
    const text = document.createElement('div');
    text.className = 'guild-req-text';
    this.reqEl.appendChild(text);

    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'guild-req-btn';
    yes.textContent = TEXT.accept;
    yes.addEventListener('click', e => {
      e.stopPropagation();
      this.answerRequest(true);
    });
    this.reqEl.appendChild(yes);

    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'guild-req-btn';
    no.textContent = TEXT.decline;
    no.addEventListener('click', e => {
      e.stopPropagation();
      this.answerRequest(false);
    });
    this.reqEl.appendChild(no);
  }

  private answerRequest(accept: boolean) {
    const req = this.request;
    if (!req) return;
    this.request = null;
    this.reqEl.classList.add('hidden');
    this.onJoinAnswer?.(accept, req.index);
  }

  private mkBtn(x: number, label: string, fn: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'npc-btn npc-btn-wide guild-btn';
    b.textContent = label;
    b.style.left = `${x}px`;
    b.style.top = `${BTN.y}px`;
    b.style.width = `${BTN.w}px`;
    b.style.height = `${BTN.h}px`;
    b.addEventListener('click', e => {
      e.stopPropagation();
      fn();
    });
    this.btnRow.appendChild(b);
    return b;
  }

  /* ---------------------------------------------------------------- */
  /* 对外                                                              */
  /* ---------------------------------------------------------------- */

  get isOpen() {
    return this.open;
  }

  get isCreating() {
    return this.creating;
  }

  show() {
    this.open = true;
    this.el.classList.remove('hidden');
    void this.ready.then(() => this.paint());
  }

  hide() {
    if (this.creating) this.closeCreate(true);
    this.open = false;
    this.el.classList.add('hidden');
  }

  setSelf(name: string) {
    this.state.self = name;
  }

  /** 0x52 回执。`null` 或 `result = 0` 都当「没有战盟」 */
  setList(list: GuildListReply | null) {
    this.state.list = list && list.result !== 0 && list.members.length > 0 ? list : null;
    this.scroll = 0;
    if (this.open) this.paint();
  }

  get guildName(): string | null {
    return this.myGuildName || null;
  }

  /** 0x5C：服务端下发（自己的那份在登录/入盟时到） */
  setMyGuild(name: string, mark?: Uint8Array) {
    this.myGuildName = name;
    if (mark) this.myMark = mark.slice();
    if (this.open) this.paint();
  }

  get members(): GuildMember[] {
    return this.state.list?.members ?? [];
  }

  /** 0x50：有人申请入盟 */
  showRequest(name: string, index: number) {
    this.request = { name, index };
    const text = this.reqEl.querySelector('.guild-req-text');
    if (text) text.textContent = `${name} 申请加入战盟`;
    this.reqEl.classList.remove('hidden');
  }

  clearRequest() {
    this.request = null;
    this.reqEl.classList.add('hidden');
  }

  get pendingRequest() {
    return this.request;
  }

  openCreate() {
    this.creating = true;
    this.cells = new Array(64).fill(0);
    this.nameInput.value = '';
    this.color = 12;
    this.paintMark();
    this.createEl.classList.remove('hidden');
    this.nameInput.focus();
  }

  closeCreate(notify: boolean) {
    if (!this.creating) return;
    this.creating = false;
    this.createEl.classList.add('hidden');
    if (notify) this.onCreateCancel?.();
  }

  toast(text: string, kind: 'ok' | 'error' | '' = '') {
    this.toastEl.textContent = text;
    this.toastEl.className = `npc-toast ${kind}`.trim();
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.className = 'npc-toast hidden';
    }, 2400);
  }

  scrollBy(delta: number) {
    const total = this.members.length;
    const max = Math.max(0, total - LIST.rows);
    this.scroll = Math.max(0, Math.min(max, this.scroll + delta));
    this.paintList();
  }

  snapshot() {
    return {
      open: this.open,
      creating: this.creating,
      title: this.titleEl.textContent ?? '',
      hasGuild: !!this.state.list,
      count: this.members.length,
      totalScore: this.state.list?.totalScore ?? 0,
      playScore: this.state.list?.playScore ?? 0,
      members: this.members.map(m => `${m.master ? '*' : ''}${m.name}${m.connected ? '' : '(off)'}`),
      request: this.request,
      self: this.state.self,
      mark: this.cells.slice(),
      myGuild: this.myGuildName,
      hasMark: !!this.myMark,
      toast: this.toastEl.textContent ?? '',
    };
  }

  /* ---------------------------------------------------------------- */
  /* 绘制                                                              */
  /* ---------------------------------------------------------------- */

  private onLeaveClick() {
    const list = this.state.list;
    if (!list) return;
    const me = list.members.find(m => m.name === this.state.self);
    this.onDelete?.(me ? me.name : this.state.self);
  }

  private paint() {
    if (!this.open) return;
    const list = this.state.list;

    // 标题：原版有盟是 "GuildName (Score:N)"，没盟是 GlobalText[180]
    if (list) {
      const name = this.myGuildName || '战盟';
      this.titleEl.textContent = `${name} (Score:${list.totalScore})`;
    } else {
      this.titleEl.textContent = TEXT.title;
    }

    this.noGuildEls.forEach(el => el.classList.toggle('hidden', !!list));
    this.noticeEls.forEach(el => (el.textContent = ''));

    this.leaveBtn.textContent = list
      ? list.members.find(m => m.name === this.state.self)?.master
        ? TEXT.disband
        : TEXT.leave
      : TEXT.leave;
    this.leaveBtn.classList.toggle('hidden', !list);
    this.createBtn.classList.toggle('hidden', !!list);

    this.paintList();
  }

  private paintList() {
    this.listEl.textContent = '';
    const list = this.state.list;
    if (!list) return;

    const rows = list.members.slice(this.scroll, this.scroll + LIST.rows);
    rows.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'guild-row' + (m.name === this.state.self ? ' self' : '');
      row.style.top = `${i * LIST.rowH}px`;
      row.style.height = `${LIST.rowH - 2}px`;
      row.title = `${m.name}${m.master ? '（会长）' : ''} · ${m.connected ? TEXT.online : TEXT.offline}`;

      const dot = document.createElement('span');
      dot.className = 'guild-dot' + (m.connected ? ' on' : '');
      row.appendChild(dot);

      const name = document.createElement('span');
      name.className = 'guild-name';
      name.textContent = `${m.master ? '★ ' : ''}${m.name}`;
      row.appendChild(name);

      const st = document.createElement('span');
      st.className = 'guild-state';
      st.textContent = m.connected ? TEXT.online : TEXT.offline;
      row.appendChild(st);

      // 会长右键任何一行（含自己）= 驱逐 / 解散；成员右键自己 = 退盟
      row.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        const me = list.members.find(x => x.name === this.state.self);
        if (!me?.master && m.name !== this.state.self) {
          this.toast('只有会长能驱逐成员', 'error');
          return;
        }
        this.onDelete?.(m.name);
      });
      this.listEl.appendChild(row);
    });

    if (list.members.length > LIST.rows) {
      const more = document.createElement('div');
      more.className = 'guild-more';
      more.style.top = `${LIST.rowH * LIST.rows + 2}px`;
      more.textContent = `${this.scroll + rows.length}/${list.members.length}（滚轮翻页，上限 ${GUILD_MAX_MEMBER}）`;
      this.listEl.appendChild(more);
    }
  }

  private paintMark() {
    for (const cell of Array.from(this.gridEl.children) as HTMLDivElement[]) {
      const i = Number(cell.dataset.cell);
      cell.style.background = GUILD_MARK_COLORS[this.cells[i] ?? 0] ?? 'transparent';
    }
    this.swatchEl.style.background = GUILD_MARK_COLORS[this.color] ?? 'transparent';
    for (const sw of Array.from(this.paletteEl.children) as HTMLDivElement[]) {
      sw.classList.toggle('picked', Number(sw.dataset.color) === this.color);
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
