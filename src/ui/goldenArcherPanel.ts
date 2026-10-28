/**
 * 黄金弓箭手窗口（0x94 / 0x95 / 0x96 / 0x97 / 0x9D）——
 * 照 Win 端 `UI/GoldenArcher.cpp:849-1035` 的**自定义事件流程**
 * （`GA_Custom_Render` / `GA_Custom_Check`，IDA 里这条链是 DLL 补的）。
 *
 * 面板 (450, 0) 190×433，底板 `Item_Back01` + `Item_Back02`。
 * 四种形态由 0x94 的 `Type` 决定：
 *
 *   0 Rena 收集器（洛兰）   登记雷娜 → 按档位兑换物品袋
 *   1 Stone 收集器（诺利亚） 登记宝石 → 3 档 VIP / 第 2 页换幸运号码
 *   2 幸运号码兑换          输入 12 位号码 → 0x9D 领奖
 *   3 号码查看              自己登记过的号码，10 条一页
 *
 * 三处照抄源码、但很容易做错的地方：
 *
 *   - **按钮只在「条件满足」时可点**：`RenderBox(..., enabled)` 里
 *     `enabled == false` 走 `glColor3f(0.4,0.4,0.4)` 且点击直接跳过。
 *     登记按钮的 enabled 是「背包里有对应等级的 469」，
 *     兑换按钮的 enabled 是「服务端记的数量 >= 这一档要求」。
 *   - **Stone 有两页**（`s_TotalPages = 2`）：第 1 页 3 档 VIP、第 2 页换幸运号码。
 *     Rena 虽然没有分页，但服务端同样把它设成 2 页 —— 所以 Rena 面板
 *     **不画翻页条**（`RenderRena` 里没有 `RenderPagination`）。
 *   - **幸运号码是 12 位字母数字**（`GlobalText[907]` 的例子是
 *     `AUS919DKL2J9`），不是纯数字；显示成 `xxxx - xxxx - xxxx`。
 */
import type { UiLayer } from './frame';
import { textSync } from '../data/localText';
import { uiSprite } from './ozj';
import type { GoldenArcherInfo, GoldenArcherOpen } from '../net/game';

const PANEL = { x: 450, y: 0, w: 190, h: 433 };
const CLOSE = { x: 25, y: 395, size: 24 } as const;
const BODY_TOP = 50;

/** 每种形态的副标题（`RenderTitle` 的 `kSub[]`，GlobalText[243..246]） */
const SUBTITLE = ['雷娜收集器', '宝石收集器', '幸运号码兑换', '幸运号码查看'];

/** 说明文字（GlobalText 里的原文，已翻成中文） */
const TEXT = {
  renaIntro: ['登记雷娜之后就会累积。', '在背包里收集雷娜。'],
  renaRegister: '登记雷娜',
  renaCollected: '已收集雷娜',
  renaRegistered: '已登记雷娜',
  renaExchangeHint: '把登记的雷娜兑换成奖励。',
  renaExchange: (n: number) => `兑换雷娜: ${n}`,

  stoneIntro: ['登记宝石之后就会累积。', '在背包里收集宝石。'],
  stoneRegister: '登记宝石',
  stoneCollected: '已收集宝石',
  stoneRegistered: '已登记宝石',
  stoneExchange: (n: number) => `兑换宝石: ${n}`,
  stoneVip: (n: number, h: number, i: number) => `用 ${n} 个宝石换 ${h} 小时 VIP ${i}`,
  stoneLucky: (n: number) => `用 ${n} 个宝石换 1 个幸运号码`,
  stoneLuckyOwned: '这是你的幸运号码',
  stoneRegisterLucky: '登记幸运号码',
  stoneLuckyHint:
    '登记号码之后，可以在德维亚的黄金弓箭手处查看你登记过的所有幸运号码。',

  luckyIntro: [
    '如果你登记过幸运号码',
    '可以在这里查看它们是否有奖励。',
  ],
  luckyEnter: '输入幸运号码',
  luckyExample: '例：AUS919DKL2J9',
  luckyWarn: ['注意区分字母 O 和数字 0，', '以及字母 I 和数字 1。'],

  bingoIntro: ['登记幸运号码', '就能参加 Bingo 活动'],
  bingoHint: '这些是你登记过的幸运号码',

  explain: '说明',
  close: textSync(247, '关闭'),
  registerResult: [
    '幸运号码登记成功',
    '登记幸运号码时出错',
    '你需要先有一个幸运号码',
    '幸运号码不正确',
  ],
  exchangeResult: [
    '恭喜！请领取你的奖励。',
    '这个幸运号码没有奖励。',
    '你没有登记过任何幸运号码。',
    '输入的幸运号码不正确。',
  ],
};

