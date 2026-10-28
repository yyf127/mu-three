/**
 * 地图物件特效：火把 / 篝火 / 壁炉 / 街灯 / 蜡烛的火焰、烟、地面光。
 *
 * 全部照抄 0.97k 客户端的 `Scene_ObjectUpdate.cpp`（`MoveObject_PerWorld` /
 * `FUN_0046c7f0`）的 World 0 分支：
 *
 *   | 物件 id | 名字 | 源码分支 | 偏移（世界单位，/100 = 米） |
 *   |---|---|---|---|
 *   | 0x32 (50) | FireLight01 | `FUN_0046c7f0(0, …, 0, 0, 200)` | 火焰，向上 2 m |
 *   | 0x33 (51) | FireLight02 | `(0, -30, 60)` | 火焰 |
 *   | 0x34 (52) | Bonfire01 | `(0, 0, 60)` | 火焰 + 尺寸抖动 |
 *   | 0x37 (55) | DoungeonGate01 | `(±150, -150, 140)` | 两簇火 |
 *   | 0x50 (80) | Bridge01 | `(90, ±200, 30)` | 两簇火（桥头火盆） |
 *   | 0x5A (90) | StreetLight01 | `AddTerrainLight(r=3)` | 地面暖光 |
 *   | 0x82..0x84 (130..132) | Light01..03 | `FUN_0046c7f0(kind)`，kind=0/1/2 | 火 → 烟 → 烟 |
 *   | 0x96 (150) | Candle01 | `AddTerrainLight(r=3)` | 地面暖光 |
 *
 * 源码里火焰是「每帧 50% 概率 spawn 粒子」，一秒 12~13 个粒子、每个活几帧。
 * 我们不做粒子池，而是**每个火点固定几个 billboard 循环**（上升 + 放大 + 淡出），
 * 观感等价、开销恒定 —— 洛兰有 80 多个火点，粒子池反而会拖慢。
 *
 * 贴图取自原版：`Effect/Fire01.OZJ`（4 帧横排）、`Effect/Flame01.OZJ`（静态）、
 * `Effect/smoke01.OZJ`。地面光是程序生成的径向渐变（见 `radialGlow`）。
 */

import * as THREE from 'three';
import { loadTexture } from '../core/texture';
import { additiveProps, fxAlpha } from '../core/additive';

export interface ObjectFxSpot {
  x: number;
  y: number;
  z: number;
  kind: 'fire' | 'smoke' | 'glow';
  /** 视觉尺寸（米） */
  size: number;
  /** 地面光半径（米）或火焰高度（米） */
  range: number;
  /** 0xRRGGBB */
  color: number;
  /** 来源物件 id（调试用，便于对着源码表核对） */
  src?: number;
}

const FX_DIR = 'Data/Effect/';

/** 贴图缓存：同文件只加载一次 */
const texCache = new Map<string, Promise<THREE.Texture | null>>();
function fxTexture(file: string): Promise<THREE.Texture | null> {
  const hit = texCache.get(file);
  if (hit) return hit;
  const task = (async () => {
    const loaded = await loadTexture(FX_DIR, file);
    if (!loaded) return null;
    const tex = loaded.texture.clone();
    // BMD 的 UV 是反的，sprite 用标准 UV —— 不翻回来上下颠倒
    tex.flipY = true;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  })();
  texCache.set(file, task);
  return task;
}

/** 地面光斑：中心白 → 边缘透明（与 `effects.ts` 里那张同形） */
let glowTex: THREE.Texture | null = null;
export function radialGlow(): THREE.Texture {
  if (glowTex) return glowTex;
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0.0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.42)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.11)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  glowTex = tex;
  return tex;
}

/** 一簇火 = 若干个循环上升的面片 */
interface FlameLayer {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  /** 循环周期（秒） */
  period: number;
  /** 相位 0..1 */
  phase: number;
  /** 上升高度（米） */
  rise: number;
  /** 起始/结束尺寸（米） */
  from: number;
  to: number;
  /** 峰值不透明度 */
  peak: number;
}

interface GlowPatch {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  baseOpacity: number;
  /** 呼吸相位 */
  phase: number;
  /** 半径（米） */
  radius: number;
}

const MAX_DIST = 130;

export class ObjectFxLayer {
  readonly spots: ObjectFxSpot[];
  private group = new THREE.Group();
  private flames: FlameLayer[] = [];
  private glows: GlowPatch[] = [];
  /** 每个 spot 的锚点，用于距离剔除 */
  private anchors: { x: number; y: number; z: number; objs: THREE.Object3D[] }[] = [];
  private time = 0;

  constructor(parent: THREE.Object3D, spots: ObjectFxSpot[]) {
    this.spots = spots;
    this.group.name = 'object-fx';
    parent.add(this.group);
    void this.build();
  }

  /**
   * 地面光斑（`AddTerrainLight` 的那张朝上加色圆盘）。
   *
   * 原版是给地形顶点加亮，我们用一张大圆盘近似 —— 但洛兰这种密集摆件的地图，
   * 十几个 6 米圆盘叠在一起会糊成一大片"黄圈"，用户要求去掉。
   * 火焰/烟保留（那是物件本体的一部分），只关掉地面这层。
   */
  private static readonly GROUND_GLOW = false;

