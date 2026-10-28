/**
 * 聊天框 —— `Render_ChatBox_`（`HUD_Pass2.cpp:222`）+ `ChatLB_renderLine`
 * （`UI/ChatListBox.cpp:1205`）+ `ReceiveChat`（`Net/Net_LegacyRuntime.cpp:189`）。
 *
 * 版面全部来自源码硬编码，不是自己摆的：
 *
 *   输入框底板  `GL_DrawTexture(248, 186, 415, 134, 29)` → `Dialogue1.ozj`（133×29）
 *               `GL_DrawTexture(249, 320, 415, 134, 29)` → `Dialogue2.ozj`
 *               左格 = 聊天输入，右格 = 密语对象
 *   输入文字    `RenderInputText(191, 422, 0)` / `(376, 422, 1)`
 *   消息行      `x = self[11] + 10 = 196`
 *               `y = self[12] - 13*row - 16 = 404 - 13*row`   （row 0 = 最新）
 *   可见行数    `obj[35] = 6`，行高 `obj[39] = 13.0f`
 *   面板位置    `ChatListBox_Construct`: `obj[11] = 186; obj[12] = 420`
 *
 * 频道颜色（`ChatLB_renderLine` 的两张调色板，ABGR）：
 *
 *   0 chat   黑字 / 金底 0x9632C8FF
 *   1 system 0xFFFF9664 → #6496FF
 *   2 GM     0xFF001EFF → #FF1E00
 *   3 普通   发送者 #EFDCCD、正文 #C8DCE6（`ReceiveChat` 的 default 分支用 3）
 *   4 party  黑字 / #00C8FF 底（'~' 前缀）
 *   5 guild  黑字 / #96FF00 底（'@' 前缀）
 *
 * 收包格式（`ReceiveChat`）：`C1 | size | 00 | name[10] | msg…`，`msg[0]` 是
 * 频道前缀 —— '~' 队伍、'@' 战盟、'#' 只出头上的气泡，其余按普通聊天（正文
 * 从 `msg[0]` 开始，不减一）。
 */
import { uiSprite, preloadUi } from './ozj';
import { UiLayer, spriteBox } from './frame';

/**
 * 版面常量。
 *
 * 输入条（`chat-panels` + 输入框）**保持原版位置不动**：
 *   Dialogue1 在 (186,415)，Dialogue2 在 (320,415)，都是 134×29
 *   输入文字左上角 (191,422)
 *
 * 只有**消息行**（`.chat-log` 里那六行）挪了：原版 x=196 / 最新一行 y=404，
 * 这个位置会压住底栏左侧装饰角（`bar-corner` 从逻辑 y=387 起）。
 * 现在贴左边、并整体抬到底栏上沿之上：
 *
 *   行 0（最新）顶部 y = 372（底部 385，底栏 387 起，留 2px）
 *   往上每行 13px → 372/359/346/333/320/307
 */
const BOX = { x: 186, y: 420 };
const LINE_X = 10;
const LINE_H = 13;
const LINE_BASE = 372;
const ROWS = 6;
const PANEL = { y: 415, w: 134, h: 29 };
const PANEL_L = { x: 186 };
const PANEL_R = { x: 320 };
const INPUT_TEXT = { x: 191, y: 422 };

const SPRITES = ['Dialogue1', 'Dialogue2'];

export type ChatChannel = 0 | 1 | 2 | 3 | 4 | 5;

interface ChatLine {
  name: string;
  text: string;
  channel: ChatChannel;
}

/** 频道 → 配色（ABGR 拆成 CSS） */
const CHANNEL_STYLE: Record<ChatChannel, { fg: string; bg: string; nameFg: string }> = {
  0: { fg: '#000000', bg: 'rgba(255, 200, 50, .59)', nameFg: '#000000' },
  1: { fg: '#6496ff', bg: '', nameFg: '#6496ff' },
  2: { fg: '#ff1e00', bg: '', nameFg: '#ff1e00' },
  3: { fg: '#c8dce6', bg: '', nameFg: '#efdccd' },
  4: { fg: '#000000', bg: 'rgba(0, 200, 255, .59)', nameFg: '#000000' },
  5: { fg: '#000000', bg: 'rgba(150, 255, 0, .78)', nameFg: '#000000' },
};

/** 命令行历史条数（上下键翻） */
const HISTORY_MAX = 20;
/** 日志上限，超出丢最旧的 */
const LOG_MAX = 60;

export class ChatBox {
  private layer: HTMLDivElement;
  private logEl: HTMLDivElement;
  private lineEls: HTMLDivElement[] = [];

  private panelLeft!: HTMLImageElement;
  private panelRight!: HTMLImageElement;
  private panelWrap: HTMLDivElement;

  private inputEl: HTMLInputElement;
  private typing = false;

  private lines: ChatLine[] = [];
  private history: string[] = [];
  private historyAt = -1;

  /** 提交一条（Enter）：调用方负责真正发包 */
  onSend: ((text: string) => void) | null = null;

