/**
 * 「武器旋转」层 —— 源码 `RenderWheelWeapon`（IDA **0x0046B7C0**）。
 *
 * 为什么单独一层：效果号 **238**（霹雳回旋斩）在 `RenderEffects` 里是
 * `case 238: break;` —— **客户端根本不画这个槽**（`OpenSkills` 也没给它模型）。
 * 它的视觉全在 `MoveEffect` 的 `case 0xee`：每帧生成一个 **239**，而
 * `RenderEffects` 把 239 交给 `RenderWheelWeapon` —— 也就是说
 * **转的是玩家手上那把武器本身**，不是某个技能特效模型。
 *
 * 源码逐行（`Render/Render_WorldHelpers.cpp:970`）：
 *
 * ```c
 * model_id = *(uchar*)(owner + 136) + 400;      // owner 当前武器 → Item 模型池
 * spin = *(float*)(o + 200) - 30.0f;            // 每帧 -30°
 * *(float*)(o + 200) = spin;
 * *(float*)(o + 36) += spin;                    // 第 3 个欧拉角（roll）累积
 * *(int*)  (o + 32)  = 1119092736;              // = 90.0f（pitch，把武器放平）
 * *(float*)(o + 24) += 100.0f;                  // Z 抬高 100 单位 = 1 m
 * RenderPartObject(o, model_id, …alpha…);       // 借用效果槽画完再还原
 * ```
 *
 * 换算：`-30°/帧 × 25 fps = -750°/s ≈ -13.09 rad/s`；抬高 100 单位 = **1.0 m**；
 * 239 自己的寿命 `pfVar17[0x18] = 3.50325e-44` → 位模式 **25 帧 = 1.0 s**。
 *
 * 我们的做法等价但更干净：**克隆**一份当前武器（武器是静态几何，见
 * `Actor.buildHeldItem` 用的 `createStaticMeshes`），挂到一个绕竖轴转的 pivot 上，
 * 不碰角色本体，也就不需要源码那套「改字段 → 画 → 还原」。
 */
import * as THREE from 'three';

/** 239 的默认不透明度：源码按 SubType 给 0.6 / 0.5 / 0.4 / 0.3，取最亮那档 */
const WHEEL_ALPHA = 0.6;

export interface WheelOptions {
  /** 寿命（秒）。源码 239 的 `+0x18` = 25 帧 = **1.0 s** */
  life?: number;
  /** 自转（弧度/秒）。源码每帧 -30° @25fps → **-13.09** */
  spin?: number;
  /** 抬高（米）。源码 `o+24 += 100` 单位 = **1.0 m** */
  lift?: number;
  /** 躺平角（弧度）。源码 `o+32 = 90°`，把武器从竖直放平 */
  tilt?: number;
  /** 整体缩放 */
  scale?: number;
}

interface Wheel {
  id: number;
  /** 绕竖轴转的那个 Group */
  pivot: THREE.Group;
  meshes: THREE.Mesh[];
  mats: THREE.Material[];
  age: number;
  life: number;
  spin: number;
  alpha: number;
}


/**
 * 克隆一份武器的网格（共享几何、**克隆材质**）。
 *
 * 武器在 `Actor.buildHeldItem` 里是静态几何（`createStaticMeshes` + 烘焙骨骼矩阵），
 * 所以直接 `new THREE.Mesh(同一 geometry, 克隆的 material)` 就能独立摆放，
 * 顶点数据不用复制一份。
 */
function cloneWeaponMeshes(source: THREE.Object3D) {
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  const mats: THREE.Material[] = [];

  source.traverse(o => {
    const m = o as THREE.Mesh;
    if (!(m as unknown as { isMesh?: boolean }).isMesh) return;
    const src = Array.isArray(m.material) ? m.material[0] : m.material;
    if (!src) return;
    // 材质要克隆：淡出改的是 opacity，共用材质会把角色手上的武器也弄透明
    const mat = src.clone();
    mat.transparent = true;
    mat.depthWrite = false;
    const copy = new THREE.Mesh(m.geometry, mat);
    copy.position.copy(m.position);
    copy.quaternion.copy(m.quaternion);
    copy.scale.copy(m.scale);
    copy.frustumCulled = false;
    copy.renderOrder = 11;
    group.add(copy);
    meshes.push(copy);
    mats.push(mat);
  });

  return meshes.length ? { group, meshes, mats } : null;
}

export class WeaponWheelLayer {
  private active: Wheel[] = [];
  private nextId = 1;


  /** 当前活着的数量（探针计数用） */
  get activeCount() {
    return this.active.length;
  }

  constructor(private readonly scene: THREE.Scene) {}

