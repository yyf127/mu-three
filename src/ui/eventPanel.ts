/**
 * 事件入场窗口（恶魔广场 / 血色城堡）。
 *
 * 逐像素照 Win 端 `RenderEventWindow`（`HUD_Pass6.cpp:1791`，IDA 0x004F3C50），
 * 点击判定照 `SecondPassword.cpp:917-1005`（`sub_4E6C40`）。
 *
 * 版式（相对面板原点 260,0）：
 *
 *   底板      Item_Back01 190×256 + Item_Back02 190×177   （`RenderInventoryInterface`）
 *   标题      (35, 12)  `GlobalText[846]` 血堡 / `[39]` 恶魔广场
 *   档位行    x=25 宽 140，底图是贴图 240 = `Message_box`
 *             血堡    y0=170  stride 40  高 33  共 6 行
 *             恶魔广场 y0=210  stride 45  高 35  共 4 行
 *   说明文字  血堡 `GlobalText[832]` 每行 26 字，从 (30,64) 起每行 20
 *             恶魔广场 `GlobalText[670..675]`，从 (30,80) 起每行 20
 *   关闭      (25, 395) 24×24
 *
 * 两个不对称的地方，原版就是这样的：
 *
 *   1. **只有血色城堡会灰掉等级不够的行**（`glColor3f(0.4,0.4,0.5)` 且点击
 *      直接 continue）；恶魔广场四行永远可点，超范围由服务端回 0x90 result=3/4
 *      再弹提示。
 *   2. **血色城堡多一套「魔剑士」等级表**：0x8F 的 6 行 × 4 个 int 里，前两个
 *      是普通职业 min/max，后两个是魔剑士的；客户端按 `Hero[444] & 7 == 3`
 *      选第二组（偏移 +6 行）。本 port 用 `isMagicGladiator` 显式传进来。
 */

import { UiLayer } from './frame';
import { textSync } from '../data/localText';
import { preloadUi, uiSprite } from './ozj';

/** 面板原点（`dword_7EAA0C8/CC` = 260 / 0） */
const PANEL = { x: 260, y: 0, w: 190, h: 433 };
const TITLE = { x: 35, y: 11 };

/** 档位行几何（`RenderEventWindow` 里的 x / y / stride / height / count） */
const ROWS = {
  // `textW` 的上限是「行宽 140 - textX」：再宽就会被按钮自己的 overflow 裁掉
  ds: { x: 25, y: 210, stride: 45, h: 35, count: 4, textX: 10, textW: 128 },
  bc: { x: 25, y: 170, stride: 40, h: 33, count: 6, textX: 8, textW: 130 },
} as const;

/** 说明文字起点 */
const BODY = {
  ds: { x: 30, y: 80, lineHeight: 20, lines: 6 },
  bc: { x: 30, y: 64, lineHeight: 20, charsPerLine: 26, maxLines: 7 },
} as const;

/** 关闭按钮（原版 `RenderInventoryInterface` 画的 exit，本 port 显式给一个） */
const CLOSE = { x: 25, y: 395, size: 24 };

const SPRITES = ['Item_Back01', 'Item_Back02', 'Message_box', 'exit_01', 'exit_02'];

/**
 * 文案（`Data/Local/Text.bmd`，索引写在注释里）。
 *
 * **不能照抄英文原文的 `%d` 顺序**：中文/英文都只有三个占位时，
 * `Square %d (%d - %d level)` 依次是「第几档 / 下限 / 上限」。
 */
const TEXT = {
  dsTitle: 'Devil Square', // [39]
  bcTitle: 'Messenger of Archangel', // [846]
  // [645] `Square %d (%d - %d level)`  [646] `Square %d (over level %d)`
  dsRow: (n: number, min: number, max: number) => `Square ${n} (${min} - ${max} level)`,
  dsRowOver: (n: number, min: number) => `Square ${n} (over level ${min})`,
  // [847] `Castle %d (level %d-%d)`   [848] `Castle %d (over level %d)`
  bcRow: (n: number, min: number, max: number) => `Castle ${n} (level ${min}-${max})`,
  bcRowOver: (n: number, min: number) => `Castle ${n} (over level ${min})`,
  /** [670..675] 恶魔广场的六行说明 */
  dsBody: [
    "You've been given a chance to prove your bravery.",
    'No one has ever entered the Devil Square yet.',
    'No human has ever gone there.',
    'Do not believe anything you see in there.',
    'Only trust your bravery and strength',
    'Only your bravery and strength will keep you alive.',
  ],
  /** [832] 血色城堡的说明（原版按 26 字/行切 7 行） */
  bcBody:
    'Your will to help the Archangel is appreciated. But be careful, young warrior for Blood Castle is a dangerous place. May God be with you.',
};

export type EventKind = 'ds' | 'bc';

export interface EventRow {
  /** 第几档：恶魔广场 0-based，血堡 1-based（发给服务端的原值） */
  level: number;
  min: number;
  max: number;
  /** 血堡专用：本档是否允许当前角色进入（决定灰不灰、可不可点） */
  allowed: boolean;
  /** 对应的票在背包里的绝对槽位，-1 = 没有 */
  slot: number;
}

