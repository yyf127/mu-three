/**
 * 「服务器传送」窗口 —— 原版 `RenderServerDivision`（`Render/HUD_Pass6.cpp:323`，IDA `sub_4F5570`）。
 *
 * ## 来历
 *
 * 服务端 `CNpcTalk::NpcServerTransfer`（`NpcTalk.cpp:137`）在 NPC **234**
 * （Server Transfer）身上被点开时回一包 `0x30 result = 5`：
 *
 * ```c
 * pMsg.result = 5;
 * DataSend(lpObj->Index, (BYTE*)&pMsg, pMsg.header.size);
 * ```
 *
 * 客户端 `Net_Process.cpp:5226` 收到 sub 5 就 `g_bServerDivisionEnable = 1`，
 * 面板由 `RenderServerDivision` 每帧画。我们以前只往聊天里丢一句
 * 「界面未移植」，现在照原版布局补齐。
 *
 * ## 布局（640×480 逻辑坐标，逐个数抄的）
 *
 * ```
 * 底板   RenderInventoryInterface(450, 0, 1)
 *          Item_Back01  (450,   0) 190×256
 *          Item_Back02  (450, 256) 190×177
 *          Trading_line (450, 225) 190×10    ← Flag = 1 才画
 * 标题   GlobalText[462..469] 共 8 行
 *          RenderCenteredText(450+95 = 545, y)，y 从 50 起每行 +20
 * 复选框 GL_DrawTexture(290 未选 / 291 已选, 450+25 = 475, 240, 16×16)
 * 说明   RenderText(475+19 = 494, 245, GlobalText[447])   →「: 同意上述条款。」
 * 确定   GL_DrawTexture(240, 450+35 = 485, 320, 120×24) + 居中文字 GlobalText[228]
 * 取消   GL_DrawTexture(240, 485, 350, 120×24)          + 居中文字 GlobalText[229]
 * ```
 *
 * `DAT_07eaa131`（= 有没有勾选）为 0 时「确定」整块按 `glColor3f(0.5,0.5,0.5)`
 * 画成灰的 —— 这里用 `opacity: .55` 近似。
 *
 * ## 点击热区（`ServerTransfer_HitTest`，`Net/SecondPassword.cpp:1019`）
 *
 * ```
 * 复选框  [startX+25, +41) × [240, 256)
 * 确定    [startX+35, +155) × [320, 344)     ← 需要先勾选
 * 取消    [startX+35, +155) × [350, 374)
 * 关闭 X  [startX+25, +49) × [startY+395, +419)   ← 原版没有图标，只有热区
 * ```
 *
 * 「确定」在原版是 `ShowCheckBox(1, 448, 151)`：再弹一个
 * 「是否要将您的帐号移动到分割服务器？」的二选一确认框，所以这里也做成
 * 两段式（条款 → 确认），不复用一个全局 MessageBox。
 *
 * ## 发包
 *
 * 两条出口（取消 / 关闭 / 确认后）原版都发 `C1 03 31`（`CGNpcTalkCloseRecv`），
 * 让服务端把 `Interface.use` 放掉 —— `NpcServerTransfer` 里把它置了 1，
 * 不释放的话之后聊天、`/move` 全被吞。这一条我们照做。
 */

import { textSync } from '../data/localText';
import { uiSprite, preloadUi } from './ozj';

/**
 * 文案兜底（`chs/Text.bmd` 的原文）。
 *
 * 面板在模块加载时就构造，那时 `Text.bmd` 还没读完（`textSync` 返回 fallback），
 * 所以 `show()` 里会再刷一次。这里把中文原文写死一份，既当兜底也当文档 ——
 * 从 `Data/Local/chs/Text.bmd` 逐条解出来的，和索引一一对应。
 */
const TEXTS: Record<number, string> = {
  228: '确认',
  229: '取消',
  447: ': 同意上述条款。',
  448: '是否要将您的帐号移动到分割的服务器？',
  462: '1）将您的帐号移动到分割的服务器后，',
  463: '您无法再将您的帐号移回以前的服务器。',
  464: '2）将您的帐号移动到分割的服务器后，',
  465: '当您登录分割的服务器时。',
  466: '您帐号下的所有角色信息和物品',
  467: '将全部移动到分割的服务器',
  468: '3）将您的帐号移动到分割的服务器后，',
  469: '游戏会自动关闭。',
};

const tx = (i: number) => textSync(i, TEXTS[i] ?? '');

/** 面板原点：和背包一样贴右边缘（640 - 190） */
const PANEL_X = 450;
const PANEL_W = 190;

/** 标题：`GlobalText[462..469]`，居中在 PANEL_X + 95，从 y=50 起每行 20 */
const TITLE_X = PANEL_X + 95;
const TITLE_Y0 = 50;
const TITLE_STEP = 20;
const TITLE_FIRST = 462;
const TITLE_COUNT = 8;