export class GoldenArcherPanel {
  private el: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subEl: HTMLDivElement;
  private bodyEl: HTMLDivElement;
  private closeBtn: HTMLButtonElement;
  private toastEl: HTMLDivElement;

  private open = false;
  /** 0x94 下发的那份状态 */
  private data: GoldenArcherOpen | null = null;
  /** 0x97/0x00 的兑换配置 */
  private info: GoldenArcherInfo = {
    renaRequired: [0, 0, 0, 0],
    stoneRequired: [0, 0, 0],
    stoneVipHours: [0, 0, 0],
    luckyRequired: 0,
  };
  /** 背包里 Rena / Stone 各有几件（决定登记按钮能不能点） */
  private collected = { rena: 0, stone: 0 };
  /** 0x97/0x01 登记过的号码 */
  private luckyNumbers: string[] = [];
  /** Stone 第 2 页 / Bingo 翻页 */
  private page = 1;
  private totalPages = 1;

  private boxUrl = '';
  private toastTimer = 0;

  onRegister: ((type: number) => void) | null = null;
  onExchange: ((type: number, index: number) => void) | null = null;
  onRegisterLucky: ((number: string) => void) | null = null;
  onExchangeLucky: ((number: string) => void) | null = null;
  onExplain: (() => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(layer: UiLayer) {
    this.el = document.createElement('div');
    this.el.className = 'ga-panel hidden';
    this.el.style.left = `${PANEL.x}px`;
    this.el.style.top = `${PANEL.y}px`;
    this.el.style.width = `${PANEL.w}px`;
    this.el.style.height = `${PANEL.h}px`;
    layer.add(this.el);
    this.el.addEventListener('contextmenu', e => e.preventDefault());

    this.buildPlate('item_back01', 0, 0, 190, 256);
    this.buildPlate('item_back02', 0, 256, 190, 177);

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'ga-title';
    this.titleEl.style.left = '35px';
    this.titleEl.style.top = '11px';
    this.titleEl.textContent = '黄金弓箭手';

    this.subEl = document.createElement('div');
    this.subEl.className = 'ga-subtitle';
    this.subEl.style.left = '22px';
    this.subEl.style.top = '21px';

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'ga-body';

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'ga-toast hidden';

    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'ga-icon-btn ga-close';
    this.closeBtn.style.left = `${CLOSE.x}px`;
    this.closeBtn.style.top = `${CLOSE.y}px`;
    this.closeBtn.style.width = `${CLOSE.size}px`;
    this.closeBtn.style.height = `${CLOSE.size}px`;
    this.closeBtn.title = TEXT.close;
    const ci = document.createElement('img');
    ci.draggable = false;
    this.closeBtn.appendChild(ci);
    void this.loadIcon(ci, 'exit_01');
    this.closeBtn.addEventListener('click', () => this.onClose?.());

    this.el.append(this.titleEl, this.subEl, this.bodyEl, this.toastEl, this.closeBtn);

    // 按钮底图是贴图 240 = Interface/Message_box（`RenderBox` 里的 GL_DrawTexture(240, ...)）
    void uiSprite('message_box').then(s => {
      if (!s) return;
      this.boxUrl = s.url;
      if (this.open) this.paint();
    });
  }

  private buildPlate(key: string, x: number, y: number, w: number, h: number) {
    const img = document.createElement('img');
    img.className = 'ga-plate';
    img.draggable = false;
    img.style.left = `${x}px`;
    img.style.top = `${y}px`;
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    this.el.appendChild(img);
    void this.loadIcon(img, key);
  }

  private async loadIcon(img: HTMLImageElement, key: string) {
    const spr = await uiSprite(key);
    if (!spr) return;
    img.src = spr.url;
    img.style.imageRendering = 'pixelated';
  }

  /* ------------------------------------------------------------------ */

  get isOpen() {
    return this.open;
  }

  get type(): number {
    return this.data?.type ?? -1;
  }

  show(data: GoldenArcherOpen) {
    this.data = data;
    this.page = 1;
    this.pendingInput = '';
    this.open = true;
    this.el.classList.remove('hidden');
    // 服务端给的 `s_TotalPages`：Stone 固定两页，Bingo 按 10 条一页
    this.totalPages = data.type === 1 ? 2 : 1;
    this.paint();
  }

  hide() {
    this.open = false;
    this.el.classList.add('hidden');
    this.hideToast();
  }

  setInfo(info: GoldenArcherInfo) {
    this.info = info;
    if (this.open) this.paint();
  }

  setCount(count: number) {
    if (this.data) this.data.count = count;
    if (this.open) this.paint();
  }

  setLucky(lucky: string) {
    if (this.data) this.data.lucky = lucky;
    if (this.open) this.paint();
  }

  /** 背包里 Rena / Stone 的件数（登记按钮的可点条件） */
  setCollected(rena: number, stone: number) {
    if (rena === this.collected.rena && stone === this.collected.stone) return;
    this.collected = { rena, stone };
    /*
     * 只在「收集器」形态重绘。幸运号码那一页有 `<input>`，
     * 帧循环里一重绘就会把它重建掉 —— 玩家正打字时光标会消失。
     */
    if (this.open && (this.data?.type === 0 || this.data?.type === 1)) this.paint();
  }

  /** 0x97/0x01：登记过的号码 */
  setLuckyNumbers(list: string[]) {
    this.luckyNumbers = list;
    this.totalPages = Math.max(1, Math.floor(list.length / 10) + 1);
    this.page = 1;
    if (this.open) this.paint();
  }

  /** 切到「号码查看」形态（收到 0x97/0x01 时服务端就是这么切的） */
  showList() {
    this.data = { type: 3, count: 0, lucky: this.data?.lucky ?? '' };
    this.open = true;
    this.el.classList.remove('hidden');
    this.totalPages = Math.max(1, Math.floor(this.luckyNumbers.length / 10) + 1);
    this.page = 1;
    this.paint();
  }

  toast(text: string, kind: 'ok' | 'error' = 'ok') {
    this.toastEl.textContent = text;
    this.toastEl.className = `ga-toast ${kind}`;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.hideToast(), 2600);
  }