  private async build() {
    const [fireTex, flameTex, smokeTex] = await Promise.all([
      fxTexture('Fire01.OZJ'),
      fxTexture('Flame01.OZJ'),
      fxTexture('smoke01.OZJ'),
    ]);

    for (const s of this.spots) {
      const objs: THREE.Object3D[] = [];

      // 地面光斑整层跳过（见 GROUND_GLOW）；火焰/烟照旧
      if (s.kind === 'glow' && !ObjectFxLayer.GROUND_GLOW) continue;

      if (s.kind === 'fire') {
        // 三层：大底焰（静态）+ 两层序列帧火舌（错相位）
        const layers: { tex: THREE.Texture | null; frames: boolean; size: number; rise: number; period: number; tint: number }[] = [
          { tex: flameTex, frames: false, size: s.size * 1.15, rise: s.range * 0.85, period: 0.75, tint: 0xff8a30 },
          { tex: fireTex, frames: true, size: s.size * 0.95, rise: s.range, period: 0.55, tint: 0xffb050 },
          { tex: fireTex, frames: true, size: s.size * 0.7, rise: s.range * 1.25, period: 0.62, tint: 0xffd070 },
        ];
        layers.forEach((L, i) => {
          if (!L.tex) return;
          const tex = L.frames ? L.tex.clone() : L.tex;
          if (L.frames) {
            // Fire01 是 256×64 = 4 帧横排
            tex.repeat.set(0.25, 1);
            tex.offset.set(0, 0);
            tex.needsUpdate = true;
          }
          const mat = new THREE.SpriteMaterial({
            map: tex,
            color: L.tint,
            transparent: true,
            depthWrite: false,
            ...additiveProps(),
            fog: false,
      // 原版 GL_SetBlendAdditive 会 glDisable(GL_FOG)：加色特效不吃雾
            toneMapped: false,
            opacity: 0.9,
          });
          const sprite = new THREE.Sprite(mat);
          sprite.position.set(s.x, s.y, s.z);
          sprite.scale.setScalar(L.size);
          sprite.renderOrder = 12;
          sprite.name = `objfx:fire:${i}`;
          sprite.userData.baseZ = s.z;
          this.group.add(sprite);
          objs.push(sprite);
          this.flames.push({
            sprite,
            material: mat,
            period: L.period,
            phase: (i * 0.37 + Math.random() * 0.25) % 1,
            rise: L.rise,
            from: L.size * 0.85,
            to: L.size * 1.15,
            peak: 0.85,
          });
        });
      } else if (s.kind === 'smoke') {
        for (let i = 0; i < 2; i++) {
          if (!smokeTex) break;
          const mat = new THREE.SpriteMaterial({
            map: smokeTex,
            color: s.color,
            transparent: true,
            depthWrite: false,
            blending: THREE.NormalBlending,
            toneMapped: false,
            opacity: 0.25,
          });
          const sprite = new THREE.Sprite(mat);
          sprite.position.set(s.x, s.y, s.z);
          sprite.scale.setScalar(s.size);
          sprite.renderOrder = 11;
          sprite.name = `objfx:smoke:${i}`;
          sprite.userData.baseZ = s.z;
          this.group.add(sprite);
          objs.push(sprite);
          this.flames.push({
            sprite,
            material: mat,
            period: 2.4 + i * 0.5,
            phase: (i * 0.5 + Math.random() * 0.3) % 1,
            rise: s.range,
            from: s.size * 0.7,
            to: s.size * 1.6,
            peak: 0.28,
          });
        }
      } else {
        const mat = new THREE.MeshBasicMaterial({
          map: radialGlow(),
          color: s.color,
          transparent: true,
          depthWrite: false,
          ...additiveProps(),
          fog: false,
      // 原版 GL_SetBlendAdditive 会 glDisable(GL_FOG)：加色特效不吃雾
          side: THREE.DoubleSide,
          toneMapped: false,
          opacity: 0.35,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
        mesh.position.set(s.x, s.y, s.z + 0.03);
        mesh.scale.setScalar(s.range * 2);
        mesh.renderOrder = 6;
        mesh.name = 'objfx:glow';
        this.group.add(mesh);
        objs.push(mesh);
        this.glows.push({
          mesh,
          material: mat,
          baseOpacity: 0.32,
          phase: Math.random() * Math.PI * 2,
          radius: s.range,
        });
      }

      this.anchors.push({ x: s.x, y: s.y, z: s.z, objs });
    }
  }

  /** 每帧：火舌上升/放大/淡出，地面光呼吸，远景整体隐藏 */
  update(dt: number, camX: number, camY: number) {
    this.time += dt;

    for (const a of this.anchors) {
      const dx = a.x - camX;
      const dy = a.y - camY;
      const far = dx * dx + dy * dy > MAX_DIST * MAX_DIST;
      for (const o of a.objs) o.visible = !far;
    }

    for (const f of this.flames) {
      if (!f.sprite.visible) continue;
      const t = ((this.time / f.period) + f.phase) % 1;
      const baseZ = (f.sprite.userData.baseZ as number) ?? f.sprite.position.z;
      f.sprite.position.z = baseZ + t * f.rise;
      const sc = f.from + (f.to - f.from) * t;
      f.sprite.scale.set(sc, sc, 1);
      // 上升越久越淡；两端都收一点，避免「凭空出现」
      const fade = Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.7;
      fxAlpha(f.material, f.peak * fade);

      // Fire01 的 4 帧：与上升同步换帧，看起来就是火苗在窜
      const map = f.material.map;
      if (map && map.repeat.x < 0.9) {
        const idx = Math.min(3, Math.floor(t * 4));
        map.offset.x = idx * 0.25;
      }
    }

    for (const g of this.glows) {
      if (!g.mesh.visible) continue;
      const wave = 0.75 + 0.25 * Math.sin(this.time * 2.6 + g.phase);
      fxAlpha(g.material, g.baseOpacity * wave);
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(x => x.dispose());
      else mat?.dispose();
    });
    this.flames = [];
    this.glows = [];
    this.anchors = [];
  }
}