export class EventPanel {
  readonly el: HTMLDivElement;

  private titleEl!: HTMLDivElement;
  private bodyEl!: HTMLDivElement;
  private rowsEl!: HTMLDivElement;
  private closeBtn!: HTMLButtonElement;
  private toastEl!: HTMLDivElement;

  private open = false;
  private kind: EventKind = 'ds';
  private rows: EventRow[] = [];
  private toastTimer = 0;
  private ready: Promise<void>;

  /** 点了某一档（参数是 `level`，语义见 `EventRow.level`） */
  onPick: ((level: number) => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(layer: UiLayer) {
    this.el = document.createElement('div');
    this.el.className = 'npc-panel event-panel hidden';
    this.el.style.left = `${PANEL.x}px`;
    this.el.style.top = `${PANEL.y}px`;
    this.el.style.width = `${PANEL.w}px`;
    this.el.style.height = `${PANEL.h}px`;
    layer.add(this.el);
    this.el.addEventListener('contextmenu', e => e.preventDefault());

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'npc-title event-title';
    this.titleEl.style.left = `${TITLE.x}px`;
    this.titleEl.style.top = `${TITLE.y}px`;
    this.el.appendChild(this.titleEl);

    this.rowsEl = document.createElement('div');
    this.rowsEl.className = 'event-rows';
    this.el.appendChild(this.rowsEl);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'event-body';
    this.el.appendChild(this.bodyEl);

    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'npc-btn event-close';
    this.closeBtn.style.left = `${CLOSE.x}px`;
    this.closeBtn.style.top = `${CLOSE.y}px`;
    this.closeBtn.style.width = `${CLOSE.size}px`;
    this.closeBtn.style.height = `${CLOSE.size}px`;
    this.closeBtn.title = textSync(247, '关闭');
    this.closeBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.onClose?.();
    });
    this.el.appendChild(this.closeBtn);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'npc-toast hidden';
    this.el.appendChild(this.toastEl);

