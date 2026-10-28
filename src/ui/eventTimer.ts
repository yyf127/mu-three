/**
 * 事件倒计时（屏幕左上角）—— 数据来自服务端 `0xF3/0xE6`。
 *
 * 服务端 `CEventTimeManager::GCEventTimeSend`（EventTimeManager.cpp:27）在进图时
 * 和状态变化时各推一次，`count` 条，每条 `name[32] + status + pad[3] + time[4]`。
 *
 * status 的语义（`EventTimeManager.h:7`）：
 *
 *   0 BLANK  该事件关闭 —— 不显示
 *   1 STAND  还没开始，`time` = 距离开始还有多少秒（服务端给的是**剩余秒数**）
 *   2 OPEN   可以进场（血色城堡/恶魔广场的报名阶段）
 *   3 START  已经开打
 *
 * 时间只下发那一刻的剩余秒数，之后服务端不再逐秒推，所以本地要自己递减；
 * 重新收到 0xE6 就整表替换并重置基准时刻。
 *
 * 0.97 的 Win 端客户端**没有这块 UI**（源码里 `0x0B` 事件状态只解包不显示），
 * 所以位置是本 port 自己定的：左上角 (8, 6)，避开右侧背包（450..640）和
 * 底部聊天框，字号 11px 与其它面板一致。
 */
import { UiLayer } from './frame';
import { EVENT_STATE, type EventTimeEntry } from '../net/game';

/**
 * 左上角。小地图已经挪到右上角了，这里就回到原来的位置。
 */
const ORIGIN = { x: 8, y: 6 };
const LINE_H = 13;

interface Row {
  name: string;
  status: number;
  /** 收到那一刻的剩余秒数 */
  time: number;
  /** 收到时刻（performance.now） */
  at: number;
}

/**
 * 赛事状态（`0x9B`，目前只有血色城堡发）。
 *
 * 和上面那张 0xF3/0xE6 的表不是一回事：0xE6 是「所有事件什么时候开」，
 * 0x9B 是「**我已经在里面的这场**打到哪了」。所以单独一行、单独着色，
 * 排在列表最下面。
 */
export interface MatchInfo {
  kind: 'bc' | 'ds';
  /** 0 = 刚开打，1 / 4 = 进行中 */
  state: number;
  /** 服务端下发那一刻的剩余秒数 */
  seconds: number;
  maxMonster: number;
  curMonster: number;
  /** 谁拿着事件道具（'你' 或空） */
  itemOwner: string;
  /** 事件道具等级（0xFF = 没有） */
  itemLevel: number;
}

export class EventTimerPanel {
  private el: HTMLDivElement;
  private rows: Row[] = [];
  private timer = 0;
  private els: HTMLDivElement[] = [];
  /** 0x9B 的赛事状态；null = 没在赛事里 */
  private match: (MatchInfo & { at: number }) | null = null;
  private matchEl: HTMLDivElement;

  constructor(layer: UiLayer) {
    this.el = document.createElement('div');
    this.el.className = 'evt-panel hidden';
    this.el.style.left = `${ORIGIN.x}px`;
    this.el.style.top = `${ORIGIN.y}px`;
    layer.add(this.el);

    this.matchEl = document.createElement('div');
    this.matchEl.className = 'evt-match hidden';
    this.el.appendChild(this.matchEl);
  }

  /**
   * 0x9B：赛事状态。
   *
   * 服务端只在**进图和阶段切换**时推一次，之后不逐秒跟着发，所以这里记下
   * 收到时刻、自己按秒递减（和 0xE6 的倒计时同一个套路）。
   * state = 4 是 CLEAN（结束收尾），服务端会在那时再推一次。
   */
  setMatch(info: MatchInfo) {
    this.match = { ...info, at: performance.now() };
    this.render();
    this.startTick();
  }

  clearMatch() {
    this.match = null;
    this.render();
  }

  /** 赛事剩余秒数（本地递减） */
  private matchRemain(): number {
    if (!this.match) return 0;
    const passed = (performance.now() - this.match.at) / 1000;
    return Math.max(0, Math.round(this.match.seconds - passed));
  }

  setEvents(list: EventTimeEntry[]) {
    const now = performance.now();
    this.rows = list.map(e => ({ name: e.name, status: e.status, time: e.time, at: now }));
    this.render();
    this.startTick();
  }

