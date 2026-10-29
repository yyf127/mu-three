/**
 * 战盟战 / 足球赛比分条（原版 `Render_CharInfoPanel_` 的 `EnableGuildWar` 分支）。
 *
 * 数据来源三个包：
 *
 *   `0x62` `PMSG_GUILD_WAR_START_SEND`  → 开打，带**对手公会名** + `type` + `team`
 *   `0x64` `PMSG_GUILD_WAR_SCORE_SEND`  → `BYTE score[2]`：`[0]` 我方、`[1]` 对方
 *   `0x63` `PMSG_GUILD_WAR_END_SEND`    → 结束，收起
 *
 * 原版画法（`HUD_Pass2.cpp:305`）：屏幕顶端 x=300、y=4 与 y=19 两行，
 * 每行 `8×8 的盟标 + 分数 + 公会名`，我方绿(`0xFF008000`)、对方橙(`0xFFFF9560`)。
 * 这里照这个布局做，只是把「画在 GL 里」换成 DOM（字更清楚，也省一次贴图）。
 *
 * 敌方盟标拿不到 —— 服务端这三个包都不带 `Mark`，原版是从 `0x5A/0x5C` 的
 * 战盟信息表里按名字查的。我们只在**自己**有标志时画自己那格。
 */
import { UiLayer } from './frame';
import { GUILD_MARK_COLORS, unpackGuildMark } from '../net/game';

/** 原版几何：顶端、居中偏左（320 - 20），两行 */
const ORIGIN = { x: 296, y: 4 };
const LINE_H = 15;

export interface WarSide {
  name: string;
  score: number;
}

export interface GuildWarView {
  /** 是否在打（`0x62` 之后、`0x63` 之前） */
  active: boolean;
  mine: WarSide;
  theirs: WarSide;
}

interface Row {
  root: HTMLDivElement;
  mark: HTMLCanvasElement | null;
  score: HTMLSpanElement;
  name: HTMLSpanElement;
}

/** 8×8 的 32 字节标志 → canvas（像素放大，别做插值） */
function paintMark(canvas: HTMLCanvasElement, mark: Uint8Array) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cells = unpackGuildMark(mark);
  ctx.clearRect(0, 0, 8, 8);
  for (let i = 0; i < 64; i++) {
    const color = GUILD_MARK_COLORS[cells[i] ?? 0] ?? 'transparent';
    if (color === 'transparent') continue;
    ctx.fillStyle = color;
    ctx.fillRect(i % 8, Math.floor(i / 8), 1, 1);
  }
}

export class GuildWarBar {
  private el: HTMLDivElement;
  private rows: Row[] = [];
  private view: GuildWarView = {
    active: false,
    mine: { name: '', score: 0 },
    theirs: { name: '', score: 0 },
  };

  constructor(layer: UiLayer) {
    this.el = document.createElement('div');
    this.el.className = 'gwar hidden';
    this.el.style.left = `${ORIGIN.x}px`;
    this.el.style.top = `${ORIGIN.y}px`;
    layer.add(this.el);

    for (const side of ['mine', 'theirs'] as const) {
      const root = document.createElement('div');
      root.className = `gwar-row ${side}`;

      const mark = document.createElement('canvas');
      mark.width = 8;
      mark.height = 8;
      mark.className = 'gwar-mark';
      root.appendChild(mark);

      const score = document.createElement('span');
      score.className = 'gwar-score';
      score.textContent = '0';
      root.appendChild(score);

      const name = document.createElement('span');
      name.className = 'gwar-name';
      root.appendChild(name);

      this.el.appendChild(root);
      this.rows.push({ root, mark, score, name });
    }
    this.render();
  }

  /** 开打/更新比分。`mark` 只有自己的能拿到（32 字节），传 null 就空着 */
  set(view: GuildWarView, mark?: Uint8Array | null) {
    this.view = view;
    const [mine, theirs] = this.rows;

    mine.score.textContent = String(view.mine.score);
    mine.name.textContent = view.mine.name || '我方';
    if (mark && mine.mark) {
      mine.mark.style.display = '';
      paintMark(mine.mark, mark);
    } else if (mine.mark) {
      mine.mark.style.display = 'none';
    }

    theirs.score.textContent = String(view.theirs.score);
    theirs.name.textContent = view.theirs.name || '对方';
    if (theirs.mark) theirs.mark.style.display = 'none';

    this.el.classList.toggle('hidden', !view.active);
    this.el.style.height = `${LINE_H * 2}px`;
    this.render();
  }

  hide() {
    this.view.active = false;
    this.el.classList.add('hidden');
  }

  get isOpen() {
    return this.view.active;
  }

  /** 探针/调试快照 */
  snapshot() {
    return { ...this.view, open: !this.el.classList.contains('hidden') };
  }

  private render() {
    for (const r of this.rows) r.root.style.height = `${LINE_H}px`;
  }
}
