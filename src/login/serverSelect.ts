/**
 * 登录界面第一步：「选择线路」（原版 `Scene_Login_ServerSelect`）。
 *
 * 原版流程是 3 个子状态（`Scene_Login.cpp` 的 `DAT_083a7c14`）：
 *
 *   0  选择线路   ← 本文件（`Scene_Login_ServerSelect.cpp`）
 *   1  连接中     读条 + 取消
 *   2  账号密码   `0account_new.ozt` 那块面板
 *
 * 布局全部照抄源码的 640×480 逻辑坐标：
 *
 *   Pass 3  服务器组两列：非 PVP  x=0x96=150，PVP x=0x177=375
 *           每行 16px，底板 `0box.ozj`（134×30）横向压成 **70×16**
 *           选中时 x 各挪 10px（非 PVP +10 → 160，PVP −10 → 365）并全亮，未选中 0.8 灰
 *           行高起点 `min(220, 444 − 16×非PVP条数)`，所以只有一条时在 y=220
 *
 *   Pass 4  选中组的线路子表：x=230、w=134、h=20
 *           起点 y = `cnt×16 − 20×numCh + 8 + 组所在列的起点`，
 *           再夹到 `(24 − numCh)×20` 以内
 *           负载条：x=248 起、每 5px 一个 3×3 小方块，最多 20 个 = load/5
 *
 *   Pass 5  当前已连服务器的 IP（两行橙红字，x=150）—— 我们只连一台，省掉。
 *
 * 配色（`glColor3f`，注意原版这里是**给底板**上色，文字另有 TextColor）：
 *   满员(load&0x80) → (1.0, 0.7, 0.5) 暖红
 *   顺畅(<100)      → (1.0, 1.0, 1.0) 白
 *   正常(100)       → (0.4, 0.4, 0.4) 灰
 * 选中 ×1.0 / 未选中 ×0.8。
 */
import { logoCssUrl, logoSprite } from '../ui/logoAssets';
import {
  ConnectServerClient,
  CS_PORT,
  DEFAULT_GAME_PORT,
  channelNo,
  loadState,
  loadText,
  type LoadState,
  type ServerGroup,
  type ServerPick,
} from '../net/connectServer';

/* ---------------- 源码坐标 ---------------- */
const COL_NONPVP_X = 150; // 0x96
const COL_PVP_X = 375; // 0x177
const ROW_W = 70;
const ROW_H = 16;
const SEL_SHIFT = 10; // 选中时整块挪 10px
const ROW_BASE_CAP = 220; // 0xdc
const CH_X = 230; // 线路子表
const CH_W = 134;
const CH_H = 20;
const DOT_X = 248; // 负载条
const DOT_Y = 14;
const DOT_STEP = 5;
const DOT_MAX = 20;

const HEAD_Y = 196;
const HINT_Y = 438;

type Tint = [number, number, number];

function tintOf(state: LoadState, selected: boolean): Tint {
  const k = selected ? 1 : 0.8;
  if (state === 'full') return [255 * k, 179 * k, 128 * k];
  if (state === 'normal') return [102 * k, 102 * k, 102 * k];
  return [255 * k, 255 * k, 255 * k];
}

const tintCss = (t: Tint) => `rgb(${Math.round(t[0])},${Math.round(t[1])},${Math.round(t[2])})`;

export interface ServerSelectHandle {
  /** 铺到登录层里（幂等） */
  mount(): void;
  show(): void;
  hide(): void;
  /** 重新连 ConnectServer 拉列表；失败自动退成「本机服务器」一条 */
  refresh(): Promise<void>;
  /** 选中某组 / 某条线路（点击与探针共用） */
  selectGroup(index: number): void;
  pickChannel(groupIndex: number, channelIndex: number): Promise<void>;
  state(): {
    ready: boolean;
    offline: boolean;
    error: string;
    hi: number;
    lo: number;
    groups: Array<{ name: string; pvp: boolean; channels: Array<{ code: number; no: number; load: number; text: string }> }>;
    picked: ServerPick | null;
  };
}

