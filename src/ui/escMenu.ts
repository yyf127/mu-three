/**
 * ESC 菜单（原版 `UI_StatsPanel.cpp::RenderErrorMessage` 的 state 0x6e）和它的
 * 「选项」子菜单（state 0x96）。
 *
 * ## 原版布局（640×480 逻辑坐标，逐个数抄的）
 *
 * ```
 * 状态 0x6e（游戏内 5 个按钮）
 *   y 从 0x3c(60) 起，每次 +0x1e(30)
 *   GL_DrawTexture(0xf0, 260, y, 120, 22, 0, 0, 0.83203125, 1.0)
 *   文字 y = 65 / 95 / 125 / 155 / 185（按钮顶 +5），水平居中在 320
 *
 * 状态 0x96（选项：标题 + 两行开关 + 关闭）
 *   y 从 0x1e(30) 起，+30 加到 < 0x96(150) → 30 / 60 / 90 / 120
 *   文字 y = 35 / 65 / 95 / 125
 * ```
 *
 * 贴图 `0xf0` = `Interface/Message_box.OZJ`（213×64；u 取到 `0.83203125` = 213/256，
 * 其实就是整张图），画成 120×22 的扁条：中间那圈暗、上下各一条亮边，
 * 所以按钮看着像一道凹槽 —— 整张拉伸就对了。
 *
 * 文字全部来自 `Text.bmd`（原版 `Text_Data.cpp` 把 GlobalText[381..388] 抄进那几个
 * 300 字节缓冲，见 `globals.cpp` 的注释）：
 *
 * | GlobalText | 内容 | 用在哪 |
 * |---|---|---|
 * | 381 | 结束游戏 | 0x6e 按钮 0 |
 * | 382 | 回到选择服务器画面 | 0x6e 按钮 1 |
 * | 383 | 回到选择角色画面 | 0x6e 按钮 2 |
 * | 384 | 取　消 | 0x6e 按钮 4 |
 * | 385 | 选项 | 0x6e 按钮 3 + 0x96 标题 |
 * | 386 | 自动攻击 | 0x96 第 2 行（运行时拼 On/Off） |
 * | 387 | 悄悄话提示音 | 0x96 第 3 行 |
 * | 388 | 关　闭 | 0x96 第 4 行 |
 *
 * 悬停高亮在原版是「同一张图再用加色混合画一遍 + `glColor3f(0.8,0.6,0.4)`」，
 * 这里用 `::after` 复制一层贴图 + `mix-blend-mode: screen` 近似。
 */
import { textSync } from '../data/localText';
import { uiSprite } from './ozj';

export type EscAction = 'exit' | 'server' | 'char' | 'options' | 'close';

/**
 * 两套主菜单：
 *
 * - `game`：游戏内 5 项（原版 0x6e 全套：结束游戏 / 回到选择服务器画面 /
 *   回到选择角色画面 / 选项 / 取消）。
 * - `charselect`：选角界面 3 项。原版选角场景没有 ESC 菜单
 *   （`Scene_CharSelect.cpp` 里根本没有 0x1b 分支），这三项是网页端补的出口：
 *   **返回线路选择 / 选项 / 取消**。选角界面本身没有 socket 之外的上下文，
 *   给「结束游戏」等于关掉整个页面，没意义，所以只留最小的三条。
 */
export type EscMode = 'game' | 'charselect';

interface Btn {
  el: HTMLButtonElement;
  label: HTMLSpanElement;
  /** 每帧刷新文案用（选项那两个 On/Off 行） */
  dynamic: (() => string) | null;
  /** `GlobalText` 下标（文案取自 `Text.bmd`）；null = 网页端自定义文案 */
  textId: number | null;
  /** 表还没读出来时的兜底文案 */
  fallback: string;
}

/** 原版几何（逻辑像素） */
const BTN_X = 260;
const BTN_W = 120;
const BTN_H = 22;
const MAIN_Y0 = 60;
const OPT_Y0 = 30;
const STEP = 30;

export class EscMenu {
  private root: HTMLDivElement;
  /** 游戏内主菜单（5 项） */
  private mainBox: HTMLDivElement;
  /** 选角主菜单（3 项） */
  private charBox: HTMLDivElement;
  private optBox: HTMLDivElement;
  private mainBtns: Btn[] = [];
  private charBtns: Btn[] = [];
  private optBtns: Btn[] = [];
  private open = false;
  private view: 'main' | 'options' = 'main';
  private mode: EscMode = 'game';

  /** 自动攻击（原版 `m_bAutoAttack`，`globals.cpp` 里默认 1 = 开） */
  autoAttack = true;
  /** 悄悄话提示音（原版 `m_bWhisperSound`） */
  whisperSound = true;