  clear() {
    this.rows = [];
    this.render();
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  private startTick() {
    if (this.timer) return;
    // 1 Hz 足够：显示精度是秒，帧循环里逐帧改 DOM 反而浪费
    this.timer = window.setInterval(() => this.render(), 1000);
  }

  /** 剩余秒数（本地递减，最低 0） */
  private remain(row: Row): number {
    if (!row.time) return 0;
    const passed = (performance.now() - row.at) / 1000;
    return Math.max(0, Math.round(row.time - passed));
  }

  private render() {
    const visible = this.rows.filter(r => r.status !== EVENT_STATE.BLANK && r.name);
    this.renderMatch(visible.length);

    // 全 BLANK 且没有赛事状态就整块隐藏，别在屏幕上留一个空壳
    if (!visible.length && !this.match) {
      this.el.classList.add('hidden');
      return;
    }
    this.el.classList.remove('hidden');

    while (this.els.length < visible.length) {
      const line = document.createElement('div');
      line.className = 'evt-line';
      const name = document.createElement('span');
      name.className = 'evt-name';
      const val = document.createElement('span');
      val.className = 'evt-val';
      line.append(name, val);
      this.el.appendChild(line);
      this.els.push(line);
    }
    for (let i = 0; i < this.els.length; i++) {
      const line = this.els[i];
      const row = visible[i];
      if (!row) {
        line.style.display = 'none';
        continue;
      }
      line.style.display = '';
      line.style.top = `${i * LINE_H}px`;

      const nameEl = line.children[0] as HTMLSpanElement;
      const valEl = line.children[1] as HTMLSpanElement;
      nameEl.textContent = shortName(row.name);

      if (row.status === EVENT_STATE.OPEN) {
        valEl.textContent = '可入场';
        valEl.className = 'evt-val open';
      } else if (row.status === EVENT_STATE.START) {
        valEl.textContent = '进行中';
        valEl.className = 'evt-val live';
      } else {
        const s = this.remain(row);
        valEl.textContent = s > 0 ? mmss(s) : '即将开始';
        valEl.className = 'evt-val';
      }
    }
  }

  /**
   * 赛事状态行：`血色城堡 4:32 · 怪物 12/40 · 圣物在你手上`。
   *
   * `offset` 是上面那几行占掉的高度 —— 这块在小屏上要和 0xE6 的列表错开。
   */
  private renderMatch(offset: number) {
    const m = this.match;
    if (!m) {
      this.matchEl.classList.add('hidden');
      return;
    }
    this.matchEl.classList.remove('hidden');
    this.matchEl.style.top = `${offset * LINE_H + (offset ? 4 : 0)}px`;

    const label = m.kind === 'bc' ? '血色城堡' : '恶魔广场';
    const left = m.state >= 1 && m.state <= 2 ? mmss(this.matchRemain()) : mmss(this.matchRemain());
    const parts = [`${label}`, left];
    if (m.curMonster || m.maxMonster) parts.push(`怪物 ${m.curMonster}/${m.maxMonster}`);
    if (m.itemOwner) parts.push(`圣物在${m.itemOwner}手上`);
    else if (m.itemLevel !== 0xff && m.itemLevel > 0) parts.push(`圣物 Lv${m.itemLevel}`);

    this.matchEl.textContent = parts.join(' · ');
    this.matchEl.className = m.state === 4 ? 'evt-match done' : 'evt-match live';
  }

  /** 调试快照（探针用） */
  snapshot() {
    return this.rows.map(r => ({
      name: r.name,
      status: r.status,
      remain: this.remain(r),
      hidden: this.el.classList.contains('hidden'),
    }));
  }

  /** 赛事状态快照（探针用） */
  matchSnapshot() {
    if (!this.match) return null;
    return {
      kind: this.match.kind,
      state: this.match.state,
      remain: this.matchRemain(),
      maxMonster: this.match.maxMonster,
      curMonster: this.match.curMonster,
      text: this.matchEl.textContent ?? '',
      hidden: this.matchEl.classList.contains('hidden'),
    };
  }
}

/** 服务端名字比较长（"Golden Invasion"），HUD 上截短一点 */
function shortName(name: string): string {
  const map: Record<string, string> = {
    'Devil Square': '恶魔广场',
    'Blood Castle': '血色城堡',
    'Golden Invasion': '黄金怪入侵',
    'Blue Event': '蓝色事件',
    'Bonus Event': '奖励事件',
    'Chaos Castle': '混沌城堡',
    'Golden Archer': '黄金弓箭手',
  };
  return map[name] ?? name;
}

function mmss(total: number): string {
  const t = Math.max(0, Math.floor(total));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
