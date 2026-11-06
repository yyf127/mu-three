/**
 * 普通玩家命令菜单（F 键）—— 把 `Command.txt` 里**非 GM** 的那 17 条命令
 * 做成分类快捷面板。
 *
 * ## 定位
 *
 * 纯「快捷输入」：点一条命令 = 帮你在聊天框里发那条指令，**与手打完全等价**，
 * 不改任何服务端行为。所以这里不需要（也不应该）复制服务端的等级/金币校验 ——
 * 门槛由服务端 `CCommandManager` 自己判，本地置灰只会和服务端打架。
 *
 * 唯一的本地判断是「有没有参数」：无参命令点一下直发，有参命令弹一个输入框。
 *
 * ## 分类依据（`Command.h` 的枚举名 + `CommandManager.cpp` 的实现语义）
 *
 * | 分类 | 命令 | 枚举 |
 * |---|---|---|
 * | 属性 | `/str` `/agi` `/vit` `/ene` | COMMAND_ADD_STR…ENE |
 * | 转生 | `/reset` `/grandreset` `/pkclear` | COMMAND_RESET / GRAND_RESET / PK_CLEAR |
 * | 资产 | `/addmoney` `/submoney` `/ware` | COMMAND_ADD_MONEY / SUB_MONEY / WARE |
 * | 社交 | `/post` `/war` `/soccer` `/re` | COMMAND_POST / GUILD_WAR / BATTLE_SOCCER / REQUEST |
 * | 其它 | `/evo` `/onlines` | COMMAND_CHANGE / ONLINES |
 *
 * **移动命令不在这里** —— 它有自己的窗口（M 键，`moveCommand.ts`），数据来自
 * 服务端 `Move.txt`，和这批静态命令不是一回事。
 *
 * ## 版式
 *
 * 底板沿用 `Item_Back01`(190×256) + `Item_Back02`(190×177) = 190×433，
 * 和移动命令窗口、商店/仓库同一套骨架（`RenderInventoryInterface`，
 * `HUD_Pass6.cpp:216`）；但命令菜单放在**左侧**（原点 0），
 */
import { UiLayer } from './frame';
import { uiSprite, preloadUi } from './ozj';

/* ------------------------------------------------------------------ */
/* 命令表                                                              */
/* ------------------------------------------------------------------ */

/** 参数形态 —— 决定点击后的行为 */
export type ParamKind =
  | 'none' // 直接发
  | 'number' // 弹输入框，只收数字
  | 'enum' // 弹选择框，从固定项里挑
  | 'number4' // 弹输入框，收 4 个数字
  | 'text'; // 弹输入框，收任意文本

export interface CommandArg {
  /** 提示文字（输入框的 label） */
  label: string;
  /** 该参数在 `Command.txt` 注释里的占位名，用于展示用法 */
  hint: string;
  /** 参数形态；`none` 时整条命令无参 */
  kind: ParamKind;
  /** `kind === 'enum'` 时的候选值 */
  options?: string[];
  /** `kind === 'number'` 时的允许范围（仅做输入提示，不拦） */
  min?: number;
  max?: number;
}

export interface CommandSpec {
  /** 命令名，含前导斜杠，如 `/str` */
  cmd: string;
  /** 中文显示名（菜单里显示的） */
  label: string;
  /** 一句话功能说明 */
  desc: string;
  /** `Command.txt` 里的用法注释，如 `<Amount>` */
  usage: string;
  /** 参数定义（按顺序拼到命令后面） */
  args: CommandArg[];
  /**
   * 渲染成「内联加点行」：`属性名 | 输入框 | [+]`。
   *
   * 只有属性类（`/str` `/agi` `/vit` `/ene`）用它 —— 这类命令的日常用法就是
   * 「一口气加 N 点」，反复弹输入框太啰嗦。`[+]` 图标用 `Accept_box01`，
   * 悬停切换 `Accept_box02`。
   *
   * 点了 [+] 走的是和双击一样的路径：`/str <输入框的值>`。
   */
  inlinePlus?: boolean;
}

export interface CommandCategory {
  /** 页签名 */
  name: string;
  /** 一句话说明这个分类是干嘛的 */
  note: string;
  commands: CommandSpec[];
}

