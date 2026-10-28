/**
 * NPC 对话窗（原版 `CSQuest::ShowDialogText`）。
 *
 * 文案全部来自 `Data/Local/chs/Dialog.bmd`（见 `data/localText.ts`），
 * 我们只负责画：`Message_box.ozj` 底板 + 7 行正文 + `1) xxx` 形式的答案。
 *
 * 原版行为（`stubs_IDA_ports.cpp:488`）：
 *   - 正文 `SeparateTextIntoLines(text, 7, 38)`：**38 字宽、最多 7 行**；
 *   - 每条答案前面加 `N) `，同样按 38 字折；
 *   - `m_iNumAnswer == 0` 时补一条 `GlobalText[609]`（「结束对话」）；
 *   - 点答案后：`m_iLinkForAnswer[i] > 0` → 接着显示那条对话，否则关窗；
 *     `m_iReturnForAnswer[i]` 是交给任务系统的动作（1 接受 / 2 关闭 / 3 提交）。
 */
import { uiSprite } from './ozj';
import { UiLayer, spriteBox } from './frame';
import {
  loadDialogs,
  loadTextPool,
  DIALOG_LINE_CHARS,
  DIALOG_LINES,
  type DialogEntry,
} from '../data/localText';

/** 逻辑坐标（640×480）：居中偏上，整块 420×190 */
const BOX = { x: 110, y: 110, w: 420, h: 190 };
const TEXT_PAD = { x: 22, y: 24 };

export class NpcDialog {
  private layer: HTMLDivElement;
  private textEl: HTMLDivElement;
  private ansEl: HTMLDivElement;
  private bg: HTMLImageElement | null = null;
  private open = false;
  private cur: DialogEntry | null = null;

  /** 选中答案时回调（return 值交给上层，比如以后的 quest 系统） */
  onAnswer: ((ret: number, dialog: DialogEntry, slot: number) => void) | null = null;

  constructor(private ui: UiLayer) {
    this.layer = document.createElement('div');
    this.layer.className = 'npc-dialog hidden';
    ui.add(this.layer);

    this.textEl = document.createElement('div');
    this.textEl.className = 'nd-text';
    this.layer.appendChild(this.textEl);

    this.ansEl = document.createElement('div');
    this.ansEl.className = 'nd-answers';
    this.layer.appendChild(this.ansEl);

    void this.build();
  }

  private async build() {
    const img = await uiSprite('Message_box');
    if (!img) return;
    this.bg = spriteBox({
      url: img.url,
      x: BOX.x,
      y: BOX.y,
      w: BOX.w,
      h: BOX.h,
      className: 'nd-bg',
    });
    this.layer.prepend(this.bg);
  }

  get isOpen() {
    return this.open;
  }

  get index() {
    return this.cur ? this.cur.index : -1;
  }

  /** 打开第 i 条对话（原始索引，0..199） */
  async show(i: number) {
    const all = await loadDialogs();
    const d = all[i] ?? null;
    if (!d) return false;
    this.cur = d;
    this.open = true;

    // 正文：38 字一行，最多 7 行，超出用 … 收尾
    const lines = wrap(d.text, DIALOG_LINE_CHARS);
    const shown = lines.slice(0, DIALOG_LINES);
    if (lines.length > DIALOG_LINES) {
      shown[DIALOG_LINES - 1] = shown[DIALOG_LINES - 1].slice(0, DIALOG_LINE_CHARS - 1) + '…';
    }
    this.textEl.textContent = shown.join('\n');

    // 答案：`N) 文本`，没有答案时补「结束对话」（GlobalText[609]）
    this.ansEl.textContent = '';
    // 没有答案时补的那条，文案是 `GlobalText[609]`（「结束对话」）
    const answers =
      d.numAnswer > 0 ? d.answers.slice(0, d.numAnswer) : [(await loadTextPool()).get(609) || '结束对话'];
    answers.forEach((a, k) => {
      const btn = document.createElement('button');
      btn.className = 'nd-answer';
      btn.type = 'button';
      btn.textContent = `${k + 1}) ${a}`;
      btn.addEventListener('click', () => this.pick(k));
      this.ansEl.appendChild(btn);
    });

    this.layer.classList.remove('hidden');
    return true;
  }

  /** 选第 slot 条答案 */
  pick(slot: number) {
    const d = this.cur;
    if (!d) return;
    const ret = d.returns[slot] ?? -1;
    const link = d.links[slot] ?? -1;
    this.onAnswer?.(ret, d, slot);
    if (link > 0) {
      void this.show(link);
      return;
    }
    this.hide();
  }

  hide() {
    this.open = false;
    this.cur = null;
    this.layer.classList.add('hidden');
  }

  /** 数字键 1..0 选答案 */
  pickByDigit(n: number) {
    if (!this.open || !this.cur) return false;
    const total = this.cur.numAnswer > 0 ? this.cur.numAnswer : 1;
    if (n < 1 || n > Math.min(10, total)) return false;
    this.pick(n - 1);
    return true;
  }

  /** 调试快照 */
  snapshot() {
    return this.open && this.cur
      ? { index: this.cur.index, text: this.cur.text, answers: this.cur.answers.slice(0, this.cur.numAnswer) }
      : null;
  }
}

/** 按字数折行（原版 SeparateTextIntoLines 就是按字宽切，不做单词边界） */
function wrap(text: string, width: number): string[] {
  const s = text.replace(/\r/g, '');
  const out: string[] = [];
  for (const para of s.split('\n')) {
    if (!para) {
      out.push('');
      continue;
    }
    for (let i = 0; i < para.length; i += width) out.push(para.slice(i, i + width));
  }
  return out;
}

export { BOX as NPC_DIALOG_BOX, TEXT_PAD as NPC_DIALOG_TEXT_PAD };