const CHECK_X = PANEL_X + 25; // 475
const CHECK_Y = 240;
const CHECK_SIZE = 16;
const CHECK_LABEL_X = CHECK_X + 19; // 494
const CHECK_LABEL_Y = 245;

const BTN_X = PANEL_X + 35; // 485
const BTN_W = 120;
const BTN_H = 24;
const OK_Y = 320;
const CANCEL_Y = 350;

export class ServerDivisionPanel {
  private root: HTMLDivElement;
  private checkBtn: HTMLButtonElement;
  private okBtn: HTMLButtonElement;
  private confirmBox: HTMLDivElement;
  private open = false;
  /** 原版 `g_bServerDivisionAccept`：条款是否勾选 */
  private accepted = false;
  /** 二次确认框开着没有（原版 `ShowCheckBox`） */
  private confirming = false;

  /** 点「是」（= 同意迁移） */
  onAccept: (() => void) | null = null;
  /** 取消 / 关闭（原版都发 `C1 03 31`） */
  onCancel: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'svd-panel';
    this.root.className = 'hidden';

    // ── 底板三张（和背包面板同一套图，第三张是 Flag=1 时那条分隔线）
    // 根节点铺满 640×480，所以底板的 x 也要加上面板原点 450
    for (const [key, x, y, w, h] of [
      ['item_back01', PANEL_X, 0, 190, 256],
      ['item_back02', PANEL_X, 256, 190, 177],
      ['trading_line', PANEL_X, 225, 190, 10],
    ] as const) {
      const img = document.createElement('img');
      img.className = 'svd-plate';
      img.draggable = false;
      img.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
      img.dataset.key = key;
      this.root.appendChild(img);
    }

    // ── 标题八行
    const terms = document.createElement('div');
    terms.className = 'svd-terms';
    for (let i = 0; i < TITLE_COUNT; i++) {
      const line = document.createElement('div');
      line.className = 'svd-line';
      line.textContent = tx(TITLE_FIRST + i);
      terms.appendChild(line);
    }
    this.root.appendChild(terms);