/**
 * 17 条普通玩家命令，按功能分 5 类。
 *
 * 用法字符串全部照抄 `Command.txt` 每行末尾的注释，方便和配置文件对照。
 */
export const COMMAND_CATEGORIES: CommandCategory[] = [
  {
    name: '属性',
    note: '把升级得到的属性点分配到四项能力上',
    commands: [
      {
        cmd: '/str',
        label: '力量',
        desc: '增加力量属性',
        usage: '<Amount>',
        args: [{ label: '加点数', hint: '<Amount>', kind: 'number', min: 1, max: 32767 }],
        inlinePlus: true,
      },
      {
        cmd: '/agi',
        label: '敏捷',
        desc: '增加敏捷属性',
        usage: '<Amount>',
        args: [{ label: '加点数', hint: '<Amount>', kind: 'number', min: 1, max: 32767 }],
        inlinePlus: true,
      },
      {
        cmd: '/vit',
        label: '体力',
        desc: '增加体力属性',
        usage: '<Amount>',
        args: [{ label: '加点数', hint: '<Amount>', kind: 'number', min: 1, max: 32767 }],
        inlinePlus: true,
      },
      {
        cmd: '/ene',
        label: '智力',
        desc: '增加智力属性',
        usage: '<Amount>',
        args: [{ label: '加点数', hint: '<Amount>', kind: 'number', min: 1, max: 32767 }],
        inlinePlus: true,
      },
    ],
  },
  {
    name: '转生',
    note: '转生会降回 1 级但保留属性点，大转生是进阶版本',
    commands: [
      {
        cmd: '/reset',
        label: '转生',
        desc: '转生（降级换取属性点）',
        usage: '<Auto> <Str> <Agi> <Vit> <Ene>',
        args: [
          {
            label: '自动分配',
            hint: '<Auto>',
            kind: 'enum',
            options: ['0', '1'],
          },
          { label: '力量', hint: '<Str>', kind: 'number', min: 0, max: 32767 },
          { label: '敏捷', hint: '<Agi>', kind: 'number', min: 0, max: 32767 },
          { label: '体力', hint: '<Vit>', kind: 'number', min: 0, max: 32767 },
          { label: '智力', hint: '<Ene>', kind: 'number', min: 0, max: 32767 },
        ],
      },
      {
        cmd: '/grandreset',
        label: '大转生',
        desc: '大转生（重置转生数换取更高级奖励）',
        usage: '',
        args: [],
      },
      {
        cmd: '/pkclear',
        label: '清除 PK 值',
        desc: '洗掉红名（PK 杀人计数）',
        usage: '',
        args: [],
      },
    ],
  },
  {
    name: '资产',
    note: '金币存取与仓库',
    commands: [
      {
        cmd: '/addmoney',
        label: '增加金币',
        desc: '增加身上金币（上限 MAX_MONEY）',
        usage: '<Amount>',
        args: [{ label: '数量', hint: '<Amount>', kind: 'number', min: 1 }],
        inlinePlus: true,
      },
      {
        cmd: '/submoney',
        label: '扣除金币',
        desc: '扣除身上金币（不够则清零）',
        usage: '<Amount>',
        args: [{ label: '数量', hint: '<Amount>', kind: 'number', min: 1 }],
        inlinePlus: true,
      },
      {
        cmd: '/ware',
        label: '切换仓库',
        desc: '切换到第 N 个仓库（服务端 WarehouseNumber）',
        usage: '<Number>',
        args: [{ label: '仓库号', hint: '<Number>', kind: 'number', min: 0, max: 4 }],
        inlinePlus: true,
      },
    ],
  },
  {
    name: '社交',
    note: '公告、战盟战、足球赛与自动组队',
    commands: [
      {
        cmd: '/post',
        label: '发公告',
        desc: '发送全服公告（颜色由服务端配置）',
        usage: '<Message>',
        args: [{ label: '公告内容', hint: '<Message>', kind: 'text' }],
      },
      {
        cmd: '/war',
        label: '战盟战',
        desc: '向指定战盟发起战盟战',
        usage: '<GuildName>',
        args: [{ label: '战盟名', hint: '<GuildName>', kind: 'text' }],
      },
      {
        cmd: '/soccer',
        label: '足球赛',
        desc: '向指定战盟发起足球赛（Battle Soccer）',
        usage: '<GuildName>',
        args: [{ label: '战盟名', hint: '<GuildName>', kind: 'text' }],
      },
      {
        cmd: '/re',
        label: '自动组队',
        desc: '开启/关闭自动组队（AUTO 会带密码）',
        usage: '<ON|OFF|AUTO>',
        args: [
          {
            label: '模式',
            hint: '<ON|OFF|AUTO>',
            kind: 'enum',
            options: ['ON', 'OFF', 'AUTO'],
          },
        ],
      },
    ],
  },
  {
    name: '其它',
    note: '转职与在线查询',
    commands: [
      {
        cmd: '/evo',
        label: '转职',
        desc: '完成 Evolution 任务链（只能一次）',
        usage: '',
        args: [],
      },
      {
        cmd: '/onlines',
        label: '在线人数',
        desc: '查询当前在线人数',
        usage: '',
        args: [],
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* 面板                                                                */
/* ------------------------------------------------------------------ */

/**
 * 面板位置（640×480 逻辑坐标）—— 放右侧，避开左边的移动窗口 `(32, 12)`。
 *
 * 与移动命令窗口（M）**互斥显示**：开一个会自动关掉另一个（见 main.ts 的
 * 快捷键处理），所以两者即使位置重叠也不会同时可见。
 */
const PANEL_X = 0;
const PANEL_Y = 0;
const PANEL_W = 190;
const TOP_H = 256;
const BOT_H = 177;
const PANEL_H = TOP_H + BOT_H;

/** 预载的底板贴图 */
const SPRITES = ['Item_back01', 'Item_Back02'];

export interface CommandMenuCallbacks {
  /** 发送一条聊天指令（等价于手打）；返回是否成功 */
  send: (text: string) => boolean;
  /** 提示（发送失败 / 参数非法时用） */
  notice: (text: string) => void;
}

/**
 * 一行的控件句柄。
 *
 * 三种形态（都由 `args` 决定，见 `render()`）：
 *
 * | `args` | 控件 | 触发行 |
 * |---|---|---|
 * | `[]` | 无（只有 Accept 按钮） | 点按钮 = 直发 |
 * | `[number]` | 输入框（默认 = `arg.min`） | 点按钮 = 发 `/cmd <值>` |
 * | `[enum]` | 自绘下拉 | 选完即刻发 `/cmd <选中值>` |
 * | `[text]` | 输入框（文本） | 点按钮 = 发 `/cmd <文本>` |
 * | 多个数字（`/reset`） | 每参数一个输入框 | 点按钮 = 发 `/cmd v1 v2 …` |
 */
interface RowHandle {
  spec: CommandSpec;
  /** 该行的输入框（按参数顺序；下拉也算 input 的替代，见 `select`） */
  inputs: HTMLInputElement[];
  /** 自绘下拉的当前值（`enum` 参数用） */
  selects: { el: HTMLDivElement; value: string; options: string[] }[];
  /** 执行这一行（读控件值 → 发命令） */
  run: () => void;
}

export class CommandMenuPanel {
  readonly el: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private readonly footEl: HTMLDivElement;
  /** 所有命令行的 DOM（用于键盘选中高亮与滚动） */
  private readonly rowEls: HTMLDivElement[] = [];
  /** 每行的控件句柄（按 `COMMAND_CATEGORIES` 展平后的顺序） */
  private readonly rows: RowHandle[] = [];
  /** 当前**选中的控件焦点**所在的行下标 */
  private sel = 0;

  private open = false;
  /** 自绘下拉的当前弹层（同时只允许一个） */
  private dd: { el: HTMLDivElement; close: () => void } | null = null;

  callbacks: CommandMenuCallbacks = {
    send: () => false,
    notice: () => {},
  };

  constructor(ui: UiLayer) {
    this.el = document.createElement('div');
    this.el.className = 'cm-panel hidden';
    this.el.style.left = `${PANEL_X}px`;
    this.el.style.top = `${PANEL_Y}px`;
    this.el.style.width = `${PANEL_W}px`;
    this.el.style.height = `${PANEL_H}px`;
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel'] as const) {
      this.el.addEventListener(type, e => e.stopPropagation());
    }

    void this.buildPlates();

    const title = document.createElement('div');
    title.className = 'cm-title';
    title.textContent = '命令菜单';
    this.el.appendChild(title);

    // 右上角关闭按钮（与背包/移动面板同一套 `exit_01/02`）
    void this.buildCloseButton();

    this.listEl = document.createElement('div');
    this.listEl.className = 'cm-list';
    this.el.appendChild(this.listEl);

    this.footEl = document.createElement('div');
    this.footEl.className = 'cm-foot';
    this.el.appendChild(this.footEl);

    ui.add(this.el);
    this.render();
  }

  /**
   * 底板 = `Item_Back01`(190×256) + `Item_Back02`(190×177)，
   * 与 `RenderInventoryInterface` 一致（HUD_Pass6.cpp:220-221）。
   */
  private async buildPlates() {
    try {
      await preloadUi(SPRITES);
      const [top, bottom] = await Promise.all([uiSprite('Item_back01'), uiSprite('Item_Back02')]);
      if (top) this.el.appendChild(makePlate(top.url, 0, 0, PANEL_W, TOP_H));
      if (bottom) this.el.appendChild(makePlate(bottom.url, 0, TOP_H, PANEL_W, BOT_H));
      this.el.classList.add('cm-textured');
    } catch {
      // 拉不到贴图就退回纯色底板，功能不受影响
    }
  }

  /* ---------------------------------------------------------------- */
  /* 渲染                                                              */
  /* ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- */
  /* 渲染（单页竖排：分类小标题 + 全部命令）                            */
  /* ---------------------------------------------------------------- */

  /**
   * 重建整个列表。
   *
   * 布局：**一页放下所有 16 条命令**，按分类分小标题，超出面板高度就滚动
   * （不像以前那样用页签切分类）。
   *
   * 每行 = `名称 | 控件 | [Accept 按钮]`，控件形态由 `args` 决定：
   *
   *   - `[]`        无控件（按钮直发）
   *   - `[number]`  数字输入框（默认 = `arg.min`）
   *   - `[enum]`    自绘下拉
   *   - `[text]`    文本输入框
   *   - 多个数字    每个参数一个输入框（`/reset` 5 个）
   */
  private render() {
    this.closeDropdown();
    this.listEl.textContent = '';
    this.rowEls.length = 0;
    this.rows.length = 0;

    for (const cat of COMMAND_CATEGORIES) {
      // 分类小标题（跨整行，不可点）
      const head = document.createElement('div');
      head.className = 'cm-group';
      head.textContent = cat.name;
      head.title = cat.note;
      this.listEl.appendChild(head);

      for (const spec of cat.commands) {
        const { row, handle } = this.buildRow(spec);
        this.listEl.appendChild(row);
        this.rowEls.push(row);
        this.rows.push(handle);
      }
    }

    this.footEl.textContent = '↑↓选择  Enter执行  F/Esc关闭';
    this.select(0, false);
  }

  /**
   * 造一行：名称 + 控件 + `[Accept]` 按钮。
   *
   * 控件统一包进一个 `.cm-ctrl` 容器（flex），**不能直接塞进网格** ——
   * 网格是 `62px 1fr 24px` 三列，而 `/reset` 有 1 下拉 + 4 输入框共 5 个控件，
   * 直接塞会排到第二网格行、把 `[Accept]` 挤回第一列，和「转生」文字重叠。
   */
  private buildRow(spec: CommandSpec): { row: HTMLDivElement; handle: RowHandle } {
    const row = document.createElement('div');
    row.className = 'cm-row';
    row.title = `${spec.cmd} ${spec.usage}`.trim() + `\n${spec.desc}`;

    const name = document.createElement('span');
    name.className = 'cm-cmd';
    name.textContent = spec.label;
    row.appendChild(name);

    // 控件区：flex 横排，几个参数就几个控件，自动等分可用宽度
    const ctrl = document.createElement('div');
    ctrl.className = 'cm-ctrl';
    ctrl.classList.add(spec.args.length > 2 ? 'cm-ctrl-many' : 'cm-ctrl-few');
    row.appendChild(ctrl);

    const inputs: HTMLInputElement[] = [];
    const selects: RowHandle['selects'] = [];

    /*
     * `enum` 参数 → 自绘下拉；其余按参数逐个造输入框。
     * `/re` 是 1 个 enum、`/reset` 是 5 个参数（第 1 个 Auto 也是 enum）。
     */
    for (const arg of spec.args) {
      if (arg.kind === 'enum' && arg.options?.length) {
        const sel = this.buildDropdown(arg.options, arg.options[0]);
        selects.push(sel);
        // 多参数行里给下拉加个前缀标签，否则一堆框分不清哪个是哪个
        if (spec.args.length > 1 && arg.label) {
          sel.el.title = arg.label;
        }
        ctrl.appendChild(sel.el);
      } else {
        const wrap = document.createElement('div');
        wrap.className = 'cm-ctrl-cell';
        // 多参数行显示参数名（力量/敏捷/…），单参数行不显示（省地方）
        if (spec.args.length > 1 && arg.label) {
          const tag = document.createElement('span');
          tag.className = 'cm-ctrl-tag';
          tag.textContent = arg.label;
          wrap.appendChild(tag);
        }
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cm-inline-input';
        input.autocomplete = 'off';
        input.spellcheck = false;
        // 数字参数默认取下限（属性 1 / 仓库 0），文本参数留空
        input.value = arg.kind === 'number' ? String(arg.min ?? 1) : '';
        input.placeholder = arg.label;
        input.dataset.kind = arg.kind;
        input.addEventListener('keydown', e => {
          // 输入框里的按键不能漏给面板/全局，否则 ↑↓ 会被行选择吃掉
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            handle.run();
          }
        });
        input.addEventListener('click', e => e.stopPropagation());
        input.addEventListener('focus', () => this.selectRowOf(input));
        inputs.push(input);
        wrap.appendChild(input);
        ctrl.appendChild(wrap);
      }
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cm-inline-plus';
    btn.title = `${spec.desc}\n${spec.cmd} ${spec.usage}`.trim();
    btn.textContent = '✓';
    void this.attachAcceptIcon(btn);
    row.appendChild(btn);

    const handle: RowHandle = {
      spec,
      inputs,
      selects,
      run: () => this.runRow(handle),
    };
    btn.addEventListener('click', e => {
      e.stopPropagation();
      handle.run();
    });
    // 双击整行 = 执行（键盘 Enter 同路径）
    row.addEventListener('dblclick', () => handle.run());
    row.addEventListener('mouseenter', () => {
      if (inputs.some(i => i === document.activeElement)) return;
      this.selectRowOf(row);
    });

    return { row, handle };
  }

  /**
   * 自绘下拉（原版风格）。
   *
   * 不用原生 `<select>` —— 原生控件的弹出层在缩放层里样式跑偏，
   * 也没法做成和 `Item_Back` 底板一致的深色金边。这里自己画：
   * 收起态显示当前值 + `▾`，点击在下方弹一个列表，选中即写回。
   */
  private buildDropdown(options: string[], initial: string) {
    const el = document.createElement('div');
    el.className = 'cm-select';

    const value = document.createElement('span');
    value.className = 'cm-select-value';
    value.textContent = initial;

    const caret = document.createElement('span');
    caret.className = 'cm-select-caret';
    caret.textContent = '▾';

    el.append(value, caret);
    const rec = { el, value: initial, options };

    el.addEventListener('click', e => {
      e.stopPropagation();
      this.toggleDropdown(rec, value);
    });
    return rec;
  }

  /** 打开 / 关闭某个下拉的弹层（同时只允许一个） */
  private toggleDropdown(rec: RowHandle['selects'][number], valueEl: HTMLElement) {
    const prev = this.dd?.el;
    const key = rec.options.join('|');
    this.closeDropdown();
    // 点的是刚关掉的那个 → 不再重开，实现 toggle
    if (prev && prev.dataset.for === key) return;

    const menu = document.createElement('div');
    menu.className = 'cm-select-menu';
    menu.dataset.for = key;
    for (const opt of rec.options) {
      const item = document.createElement('div');
      item.className = 'cm-select-item' + (opt === rec.value ? ' on' : '');
      item.textContent = opt;
      item.addEventListener('click', e => {
        e.stopPropagation();
        rec.value = opt;
        valueEl.textContent = opt;
        this.closeDropdown();
      });
      menu.appendChild(item);
    }
    /*
     * 挂在面板上（绝对定位）而不是行里 —— 行在 `.cm-list` 里，
     * 那个容器 `overflow-y: auto` 会把弹层裁掉。
     */
    this.el.appendChild(menu);
    const box = rec.el.getBoundingClientRect();
    const panel = this.el.getBoundingClientRect();
    const sc = panel.width / PANEL_W; // 逻辑 → 屏幕像素的缩放比
    menu.style.left = `${(box.left - panel.left) / sc}px`;
    menu.style.top = `${(box.bottom - panel.top) / sc}px`;
    menu.style.minWidth = `${box.width / sc}px`;
    this.dd = { el: menu, close: () => menu.remove() };
  }

  private closeDropdown() {
    this.dd?.close();
    this.dd = null;
  }

  /** 执行一行：读控件值 → 拼命令 → 发 */
  private runRow(handle: RowHandle) {
    const { spec, inputs, selects } = handle;
    if (!spec.args.length) {
      this.fire(spec, []);
      return;
    }

    const values: string[] = [];
    let ii = 0;
    let si = 0;
    for (const arg of spec.args) {
      if (arg.kind === 'enum') {
        values.push(selects[si++]?.value ?? arg.options?.[0] ?? '');
        continue;
      }
      const input = inputs[ii++];
      const raw = (input?.value ?? '').trim();
      if (arg.kind === 'text') {
        if (!raw) {
          this.callbacks.notice(`「${arg.label}」不能为空`);
          return;
        }
        values.push(raw);
        continue;
      }
      // 数字：支持一次填多个（如 `/reset` 的框里敲 `100 100 100 100`）
      const nums = raw.split(/\s+/).filter(Boolean);
      if (!nums.length) {
        this.callbacks.notice(`「${arg.label}」不能为空`);
        return;
      }
      for (const n of nums) {
        if (!/^\d+$/.test(n)) {
          this.callbacks.notice(`「${arg.label}」需要整数`);
          return;
        }
        const v = Number(n);
        if (arg.min !== undefined && v < arg.min) {
          this.callbacks.notice(`「${arg.label}」不能小于 ${arg.min}`);
          return;
        }
        if (arg.max !== undefined && v > arg.max) {
          this.callbacks.notice(`「${arg.label}」不能大于 ${arg.max}`);
          return;
        }
        values.push(n);
      }
    }
    this.fire(spec, values);
  }

  /**
   * 右上角关闭按钮 —— `exit_01`（悬停 `exit_02`），位置与背包一致。
   *
   * 0.97 原版没有这个窗口，关闭原本只能按 F / Esc；
   * 鼠标用户需要一个显式出口，故与背包 / 移动面板统一。
   */
  private async buildCloseButton() {
    try {
      const [ex1, ex2] = await Promise.all([uiSprite('exit_01'), uiSprite('exit_02')]);
      if (!ex1) return;
      const close = document.createElement('img');
      close.src = ex1.url;
      close.className = 'cm-close';
      close.draggable = false;
      close.title = '关闭 (F)';
      close.style.imageRendering = 'pixelated';
      if (ex2) {
        close.addEventListener('mouseenter', () => (close.src = ex2!.url));
        close.addEventListener('mouseleave', () => (close.src = ex1.url));
      }
      close.addEventListener('click', e => {
        e.stopPropagation();
        this.closeDropdown();
        this.hide();
      });
      this.el.appendChild(close);
    } catch {
      // 拉不到图标就不给关闭按钮，F / Esc 也能关
    }
  }

  /** 把 `Accept_box01/02` 图标贴到执行按钮上（异步；失败就留文字 ✓） */
  private async attachAcceptIcon(btn: HTMLButtonElement) {    try {
      const [normal, hover] = await Promise.all([uiSprite('Accept_box01'), uiSprite('Accept_box02')]);
      if (!normal) return;
      btn.textContent = '';
      const img = document.createElement('img');
      img.src = normal.url;
      img.draggable = false;
      img.style.imageRendering = 'pixelated';
      btn.appendChild(img);
      if (hover) {
        btn.addEventListener('mouseenter', () => (img.src = hover.url));
        btn.addEventListener('mouseleave', () => (img.src = normal.url));
      }
    } catch {
      // 载不到图标就保留文字 ✓
    }
  }

  /** 选中一行（键盘 ↑↓ / 鼠标悬停） */
  private select(index: number, refresh = true) {
    const n = this.rows.length;
    if (!n) return;
    this.sel = Math.max(0, Math.min(n - 1, index));
    if (refresh) this.paint();
  }

  /** 按控件反查它所在的行并选中 */
  private selectRowOf(node: HTMLElement) {
    const row = node.closest('.cm-row') as HTMLDivElement | null;
    if (!row) return;
    const i = this.rowEls.indexOf(row);
    if (i >= 0) this.select(i);
  }

  /** 只重画行状态（比 render 便宜，键盘连续移动时用） */
  private paint() {
    this.rowEls.forEach((r, i) => r.classList.toggle('sel', i === this.sel));
    const row = this.rowEls[this.sel];
    if (!row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < this.listEl.scrollTop) this.listEl.scrollTop = top;
    else if (bottom > this.listEl.scrollTop + this.listEl.clientHeight) {
      this.listEl.scrollTop = bottom - this.listEl.clientHeight;
    }
  }

  /** 真正发送 */
  private fire(spec: CommandSpec, values: string[]) {
    const line = `${spec.cmd}${values.length ? ' ' + values.join(' ') : ''}`;
    const ok = this.callbacks.send(line);
    if (!ok) this.callbacks.notice(`「${spec.cmd}」发送失败（当前不在线）`);
    else this.callbacks.notice(`已发送：${line}`);
    /*
     * 留一条控制台日志 —— 加点后如果 C 面板没动，看这里有没有「已发出」，
     * 就能分清是「命令没发出去」还是「回包没到/没解析」。
     * 服务端侧对应的回包是 `0xF3/0x06`（四维）+ `0xF3/0xE0`（扩展包）。
     */
    console.log(`[cmd] ${ok ? '发出' : '失败'} ${line}`);
  }

  /* ---------------------------------------------------------------- */
  /* 开关与键盘                                                        */
  /* ---------------------------------------------------------------- */

  show() {
    this.open = true;
    this.el.classList.remove('hidden');
    this.render();
  }

  hide() {
    this.closeDropdown();
    this.open = false;
    this.el.classList.add('hidden');
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
    return this.open;
  }

  get isOpen() {
    return this.open;
  }

  /**
   * 键盘：↑↓ 选行、Enter 执行、Esc/F 关窗。
   *
   * 单页版去掉了「←→ 切分类」与「数字跳分类」（分类不再是页签），
   * 但保留 ↑↓ 与 Enter —— 不用鼠标也能逐条执行。
   */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.open) return false;
    if (e.code === 'Escape' || e.code === 'KeyF') {
      e.preventDefault();
      // 下拉开着时先收起下拉，再按才关窗
      if (this.dd) this.closeDropdown();
      else this.hide();
      return true;
    }
    /*
     * 面板互斥键要**放行**给主处理器：命令菜单开着时按 M 应该切到移动窗口
     * （`main.ts` 里 M 分支会 `commandMenu.hide()`）。如果这里吞掉，就变成
     * 「菜单开着按 M 没反应」。同理 C / I / V 这些面板键也放行。
     */
    if (e.code === 'KeyM' || e.code === 'KeyC' || e.code === 'KeyI' || e.code === 'KeyV') return false;
    // 光标在输入框里时，按键交给输入框自己处理（否则打不了字）
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && this.el.contains(active)) return true;
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      this.select(this.sel + (e.code === 'ArrowUp' ? -1 : 1));
      return true;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      e.preventDefault();
      this.rows[this.sel]?.run();
      return true;
    }
    return true; // 其余按键吞掉，避免误触游戏（WASD 走路等）
  }

  /** 调试快照 */
  snapshot() {
    return {
      open: this.open,
      sel: this.sel,
      /** 每一行的控件状态（输入框值 / 下拉当前值） */
      rows: this.rows.map(r => ({
        cmd: r.spec.cmd,
        label: r.spec.label,
        inputs: r.inputs.map(i => i.value),
        selects: r.selects.map(s => s.value),
        args: r.spec.args.map(a => a.kind),
      })),
      /** 兼容旧探针：所有带数字参数的行 */
      inline: this.rows
        .filter(r => r.spec.args.some(a => a.kind === 'number'))
        .map(r => ({
          cmd: r.spec.cmd,
          label: r.spec.label,
          value: r.inputs[0]?.value ?? '',
        })),
      categories: COMMAND_CATEGORIES.map(c => ({
        name: c.name,
        note: c.note,
        commands: c.commands.map(s => ({
          cmd: s.cmd,
          label: s.label,
          args: s.args.length,
          inlinePlus: !!s.inlinePlus,
        })),
      })),
    };
  }

  /** 探针口：选中第 i 行（走和键盘 ↑↓ 一样的路径） */
  debugSelectRow(i: number) {
    this.select(i);
    return this.sel;
  }

  /**
   * 探针口：操作某一行 —— 按 `cmd` 找行，写入控件值，然后执行。
   *
   * 走的是**真实 DOM 路径**（改 input.value + 触发按钮 click），
   * 所以验的就是用户手点的那条链路。
   */
  debugRun(cmd: string, values: string[] = []) {
    const idx = this.rows.findIndex(r => r.spec.cmd === cmd);
    if (idx < 0) return { ok: false, reason: 'no-such-command', cmd };
    const r = this.rows[idx];
    let ii = 0;
    let si = 0;
    for (const arg of r.spec.args) {
      const v = values[ii + si];
      if (arg.kind === 'enum') {
        const sel = r.selects[si];
        si++;
        if (sel && v !== undefined) {
          sel.value = v;
          const lbl = sel.el.querySelector('.cm-select-value');
          if (lbl) lbl.textContent = v;
        }
      } else {
        const inp = r.inputs[ii];
        ii++;
        if (inp && v !== undefined) inp.value = v;
      }
    }
    // 走真实点击（btn.click() 会触发 handle.run）
    const btn = this.rowEls[idx]?.querySelector('.cm-inline-plus');
    if (btn instanceof HTMLElement) btn.click();
    else r.run();
    return { ok: true, cmd, values };
  }

  /** 探针口：读某行的下拉选项（验 enum 是否渲染成下拉） */
  debugOptions(cmd: string) {
    const r = this.rows.find(x => x.spec.cmd === cmd);
    if (!r) return null;
    return r.selects.map(s => ({ value: s.value, options: s.options }));
  }

  /** 探针口：打开某行的下拉弹层（验自绘弹层能出来） */
  debugOpenDropdown(cmd: string) {
    const r = this.rows.find(x => x.spec.cmd === cmd);
    const sel = r?.selects[0];
    if (!sel) return false;
    (sel.el as HTMLElement).click();
    return !!this.dd;
  }

  /** 探针口：下拉弹层里可见的选项文本 */
  debugDropdownItems() {
    const menu = this.el.querySelector('.cm-select-menu');
    if (!menu) return null;
    return [...menu.querySelectorAll('.cm-select-item')].map(i => i.textContent);
  }

  /** 探针口：点下拉里的第 i 项（验选中后写回） */
  debugPickDropdown(i: number) {
    const menu = this.el.querySelector('.cm-select-menu');
    if (!menu) return false;
    const it = menu.querySelectorAll('.cm-select-item')[i];
    if (!(it instanceof HTMLElement)) return false;
    it.click();
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

/** 绝对定位的底板贴图（与 moveCommand/npcPanel 同款） */
function makePlate(url: string, x: number, y: number, w: number, h: number): HTMLImageElement {
  const img = document.createElement('img');
  img.src = url;
  img.draggable = false;
  img.className = 'cm-sprite';
  img.style.left = `${x}px`;
  img.style.top = `${y}px`;
  img.style.width = `${w}px`;
  img.style.height = `${h}px`;
  img.style.imageRendering = 'pixelated';
  return img;
}
