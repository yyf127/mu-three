/**
 * 队伍窗口（0x40-0x44）—— 逐像素照 Win 端 `RenderParty(450, 0)`
 * （`HUD_Pass6.cpp:473-712`，IDA 0x4EF160）。
 *
 * 原版有**两种形态**，这里是两套 DOM：
 *
 *   1. **面板**（底栏队伍图标 / `P`）：(450, 0) 190×433
 *      `Item_Back01` 190×256 + `Item_Back02` 190×177（贴图 0x104 / 0x105），
 *      5 行成员（名字 / 地图 + 坐标 / 血条 / (cur/max) / 踢人），
 *      关闭按钮在 (25, 395)，贴图 `exit_01` 0x118 / 按下 `exit_02` 0x119。
 *
 *   2. **紧凑血条**（面板没开、但队伍里有人的时候）：贴在**屏幕右缘**，
 *      宽度 50、行高 19、从 y=5 开始，每行 10 格血量。
 *      原版就是这样常驻显示队友血量的 —— 不用开面板也能看到谁快死了。
 *      上下两条 54×3 的盖片是贴图 0xFC `Message_box2`，左右各一条 1px 竖线。
 *
 * 行内坐标全部来自源码字面量（`a1+20 / a2+52+35*row` 那一串），
 * 用 9px 宋体是因为原版 `g_hFont` 在 640×480 下的实际字高就是 9px 左右 ——
 * 换成 12px 会把四行文字挤到一起。
 *
 * 三个容易做错的地方：
 *
 *   - **行首是 `PartyNumber` 的第 0 行（队长），不是「我」**。原版给第 0 行
 *     文字加了 `m_dwBackColor = 0xFF962828` 的暗红底（`row == 0` 分支）。
 *   - **踢人按钮不是每行都有**：`if (!strcmp(Party, Hero->Name) || !strcmp(row, Hero->Name))`。
 *     队长匹配上 `Party`（第 0 行）就对**所有行**成立 → 队长能踢所有人；
 *     普通队员只有自己那一行匹配，点它就是退队。
 *   - **紧凑列表的 x 跟着右侧面板走**：`GetScreenWidth() - 50`，右面板开着是
 *     450、全关是 640。所以开背包时它会自动左移，不会压在背包上。
 */
import type { UiLayer } from './frame';
import { uiSprite } from './ozj';
import type { PartyMember } from '../net/game';
import { getMapDefinition } from '../world/maps';

const PANEL = { x: 450, y: 0, w: 190, h: 433 };

/** 行内坐标（相对面板左上角），全部照抄 `RenderParty` 的字面量 */
const ROW = {
  pitch: 35,
  nameX: 20,
  nameY: 52,
  subY: 60,
  mapX: 40,
  coordX: 90,
  barX: 39,
  barY: 69,
  barW: 92,
  fillX: 40,
  fillW: 90,
  hpX: 65,
  hpY: 77,
  kickX: 140,
  kickY: 55,
} as const;

const TITLE = { x: 35, y: 11, w: 120 } as const;
const CLOSE = { x: 25, y: 395, size: 24 } as const;
/** 邀请条：放在成员区和关闭按钮之间（成员最后一行到 217，关闭按钮在 395） */
const INVITE = { x: 14, y: 296, w: 162, h: 30 } as const;

/** 紧凑列表的尺寸（照 `RenderParty` 的 else 分支） */
const COMPACT = {
  w: 50,
  h: 19,
  top: 5,
  capW: 54,
  capH: 3,
} as const;

/** 空队伍时那 7 行提示的 y（`i<3: 50+15i / i==3: 100 / else: 100+15*(i-3)`） */
const EMPTY_Y = [50, 65, 80, 100, 115, 130, 145];

const TEXT = {
  title: '队伍',
  empty: [
    '在你想要组队的玩家面前',
    '输入 /party 就可以邀请他',
    '对方接受后队伍就成立了',
    '队伍最多 5 人',
    '队长可以踢出队员',
    '队伍里成员等级越高',
    '一起打怪分到的经验越多',
  ],
  kick: '踢出队伍 / 离开队伍',
  close: '关闭队伍 (P)',
};

export class PartyPanel {
  /** 面板本体（450,0 190×433） */
  private el: HTMLDivElement;
  /** 紧凑血条（屏幕右缘，独立于面板） */
  private compactEl: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private rowsEl: HTMLDivElement;
  private emptyEl: HTMLDivElement;
  private closeBtn: HTMLButtonElement;