  onExit: (() => void) | null = null;
  onJoinServer: (() => void) | null = null;
  onJoinChar: (() => void) | null = null;
  /** 选角菜单的「返回线路选择」 */
  onBackToServer: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'esc-menu';
    this.root.className = 'hidden';

    this.mainBox = document.createElement('div');
    this.mainBox.className = 'esc-box';
    this.root.appendChild(this.mainBox);

    this.charBox = document.createElement('div');
    this.charBox.className = 'esc-box hidden';
    this.root.appendChild(this.charBox);

    this.optBox = document.createElement('div');
    this.optBox.className = 'esc-box hidden';
    this.root.appendChild(this.optBox);

    // 主菜单：5 个按钮，顺序照 `globals.cpp` 里那排 lpString 的注释
    this.mainBtns = [
      this.addBtn(this.mainBox, MAIN_Y0 + STEP * 0, textSync(381, '结束游戏'), () => this.exitGame(), false, null, 381),
      this.addBtn(
        this.mainBox,
        MAIN_Y0 + STEP * 1,
        textSync(382, '回到选择服务器画面'),
        () => this.joinServer(),
        false,
        null,
        382
      ),
      this.addBtn(
        this.mainBox,
        MAIN_Y0 + STEP * 2,
        textSync(383, '回到选择角色画面'),
        () => this.joinChar(),
        false,
        null,
        383
      ),
      this.addBtn(this.mainBox, MAIN_Y0 + STEP * 3, textSync(385, '选项'), () => this.openOptions(), false, null, 385),
      this.addBtn(this.mainBox, MAIN_Y0 + STEP * 4, textSync(384, '取 消'), () => this.hide(), false, null, 384),
    ];

    /*
     * 选角：返回线路选择 / 选项 / 取消（只 3 项，排版从 MAIN_Y0 起）。
     *
     * 第一项文案不用原版 `GlobalText[382]`（「回到选择服务器画面」）——
     * 选角场景本来就没有 ESC 菜单，这三项是网页端补的，用户明确要「返回线路选择」
     * 这个说法。游戏内那套（0x6e 五项）仍然照原版文案。
     */
    this.charBtns = [
      this.addBtn(this.charBox, MAIN_Y0 + STEP * 0, '返回线路选择', () => this.backToServer()),
      this.addBtn(this.charBox, MAIN_Y0 + STEP * 1, textSync(385, '选项'), () => this.openOptions(), false, null, 385),
      this.addBtn(this.charBox, MAIN_Y0 + STEP * 2, textSync(384, '取 消'), () => this.hide(), false, null, 384),
    ];

    // 选项：标题行（不响应）+ 两个开关 + 关闭
    this.optBtns = [
      this.addBtn(this.optBox, OPT_Y0 + STEP * 0, textSync(385, '选项'), null, true, null, 385),
      this.addBtn(
        this.optBox,
        OPT_Y0 + STEP * 1,
        '',
        () => {
          this.autoAttack = !this.autoAttack;
          this.paintLabels();
        },
        false,
        () => `${textSync(386, '自动攻击')}  ${this.autoAttack ? 'On' : 'Off'}`
      ),
      this.addBtn(
        this.optBox,
        OPT_Y0 + STEP * 2,
        '',
        () => {
          this.whisperSound = !this.whisperSound;
          this.paintLabels();
        },
        false,
        () => `${textSync(387, '悄悄话提示音')}  ${this.whisperSound ? 'On' : 'Off'}`
      ),
      this.addBtn(this.optBox, OPT_Y0 + STEP * 3, textSync(388, '关 闭'), () => this.backToMain(), false, null, 388),
    ];