  constructor(private ui: UiLayer) {
    this.layer = document.createElement('div');
    this.layer.className = 'chat-layer';
    ui.add(this.layer);

    // 消息行容器（6 行常驻元素，滚动时只改文字，不重建 DOM）
    this.logEl = document.createElement('div');
    this.logEl.className = 'chat-log';
    this.layer.appendChild(this.logEl);
    for (let i = 0; i < ROWS; i++) {
      const row = document.createElement('div');
      row.className = 'chat-line';
      row.style.left = `${LINE_X}px`;
      row.style.top = `${LINE_BASE - i * LINE_H}px`;
      this.logEl.appendChild(row);
      this.lineEls.push(row);
    }

    // 输入框底板：左格 = 聊天，右格 = 密语对象（原版同时画两块）
    this.panelWrap = document.createElement('div');
    this.panelWrap.className = 'chat-panels hidden';
    this.layer.appendChild(this.panelWrap);

    // 真实的 <input>：这样 IME/退格/选择框全都免费，
    // 而且 main.ts 的按键处理看到 target 是 INPUT 就不会抢快捷键
    this.inputEl = document.createElement('input');
    this.inputEl.className = 'chat-input hidden';
    this.inputEl.type = 'text';
    this.inputEl.maxLength = 59;
    this.inputEl.autocomplete = 'off';
    this.inputEl.spellcheck = false;
    this.inputEl.style.left = `${INPUT_TEXT.x}px`;
    this.inputEl.style.top = `${INPUT_TEXT.y - 3}px`;
    this.layer.appendChild(this.inputEl);

    this.inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.recall(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.recall(1);
      }
      e.stopPropagation();
    });

    // 点画面把焦点抢走时跟着收起来，免得 keys 被永久挡住（打字状态卡死）
    this.inputEl.addEventListener('blur', () => {
      if (this.typing) this.close();
    });

    void this.build();
  }

  private async build() {
    await preloadUi(SPRITES);
    const [a, b] = await Promise.all([uiSprite('Dialogue1'), uiSprite('Dialogue2')]);
    if (a) {
      this.panelLeft = spriteBox({
        url: a.url,
        x: PANEL_L.x,
        y: PANEL.y,
        w: PANEL.w,
        h: PANEL.h,
        className: 'chat-panel',
      });
      this.panelWrap.appendChild(this.panelLeft);
    }
    if (b) {
      this.panelRight = spriteBox({
        url: b.url,
        x: PANEL_R.x,
        y: PANEL.y,
        w: PANEL.w,
        h: PANEL.h,
        className: 'chat-panel',
      });
      this.panelWrap.appendChild(this.panelRight);
    }
    this.render();
  }

  /* ---------------------------------------------------------------- */
  /* 数据                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * 往日志里塞一条。
   *
   * `channel` 由调用方按协议决定：普通聊天 3、系统 1、GM 2、队伍 4、战盟 5。
   * 正文里的前缀（'~' / '@'）已经在解析时剥掉。
   */
  push(name: string, text: string, channel: ChatChannel = 3) {
    const clean = text.replace(/[\r\n]+/g, ' ').trimEnd();
    if (!clean && !name) return;
    this.lines.push({ name: name.trim(), text: clean, channel });
    if (this.lines.length > LOG_MAX) this.lines.splice(0, this.lines.length - LOG_MAX);
    this.render();
  }

  /** 只有正文的系统提示（升级、掉落、服务端公告） */
  notice(text: string) {
    this.push('', text, 1);
  }

  get count() {
    return this.lines.length;
  }

  snapshot() {
    return {
      typing: this.typing,
      input: this.inputEl.value,
      lines: this.lines.map(l => ({ name: l.name, text: l.text, channel: l.channel })),
    };
  }

  /* ---------------------------------------------------------------- */
  /* 输入                                                              */
  /* ---------------------------------------------------------------- */

  get isTyping() {
    return this.typing;
  }

  open(prefill = '') {
    this.typing = true;
    this.panelWrap.classList.remove('hidden');
    this.inputEl.classList.remove('hidden');
    this.inputEl.value = prefill;
    this.historyAt = -1;
    this.inputEl.focus();
    this.inputEl.setSelectionRange(prefill.length, prefill.length);
  }

  close() {
    this.typing = false;
    this.panelWrap.classList.add('hidden');
    this.inputEl.classList.add('hidden');
    this.inputEl.value = '';
    this.inputEl.blur();
  }

  /** Enter：发出去并关掉输入框（原版也是发完就收） */
  submit() {
    const text = this.inputEl.value.trim();
    this.close();
    if (!text) return;
    this.history.push(text);
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this.onSend?.(text);
  }

  /** 上下键翻历史 */
  private recall(dir: number) {
    if (!this.history.length) return;
    if (this.historyAt < 0) this.historyAt = this.history.length;
    this.historyAt = Math.max(0, Math.min(this.history.length, this.historyAt + dir));
    const text = this.historyAt >= this.history.length ? '' : this.history[this.historyAt];
    this.inputEl.value = text;
    this.inputEl.setSelectionRange(text.length, text.length);
  }

  /* ---------------------------------------------------------------- */
  /* 渲染                                                              */
  /* ---------------------------------------------------------------- */

  private render() {
    for (let row = 0; row < ROWS; row++) {
      // row 0 = 最新，往上越旧
      const line = this.lines[this.lines.length - 1 - row];
      const el = this.lineEls[row];
      if (!line) {
        el.textContent = '';
        el.style.background = '';
        continue;
      }
      const st = CHANNEL_STYLE[line.channel];
      el.style.background = st.bg;

      // 原版是两段 DrawText：先 "name: "（自己的调色板），再正文
      el.textContent = '';
      if (line.name) {
        const who = document.createElement('span');
        who.className = 'chat-who';
        who.style.color = st.nameFg;
        who.textContent = `${line.name}: `;
        el.appendChild(who);
      }
      const body = document.createElement('span');
      body.className = 'chat-text';
      body.style.color = st.fg;
      body.textContent = line.text;
      el.appendChild(body);
    }
  }

  /** UI 层整体显隐跟着走（选角界面里不显示聊天） */
  setVisible(on: boolean) {
    this.layer.style.display = on ? '' : 'none';
    if (!on) this.close();
  }
}

export { LINE_BASE, LINE_H, LINE_X, ROWS as CHAT_ROWS, BOX as CHAT_BOX };
