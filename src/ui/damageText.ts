/**
 * 伤害飘字：世界坐标 → 屏幕坐标的浮动文字。
 *
 * 用 DOM 而不是 Sprite：文字更清晰、不用管贴图尺寸，
 * 而且 4:3 舞台本身就是 DOM，投影坐标直接用 canvas 的 rect 换算。
 */
import * as THREE from 'three';

/**
 * 服务端伤害类型 → 飘字样式。
 *
 * 类型在 `damage[0]` 的高 4 位（`GameServer/User.h:136-140`）：
 *
 *   0x00 普通   0x10 无视防御   0x20 反射   0x40 卓越一击   0x80 暴击
 *
 * 暴击是 **0x80**（`DAMAGE_TYPE_CRITICAL`），不是 0x10 —— 后者是
 * `DAMAGE_TYPE_IGNORE`（毒/火/坠落这类跳过防御的伤害）。
 */
export function damageClassOf(type: number): '' | 'crit' | 'exc' | 'hurt' {
  if (type === 0x80) return 'crit';
  if (type === 0x40) return 'exc';
  if (type === 0x10) return 'hurt';
  return '';
}

interface FloatItem {  el: HTMLDivElement;
  /** 世界坐标 */
  x: number;
  y: number;
  z: number;
  /** 已经活了多少秒 */
  age: number;
  /** 总时长 */
  ttl: number;
  /** 水平漂移（像素） */
  drift: number;
}

export class DamageTexts {
  private layer: HTMLElement;
  private items: FloatItem[] = [];
  private v = new THREE.Vector3();

  constructor(layer: HTMLElement) {
    this.layer = layer;
  }

  spawn(
    world: { x: number; y: number; z: number },
    text: string,
    cls: '' | 'crit' | 'exc' | 'exp' | 'hurt' = ''
  ) {
    const el = document.createElement('div');
    el.className = `dmg ${cls}`.trim();
    el.textContent = text;
    this.layer.appendChild(el);

    this.items.push({
      el,
      x: world.x,
      y: world.y,
      z: world.z,
      age: 0,
      ttl: cls === 'exp' ? 1.6 : 1.0,
      drift: (Math.random() - 0.5) * 26,
    });

    // 保险：极端情况下（掉帧导致 update 不跑）不让节点堆积
    if (this.items.length > 60) {
      const old = this.items.shift();
      old?.el.remove();
    }
  }

  clear() {
    for (const it of this.items) it.el.remove();
    this.items.length = 0;
  }

  /** 每帧调用：把世界坐标投影到屏幕并上浮淡出 */
  update(dt: number, camera: THREE.Camera) {
    if (this.items.length === 0) return;

    const rect = this.layer.getBoundingClientRect();
    const v = this.v;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;

      if (it.age >= it.ttl) {
        it.el.remove();
        this.items.splice(i, 1);
        continue;
      }

      const t = it.age / it.ttl;

      v.set(it.x, it.y, it.z);
      v.project(camera);

      // 在相机背后/画面外就别画了
      if (v.z > 1 || Math.abs(v.x) > 1.4 || Math.abs(v.y) > 1.4) {
        it.el.style.opacity = '0';
        continue;
      }

      const sx = (v.x * 0.5 + 0.5) * rect.width + it.drift * t;
      // 上浮：起始就在头顶，随时间继续抬升
      const sy = (-v.y * 0.5 + 0.5) * rect.height - t * 34;

      it.el.style.left = `${sx.toFixed(1)}px`;
      it.el.style.top = `${sy.toFixed(1)}px`;
      it.el.style.opacity = String(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
    }
  }
}
