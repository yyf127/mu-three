/**
 * 世界空间标签层：头顶名字 + 队伍成员 10 格血条。
 *
 * 原版有两套东西（都从 0.97 反编译源码里读出来的）：
 *
 *   1. `Render_HPBars`（`HUD_Render.cpp:130`）—— 队伍成员头顶的 10 格血条。
 *      数据来自下行 `0x44`（`CParty::GCPartyLifeSend`，`Party.cpp:645`）：
 *      每字节高 4 bit 是队伍位置、低 4 bit 是 `Life / ((MaxLife+AddLife)/10)`。
 *      画法：42×5 的条，`x -= 0x13` 居中，暗红底 + 10 段 3×2 的红格，间隔 4px。
 *
 *   2. `Render_CharNameTags`（`HUD_Render.cpp:551`）—— 屏幕上可见角色的名字。
 *      格式 `"%s %d/%d"`（名字 + 当前 HP + 上限），按 HP 比例换颜色，
 *      逐个往下 12px 避让，X 超出右边界时钳住。
 *
 * 用 DOM 而不是 3D 精灵：文字清晰、不用管贴图，和 `DamageTexts` 同一套投影。
 */
import * as THREE from 'three';

export interface TagItem {
  id: number;
  name: string;
  /** 世界坐标（z 已算好地形高度） */
  x: number;
  y: number;
  z: number;
  kind: 'player' | 'monster' | 'npc';
  /** 队伍成员：0..10 的十等分血量（`0x44`）；不给就不画血条 */
  tenths?: number;
  /** 当前目标：名字用怪物色（原版 `0xFFC8E6FF` 那种冷色） */
  focused?: boolean;
  /** 名字后面跟的 `cur/max`（原版 `Render_CharNameTags` 的 `"%s %d/%d"`） */
  hpText?: string;
  /**
   * 怪物血条：0..1 的连续比例（1 = 满血）。
   * 有它就画**一条实心条**（比队伍那种 10 格更适合「一眼看血量」），
   * 颜色按比例从绿到红。不给就不画条。
   */
  hpRatio?: number;
}

type BarMode = 'none' | 'seg' | 'smooth';

interface TagNode {
  root: HTMLDivElement;
  name: HTMLDivElement;
  bar: HTMLDivElement | null;
  segs: HTMLDivElement[];
  /** 实心条（怪物血量）的填充块，和 `segs` 二选一 */
  fill: HTMLDivElement | null;
  mode: BarMode;
  /** 这一帧还活着吗（不在列表里的要删掉） */
  alive: boolean;
}

/** 原版 `Render_HPBars` 的几何（像素，1:1） */
const BAR_W = 42;
const BAR_H = 5;
const SEG_W = 3;
const SEG_H = 2;
const SEG_PITCH = 4;
const SEG_LEFT = 2;
const SEG_TOP = 2;
/*
 * 源码是 `screenX -= 0x13`（19px）把 42px 宽的条往左挪，等价于「几乎居中但偏右 2px」。
 * 这里直接用 flex 居中（差 2px 看不出来），省掉一层绝对定位。
 */

export class WorldTags {
  private layer: HTMLElement;
  private nodes = new Map<number, TagNode>();
  private v = new THREE.Vector3();
  /** 名字避让用：本帧已经占掉的矩形 */
  private taken: { x: number; y: number; w: number; h: number }[] = [];
  private enabled = true;

  constructor(layer: HTMLElement) {
    this.layer = layer;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.clear();
  }

  clear() {
    for (const n of this.nodes.values()) n.root.remove();
    this.nodes.clear();
    this.taken.length = 0;
  }

  /** 当前挂着多少个标签（调试/探针） */
  snapshot() {
    const out: {
      id: number;
      name: string;
      bar: boolean;
      mode: BarMode;
      tenths: number;
      ratio?: string;
      focused: boolean;
      visible: boolean;
      pos: [number, number];
    }[] = [];
    for (const [id, n] of this.nodes) {
      out.push({
        id,
        name: n.name.textContent ?? '',
        bar: !!n.bar,
        mode: n.mode,
        tenths: parseInt(n.bar?.dataset.tenths ?? '-1', 10),
        ratio: n.fill ? n.bar?.dataset.ratio : undefined,
        focused: n.name.classList.contains('focused'),
        visible: n.root.style.display !== 'none',
        pos: [parseFloat(n.root.style.left || '0'), parseFloat(n.root.style.top || '0')],
      });
    }
    return out;
  }