  private hideToast() {
    this.toastEl.className = 'ga-toast hidden';
  }

  /* ------------------------------------------------------------------ */
  /* 绘制                                                                */
  /* ------------------------------------------------------------------ */

  private paint() {
    if (!this.open || !this.data) return;
    this.subEl.textContent = SUBTITLE[this.data.type] ?? '';
    this.bodyEl.textContent = '';
    switch (this.data.type) {
      case 0:
        this.paintRena();
        break;
      case 1:
        this.paintStone();
        break;
      case 2:
        this.paintLucky();
        break;
      default:
        this.paintBingo();
        break;
    }
    this.bodyEl.appendChild(this.toastEl);
  }

  /** 一行说明文字（原版 `TextC(x, y, ..., 190)`，x 就是面板左边） */
  private line(x: number, y: number, text: string, cls = 'ga-line') {
    const div = document.createElement('div');
    div.className = cls;
    div.style.left = `${x}px`;
    div.style.top = `${y - 1}px`;
    div.textContent = text;
    this.bodyEl.appendChild(div);
    return div;
  }

  /** 一条 190 宽的分隔线（原版 `GL_DrawTexture(279, x, y, 190, 10, ...)`） */
  private divider(y: number) {
    const div = document.createElement('div');
    div.className = 'ga-divider';
    div.style.left = '0px';
    div.style.top = `${y}px`;
    this.bodyEl.appendChild(div);
  }

