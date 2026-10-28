/**
 * 移动命令窗口（M 键）。
 *
 * 数据全部来自服务端表：`Move.txt`（价格 / 等级门槛 / 门号）+ `Gate.txt`（落点矩形），
 * 由 `src/world/warp.ts` 合并成 `WarpEntry[]`。窗口只订阅 `warpTable.onChange`，
 * 表被服务端整表替换时自己重画 —— 所以以后接入服务端同步不用改这个文件。
 *
 * 显示规则（和老版本一致）：
 *   - 缺翅膀 / 等级不够 / 金币不够 / 转生不够 → 整行变红，点了不给走，底下一行小字说原因
 *   - 跨图**没有客户端上行包**：0x1C 只用于「我站在门格上，请确认」，
 *     服务端还会 `gGate.IsInGate()` 复核。真正的付费传送是服务端命令
 *     `/move <Move.txt 的 key>`（`CMove::Move` 里校验等级/金币/转生并扣钱），
 *     所以在线模式点「移动」= 发这条命令，价格和落点都以服务端为准；
 *     离线演示才真的本地切图
 *
 * 坐标放在 `UiLayer` 的 640×480 逻辑坐标里，跟着舞台等比缩放（和背包/属性面板一致），
 * 不用舞台像素，否则窗口大小会跟随窗口尺寸漂移。
 */
import { UiLayer } from './frame';
import { warpTable, type WarpEntry } from '../world/warp';

/** 面板位置（640×480 逻辑坐标） */
const PANEL_X = 202;
const PANEL_Y = 72;
const PANEL_W = 236;

export interface MoveCommandStatus {
  /** 角色等级；0 = 未知（离线演示没有角色卡，按「不限制」处理） */
  level: number;
  /** 身上金币；-1 = 未知（离线演示） */
  money: number;
  /** 转生次数；0 = 未知 / 不校验 */
  reset: number;
  /** 是否装备了翅膀（天空之城要它） */
  wings: boolean;
}

export class MoveCommandPanel {
  readonly el: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private readonly rowEls: HTMLDivElement[] = [];

  private open = false;
  private sel = 0;

  /** 每次打开前由 main.ts 刷新 */
  status: MoveCommandStatus = { level: 0, money: -1, reset: 0, wings: false };

  /** 点了「移动」（在线/离线的判定交给 main.ts，那边才知道会话状态） */
  onWarp: (entry: WarpEntry) => void = () => {};

  constructor(ui: UiLayer) {
    this.el = document.createElement('div');
    this.el.className = 'mv-panel hidden';
    this.el.style.left = `${PANEL_X}px`;
    this.el.style.top = `${PANEL_Y}px`;
    this.el.style.width = `${PANEL_W}px`;
    // 面板上的点击不要漏给 3D 画面（点地板会走位）
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel'] as const) {
      this.el.addEventListener(type, e => e.stopPropagation());
    }

    const title = document.createElement('div');
    title.className = 'mv-title';
    title.textContent = '移动命令';
    this.el.appendChild(title);

    const head = document.createElement('div');
    head.className = 'mv-head';
    for (const t of ['纷争', '地图名称', '等级', '金币']) {
      const c = document.createElement('span');
      c.textContent = t;
      head.appendChild(c);
    }
    this.el.appendChild(head);

    this.listEl = document.createElement('div');
    this.listEl.className = 'mv-list';
    this.el.appendChild(this.listEl);

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'mv-hint';
    this.el.appendChild(this.hintEl);

    const btns = document.createElement('div');
    btns.className = 'mv-btns';
    btns.append(this.button('移 动', () => this.confirm()), this.button('关 闭', () => this.hide()));
    this.el.appendChild(btns);

    ui.add(this.el);