  /**
   * 每帧调用。`items` 由调用方按「值得显示的实体」筛好（自己、尸体不算）。
   */
  update(camera: THREE.Camera, items: TagItem[]) {
    if (!this.enabled) return;

    const rect = this.layer.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    for (const n of this.nodes.values()) n.alive = false;
    this.taken.length = 0;

    for (const it of items) {
      const v = this.v.set(it.x, it.y, it.z);
      v.project(camera);
      const onScreen = v.z <= 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.1;
      const mode: BarMode = it.hpRatio !== undefined ? 'smooth' : it.tenths !== undefined ? 'seg' : 'none';
      const node = this.node(it, mode);
      node.alive = true;
      /*
       * 文本先写、再判屏幕内 —— 屏幕外的节点也要有内容，不然探针 `worldTags()`
       * 抓到一堆空名字，看不出到底是「没生成」还是「照不到」。
       */
      node.name.textContent = it.hpText ? `${it.name} ${it.hpText}` : it.name;
      node.name.classList.toggle('focused', !!it.focused);
      node.name.classList.toggle('foe', it.kind === 'monster');
      node.name.classList.toggle('self-party', !!it.tenths);
      if (!onScreen) {
        node.root.style.display = 'none';
        continue;
      }

      let sx = (v.x * 0.5 + 0.5) * rect.width;
      let sy = (-v.y * 0.5 + 0.5) * rect.height;

      /*
       * `Render_CharNameTags` 的避让：同屏两个标签重叠时把后画的那个往下推 12px
       * （源码 `textY += 0x0c`）。这里比它多做一步 —— 只在**真的重叠**时推，
       * 不然十几个队友会一路排到屏幕外。
       */
      // 锚点是「底边中心」（CSS `translate(-50%, -100%)`），所以矩形从 sy-h 开始
      const w = node.root.offsetWidth || 60;
      const h = node.root.offsetHeight || 14;
      let guard = 0;
      while (this.overlaps(sx - w / 2, sy - h, w, h) && guard < 8) {
        sy += 12;
        guard++;
      }
      this.taken.push({ x: sx - w / 2, y: sy - h, w, h });

      // 原版把 X 钳在右边界的做法：超出就往回拉，标签不会跑出画面
      sx = Math.max(w / 2 + 2, Math.min(rect.width - w / 2 - 2, sx));
      sy = Math.max(h + 2, Math.min(rect.height - 2, sy));

      node.root.style.display = '';
      node.root.style.left = `${sx.toFixed(1)}px`;
      node.root.style.top = `${sy.toFixed(1)}px`;
      if (node.bar && mode === 'seg') {
        const k = Math.max(0, Math.min(10, it.tenths ?? 0));
        node.bar.dataset.tenths = String(k);
        for (let i = 0; i < node.segs.length; i++) {
          node.segs[i].style.visibility = i < k ? 'visible' : 'hidden';
        }
      } else if (node.fill) {
        const r = Math.max(0, Math.min(1, it.hpRatio ?? 0));
        node.fill.style.width = `${(r * 100).toFixed(1)}%`;
        // 绿 → 黄 → 红：hue 从 105° 降到 0°
        node.fill.style.background = `hsl(${Math.round(105 * r)}deg 85% 52%)`;
        node.bar!.dataset.ratio = r.toFixed(2);
      }
    }

    // 这一帧没出现的删掉
    for (const [id, n] of [...this.nodes]) {
      if (!n.alive) {
        n.root.remove();
        this.nodes.delete(id);
      }
    }
  }

  private overlaps(x: number, y: number, w: number, h: number): boolean {
    for (const t of this.taken) {
      if (x < t.x + t.w && x + w > t.x && y < t.y + t.h && y + h > t.y) return true;
    }
    return false;
  }

  private node(it: TagItem, mode: BarMode): TagNode {
    let n = this.nodes.get(it.id);
    if (n && n.mode !== mode) {
      // 模式变了（无条 ↔ 十格 ↔ 实心）要重建，血条结构不是每帧都能补出来的
      n.root.remove();
      this.nodes.delete(it.id);
      n = undefined;
    }
    if (n) return n;

    const root = document.createElement('div');
    root.className = 'wtag';
    root.dataset.id = String(it.id);

    const name = document.createElement('div');
    name.className = 'wtag-name';
    root.appendChild(name);

    let bar: HTMLDivElement | null = null;
    let fill: HTMLDivElement | null = null;
    const segs: HTMLDivElement[] = [];
    if (mode !== 'none') {
      bar = document.createElement('div');
      bar.className = 'wtag-bar';
      bar.style.width = `${BAR_W}px`;
      bar.style.height = `${BAR_H}px`;
      if (mode === 'seg') {
        for (let i = 0; i < 10; i++) {
          const s = document.createElement('div');
          s.className = 'wtag-seg';
          s.style.left = `${SEG_LEFT + i * SEG_PITCH}px`;
          s.style.top = `${SEG_TOP}px`;
          s.style.width = `${SEG_W}px`;
          s.style.height = `${SEG_H}px`;
          bar.appendChild(s);
          segs.push(s);
        }
      } else {
        // 实心条：暗底 + 一条按比例伸缩的填充
        fill = document.createElement('div');
        fill.className = 'wtag-fill';
        fill.style.width = '100%';
        fill.style.height = `${BAR_H}px`;
        bar.appendChild(fill);
      }
      root.appendChild(bar);
    }

    this.layer.appendChild(root);
    n = { root, name, bar, segs, fill, mode, alive: true };
    this.nodes.set(it.id, n);
    return n;
  }
}
