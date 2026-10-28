/**
 * 地面物品的**浮动名字**。
 *
 * 原版是 `RenderItemName`（`Item/Item_Display.cpp`，IDA 0x004C9E70），
 * 由 `Target_Render`（sub_4CB6F0）在两处调用：
 *
 *   1. **光标指着的那件物品** —— `Sort = 0`，画在**鼠标位置**上方 15px
 *      （`RenderText(MouseX - w/2, MouseY - 15, ...)`）。
 *   2. **按住 Alt** —— `Sort = 1`，地面上**所有**物品都画，
 *      位置是物品自己的屏幕坐标上方 15px（`o+0x5c / o+0x5e`，水平居中）。
 *
 * 颜色（源码 `glColor3f` 那几档，注意 IDA 里 `v38[2]` 是蓝、`v38[0]` 是红，
 * 原来的移植把它写反过一次）：
 *
 *   卓越（`ItemOption & 0x3F`）  → (0.1, 1.0, 0.5)  绿
 *   +0                          → (0.7, 0.7, 0.7)  灰
 *   +1..+2                      → (0.9, 0.9, 0.9)  白
 *   +3..+4                      → (1.0, 0.5, 0.2)  橙
 *   +5..+6                      → (0.4, 0.7, 1.0)  淡蓝
 *   +7 以上                     → (1.0, 0.8, 0.1)  金
 *   金币                        → (1.0, 0.8, 0.1)  金
 *
 * 名字后缀（`GlobalText`，实测 `Data/Local/chs/Text.bmd`）：
 *   `[176] = ' +技能'`   ← level 字节 bit7
 *   `[177] = ' +属性'`   ← 追加 1..3 或 b3&0x40
 *   `[178] = ' +幸运'`   ← level 字节 bit2
 *   `[179] = '剑士专用技能'`（type 819 专用，这里不用）
 *
 * 用 DOM 而不是 3D Sprite：和头顶名字（`worldTags`）同一套投影，文字清晰、
 * 不占渲染队列，也不会被半透明特效盖住。
 */
import * as THREE from 'three';

export interface GroundLabel {
  /** 物品 id（节点复用的键） */
  id: number;
  /** 世界坐标（格心 + 地形高度） */
  x: number;
  y: number;
  z: number;
  text: string;
  /** CSS 颜色（见文件头的分档） */
  color: string;
  /**
   * `true`  = 画在**物品**上方（Alt 全显，原版 `Sort = 1`）
   * `false` = 画在**鼠标**上方（悬停，原版 `Sort = 0`）
   */
  atItem: boolean;
  /** 强调（悬停的那一条，字号略大） */
  focused?: boolean;
}

interface Node {
  root: HTMLDivElement;
  text: HTMLDivElement;
}

const FONT_H = 13;

export class ItemLabels {
  private nodes = new Map<number, Node>();
  private enabled = true;
  private v = new THREE.Vector3();

  constructor(private layer: HTMLElement) {}

  /** 整个图层显隐（切图/退出时关掉） */
  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.clear();
  }

  clear() {
    for (const n of this.nodes.values()) n.root.remove();
    this.nodes.clear();
  }

  /** 当前渲染了多少条（探针用） */
  snapshot() {
    return [...this.nodes.entries()].map(([id, n]) => ({
      id,
      text: n.text.textContent ?? '',
      color: n.text.style.color,
      display: n.root.style.display,
      left: n.root.style.left,
      top: n.root.style.top,
    }));
  }

  private node(id: number): Node {
    const hit = this.nodes.get(id);
    if (hit) return hit;
    const root = document.createElement('div');
    root.className = 'item-label';
    const text = document.createElement('div');
    text.className = 'item-label-text';
    root.appendChild(text);
    this.layer.appendChild(root);
    const made = { root, text };
    this.nodes.set(id, made);
    return made;
  }

  /**
   * @param camera 游戏相机
   * @param labels 这一帧要画的标签（`atItem` 走投影，`!atItem` 走鼠标坐标）
   * @param mouse  鼠标在 viewport 的 CSS 坐标（`clientX/clientY`）
   */
  update(camera: THREE.Camera, labels: GroundLabel[], mouse: { x: number; y: number }) {
    if (!this.enabled) return;
    const rect = this.layer.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const alive = new Set<number>();
    for (const l of labels) {
      alive.add(l.id);
      const node = this.node(l.id);
      node.text.textContent = l.text;
      node.text.style.color = l.color;
      node.root.classList.toggle('focused', !!l.focused);

      let sx: number;
      let sy: number;
      if (l.atItem) {
        this.v.set(l.x, l.y, l.z);
        this.v.project(camera);
        // z > 1 = 在相机后面；边缘一点也隐藏，免得贴在屏幕边上乱跳
        if (this.v.z > 1 || Math.abs(this.v.x) > 1.02 || Math.abs(this.v.y) > 1.02) {
          node.root.style.display = 'none';
          continue;
        }
        sx = (this.v.x * 0.5 + 0.5) * rect.width;
        sy = (-this.v.y * 0.5 + 0.5) * rect.height;
      } else {
        // 原版 `Sort = 0` 直接用鼠标位置，不投影
        sx = mouse.x - rect.left;
        sy = mouse.y - rect.top;
      }

      // 锚点是「底边中心」：CSS 里 translate(-50%, -100%)
      const w = node.root.offsetWidth || 60;
      node.root.style.display = '';
      node.root.style.left = `${Math.max(w / 2 + 2, Math.min(rect.width - w / 2 - 2, sx)).toFixed(1)}px`;
      node.root.style.top = `${Math.max(FONT_H + 2, Math.min(rect.height - 2, sy)).toFixed(1)}px`;
    }

    for (const [id, n] of [...this.nodes]) {
      if (alive.has(id)) continue;
      n.root.remove();
      this.nodes.delete(id);
    }
  }
}