    this.ready = this.build();
  }

  get isOpen() {
    return this.open;
  }

  get eventKind() {
    return this.kind;
  }

  private async build() {
    await preloadUi(SPRITES);
    const [back1, back2, box, ex1, ex2] = await Promise.all([
      uiSprite('Item_Back01'),
      uiSprite('Item_Back02'),
      uiSprite('Message_box'),
      uiSprite('exit_01'),
      uiSprite('exit_02'),
    ]);

    if (back1) this.el.appendChild(makePlate(back1.url, 0, 0, 190, 256));
    if (back2) this.el.appendChild(makePlate(back2.url, 0, 256, 190, 177));

    // 档位行的底图：贴图索引 240 = `Interface/Message_box.jpg`
    // （`Scene_AssetLoad.cpp:34` `OpenJPG("Interface/Message_box.jpg", 0xf0, …)`）
    this.boxUrl = box?.url ?? null;

    if (ex1) {
      const img = document.createElement('img');
      img.src = ex1.url;
      img.draggable = false;
      img.style.imageRendering = 'pixelated';
      img.style.width = '100%';
      img.style.height = '100%';
      this.closeBtn.appendChild(img);
      if (ex2) {
        this.closeBtn.addEventListener('mouseenter', () => (img.src = ex2.url));
        this.closeBtn.addEventListener('mouseleave', () => (img.src = ex1.url));
      }
    }
  }

  private boxUrl: string | null = null;

  /**
   * 打开窗口。
   *
   * `title` 由调用方给（血堡 / 恶魔广场），`ranges` 是 0x8E/0x8F 解出来的表。
   * `slots` 是「每档对应的票的背包槽位」，长度不足的补 -1。
   */
  show(opts: {
    kind: EventKind;
    ranges: { min: number; max: number }[];
    slots?: number[];
    /** 当前角色等级（算 allowed 用；血堡才用得上） */
    charLevel?: number;
    /** 魔剑士：血堡用第二组等级表（偏移 +6 行） */
    magicGladiator?: boolean;
  }) {
    this.kind = opts.kind;
    const geo = ROWS[opts.kind];
    const ranges = opts.ranges.slice();
    const mgOffset = opts.kind === 'bc' && opts.magicGladiator ? 6 : 0;

    this.rows = [];
    for (let i = 0; i < geo.count; i++) {
      const range = ranges[i + mgOffset] ?? { min: 0, max: 0 };
      const level = opts.kind === 'ds' ? i : i + 1;
      const lv = opts.charLevel ?? 0;
      this.rows.push({
        level,
        min: range.min,
        max: range.max,
        // 血堡：等级在档内才可点；恶魔广场一律可点（原版如此）
        allowed: opts.kind === 'bc' ? lv >= range.min && lv <= range.max : true,
        slot: opts.slots?.[i] ?? -1,
      });
    }

    this.titleEl.textContent = opts.kind === 'bc' ? TEXT.bcTitle : TEXT.dsTitle;
    this.paintRows();
    this.paintBody();
    this.el.classList.remove('hidden');
    this.open = true;
    void this.ready;
  }

  /**
   * 点某一档。
   *
   * **灰行的判断必须在这里**，不能只写在按钮的 click 里 ——
   * 否则任何走 `onPick` 的其它入口（调试口、键盘）都能绕过它，
   * 把「等级不够的那一档」直接发给服务端。
   *
   * 返回 true = 已经把事交给上层（是否真能进由服务端决定）；
   * false = 本地就挡下来了。
   */
  pick(level: number): boolean {
    const row = this.rows.find(r => r.level === level);
    if (!row) return false;
    if (this.kind === 'bc' && !row.allowed) {
      this.toast('等级不在这一档的范围内', 'error');
      return false;
    }
    this.onPick?.(level);
    return true;
  }

  /** 只换档位数据（比如票进/出背包后重画） */
  setRows(rows: EventRow[]) {
    this.rows = rows.slice();
    this.paintRows();
  }

  hide() {
    this.el.classList.add('hidden');
    this.open = false;
    window.clearTimeout(this.toastTimer);
    this.toastEl.classList.add('hidden');
  }

  toast(text: string, tone: 'ok' | 'error' = 'ok') {
    this.toastEl.textContent = text;
    this.toastEl.className = `npc-toast ${tone === 'error' ? 'npc-toast-error' : 'npc-toast-ok'}`;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('hidden'), 2200);
  }

  private paintRows() {
    this.rowsEl.textContent = '';
    const geo = ROWS[this.kind];

    this.rows.forEach((row, i) => {
      const y = geo.y + i * geo.stride;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'event-row';
      btn.dataset.level = String(row.level);
      btn.style.left = `${geo.x}px`;
      btn.style.top = `${y}px`;
      btn.style.width = '140px';
      btn.style.height = `${geo.h}px`;
      btn.classList.add(this.kind === 'bc' ? 'event-row-bc' : 'event-row-ds');
      // 灰掉 = 不可点（原版 `if (!permitted) glColor3f(0.4,0.4,0.5)` + `continue`）
      if (this.kind === 'bc' && !row.allowed) btn.classList.add('event-row-off');

      if (this.boxUrl) {
        const img = makePlate(this.boxUrl, 0, 0, 140, geo.h);
        img.className = 'event-row-bg';
        btn.appendChild(img);
      }

      const label = document.createElement('span');
      label.className = 'event-row-text';
      label.style.left = `${geo.textX}px`;
      label.style.width = `${geo.textW}px`;
      // `max <= 10000` 才算「有上限」（原版 `withMax`）
      const withMax = row.max <= 10000;
      if (this.kind === 'bc') {
        label.textContent = withMax
          ? TEXT.bcRow(row.level, row.min, row.max)
          : TEXT.bcRowOver(row.level, row.min);
      } else {
        label.textContent = withMax
          ? TEXT.dsRow(row.level + 1, row.min, row.max)
          : TEXT.dsRowOver(row.level + 1, row.min);
      }
      btn.appendChild(label);

      btn.addEventListener('click', e => {
        e.stopPropagation();
        this.pick(row.level);
      });

      this.rowsEl.appendChild(btn);
    });
  }

  private paintBody() {
    this.bodyEl.textContent = '';
    if (this.kind === 'ds') {
      TEXT.dsBody.forEach((line, i) => {
        const d = document.createElement('div');
        d.className = 'event-body-line';
        d.style.left = `${BODY.ds.x}px`;
        d.style.top = `${BODY.ds.y + i * BODY.ds.lineHeight}px`;
        d.textContent = line;
        this.bodyEl.appendChild(d);
      });
      return;
    }

    // 血堡：`SeparateTextIntoLines(GlobalText[832], lines, 7, 26)` —— 按词切
    const lines = wrapWords(TEXT.bcBody, BODY.bc.charsPerLine, BODY.bc.maxLines);
    lines.forEach((line, i) => {
      const d = document.createElement('div');
      d.className = 'event-body-line';
      d.style.left = `${BODY.bc.x}px`;
      d.style.top = `${BODY.bc.y + i * BODY.bc.lineHeight}px`;
      d.textContent = line;
      this.bodyEl.appendChild(d);
    });
  }

  /** 探针用快照 */
  snapshot() {
    return {
      open: this.open,
      kind: this.kind,
      title: this.titleEl.textContent ?? '',
      rows: this.rows.map(r => ({ ...r })),
      bodyLines: Array.from(this.bodyEl.children).map(e => (e.textContent ?? '').slice(0, 40)),
    };
  }
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function makePlate(url: string, x: number, y: number, w: number, h: number): HTMLImageElement {
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

/** `SeparateTextIntoLines` 的等价物：按空格切词，超宽就换行，最多 `maxLines` 行 */
function wrapWords(text: string, charsPerLine: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= charsPerLine) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = w;
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.slice(0, maxLines);
}