export function createServerSelect(opts: {
  onPicked: (srv: ServerPick) => void;
  setStatus?: (text: string, kind?: '' | 'error' | 'ok') => void;
  /**
   * 离线演示（`/demo`）：**不去连 ConnectServer**，直接给一份假列表。
   *
   * 演示页是纯静态的（后面要挂 GitHub Pages），本机没 44405 的时候
   * `refresh()` 会先等连接超时再退回「本机服务器」一条 —— 那样演示第一屏
   * 要愣 3~5 秒，还刷一堆 WebSocket 错误。这里直接把列表塞进去。
   */
  demo?: boolean;
}): ServerSelectHandle {
  let root: HTMLElement | null = null;
  let listEl: HTMLElement | null = null;
  let hintEl: HTMLElement | null = null;
  let boxUrl = '';

  let groups: ServerGroup[] = [];
  let hi = -1;
  let lo = -1;
  let offline = false;
  let error = '';
  let ready = false;
  let busy = false;
  let picked: ServerPick | null = null;
  let client: ConnectServerClient | null = null;

  const pvpOf = (g: ServerGroup) => /2$/.test(g.name.trim());

  /** 组标题：单线路 `名字 状态`，多线路 `名字-号 状态` 都是子表的写法，行上用组名 */
  const groupLabel = (g: ServerGroup) => {
    const first = g.channels[0];
    return first ? `${g.name} ${loadText(first.load)}` : g.name;
  };

  const channelLabel = (g: ServerGroup, code: number, load: number) => {
    if (g.channels.length <= 1) return `${g.name} ${loadText(load)}`;
    const pvp = pvpOf(g);
    return pvp
      ? `${g.name}-${channelNo(code)} ${loadText(load)}`
      : `${g.name}-${channelNo(code)}(Non-PVP) ${loadText(load)}`;
  };

  /** 非 PVP / PVP 两列的起点（Pass 3 的 iStartY / iYPvp） */
  function columnBases() {
    const nonPvpCount = groups.filter(g => !pvpOf(g)).length;
    const pvpCount = groups.filter(g => pvpOf(g)).length;
    const startY = Math.min(ROW_BASE_CAP, 444 - ROW_H * nonPvpCount);
    const pvpY = (nonPvpCount - pvpCount - 1) * ROW_H + startY;
    return { startY, pvpY, nonPvpCount };
  }

  /** 线路子表的起点 y（Pass 4） */
  function channelTop(index: number) {
    const g = groups[index];
    if (!g) return ROW_BASE_CAP;
    const pvp = pvpOf(g);
    const { startY, pvpY } = columnBases();
    const base = pvp ? pvpY : startY;
    // cnt = 同列里排在这个组之前的条数
    let cnt = 0;
    for (let i = 0; i < index; i++) if (pvpOf(groups[i]) === pvp) cnt++;
    const numCh = g.channels.length;
    let y = cnt * ROW_H - numCh * 10 + 8 + base;
    const cap = (24 - numCh) * CH_H;
    if (cap <= y) y = cap;
    return y;
  }

  function mount() {
    if (root) return;
    const layer = document.getElementById('login-layer');
    if (!layer) return;
    root = document.createElement('div');
    root.className = 'sv hidden';
    root.id = 'server-select';
    root.innerHTML =
      '<div class="sv-head" id="sv-head">选择线路</div>' +
      '<div class="sv-list" id="sv-list"></div>' +
      '<div class="sv-hint" id="sv-hint"></div>' +
      '<button class="sv-refresh" id="sv-refresh" type="button">重新读取列表</button>';
    layer.appendChild(root);
    listEl = root.querySelector('#sv-list');
    hintEl = root.querySelector('#sv-hint');
    root.querySelector('#sv-refresh')?.addEventListener('click', () => void refresh());
    void loadArt();
  }

  async function loadArt() {
    const img = await logoSprite('0box.ozj');
    if (!img) return;
    boxUrl = logoCssUrl(img);
    render();
  }

  function makeRow(x: number, y: number, w: number, h: number, tint: Tint, extra = '') {
    const row = document.createElement('div');
    row.className = `sv-row ${extra}`.trim();
    row.style.left = `${x}px`;
    row.style.top = `${y}px`;
    row.style.width = `${w}px`;
    row.style.height = `${h}px`;
    if (boxUrl) {
      row.style.backgroundImage = boxUrl;
      row.style.backgroundColor = tintCss(tint);
      row.style.backgroundBlendMode = 'multiply';
    }
    return row;
  }

  function render() {
    if (!listEl || !hintEl || !root) return;
    const host: HTMLElement = listEl;
    host.innerHTML = '';

    if (!groups.length) {
      hintEl.textContent = busy ? '正在连接服务端…' : error || '没有可用线路';
      hintEl.classList.toggle('error', !!error && !busy);
      return;
    }

    // Pass 3：两列
    const { startY, pvpY } = columnBases();
    let yNon = startY;
    let yPvp = pvpY;
    groups.forEach((g, gi) => {
      const pvp = pvpOf(g);
      const baseX = pvp ? COL_PVP_X : COL_NONPVP_X;
      const y = pvp ? yPvp : yNon;
      if (pvp) yPvp += ROW_H;
      else yNon += ROW_H;

      const selected = gi === hi;
      const x = selected ? baseX + (pvp ? -SEL_SHIFT : SEL_SHIFT) : baseX;
      const tint = tintOf(loadState(g.channels[0]?.load ?? 0), selected);
      const row = makeRow(x, y, ROW_W, ROW_H, tint, selected ? 'sel' : '');
      const label = document.createElement('span');
      label.className = 'sv-row-text';
      label.textContent = groupLabel(g);
      row.appendChild(label);
      row.addEventListener('click', () => selectGroup(gi));
      host.appendChild(row);
    });

    // Pass 4：选中组的线路子表
    if (hi >= 0 && groups[hi]) {
      const g = groups[hi];
      const top = channelTop(hi);
      g.channels.forEach((ch, ci) => {
        const selected = ci === lo;
        const state = loadState(ch.load);
        const tint = tintOf(state, selected);
        const row = makeRow(CH_X, top + ci * CH_H, CH_W, CH_H, tint, selected ? 'sel' : '');
        row.dataset.code = String(ch.code);

        const label = document.createElement('span');
        label.className = 'sv-ch-text';
        label.textContent = channelLabel(g, ch.code, ch.load);
        row.appendChild(label);

        // 负载条：load/5 个亮点 + 剩下的暗点（满员不画，源码也是跳过）
        if (state !== 'full') {
          const filled = Math.min(DOT_MAX, Math.round(Math.min(100, ch.load & 0x7f) / 5));
          for (let d = 0; d < DOT_MAX; d++) {
            const dot = document.createElement('i');
            dot.className = `sv-dot${d < filled ? ' on' : ''}`;
            dot.style.left = `${DOT_X - CH_X + d * DOT_STEP}px`;
            dot.style.top = `${DOT_Y}px`;
            if (d < filled) dot.classList.add(`s-${state}`);
            row.appendChild(dot);
          }
        }

        row.addEventListener('click', () => void pickChannel(hi, ci));
        host.appendChild(row);
      });
    }

    hintEl.textContent = busy
      ? '正在连接服务端…'
      : error
        ? error
        : offline
          ? `ConnectServer(${CS_PORT}) 未启动，直连本机 GameServer ${DEFAULT_GAME_PORT}`
          : '先点服务器组，再点具体线路进入登录';
    hintEl.classList.toggle('error', !!error && !busy);
  }

  function selectGroup(index: number) {
    if (index < 0 || index >= groups.length) return;
    hi = index;
    lo = -1;
    render();
    // 原版点组会重发 `C1 04 F4 02` 刷新负载，这里照做（失败不打扰用户）
    if (client) {
      void client
        .refresh()
        .then(list => {
          if (!list.length) return;
          groups = list;
          render();
        })
        .catch(() => {
          /* 刷新失败就继续用旧数据 */
        });
    }
  }

  async function pickChannel(groupIndex: number, channelIndex: number) {
    const g = groups[groupIndex];
    if (!g) return;
    const ch = g.channels[channelIndex];
    if (!ch) return;
    hi = groupIndex;
    lo = channelIndex;
    render();

    busy = true;
    opts.setStatus?.('正在获取线路地址…');
    try {
      if (offline || !client) {
        picked = { host: '127.0.0.1', port: DEFAULT_GAME_PORT, code: -1 };
      } else {
        picked = await client.pick(ch.code);
      }
      client?.close();
      client = null;
      busy = false;
      opts.setStatus?.('');
      opts.onPicked(picked);
    } catch (err) {
      busy = false;
      error = err instanceof Error ? err.message : String(err);
      opts.setStatus?.(error, 'error');
      render();
    }
  }

  /** 演示用的假线路表（两列：普通服 2 条线 + PVP 服 1 条线） */
  const DEMO_GROUPS: ServerGroup[] = [
    { group: 0, name: 'MU 演示服', channels: [{ code: 0, load: 0 }, { code: 1, load: 2 }] },
    { group: 1, name: 'MU 演示服2', channels: [{ code: 2, load: 1 }] },
  ];

  async function refresh() {
    if (opts.demo) {
      groups = DEMO_GROUPS.map(g => ({ ...g, channels: g.channels.map(c => ({ ...c })) }));
      offline = true;
      ready = true;
      client = null;
      error = '';
      hi = -1;
      lo = -1;
      busy = false;
      opts.setStatus?.('');
      render();
      return;
    }
    busy = true;
    error = '';
    render();
    opts.setStatus?.('读取线路列表…');
    try {
      client?.close();
      client = await ConnectServerClient.open('127.0.0.1');
      groups = client.groups;
      offline = false;
      ready = true;
      // 原版 `ServerSelectHi` 初值就是 -1（点了组才出线路子表），这里不预选
      hi = -1;
      lo = -1;
    } catch (err) {
      client = null;
      ready = false;
      offline = true;
      error = '';
      // 兜底：ConnectServer 没跑的时候还能按老路子直连 GameServer
      groups = [
        {
          group: 0,
          name: '本机服务器',
          channels: [{ code: 0, load: 0 }],
        },
      ];
      hi = -1;
      lo = -1;
      console.warn('[server-select]', err instanceof Error ? err.message : err);
    } finally {
      busy = false;
      opts.setStatus?.('');
      render();
    }
  }

  return {
    mount,
    show() {
      mount();
      if (!root) return;
      root.classList.remove('hidden');
      // 每次回到这一步都重拉一次负载（原版进画面带的是最新 UserTotal；
      // 选完线路后 CS 连接已关，`client === null` 所以要重连）
      if (!client) void refresh();
      else render();
    },
    hide() {
      root?.classList.add('hidden');
    },
    refresh,
    selectGroup,
    pickChannel,
    state() {
      return {
        ready,
        offline,
        error,
        hi,
        lo,
        groups: groups.map(g => ({
          name: g.name,
          pvp: pvpOf(g),
          channels: g.channels.map(c => ({
            code: c.code,
            no: channelNo(c.code),
            load: c.load,
            text: channelLabel(g, c.code, c.load),
          })),
        })),
        picked,
      };
    },
  };
}