  /**
   * 生成一圈「武器旋转」。
   *
   * @param source 玩家当前武器的 Object3D（`Actor.props` 里 `held:*@right` 那个组）。
   *               会**克隆**它的网格，不动原件。
   * @param pos    落点（角色脚下地面坐标）；z 会再加 `lift`
   */
  spawn(source: THREE.Object3D, pos: { x: number; y: number; z: number }, opt: WheelOptions = {}) {
    const pivot = new THREE.Group();
    pivot.name = 'fx:wheel';

    const holder = new THREE.Group();
    // 源码 `o+32 = 90°`：先把武器放平，之后绕竖轴转才是「桨叶」的观感
    holder.rotation.x = opt.tilt ?? Math.PI / 2;
    pivot.add(holder);

    const cloned = cloneWeaponMeshes(source);
    if (!cloned) return null;
    const { meshes, mats } = cloned;
    // 先收集再搬：边 traverse 边 removeFromParent 会打乱遍历
    for (const m of [...meshes]) holder.add(m);
    for (const m of mats) (m as THREE.MeshBasicMaterial).opacity = WHEEL_ALPHA;

    /*
     * 让旋转绕**武器自身中心**，而不是绕挂载点：
     * 挂到手上时 group 带了挂载偏移/朝向，直接转会甩出一个大圈。
     * 这里把克隆体的包围盒中心平移到 pivot 原点。
     */
    pivot.position.set(0, 0, 0);
    pivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    if (!box.isEmpty()) {
      const c = box.getCenter(new THREE.Vector3());
      holder.position.sub(c);
    }

    pivot.position.set(pos.x, pos.y, pos.z + (opt.lift ?? 1.0));
    if (opt.scale !== undefined) pivot.scale.setScalar(opt.scale);
    this.scene.add(pivot);

    const w: Wheel = {
      id: this.nextId++,
      pivot,
      meshes,
      mats,
      age: 0,
      life: opt.life ?? 1.0,
      spin: opt.spin ?? -13.09,
      alpha: WHEEL_ALPHA,
    };
    this.active.push(w);
    return w.id;
  }

  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const w = this.active[i];
      w.age += dt;
      // 绕竖轴（世界 Z-up）；`rotation.z` 才是「转竖轴」，不是 `rotation.y`
      w.pivot.rotation.z += w.spin * dt;

      // 后 30% 淡出：源码靠「每帧新建 239 + SubType 降 alpha」做出消散
      const t = w.age / Math.max(0.01, w.life);
      const k = t < 0.7 ? 1 : Math.max(0, 1 - (t - 0.7) / 0.3);
      for (const m of w.mats) {
        const mm = m as THREE.MeshBasicMaterial;
        mm.opacity = w.alpha * k;
      }

      if (w.age >= w.life) {
        this.remove(i);
      }
    }
  }

  private remove(i: number) {
    const w = this.active[i];
    this.scene.remove(w.pivot);
    for (const m of w.mats) m.dispose();
    // 几何是**共享**的（克隆时没复制顶点），只清材质，别 dispose 几何
    w.meshes.length = 0;
    this.active.splice(i, 1);
  }

  clear() {
    for (let i = this.active.length - 1; i >= 0; i--) this.remove(i);
  }

  snapshot() {
    return this.active.map(w => ({
      id: w.id,
      age: Number(w.age.toFixed(3)),
      life: w.life,
      spin: w.spin,
      angle: Number(w.pivot.rotation.z.toFixed(3)),
      pos: [
        Number(w.pivot.position.x.toFixed(2)),
        Number(w.pivot.position.y.toFixed(2)),
        Number(w.pivot.position.z.toFixed(2)),
      ],
      meshes: w.meshes.length,
      visible: w.pivot.visible && w.pivot.parent !== null,
    }));
  }
}

/* ------------------------------------------------------------------ */
/* 244 武器砸地（ItemDrop_RenderGroundWeapon 0x0046B980）              */
/* ------------------------------------------------------------------ */

export interface SlamOptions {
  /** 总时长（秒）。源码 244 的 `+0x18` = 20 帧 = **0.8 s** */
  life?: number;
  /** 举到多高（米） */
  height?: number;
  /** 砸下时的倾斜（弧度）。源码 `[0x36] = 50°` */
  tilt?: number;
  /** 绕竖轴的自转（弧度/秒） */
  spin?: number;
}

interface Slam {
  id: number;
  pivot: THREE.Group;
  holder: THREE.Group;
  mats: THREE.Material[];
  meshes: THREE.Mesh[];
  age: number;
  life: number;
  height: number;
  spin: number;
  baseZ: number;
  impacted: boolean;
}

/**
 * 「举起来 → 砸下去」的武器。
 *
 * 时间线照 `MoveEffect` 的 `case 0xF4`（总 20 帧）：
 *   `life 20..15` 上升，`life 15` 翻转垂直速度，`life 10..15` 每帧 -8 单位，
 *   `life 3` 砸地（调用方在 `onImpact` 里放地裂/碎石），`life 2` 结算。
 * 而 `ItemDrop_RenderGroundWeapon` 只在 `life > 10` 时画武器 —— 落地后不再画武器，
 * 所以这里砸地之后保留一小段只是为了淡出，主体交给地裂。
 */