  /**
   * 按钮。`enabled == false` 时整体灰掉且点击无反应 ——
   * 对应 `RenderBox(..., hoverable=false)` 的 `glColor3f(0.4,0.4,0.4)`。
   */
  private box(
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    enabled: boolean,
    onClick: () => void
  ) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `ga-box${enabled ? '' : ' off'}`;
    btn.style.left = `${x}px`;
    btn.style.top = `${y}px`;
    btn.style.width = `${w}px`;
    btn.style.height = `${h}px`;
    if (this.boxUrl) btn.style.backgroundImage = `url("${this.boxUrl}")`;
    btn.textContent = text;
    btn.disabled = !enabled;
    /*
     * 监听器**永远挂上**，能不能点由 `disabled` 决定。
     *
     * 一开始写成 `if (enabled) addEventListener(...)`，结果输入框那页的
     * 「输入幸运号码」按钮是**先灰后亮**（打字才点亮）—— 创建时没有监听器，
     * 点亮之后点它什么都不发生。`disabled` 的按钮在浏览器里本来就不派发
     * click，所以这个判断放在这里永远不会误触发。
     */
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (btn.disabled) return;
      onClick();
    });
    this.bodyEl.appendChild(btn);
    return btn;
  }

  /** 「已收集 / 已登记」两块 75×21 的框 + 下面的两个数字（`RenderCollectedRegistered`） */
  private countRow(y: number, leftLabel: string, rightLabel: string, left: number, right: number) {
    this.box(13, y - 10, 75, 21, leftLabel, false, () => {});
    this.box(102, y - 10, 75, 21, rightLabel, false, () => {});
    const a = this.line(54, y + 20, String(left), 'ga-num');
    a.style.left = '54px';
    const b = this.line(142, y + 20, String(right), 'ga-num gold');
    b.style.left = '142px';
  }

  /** 自动折行（原版 `DrawSeparatedLines`：7 行、每行 38 字节） */
  private wrapped(x: number, y: number, text: string, step = 15) {
    let cur = y;
    for (const seg of wrapText(text, 13) ) {
      this.line(x, cur, seg);
      cur += step;
    }
    return cur;
  }

  private paintRena() {
    const d = this.data!;
    let y = BODY_TOP;
    for (const t of TEXT.renaIntro) {
      this.line(0, y, t);
      y += 15;
    }
    this.box(35, y, 120, 22, TEXT.explain, true, () => this.onExplain?.());
    y += 45;
    this.countRow(y, TEXT.renaCollected, TEXT.renaRegistered, this.collected.rena, d.count);
    y += 25 + 15;
    this.box(35, y, 120, 22, TEXT.renaRegister, this.collected.rena > 0, () =>
      this.onRegister?.(0)
    );
    y += 30;
    this.divider(y);
    y += 20;
    y = this.wrapped(0, y, TEXT.renaExchangeHint);
    y += 5;
    for (let i = 0; i < 4; i++) {
      const need = this.info.renaRequired[i] ?? 0;
      if (need <= 0) continue;
      this.box(35, y, 120, 22, TEXT.renaExchange(need), d.count >= need, () =>
        this.onExchange?.(0, i)
      );
      y += 30;
    }
  }

  private paintStone() {
    const d = this.data!;
    let y = BODY_TOP;
    for (const t of TEXT.stoneIntro) {
      this.line(0, y, t);
      y += 15;
    }
    this.box(35, y, 120, 22, TEXT.explain, true, () => this.onExplain?.());
    y += 45;
    this.countRow(y, TEXT.stoneCollected, TEXT.stoneRegistered, this.collected.stone, d.count);
    y += 25 + 15;
    this.box(35, y, 120, 22, TEXT.stoneRegister, this.collected.stone > 0, () =>
      this.onRegister?.(1)
    );
    y += 30;
    this.divider(y);
    y += 20;

    if (this.page === 1) {
      for (let i = 0; i < 3; i++) {
        const need = this.info.stoneRequired[i] ?? 0;
        if (need <= 0) continue;
        const hours = this.info.stoneVipHours[i] ?? 0;
        this.line(0, y, TEXT.stoneVip(need, hours, i + 1));
        y += 10;
        this.box(35, y, 120, 22, TEXT.stoneExchange(need), d.count >= need, () =>
          this.onExchange?.(1, i)
        );
        y += 35;
      }
    } else if (this.info.luckyRequired > 0) {
      const need = this.info.luckyRequired;
      if (!d.lucky) {
        this.line(0, y, TEXT.stoneLucky(need));
        y += 10;
        this.box(35, y, 120, 22, TEXT.stoneExchange(need), d.count >= need, () =>
          this.onExchange?.(1, 3)
        );
        y += 40;
        this.wrapped(0, y, TEXT.stoneLuckyHint);
      } else {
        this.line(0, y, TEXT.stoneLuckyOwned);
        y += 10;
        this.line(0, y, formatLucky(d.lucky), 'ga-lucky');
        y += 30;
        this.box(35, y, 120, 22, TEXT.stoneRegisterLucky, true, () =>
          this.onRegisterLucky?.(d.lucky)
        );
        y += 40;
        this.wrapped(0, y, TEXT.stoneLuckyHint);
      }
    }
    if (this.totalPages > 1) this.pagination();
  }

  private paintLucky() {
    const d = this.data!;
    let y = BODY_TOP;
    for (const t of TEXT.luckyIntro) {
      this.line(0, y, t);
      y += 15;
    }
    this.box(35, y, 120, 22, TEXT.explain, true, () => this.onExplain?.());
    y += 30;
    this.divider(y);
    y += 20;
    this.line(0, y, TEXT.luckyEnter);
    y += 15;
    this.line(0, y, TEXT.luckyExample, 'ga-gold');
    y += 15;
    for (const t of TEXT.luckyWarn) {
      this.line(0, y, t);
      y += 15;
    }
    y += 5;

    // 输入框：原版是贴图 271（Item_Money 条）120×18 + RenderInputText
    const input = document.createElement('input');
    input.className = 'ga-input';
    input.type = 'text';
    input.maxLength = 12;
    input.spellcheck = false;
    input.style.left = '35px';
    input.style.top = `${y}px`;
    input.style.width = '120px';
    input.style.height = '18px';
    input.value = this.pendingInput;
    input.addEventListener('input', () => {
      this.pendingInput = input.value.toUpperCase();
      input.value = this.pendingInput;
      confirm.disabled = this.pendingInput.length === 0;
      confirm.classList.toggle('off', confirm.disabled);
    });
    input.addEventListener('keydown', e => {
      // 输入框里的回车 = 点确认；不拦住会一路冒到聊天框把字发出去
      if (e.key === 'Enter' && this.pendingInput) {
        e.preventDefault();
        e.stopPropagation();
        this.onExchangeLucky?.(this.pendingInput);
      }
      e.stopPropagation();
    });
    this.bodyEl.appendChild(input);
    y += 30;

    const confirm = this.box(35, y, 120, 22, TEXT.luckyEnter, this.pendingInput.length > 0, () =>
      this.onExchangeLucky?.(this.pendingInput)
    );
    void d;
  }

  private paintBingo() {
    let y = BODY_TOP;
    for (const t of TEXT.bingoIntro) {
      this.line(0, y, t);
      y += 15;
    }
    this.box(35, y, 120, 22, TEXT.explain, true, () => this.onExplain?.());
    y += 30;
    this.divider(y);

    if (!this.luckyNumbers.length) {
      this.wrapped(0, 216, TEXT.stoneLuckyHint);
      return;
    }
    y += 20;
    this.line(0, y, TEXT.bingoHint);
    y += 20;

    const first = (this.page - 1) * 10;
    for (let i = first; i < this.luckyNumbers.length && i < first + 10; i++) {
      const div = document.createElement('div');
      div.className = `ga-bingo-row${(i - first) % 2 ? ' odd' : ''}`;
      div.style.left = '13px';
      div.style.top = `${y}px`;
      div.textContent = formatLucky(this.luckyNumbers[i]);
      this.bodyEl.appendChild(div);
      y += 20;
    }
    if (this.totalPages > 1) this.pagination();
  }

  /** 翻页条：`当前/总数` + 两个 19×19 箭头（原版 y=375） */
  private pagination() {
    const y = 375;
    const label = document.createElement('div');
    label.className = 'ga-page';
    label.style.top = `${y + 4}px`;
    label.textContent = `${this.page}/${this.totalPages}`;
    this.bodyEl.appendChild(label);

    const mk = (left: number, text: string, dir: number, enabled: boolean) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ga-arrow${enabled ? '' : ' off'}`;
      b.style.left = `${left}px`;
      b.style.top = `${y}px`;
      b.textContent = text;
      b.disabled = !enabled;
      if (enabled)
        b.addEventListener('click', e => {
          e.stopPropagation();
          this.page = Math.max(1, Math.min(this.totalPages, this.page + dir));
          this.paint();
        });
      this.bodyEl.appendChild(b);
    };
    mk(55, '‹', -1, this.page > 1);
    mk(116, '›', 1, this.page < this.totalPages);
  }

  /** 输入框里的内容（切页 / 重绘时保留） */
  private pendingInput = '';

  /** 探针快照 */
  snapshot() {
    return {
      open: this.open,
      type: this.data?.type ?? -1,
      count: this.data?.count ?? 0,
      lucky: this.data?.lucky ?? '',
      info: this.info,
      collected: { ...this.collected },
      page: this.page,
      totalPages: this.totalPages,
      numbers: this.luckyNumbers.slice(),
      buttons: Array.from(this.bodyEl.querySelectorAll<HTMLElement>('.ga-box')).map(b => ({
        text: (b.textContent ?? '').trim(),
        off: b.classList.contains('off'),
        left: b.style.left,
        top: b.style.top,
        w: b.offsetWidth,
        h: b.offsetHeight,
      })),
      subtitle: this.subEl.textContent,
      rect: { x: PANEL.x, y: PANEL.y, w: PANEL.w, h: PANEL.h },
    };
  }
}

/** `xxxx - xxxx - xxxx`（原版 `sprintf_s("%c%c%c%c - %c%c%c%c - %c%c%c%c")`） */
export function formatLucky(n: string) {
  const s = (n ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (s.length < 12) return s;
  return `${s.slice(0, 4)} - ${s.slice(4, 8)} - ${s.slice(8, 12)}`;
}

/** 按 13 个全角字宽折行（`SeparateTextIntoLines(text, 38)` 的近似） */
function wrapText(text: string, perLine: number): string[] {
  const out: string[] = [];
  let s = text;
  while (s.length > perLine) {
    out.push(s.slice(0, perLine));
    s = s.slice(perLine);
  }
  if (s) out.push(s);
  return out;
}