    // ── 复选框
    this.checkBtn = document.createElement('button');
    this.checkBtn.className = 'svd-check';
    this.checkBtn.style.cssText = `left:${CHECK_X}px;top:${CHECK_Y}px;width:${CHECK_SIZE}px;height:${CHECK_SIZE}px`;
    this.checkBtn.title = tx(447);
    this.checkBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.setAccepted(!this.accepted);
    });
    this.root.appendChild(this.checkBtn);

    const checkLabel = document.createElement('div');
    checkLabel.className = 'svd-checklabel';
    checkLabel.style.cssText = `left:${CHECK_LABEL_X}px;top:${CHECK_LABEL_Y}px`;
    checkLabel.textContent = tx(447);
    this.root.appendChild(checkLabel);

    // ── 确定 / 取消
    this.okBtn = this.mkButton(tx(228), OK_Y, () => this.pickOk());
    this.okBtn.classList.add('svd-ok');
    this.root.appendChild(this.okBtn);
    const cancelBtn = this.mkButton(tx(229), CANCEL_Y, () => this.cancel());
    cancelBtn.classList.add('svd-cancel');
    this.root.appendChild(cancelBtn);

    // ── 二次确认框（原版 `ShowCheckBox(1, 448, 151)`）
    this.confirmBox = document.createElement('div');
    this.confirmBox.className = 'svd-confirm hidden';
    this.confirmBox.innerHTML =
      `<div class="svd-confirm-text">${textSync(448, '是否要将您的帐号移动到分割服务器？')}</div>` +
      `<div class="svd-confirm-btns">` +
      `<button class="svd-mini svd-yes">${textSync(228, '确认')}</button>` +
      `<button class="svd-mini svd-no">${textSync(229, '取消')}</button>` +
      `</div>`;
    this.root.appendChild(this.confirmBox);
    this.confirmBox.querySelector('.svd-yes')?.addEventListener('click', e => {
      e.stopPropagation();
      this.confirming = false;
      this.confirmBox.classList.add('hidden');
      this.accept();
    });
    this.confirmBox.querySelector('.svd-no')?.addEventListener('click', e => {
      e.stopPropagation();
      this.confirming = false;
      this.confirmBox.classList.add('hidden');
    });

    // 点面板别透到 canvas（否则会顺手寻路/攻击）
    this.root.addEventListener('pointerdown', e => e.stopPropagation());
    this.root.addEventListener('contextmenu', e => e.preventDefault());

    host.appendChild(this.root);
    void this.skin();
  }

  private mkButton(label: string, y: number, onPick: () => void): HTMLButtonElement {
    const el = document.createElement('button');
    el.className = 'svd-btn';
    el.style.cssText = `left:${BTN_X}px;top:${y}px;width:${BTN_W}px;height:${BTN_H}px`;
    const span = document.createElement('span');
    span.textContent = label;
    el.appendChild(span);
    el.addEventListener('click', e => {
      e.stopPropagation();
      onPick();
    });
    return el;
  }

  private async skin() {
    const [back1, back2, line, msg, box1, box2] = await Promise.all([
      uiSprite('item_back01'),
      uiSprite('item_back02'),
      uiSprite('trading_line'),
      uiSprite('Message_box.OZJ'),
      uiSprite('accept_box01'),
      uiSprite('accept_box02'),
    ]);
    const url = (s: typeof back1) => (s ? `url(${s.url})` : '');
    for (const img of this.root.querySelectorAll<HTMLImageElement>('.svd-plate')) {
      const key = img.dataset.key;
      const spr = key === 'item_back01' ? back1 : key === 'item_back02' ? back2 : line;
      if (!spr) {
        console.warn(`[svd] 底板贴图取不到：${key}`);
        img.style.display = 'none';
        continue;
      }
      // dataURL 比 blob: 稳（blob 在缓存层被 revoke 后会白图）
      img.src = spr.url;
      console.log(`[svd] 底板 ${key} ← ${spr.source} ${spr.width}×${spr.height}`);
    }
    if (msg) this.root.style.setProperty('--svd-plate', `url(${msg.url})`);
    // 复选框两张图都进缓存，切换时只改背景
    if (box1) this.root.style.setProperty('--svd-check-off', url(box1));
    if (box2) this.root.style.setProperty('--svd-check-on', url(box2));
    this.paintCheck();
  }

  /* ------------------------------------------------------------------ */

  private setAccepted(on: boolean) {
    this.accepted = on;
    this.paintCheck();
  }

  private paintCheck() {
    this.checkBtn.classList.toggle('on', this.accepted);
    // 原版 `DAT_07eaa131` 为 0 时「确定」整块按 0.5 灰度画
    this.okBtn.classList.toggle('dim', !this.accepted);
  }

  private pickOk() {
    if (!this.accepted) return; // 原版：没勾选时点「确定」没有任何反应
    this.confirming = true;
    this.confirmBox.classList.remove('hidden');
  }

  private accept() {
    this.onAccept?.();
    this.hide();
  }

  private cancel() {
    this.onCancel?.();
    this.hide();
  }

  /* ------------------------------------------------------------------ */

  /**
   * 重新取一遍文案。
   *
   * `Text.bmd` 是懒加载的，面板构造时通常还没读完 —— 构造那一刻取到的都是
   * fallback。每次打开再刷一次，保证用的是 `chs/` 里的原文。
   */
  private refreshText() {
    this.root.querySelectorAll<HTMLElement>('.svd-line').forEach((el, i) => {
      el.textContent = tx(TITLE_FIRST + i);
    });
    const label = this.root.querySelector<HTMLElement>('.svd-checklabel');
    if (label) label.textContent = tx(447);
    const label2 = this.root.querySelector<HTMLElement>('.svd-confirm-text');
    if (label2) label2.textContent = tx(448);
    const spans = this.root.querySelectorAll<HTMLElement>('.svd-btn span');
    if (spans[0]) spans[0].textContent = tx(228);
    if (spans[1]) spans[1].textContent = tx(229);
    const minis = this.root.querySelectorAll<HTMLElement>('.svd-mini');
    if (minis[0]) minis[0].textContent = tx(228);
    if (minis[1]) minis[1].textContent = tx(229);
  }

  show() {
    this.open = true;
    this.refreshText();
    this.accepted = false;
    this.confirming = false;
    this.confirmBox.classList.add('hidden');
    this.paintCheck();
    this.root.classList.remove('hidden');
  }

  hide() {
    this.open = false;
    this.confirming = false;
    this.confirmBox.classList.add('hidden');
    this.root.classList.add('hidden');
  }

  /** ESC：先关确认框，再关面板（原版也是这个顺序） */
  escKey() {
    if (!this.open) return false;
    if (this.confirming) {
      this.confirming = false;
      this.confirmBox.classList.add('hidden');
      return true;
    }
    this.cancel();
    return true;
  }

  get isOpen() {
    return this.open;
  }

  get isAccepted() {
    return this.accepted;
  }

  /** 探针：面板状态 + 每个热区的逻辑矩形 */
  snapshot() {
    return {
      open: this.open,
      accepted: this.accepted,
      confirming: this.confirming,
      panel: { x: PANEL_X, y: 0, w: PANEL_W, h: 433 },
      check: { x: CHECK_X, y: CHECK_Y, w: CHECK_SIZE, h: CHECK_SIZE },
      ok: { x: BTN_X, y: OK_Y, w: BTN_W, h: BTN_H },
      cancel: { x: BTN_X, y: CANCEL_Y, w: BTN_W, h: BTN_H },
      lines: [...this.root.querySelectorAll('.svd-line')].map(el => el.textContent ?? ''),
    };
  }
}

/** 面板打开前把六张图预热（进图时调一次） */
export function preloadServerDivision() {
  return preloadUi(['item_back01', 'item_back02', 'trading_line', 'Message_box.OZJ', 'accept_box01', 'accept_box02']);
}