    host.appendChild(this.root);
    // 点面板别透到 canvas（否则会顺手寻路/攻击）
    this.root.addEventListener('pointerdown', e => e.stopPropagation());
    this.root.addEventListener('contextmenu', e => e.preventDefault());
    void this.skin();
  }

  /* ------------------------------------------------------------------ */
  /* 构建                                                               */
  /* ------------------------------------------------------------------ */

  private addBtn(
    box: HTMLDivElement,
    y: number,
    label: string,
    onPick: (() => void) | null,
    header = false,
    dynamic: (() => string) | null = null,
    textId: number | null = null
  ): Btn {
    const el = document.createElement('button');
    el.className = `esc-btn${header ? ' esc-head' : ''}`;
    el.style.left = `${BTN_X}px`;
    el.style.top = `${y}px`;
    el.style.width = `${BTN_W}px`;
    el.style.height = `${BTN_H}px`;

    const span = document.createElement('span');
    span.className = 'esc-label';
    span.textContent = dynamic ? dynamic() : label;
    el.appendChild(span);

    if (onPick) {
      el.addEventListener('click', e => {
        e.stopPropagation();
        onPick();
      });
    } else {
      el.classList.add('esc-noop');
      el.disabled = true;
    }
    box.appendChild(el);
    return { el, label: span, dynamic, textId, fallback: label };
  }

  /**
   * 重新读一遍 `Text.bmd`。
   *
   * 菜单是模块初始化时就 new 出来的，那会儿 `loadTextPool()` 还没回来，
   * `textSync()` 只能给兜底串。表读完之后调这里覆盖一次，按钮文案才真来自
   * `Data/Local/chs/Text.bmd`（`取 消`、`关 闭` 在原表里就是「取」+ 5 个半角
   * 空格 +「消」，照抄原样）。
   */
  refreshText() {
    for (const b of [...this.mainBtns, ...this.charBtns, ...this.optBtns]) {
      if (b.dynamic || b.textId === null) continue;
      b.label.textContent = textSync(b.textId, b.fallback);
    }
    this.paintLabels();
  }

  private async skin() {
    const spr = await uiSprite('Message_box.OZJ');
    if (!spr) return;
    this.root.style.setProperty('--esc-plate', `url(${spr.url})`);
  }

  /* ------------------------------------------------------------------ */
  /* 交互                                                               */
  /* ------------------------------------------------------------------ */

  private exitGame() {
    this.hide();
    this.onExit?.();
  }

  private joinServer() {
    this.hide();
    this.onJoinServer?.();
  }

  private joinChar() {
    this.hide();
    this.onJoinChar?.();
  }

  private backToServer() {
    this.hide();
    this.onBackToServer?.();
  }

  private openOptions() {
    this.view = 'options';
    this.paintView();
    this.paintLabels();
  }

  private backToMain() {
    // 原版点「关闭」回主菜单（`DAT_083a7c28 = 0x6e`）
    this.view = 'main';
    this.paintView();
  }

  /** Esc 键：选项里先回主菜单，主菜单里才关掉（和原版 toggle 一致） */
  escKey() {
    if (!this.open) return false;
    if (this.view === 'options') {
      this.backToMain();
      return true;
    }
    this.hide();
    return true;
  }

  private paintLabels() {
    for (const b of [...this.mainBtns, ...this.charBtns, ...this.optBtns]) {
      if (b.dynamic) b.label.textContent = b.dynamic();
    }
  }

  private paintView() {
    const opt = this.view === 'options';
    this.mainBox.classList.toggle('hidden', opt || this.mode !== 'game');
    this.charBox.classList.toggle('hidden', opt || this.mode !== 'charselect');
    this.optBox.classList.toggle('hidden', !opt);
  }

  /** 当前显示的是哪一套按钮（选项视图两个模式共用） */
  private activeBtns(): Btn[] {
    if (this.view === 'options') return this.optBtns;
    return this.mode === 'charselect' ? this.charBtns : this.mainBtns;
  }

  get isOpen() {
    return this.open;
  }

  get currentView() {
    return this.view;
  }

  /**
   * 换宿主。
   *
   * 菜单是同一份 DOM，但两个画面分属不同的层：游戏内在 `#mu-ui`（只在游戏内
   * 显示），选角在 `#char-layer`（`.mu-layer`）。试过在 `#stage` 下单独开一层
   * 再抬高 z-index —— `#char-layer` 那圈框（z-index 2）照样压在菜单上面，
   * `elementsFromPoint` 里菜单排在最后。直接搬进目标层最省事，也不用跟
   * 层叠顺序较劲。`appendChild` 移动节点会保留所有事件监听。
   */
  setHost(host: HTMLElement) {
    if (this.root.parentElement !== host) host.appendChild(this.root);
  }

  show(mode: EscMode = 'game') {
    this.open = true;
    this.view = 'main';
    this.mode = mode;
    this.refreshText();
    this.paintView();
    this.paintLabels();
    this.root.classList.remove('hidden');
  }

  get currentMode() {
    return this.mode;
  }

  hide() {
    this.open = false;
    this.view = 'main';
    this.paintView();
    this.root.classList.add('hidden');
  }

  /** 探针：当前面板状态（文案 + 逻辑坐标） */
  snapshot() {
    const list = this.activeBtns();
    return {
      open: this.open,
      view: this.view,
      mode: this.mode,
      autoAttack: this.autoAttack,
      whisperSound: this.whisperSound,
      items: list.map(b => ({
        label: b.label.textContent ?? '',
        x: parseInt(b.el.style.left, 10),
        y: parseInt(b.el.style.top, 10),
        w: parseInt(b.el.style.width, 10),
        h: parseInt(b.el.style.height, 10),
      })),
    };
  }
}
