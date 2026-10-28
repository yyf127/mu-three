import type { UiLayer } from './frame';
import { textSync } from '../data/localText';

/**
 * 通用输入框（640×480 逻辑坐标，和背包/仓库面板同一套缩放）。
 *
 * 现在两处在用：
 *   1. **拆堆叠**（0x2B）：Shift + 左键点背包里的一堆药水 → 问「拆多少」；
 *   2. **仓库密码**（0x83）：点仓库面板的锁 → 输密码 / 个人码。
 *
 * 为什么不用 `window.prompt`：
 *   - 原版是游戏内的输入框，`prompt` 会挡住整个 canvas、还会被浏览器的
 *     「阻止此页面创建更多对话框」静默吃掉；
 *   - 全屏游戏里 `prompt` 弹出时 `keydown` 会被浏览器接管，松开后 WASD
 *     仍然是按下状态，角色会自己往前跑（`keys` 集合没收到 keyup）。
 *
 * 这个组件只负责「收一串值 + 回调」，业务含义（发哪个包）留给调用方。
 */
export interface PromptField {
  /** 回调里的键名 */
  key: string;
  label: string;
  /** 最多几位；默认 4 */
  maxLength?: number;
  /** 只收数字（拆堆叠 / 密码 / 个人码都是数字） */
  numeric?: boolean;
  /** 显示成圆点（密码） */
  mask?: boolean;
  /** 初始值 */
  value?: string;
}

export interface PromptOptions {
  title: string;
  fields: PromptField[];
  /** 确认按钮文案，默认「确定」 */
  okText?: string;
  /**
   * 第三个按钮（可选）。仓库密码用它挂「取消密码」——
   * 同一个框里既要有「设置新密码」，又要能「取消密码」，
   * 弹两次框反而更绕。
   */
  altText?: string;
  onAlt?: (values: Record<string, string>) => void;
  /** 标题下面的一行说明 */
  hint?: string;
  onOk: (values: Record<string, string>) => void;
  onCancel?: () => void;
}

export class PromptDialog {
  private el: HTMLDivElement;
  private box: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private okBtn: HTMLButtonElement;
  private altBtn: HTMLButtonElement;
  private cancelBtn: HTMLButtonElement;
  private inputs: { field: PromptField; input: HTMLInputElement }[] = [];
  private opts: PromptOptions | null = null;

  constructor(layer: UiLayer) {
    this.el = document.createElement('div');
    this.el.className = 'dlg-overlay hidden';

    this.box = document.createElement('div');
    this.box.className = 'dlg-box';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'dlg-title';

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'dlg-hint';

    this.okBtn = document.createElement('button');
    this.okBtn.className = 'dlg-btn dlg-ok';
    this.okBtn.textContent = textSync(228, '确认');

    this.altBtn = document.createElement('button');
    this.altBtn.className = 'dlg-btn dlg-alt hidden';
    this.altBtn.textContent = '其他';

    this.cancelBtn = document.createElement('button');
    this.cancelBtn.className = 'dlg-btn dlg-cancel';
    this.cancelBtn.textContent = textSync(229, '取消');

    this.box.append(this.titleEl, this.hintEl, this.okBtn, this.altBtn, this.cancelBtn);
    this.el.appendChild(this.box);
    layer.root.appendChild(this.el);

    this.okBtn.addEventListener('click', () => this.confirm('ok'));
    this.altBtn.addEventListener('click', () => this.confirm('alt'));
    this.cancelBtn.addEventListener('click', () => this.cancel());
    // 点遮罩空白处 = 取消（原版点面板外也是关掉）
    this.el.addEventListener('pointerdown', e => {
      if (e.target === this.el) this.cancel();
    });
    this.box.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.confirm('ok');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancel();
      }
      // 输入框里打字不能漏给游戏（WASD 会带着角色跑）
      e.stopPropagation();
    });
    this.box.addEventListener('keyup', e => e.stopPropagation());
    this.box.addEventListener('keypress', e => e.stopPropagation());
  }

  get isOpen() {
    return this.opts !== null;
  }

  open(opts: PromptOptions) {
    this.opts = opts;
    this.titleEl.textContent = opts.title;
    this.hintEl.textContent = opts.hint ?? '';
    this.hintEl.classList.toggle('hidden', !opts.hint);
    this.okBtn.textContent = opts.okText ?? textSync(228, '确认');
    this.altBtn.textContent = opts.altText ?? '其他';
    this.altBtn.classList.toggle('hidden', !opts.altText);

    // 重建输入行（每次字段可能不同）
    for (const { input } of this.inputs) input.parentElement?.remove();
    this.inputs = [];

    let top = 34;
    for (const f of opts.fields) {
      const row = document.createElement('div');
      row.className = 'dlg-row';
      row.style.top = `${top}px`;

      const label = document.createElement('span');
      label.className = 'dlg-label';
      label.textContent = f.label;

      const input = document.createElement('input');
      input.className = 'dlg-input';
      input.type = f.mask ? 'password' : 'text';
      input.inputMode = f.numeric ? 'numeric' : 'text';
      input.maxLength = f.maxLength ?? 4;
      input.value = f.value ?? '';
      input.autocomplete = 'off';
      // 只收数字：粘贴/输入法都可能塞进字母
      if (f.numeric) {
        input.addEventListener('input', () => {
          const cleaned = input.value.replace(/\D+/g, '');
          if (cleaned !== input.value) input.value = cleaned;
        });
      }

      row.append(label, input);
      this.box.appendChild(row);
      this.inputs.push({ field: f, input });
      top += 28;
    }

    this.box.style.height = `${top + 46}px`;
    this.okBtn.style.top = `${top}px`;
    this.cancelBtn.style.top = `${top}px`;
    // 按钮跟着字段数量走：有第三个按钮就排三个，否则两个居中
    if (opts.altText) {
      this.okBtn.style.left = '16px';
      this.altBtn.style.left = '89px';
      this.cancelBtn.style.left = '162px';
    } else {
      this.okBtn.style.left = '56px';
      this.cancelBtn.style.left = '132px';
    }

    this.el.classList.remove('hidden');
    // 聚焦第一个框：原版弹出密码框就能直接敲
    window.setTimeout(() => this.inputs[0]?.input.focus(), 0);
  }

  hide() {
    this.opts = null;
    this.el.classList.add('hidden');
    for (const { input } of this.inputs) input.blur();
  }

  private confirm(kind: 'ok' | 'alt') {
    const opts = this.opts;
    if (!opts) return;
    const values: Record<string, string> = {};
    for (const { field, input } of this.inputs) values[field.key] = input.value.trim();
    this.hide();
    if (kind === 'alt') opts.onAlt?.(values);
    else opts.onOk(values);
  }

  private cancel() {
    const opts = this.opts;
    if (!opts) return;
    this.hide();
    opts.onCancel?.();
  }
}