    // 表来自服务端（可能晚于窗口创建 / 运行中整表替换），所以行是动态重建的
    warpTable.onChange(() => this.rebuild());
    this.rebuild();
  }

  private button(text: string, onClick: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mv-btn';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  /** 表变了：重建成新行（选中位置尽量保留） */
  private rebuild() {
    const entries = warpTable.entries;
    const keep = entries[Math.min(this.sel, entries.length - 1)];
    this.rowEls.length = 0;
    this.listEl.textContent = '';

    entries.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'mv-row';
      row.dataset.index = String(entry.index);

      const texts = [
        entry.conflict ? '争' : '',
        entry.name,
        String(entry.minLevel),
        String(entry.money),
      ];
      texts.forEach((text, col) => {
        const c = document.createElement('span');
        c.className = 'mv-cell' + (col === 0 ? ' mv-conflict' : '') + (col >= 2 ? ' mv-num' : '');
        c.textContent = text;
        row.appendChild(c);
      });

      row.addEventListener('mouseenter', () => {
        if (!this.open) return;
        this.select(i, false);
      });
      row.addEventListener('click', () => {
        if (!this.open) return;
        this.select(i, false);
      });
      row.addEventListener('dblclick', () => {
        if (!this.open) return;
        this.select(i, false);
        this.confirm();
      });

      this.listEl.appendChild(row);
      this.rowEls.push(row);
    });

    this.sel = Math.max(0, keep ? entries.indexOf(keep) : 0);
    this.refresh();
  }

  /* ---------------------------------------------------------------- */
  /* 状态                                                              */
  /* ---------------------------------------------------------------- */

  /** 这一条现在能不能走；能走返回 null，不能走返回原因 */
  private problem(e: WarpEntry): string | null {
    /*
     * 服务端 `F3/E5` 已经按角色算过一遍门槛（`gGate.GetMoveLevel` 会看 VIP
     * 账号等级），它说不行就肯定不行 —— 放在最前面，避免本地那套等级判断
     * 和服务端打架（本地表是 `Move.txt` 的原始值，没算账号等级加成）。
     */
    if (e.canMove === false) return '服务端未开放（等级/转生/账号等级不足）';
    // 顺序照服务端 `MapSvrMoveReq` 的校验：翅膀 → 等级上限 → 等级下限 → 转生 → 金币
    if (e.needWings && !this.status.wings) return '需要装备翅膀';
    if (this.status.level > 0 && e.maxLevel > 0 && this.status.level > e.maxLevel) {
      return `等级过高（上限 ${e.maxLevel} 级）`;
    }
    if (this.status.level > 0 && this.status.level < e.minLevel) {
      return `等级不足（需要 ${e.minLevel} 级）`;
    }
    if (this.status.reset > 0 && e.minReset > 0 && this.status.reset < e.minReset) {
      return `转生不足（需要 ${e.minReset} 转）`;
    }
    if (this.status.money >= 0 && this.status.money < e.money) {
      return `金币不足（需要 ${e.money}）`;
    }
    return null;
  }

  /**
   * 选中第 index 条（`scroll` = 要不要把它滚进可视区）。
   *
   * 公开是为了让调试口 / 探针走和键盘完全一样的路径 —— 直接调 `onWarp`
   * 会跳过 `problem()` 的门槛校验，测出来的东西不算数。
   */
  select(index: number, scroll = true) {
    const n = warpTable.entries.length;
    if (!n) return;
    this.sel = Math.max(0, Math.min(n - 1, index));
    this.refresh();
    if (scroll) {
      const row = this.rowEls[this.sel];
      const list = this.listEl;
      if (!row) return;
      const top = row.offsetTop;
      const bottom = top + row.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    }
  }

  /** 重画所有行的状态（打开时 / 等级金币变了时） */
  refresh() {
    const entries = warpTable.entries;
    for (let i = 0; i < entries.length; i++) {
      const row = this.rowEls[i];
      if (!row) continue;
      row.classList.toggle('sel', i === this.sel);
      row.classList.toggle('locked', this.problem(entries[i]) !== null);
    }
    const entry = entries[this.sel];
    const bad = entry ? this.problem(entry) : null;
    this.hintEl.textContent = bad ? `${entry.name}：${bad}` : '';
    this.hintEl.classList.toggle('show', bad !== null);
  }

  /* ---------------------------------------------------------------- */
  /* 开关                                                              */
  /* ---------------------------------------------------------------- */

  show() {
    this.open = true;
    this.el.classList.remove('hidden');
    this.refresh();
    // 打开时把选中行滚进视野（23 条一屏放不下）
    this.select(this.sel);
  }

  hide() {
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

  /** 上下选（键盘） */
  move(delta: number) {
    this.select(this.sel + delta);
  }

  /** Home / End：跳到首 / 尾（`dir` = -1 / 1） */
  jump(dir: number) {
    this.select(dir < 0 ? 0 : warpTable.entries.length - 1);
  }

  /** 当前选中的条目 */
  get current(): WarpEntry | null {
    return warpTable.entries[this.sel] ?? null;
  }

  /** 确认传送 */
  confirm() {
    const entry = this.current;
    if (!entry) return;
    const bad = this.problem(entry);
    if (bad) {
      this.hintEl.textContent = `${entry.name}：${bad}`;
      this.hintEl.classList.add('show');
      const row = this.rowEls[this.sel];
      if (row) {
        row.classList.remove('shake');
        // 强制重排才能重放动画
        void row.offsetWidth;
        row.classList.add('shake');
      }
      return;
    }
    this.onWarp(entry);
  }

  /** 调试快照 */
  snapshot() {
    return {
      open: this.open,
      sel: this.sel,
      status: { ...this.status },
      table: warpTable.snapshot(),
      entries: warpTable.entries.map(e => ({
        index: e.index,
        key: e.key,
        mapId: e.mapId,
        name: e.name,
        level: e.minLevel,
        zen: e.money,
        gate: e.gate,
        spawn: e.spawn,
        dir: e.dir,
        conflict: e.conflict,
        problem: this.problem(e),
      })),
    };
  }
}