  private inviteEl: HTMLDivElement;
  private inviteText: HTMLDivElement;
  private acceptBtn: HTMLButtonElement;
  private declineBtn: HTMLButtonElement;

  private members: PartyMember[] = [];
  /** 队伍位置 → 血量十等分（0x44 下发） */
  private lifeTenths = new Map<number, number>();
  private nearby: { id: number; name: string }[] = [];
  private invite: { index: number; name: string } | null = null;
  private open = false;

  /** 视野里的玩家名字（紧凑列表用它判断「成员是否在视野内」） */
  private viewport = new Set<string>();
  /** 自己的名字（踢人按钮的显示条件之一） */
  private selfName = '';
  /** 右侧面板的起点 x：原版 `GetScreenWidth()`，450 或 640 */
  private rightEdge = 640;
  /** 紧凑血条的起始 Y（右上角有小地图时要往下让开，见 `setTopOffset`） */
  private topOffset = 0;
  /** 上一次画紧凑列表用的状态，用来避免每帧重建 DOM */
  private compactSig = '';

  private closeImg!: HTMLImageElement;
  private compactCaps: HTMLImageElement[] = [];

  onInvite: ((id: number) => void) | null = null;
  onKick: ((number: number) => void) | null = null;
  onAccept: ((index: number) => void) | null = null;
  onDecline: ((index: number) => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(layer: UiLayer) {
    /* ---------------- 面板 ---------------- */
    this.el = document.createElement('div');
    this.el.className = 'party-panel hidden';
    this.el.style.left = `${PANEL.x}px`;
    this.el.style.top = `${PANEL.y}px`;
    this.el.style.width = `${PANEL.w}px`;
    this.el.style.height = `${PANEL.h}px`;
    layer.add(this.el);
    this.el.addEventListener('contextmenu', e => e.preventDefault());

    /*
     * 底板先建、`src` 后填。
     *
     * 事件窗口那边踩过一次：底板是在 `await uiSprite()` **之后**才 append 的，
     * 结果异步回来的时候盖住了早就建好的行。这里反过来 —— 先把 `<img>`
     * 占好位置（哪怕还没 src），加载完只赋值，层级就永远在 rows 下面。
     */
    this.buildPlate('item_back01', 0, 0, 190, 256);
    this.buildPlate('item_back02', 0, 256, 190, 177);

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'party-title';
    this.titleEl.style.left = `${TITLE.x}px`;
    this.titleEl.style.top = `${TITLE.y - 1}px`;
    this.titleEl.style.maxWidth = `${TITLE.w}px`;
    this.titleEl.textContent = TEXT.title;
    this.el.appendChild(this.titleEl);

    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'party-empty';
    TEXT.empty.forEach((line, i) => {
      const div = document.createElement('div');
      div.className = 'party-empty-line';
      div.style.left = '20px';
      div.style.top = `${EMPTY_Y[i] - 1}px`;
      div.textContent = line;
      this.emptyEl.appendChild(div);
    });
    this.el.appendChild(this.emptyEl);

    this.rowsEl = document.createElement('div');
    this.rowsEl.className = 'party-rows';
    this.el.appendChild(this.rowsEl);

    /* 关闭按钮：exit_01 / exit_02（贴图 0x118 / 0x119） */
    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'party-icon-btn party-close';
    this.closeBtn.style.left = `${CLOSE.x}px`;
    this.closeBtn.style.top = `${CLOSE.y}px`;
    this.closeBtn.style.width = `${CLOSE.size}px`;
    this.closeBtn.style.height = `${CLOSE.size}px`;
    this.closeBtn.title = TEXT.close;
    this.closeImg = document.createElement('img');
    this.closeImg.draggable = false;
    this.closeBtn.appendChild(this.closeImg);
    this.closeBtn.addEventListener('click', () => this.onClose?.());
    this.el.appendChild(this.closeBtn);
    void this.loadIcon(this.closeImg, 'exit_01');

    /* 邀请条 */
    this.inviteEl = document.createElement('div');
    this.inviteEl.className = 'party-invite hidden';
    this.inviteEl.style.left = `${INVITE.x}px`;
    this.inviteEl.style.top = `${INVITE.y}px`;
    this.inviteEl.style.width = `${INVITE.w}px`;
    this.inviteEl.style.height = `${INVITE.h}px`;
    this.inviteText = document.createElement('div');
    this.inviteText.className = 'party-invite-text';
    this.acceptBtn = document.createElement('button');
    this.acceptBtn.type = 'button';
    this.acceptBtn.className = 'party-btn party-accept';
    this.acceptBtn.textContent = '接受';
    this.declineBtn = document.createElement('button');
    this.declineBtn.type = 'button';
    this.declineBtn.className = 'party-btn party-decline';
    this.declineBtn.textContent = '拒绝';
    this.inviteEl.append(this.inviteText, this.acceptBtn, this.declineBtn);
    this.acceptBtn.addEventListener('click', () => {
      const inv = this.invite;
      this.hideInvite();
      if (inv) this.onAccept?.(inv.index);
    });
    this.declineBtn.addEventListener('click', () => {
      const inv = this.invite;
      this.hideInvite();
      if (inv) this.onDecline?.(inv.index);
    });
    this.el.appendChild(this.inviteEl);

    /* ---------------- 紧凑血条 ---------------- */
    this.compactEl = document.createElement('div');
    this.compactEl.className = 'party-compact hidden';
    this.compactEl.style.left = `${this.rightEdge - COMPACT.w}px`;
    this.compactEl.style.top = `${this.topOffset}px`;
    layer.add(this.compactEl);

    // 上下两条盖片（贴图 0xFC = Message_box2，54×3）
    for (let i = 0; i < 2; i++) {
      const img = document.createElement('img');
      img.className = 'party-compact-cap';
      img.draggable = false;
      img.style.width = `${COMPACT.capW}px`;
      img.style.height = `${COMPACT.capH}px`;
      img.style.left = '-5px';
      this.compactEl.appendChild(img);
      this.compactCaps.push(img);
      void this.loadIcon(img, 'message_box2');
    }
  }

  /* ------------------------------------------------------------------ */
  /* 底板 / 图标                                                         */
  /* ------------------------------------------------------------------ */

  private buildPlate(key: string, x: number, y: number, w: number, h: number) {
    const img = document.createElement('img');
    img.className = 'party-plate';
    img.draggable = false;
    img.style.left = `${x}px`;
    img.style.top = `${y}px`;
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    this.el.appendChild(img);
    void this.loadIcon(img, key);
  }

  /** 异步填 `src`。失败只留一个空盒子，不影响布局和点击 */
  private async loadIcon(img: HTMLImageElement, key: string) {
    const spr = await uiSprite(key);
    if (!spr) {
      console.warn(`[party] 贴图 ${key} 载入失败`);
      return;
    }
    img.src = spr.url;
    img.style.imageRendering = 'pixelated';
  }

  /* ------------------------------------------------------------------ */
  /* 对外状态                                                            */
  /* ------------------------------------------------------------------ */

  get isOpen() {
    return this.open;
  }

  get pendingInvite() {
    return this.invite;
  }

  /** 队伍成员（main.ts 的 `/party` 命令用它判断「我是不是队长」） */
  get memberList() {
    return this.members;
  }

  show() {
    this.open = true;
    this.el.classList.remove('hidden');
    this.paint();
  }

  hide() {
    this.open = false;
    this.el.classList.add('hidden');
    this.paint();
  }

  setMembers(members: PartyMember[]) {
    this.members = members;
    // 0x44 的十等分血量是「上一份」的，成员表变了就以新表为准重算
    this.lifeTenths.clear();
    for (const m of members) {
      const max = m.maxLife || 1;
      this.lifeTenths.set(m.number, clamp10(Math.round((m.life / max) * 10)));
    }
    this.paint();
  }

  /** 0x44：只更新血量（十等分） */
  setLife(list: { number: number; tenths: number }[]) {
    let changed = false;
    for (const l of list) {
      const v = clamp10(l.tenths);
      if (this.lifeTenths.get(l.number) !== v) changed = true;
      this.lifeTenths.set(l.number, v);
    }
    if (changed) this.paint();
  }

  setNearby(list: { id: number; name: string }[]) {
    this.nearby = list;
  }

  /** 视野内玩家的名字（紧凑列表判断「在不在视野」用） */
  setViewport(names: string[]) {
    const next = new Set(names);
    if (next.size === this.viewport.size) {
      let same = true;
      for (const n of next) {
        if (!this.viewport.has(n)) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    this.viewport = next;
    this.paintCompact();
  }

  setSelf(name: string) {
    if (name === this.selfName) return;
    this.selfName = name;
    this.paint();
  }

  /** 右侧面板的起点（原版 `GetScreenWidth()`：450 或 640） */
  /** 往下让开一段（小地图占了右上角） */
  setTopOffset(px: number) {
    const v = Math.max(0, Math.round(px));
    if (v === this.topOffset) return;
    this.topOffset = v;
    this.compactEl.style.top = `${v}px`;
  }

  setRightEdge(px: number) {
    if (px === this.rightEdge) return;
    this.rightEdge = px;
    this.paintCompact();
  }

  showInvite(index: number, name: string) {
    this.invite = { index, name };
    this.inviteText.textContent = `${name} 邀请你组队`;
    this.inviteEl.classList.remove('hidden');
  }

  hideInvite() {
    this.invite = null;
    this.inviteEl.classList.add('hidden');
  }

  /* ------------------------------------------------------------------ */
  /* 绘制                                                                */
  /* ------------------------------------------------------------------ */

  private paint() {
    const hasParty = this.members.length > 0;
    this.emptyEl.classList.toggle('hidden', hasParty);
    this.titleEl.classList.toggle('party-title-active', hasParty);

    this.rowsEl.textContent = '';
    const isLeader = this.selfName !== '' && this.members[0]?.name === this.selfName;
    this.members.forEach((m, i) => {
      const y = i * ROW.pitch;
      // 原版：第 0 行文字带 0xFF962828 的暗红底
      const leader = i === 0;

      const name = this.textEl('party-name', m.name, ROW.nameX, ROW.nameY + y);
      if (leader) name.classList.add('party-row-hl');

      const map = this.textEl('party-sub', getMapDefinition(m.map).name, ROW.mapX, ROW.subY + y);
      if (leader) map.classList.add('party-row-hl');

      const coord = this.textEl('party-sub', `${m.x},${m.y}`, ROW.coordX, ROW.subY + y);
      if (leader) coord.classList.add('party-row-hl');

      const barBg = document.createElement('div');
      barBg.className = 'party-hp-bg';
      barBg.style.left = `${ROW.barX}px`;
      barBg.style.top = `${ROW.barY + y}px`;
      barBg.style.width = `${ROW.barW}px`;
      barBg.style.height = '5px';

      const ratio = m.maxLife > 0 ? Math.max(0, Math.min(1, m.life / m.maxLife)) : 0;
      const fill = document.createElement('div');
      fill.className = 'party-hp-fill';
      fill.style.left = `${ROW.fillX}px`;
      fill.style.top = `${ROW.barY + y}px`;
      fill.style.width = `${Math.round(ROW.fillW * ratio)}px`;
      fill.style.height = '3px';

      const hpText = this.textEl('party-sub', `( ${m.life} / ${m.maxLife} )`, ROW.hpX, ROW.hpY + y);
      if (leader) hpText.classList.add('party-row-hl');

      this.rowsEl.append(name, map, coord, barBg, fill, hpText);

      /*
       * 踢人按钮。
       *
       * 原版条件：`strcmp(Party, Hero->Name) == 0 || strcmp(row, Hero->Name) == 0`
       * —— `Party` 是第 0 行（队长）。所以：
       *   队长 → 每一行都有按钮（踢人）
       *   队员 → 只有自己那一行有（点它 = 退队，服务端 0x43 也只允许踢自己）
       */
      if (isLeader || m.name === this.selfName) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'party-icon-btn party-kick';
        btn.style.left = `${ROW.kickX}px`;
        btn.style.top = `${ROW.kickY + y}px`;
        btn.style.width = '24px';
        btn.style.height = '24px';
        btn.title = TEXT.kick;
        const img = document.createElement('img');
        img.draggable = false;
        btn.appendChild(img);
        void this.loadIcon(img, 'exit_01');
        btn.addEventListener('click', e => {
          e.stopPropagation();
          this.onKick?.(m.number);
        });
        this.rowsEl.appendChild(btn);
      }
    });

    this.paintCompact();
  }

  private textEl(cls: string, text: string, x: number, y: number) {
    const div = document.createElement('div');
    div.className = cls;
    div.style.left = `${x}px`;
    div.style.top = `${y - 1}px`;
    div.textContent = text;
    return div;
  }

  /**
   * 紧凑血条。原版 `RenderParty` 的 `!PartyOpened` 分支：
   * 右缘 50×19 一行，10 格血，行背景按「在不在视野」换色。
   */
  private paintCompact() {
    const show = !this.open && this.members.length > 0;
    this.compactEl.classList.toggle('hidden', !show);
    if (!show) {
      this.compactSig = '';
      return;
    }

    const x = this.rightEdge - COMPACT.w;
    const n = this.members.length;
    // 内容（成员 / 血量 / 视野 / 位置）没变就不重排 DOM —— 这函数每次 frame 都可能被叫
    const sig = `${x}|${this.members
      .map(m => `${m.name}:${this.lifeTenths.get(m.number) ?? 0}:${this.viewport.has(m.name) ? 1 : 0}`)
      .join(',')}`;
    if (sig === this.compactSig) return;
    this.compactSig = sig;

    this.compactEl.style.left = `${x}px`;
    this.compactEl.style.height = `${COMPACT.top + n * COMPACT.h + COMPACT.capH + 2}px`;

    // 上下盖片
    this.compactCaps[0].style.top = '2px';
    this.compactCaps[1].style.top = `${COMPACT.top + n * COMPACT.h}px`;

    // 清掉旧的行（保留两个盖片）
    for (const child of Array.from(this.compactEl.children)) {
      if (!child.classList.contains('party-compact-cap')) child.remove();
    }

    this.members.forEach((m, i) => {
      const top = COMPACT.top + i * COMPACT.h;
      // 自己的名字永远算「在视野」（原版给本地角色塞 -3）
      const inView = m.name === this.selfName || this.viewport.has(m.name);

      const bg = document.createElement('div');
      bg.className = `party-compact-bg${inView ? '' : ' out'}`;
      bg.style.left = '-3px';
      bg.style.top = `${top}px`;
      bg.style.width = `${COMPACT.w}px`;
      bg.style.height = `${COMPACT.h}px`;

      const hpBg = document.createElement('div');
      hpBg.className = 'party-compact-hpbg';
      hpBg.style.left = '-2px';
      hpBg.style.top = `${top + 12}px`;
      hpBg.style.width = '43px';
      hpBg.style.height = '4px';

      const name = document.createElement('div');
      name.className = 'party-compact-name';
      name.style.left = '0px';
      name.style.top = `${top + 2}px`;
      name.style.width = `${COMPACT.w}px`;
      name.textContent = m.name;

      this.compactEl.append(bg, hpBg);

      // 10 格：每格 3px 宽、间隔 1px（`seg * 4 + v64`）
      const tenths = clamp10(this.lifeTenths.get(m.number) ?? 0);
      for (let seg = 0; seg < tenths; seg++) {
        const dot = document.createElement('div');
        dot.className = 'party-compact-seg';
        dot.style.left = `${seg * 4}px`;
        dot.style.top = `${top + 13}px`;
        dot.style.width = '3px';
        dot.style.height = '2px';
        this.compactEl.appendChild(dot);
      }
      this.compactEl.appendChild(name);
    });

    // 左右两条 1px 竖线（rgba(0.722,0.592,0.380,0.5)）
    for (const left of [-4, 47]) {
      const line = document.createElement('div');
      line.className = 'party-compact-line';
      line.style.left = `${left}px`;
      line.style.top = `${COMPACT.top}px`;
      line.style.width = '1px';
      line.style.height = `${n * COMPACT.h}px`;
      this.compactEl.appendChild(line);
    }

    // 盖片永远在最上层
    this.compactEl.append(...this.compactCaps);
  }

  /** 探针快照（字段沿用旧的，另外补上 UI 需要的真值） */
  snapshot() {
    return {
      open: this.open,
      members: this.members.map(m => ({
        name: m.name,
        number: m.number,
        tenths: this.lifeTenths.get(m.number) ?? 0,
        pos: `${m.map}-${m.x},${m.y}`,
        mapName: getMapDefinition(m.map).name,
        life: m.life,
        maxLife: m.maxLife,
        inViewport: m.name === this.selfName || this.viewport.has(m.name),
      })),
      nearby: this.nearby.map(p => p.name),
      invite: this.invite,
      compact: {
        visible: !this.compactEl.classList.contains('hidden'),
        x: this.rightEdge - COMPACT.w,
        rows: this.compactEl.querySelectorAll('.party-compact-bg').length,
        segs: this.compactEl.querySelectorAll('.party-compact-seg').length,
        caps: this.compactEl.querySelectorAll('.party-compact-cap').length,
      },
      rect: { x: PANEL.x, y: PANEL.y, w: PANEL.w, h: PANEL.h },
    };
  }
}

function clamp10(v: number) {
  return Math.max(0, Math.min(10, v));
}
