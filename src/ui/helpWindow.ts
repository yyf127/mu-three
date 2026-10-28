/**
 * 帮助窗（原版 F1，`RenderHelpWindow` → `CondText_Render`）。
 *
 * 文案例行全部来自 `Data/Local/chs/Text.bmd` 的 **120..157**（38 行）：
 *
 *   120 「快捷键说明」   121..139 键位
 *   140 「聊天指令说明」 141..157 聊天命令
 *
 * 原版是居中逐行画（`CondText_Render`）；38 行按 13px 一行塞不进 480 高，
 * 所以这里排成两列（各 19 行），字号仍然跟事件/聊天一致：宋体 11px。
 */
import { UiLayer } from './frame';
import { loadTextPool } from '../data/localText';

/** Text.bmd 里的帮助文本范围（含两端） */
export const HELP_FIRST = 120;
export const HELP_LAST = 157;

const PANEL = { x: 40, y: 32, w: 560, h: 416 };
const COL = [{ x: 62, y: 56 }, { x: 332, y: 56 }];
const LINE_H = 15;
const ROWS_PER_COL = 19;

export class HelpWindow {
  private layer: HTMLDivElement;
  private open = false;
  private built = false;

  constructor(private ui: UiLayer) {
    this.layer = document.createElement('div');
    this.layer.className = 'help-window hidden';
    ui.add(this.layer);
  }

  get isOpen() {
    return this.open;
  }

  private async build() {
    if (this.built) return;
    this.built = true;
    const pool = await loadTextPool();

    const box = document.createElement('div');
    box.className = 'hw-box';
    box.style.left = `${PANEL.x}px`;
    box.style.top = `${PANEL.y}px`;
    box.style.width = `${PANEL.w}px`;
    box.style.height = `${PANEL.h}px`;
    this.layer.appendChild(box);

    for (let col = 0; col < 2; col++) {
      const el = document.createElement('div');
      el.className = 'hw-col';
      el.style.left = `${COL[col].x}px`;
      el.style.top = `${COL[col].y}px`;
      this.layer.appendChild(el);
    }

    const cols = this.layer.querySelectorAll<HTMLDivElement>('.hw-col');
    for (let i = HELP_FIRST; i <= HELP_LAST; i++) {
      const line = pool.get(i);
      if (!line) continue;
      const k = i - HELP_FIRST;
      const col = k < ROWS_PER_COL ? 0 : 1;
      const row = k % ROWS_PER_COL;
      const el = document.createElement('div');
      el.className = i === 120 || i === 140 ? 'hw-line hw-title' : 'hw-line';
      el.style.top = `${row * LINE_H}px`;
      el.textContent = line.replace(/\s+$/, '');
      cols[col]?.appendChild(el);
    }

    const hint = document.createElement('div');
    hint.className = 'hw-hint';
    hint.textContent = 'F1 / Esc 关闭';
    this.layer.appendChild(hint);
  }

  async toggle() {
    if (this.open) {
      this.hide();
      return false;
    }
    await this.build();
    this.open = true;
    this.layer.classList.remove('hidden');
    return true;
  }

  hide() {
    this.open = false;
    this.layer.classList.add('hidden');
  }

  /** 调试：当前显示的行（Text.bmd 原文） */
  snapshot() {
    if (!this.open) return null;
    return [...this.layer.querySelectorAll('.hw-line')].map(e => e.textContent ?? '');
  }
}