export class WeaponSlamLayer {
  private active: Slam[] = [];
  private nextId = 1;

  /** 当前活着的数量（探针计数用） */
  get activeCount() {
    return this.active.length;
  }

  constructor(private readonly scene: THREE.Scene) {}

  spawn(
    source: THREE.Object3D,
    pos: { x: number; y: number; z: number },
    opt: SlamOptions = {},
    onImpact?: () => void
  ) {
    const cloned = cloneWeaponMeshes(source);
    if (!cloned) return null;

    const pivot = new THREE.Group();
    pivot.name = 'fx:slam';
    const holder = new THREE.Group();
    holder.rotation.x = opt.tilt ?? (50 * Math.PI) / 180;
    pivot.add(holder);
    for (const m of [...cloned.meshes]) holder.add(m);
    for (const m of cloned.mats) (m as THREE.MeshBasicMaterial).opacity = 1;

    // 绕武器自身中心升降/自转，避免绕挂载点甩
    pivot.position.set(0, 0, 0);
    pivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    if (!box.isEmpty()) holder.position.sub(box.getCenter(new THREE.Vector3()));

    const baseZ = pos.z;
    pivot.position.set(pos.x, pos.y, baseZ);
    this.scene.add(pivot);

    const sl: Slam = {
      id: this.nextId++,
      pivot,
      holder,
      mats: cloned.mats,
      meshes: cloned.meshes,
      age: 0,
      life: opt.life ?? 0.8,
      height: opt.height ?? 2.8,
      spin: opt.spin ?? -2.4,
      baseZ,
      impacted: false,
    };
    (sl as Slam & { onImpact?: () => void }).onImpact = onImpact;
    this.active.push(sl);
    return sl.id;
  }

  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      s.age += dt;
      const t = s.age / Math.max(0.01, s.life);

      /*
       * 高度曲线完全按源码的帧号换算（总 20 帧）：
       *   life 20 → 15（t 0..0.25）上升
       *   life 15        （t 0.25）翻转垂直速度
       *   life 15 → 10（t 0.25..0.5）每帧 -8 单位，只掉一点点
       *   life 10 → 3 （t 0.5..0.85）继续下坠，砸地
       *   life 3        （t 0.85）落地
       */
      let k: number;
      if (t < 0.25) {
        const u = t / 0.25;
        k = 1 - (1 - u) * (1 - u); // easeOut 升到顶
      } else if (t < 0.5) {
        // life 15→10：-8 单位/帧 × 5 帧 = 40 单位 ≈ 顶高的 15%
        const u = (t - 0.25) / 0.25;
        k = 1 - 0.15 * u;
      } else if (t < 0.85) {
        const u = (t - 0.5) / 0.35;
        k = 0.85 * (1 - u * u); // 加速砸下
      } else {
        k = 0;
      }
      s.pivot.position.z = s.baseZ + s.height * k;
      s.holder.rotation.z += s.spin * dt;

      // 落地：只触发一次（源码 life == 3 → t = 0.85）
      if (!s.impacted && t >= 0.85) {
        s.impacted = true;
        (s as Slam & { onImpact?: () => void }).onImpact?.();
      }

      // 落地后快速淡出（源码画武器到 life 10 就停，剩下交给地裂）
      const fade = t > 0.9 ? Math.max(0, 1 - (t - 0.9) / 0.1) : 1;
      for (const m of s.mats) (m as THREE.MeshBasicMaterial).opacity = fade;

      if (s.age >= s.life) this.remove(i);
    }
  }

  private remove(i: number) {
    const s = this.active[i];
    this.scene.remove(s.pivot);
    for (const m of s.mats) m.dispose();
    s.meshes.length = 0;
    this.active.splice(i, 1);
  }

  clear() {
    for (let i = this.active.length - 1; i >= 0; i--) this.remove(i);
  }

  snapshot() {
    return this.active.map(s => {
      const t = s.age / Math.max(0.01, s.life);
      return {
        id: s.id,
        age: Number(s.age.toFixed(3)),
        life: s.life,
        /** 0 = 地面，1 = 最高点 */
        height: Number(((s.pivot.position.z - s.baseZ) / s.height).toFixed(3)),
        z: Number(s.pivot.position.z.toFixed(2)),
        impacted: s.impacted,
        phase: t < 0.25 ? 'rise' : t < 0.5 ? 'hold' : t < 0.85 ? 'fall' : 'ground',
        meshes: s.meshes.length,
        visible: s.pivot.visible && s.pivot.parent !== null,
      };
    });
  }
}
