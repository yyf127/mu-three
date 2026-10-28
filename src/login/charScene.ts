/**
 * 选角界面的 3D —— `Data/Logo/Logo05.bmd`（内部名 `main.smd`，0xA4 槽）。
 *
 * 原版 `Game_EnterWorldTick` 一进来就是 `GL_BeginViewport(0, 0, 0x280, 0x1e0)` 全屏 3D：
 * 布景在原点（`CreateObject(0xa4, pos3={0,0,0}, rot3={0,0,0}, 1.0f)`），
 * 前面站着最多 5 个角色（`Recv_CharList` 里 `CreateHero(slot, class, 0, x, y, rotate)`）。
 *
 * 这一版**照原版数值摆**，不再靠猜：
 *
 *   相机   `CameraWalk_005615ec` 的 wp5 —— pos(200,-800,300)、ang(pitch −80, yaw 0, roll −10)、
 *          `MoveCamera` 里再把 pos 按 roll 反向旋转一次（`VectorIRotate`），FOV 45。
 *   角色   `Net_Process.cpp::Recv_CharList` —— x = slot×100、y = slot×50 − 50、
 *          rotate = (slot−1)×15°（单位是 MU 单位 / 度，×0.01 就是我们世界的格子大小）。
 *
 * 所以「画面看着是斜的」不是布景被转了，是**相机有 −10° 的 roll**（`glRotatef(roll,0,0,1)`）。
 */

import * as THREE from 'three';
import { MODEL_SCALE } from '../core/model';
import { buildBmdGroup } from '../core/bmdProp';
import { PlayerAction, createPlayer, type Actor } from '../world/actor';
import { decodeCharSet } from '../data/charSet';

const LOGO_DIR = 'Data/Logo/';
const PLAYER_DIR = '/Data/Player/';

/* ==================================================================== */
/* 构图旋钮（想手动调就改这里，改完刷新页面）                            */
/* ==================================================================== */

/* ---------------------------- 相机 ---------------------------- */
/*
 * 全部照抄 `globals.cpp` 的 `CameraWalk_005615ec[wp5]`：
 *
 *   CAM_POS_MU     MU 单位的位置（200, -800, 300）；世界坐标 = 它 × MODEL_SCALE(0.01)
 *   CAM_PITCH_DEG  wp5.ang[0] = −80 → 镜头往下俯 10°（−90 才是垂直向下看）
 *   CAM_YAW_DEG    wp5.ang[1] = 0
 *   CAM_ROLL_DEG   wp5.ang[2] = −10 → **画面整体倾斜 10°**（不是布景转了，是相机 roll）
 *   CAM_FOV        `MoveCamera` 里写死 `CameraFOV = 45`
 *
 * 注意：位置不是直接用 (200,-800,300)，`MoveCamera` 会先用 roll 做一次
 * `VectorIRotate`（逆旋转），得到的才是 `CameraPosition`。下面的 `applyCamera()`
 * 就是干这个 —— 别自己把两个旋转混一起。
 */
const CAM_POS_MU = { x: 200, y: -800, z: 300 };
const CAM_PITCH_DEG = -80;
const CAM_YAW_DEG = 0;
const CAM_ROLL_DEG = -10;
const CAM_FOV = 45;

/* -------------------------- 场上角色 -------------------------- */
/*
 * `Recv_CharList`：`x = slot*100`、`y = slot*50 - 50`（MU 单位）、`rotate = (slot-1)*15°`。
 * 换成世界坐标（×0.01）就是：x = slot、y = slot*0.5 - 0.5，站在一条 45° 斜线上，
 * 每往后一格转 15°。
 *
 *   CHAR_STEP_X / CHAR_STEP_Y  相邻两个槽的横向 / 纵向间距（世界单位，1 = 一格）
 *   CHAR_YAW_STEP              槽位之间转多少度
 *   CHAR_MAX                   最多摆几只（原版 5 个槽）
 *   STAGE_Z                    脚踩的高度
 */
const CHAR_STEP_X = 100 * MODEL_SCALE;
const CHAR_STEP_Y = 50 * MODEL_SCALE;
const CHAR_YAW_STEP = 15;
const CHAR_MAX = 5;
const STAGE_Z = 0;

/** 选角里的一只角色（名字 / 职业号 / 等级 / 槽位），由 main.ts 从角色列表传进来 */
export interface CharSlot {
  name: string;
  cls: number;
  level: number;
  /** 0..4，原版的 `slot`（Recv_CharList 的 rec[0]）—— 站位和朝向都按它算 */
  slot: number;
  /**
   * `CharSet[11]`（原包里的装备压缩字段）。
   * 原版 `Recv_CharList` 拿到就 `ChangeCharacterExt(slot, &CharSet[1])` 把装备穿身上，
   * 所以选角界面上的人是他自己那套甲/头盔/翅膀，不是职业默认皮肤。
   */
  charSet: number[];
}

export interface CharSceneHandle {
  tick(dt: number): void;
  resize(): void;
  dispose(): void;
  /** 重建站在场上的角色（进入选角、建角/删角后调用） */
  setChars(list: CharSlot[]): Promise<void>;
  /** 高亮某一只（传 null / 不存在的名字就是全不高亮） */
  setSelected(name: string | null): void;
  /** 调试：转 / 挪布景（rot 度、offsetY 世界 Y） */
  setScene(o: { rot?: number; offsetY?: number }): void;
  /** 调试：射线检测每只角色有没有被布景挡住 */
  probe(): unknown[];
  /** 调试：布景每块 mesh 的世界包围盒 */
  boxes(): { name: string; min: number[]; max: number[] }[];
  stats(): { loaded: boolean; camera: number[]; target: number[]; fov: number };
  /** 调试：临时改相机（调构图用，不落盘） */
  setCamera(o: { x?: number; y?: number; z?: number; pitch?: number; yaw?: number; roll?: number; fov?: number }): void;
  /** 调试：布景整体亮度（乘在材质色上，1 = 原样） */
  setStageLight(k: number): void;
  /** 调试：角色整体亮度（乘在材质色上，1 = 原样） */
  setCharLight(k: number): void;
  /** 调试：角色贴图关掉 mipmap（原版 GL 只有 LINEAR，不生成 mip） */
  setCharSharp(on: boolean): void;
  /** 调试：布景不吃顶点光照（压平明暗对比） */
  setStageFlat(on: boolean): void;
  /** 调试：按 1999 年那套 GL（不做 sRGB 输出转换）出图 */
  setLegacyGamma(on: boolean): void;
}

/** MU 单位 → 世界单位（和 BMD 的 `MODEL_SCALE` 同一套：100 MU = 1 格） */
const MU = MODEL_SCALE;

export async function createCharScene(host: HTMLElement): Promise<CharSceneHandle | null> {
  // `cull: true` = 原版那样单面渲染（`glEnable(GL_CULL_FACE)`）。
  // 少了它，`main_wood6.jpg` 那个把整个场景包在里面的大壳会画出内壁，把人全挡住。
  const built = await buildBmdGroup(LOGO_DIR, 'Logo05', {
    sideRules: [
      // 这圈「树墙」法线朝内（原版靠 GL_CULL_FACE 把近侧剔掉），必须按背面画
      { match: /wood6\.jpg/i, side: 'back' },
    ],
  });
  if (!built) return null;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' });
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  host.appendChild(canvas);

  /** 布景亮度：实测原版截图里背景比我们亮一点（p50 43 vs 30），乘一点点追平 */
  const STAGE_LIGHT = 1.05;
  /** 顶点光照压软：0 = 原样，0.35 = 每个顶点朝白 lerp 35% */
  const STAGE_LIGHT_SOFT = 0.45;

  const scene = new THREE.Scene();

  /*
   * 布景在原点、**不旋转**（原版 `CreateObject(0xa4, {0,0,0}, {0,0,0}, 1.0)`）。
   * 外面套一层 `pivot` 只是为了留个调试用的旋钮。
   */
  const pivot = new THREE.Group();
  pivot.name = 'login:charStage';
  pivot.add(built.group);
  scene.add(pivot);

  /*
   * 布景整体提亮 + 顶点光照**压软**。
   *
   * 我们的静态物件是按「环境光 0.6 + 阳光 0.85」烘的顶点色，明暗差很大；
   * 和原版截图对比，我们的暗部太暗（p50 32 vs 原版 43）、高光又偏亮。
   * 这里把每个顶点的颜色朝白 lerp 一部分（`STAGE_LIGHT_SOFT`），
   * 阴影抬起来、亮部压一点，整体分布就贴近原版了。
   */
  const soft = STAGE_LIGHT_SOFT;
  pivot.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (m.material as THREE.MeshBasicMaterial).clone();
    mat.color.setScalar(STAGE_LIGHT);
    m.material = mat;

    const col = m.geometry.getAttribute('color');
    if (col && soft > 0) {
      for (let i = 0; i < col.count; i++) {
        col.setXYZ(
          i,
          col.getX(i) + (1 - col.getX(i)) * soft,
          col.getY(i) + (1 - col.getY(i)) * soft,
          col.getZ(i) + (1 - col.getZ(i)) * soft
        );
      }
      col.needsUpdate = true;
    }
  });

  const camera = new THREE.PerspectiveCamera(CAM_FOV, 4 / 3, 0.05, 400);
  camera.up.set(0, 0, 1);

  /* ------------------------------ 相机 ------------------------------ */
  /*
   * 和原版一一对应：
   *   AngleMatrix({0,0,roll}) → `VectorIRotate(CAM_POS_MU, M)` → `CameraPosition`
   *   视图矩阵 = RotY(yaw) · RotX(pitch) · RotZ(roll) · Translate(−pos)
   *   → 相机的世界朝向 = RotZ(−roll) · RotX(−pitch) · RotY(−yaw)
   */
  const cam = {
    x: CAM_POS_MU.x,
    y: CAM_POS_MU.y,
    z: CAM_POS_MU.z,
    pitch: CAM_PITCH_DEG,
    yaw: CAM_YAW_DEG,
    roll: CAM_ROLL_DEG,
    fov: CAM_FOV,
  };

  const camTarget = new THREE.Vector3(); // 视线前方 1 单位处的点（只给 stats / 调试看）

  const applyCamera = () => {
    const rad = THREE.MathUtils.degToRad(cam.roll);
    const cR = Math.cos(rad);
    const sR = Math.sin(rad);
    // VectorIRotate：out = Mᵀ · v（M 只含 roll）
    const px = cam.x * cR + cam.y * sR;
    const py = -cam.x * sR + cam.y * cR;
    camera.position.set(px * MU, py * MU, cam.z * MU);

    const m = new THREE.Matrix4()
      .makeRotationZ(THREE.MathUtils.degToRad(-cam.roll))
      .multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(-cam.pitch)))
      .multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(-cam.yaw)));
    camera.quaternion.setFromRotationMatrix(m);

    if (camera.fov !== cam.fov) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }
    camTarget.set(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position);
  };
  applyCamera();

  const resize = () => {
    const w = host.clientWidth || 640;
    const h = host.clientHeight || 480;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  resize();

  /* ------------------------------------------------------------------ */
  /* 场上的角色                                                          */
  /* ------------------------------------------------------------------ */
  let actors: Actor[] = [];
  let slots: CharSlot[] = [];
  let selected: string | null = null;

  /**
   * 原版站位的世界坐标：`x = slot×100`、`y = slot×50 − 50`（MU 单位）。
   * `Actor.x/y` 是**格号**，渲染时会 +0.5 落到格心，所以这里减掉 0.5。
   */
  const slotWorld = (slot: number) => ({
    x: slot * CHAR_STEP_X,
    y: slot * CHAR_STEP_Y - CHAR_STEP_Y,
  });

  /**
   * 每个槽位的**站位锚点**（世界坐标）。
   *
   * 名字标签只依赖它，不依赖模型 —— 于是「站位 + 头顶名字」可以先出来，
   * 角色模型在后台并发加载，选角界面不用等模型就能点。
   */
  const anchors: { wx: number; wy: number; z: number }[] = [];
  const anchorOf = (slot: number) => {
    const w = slotWorld(slot);
    return { wx: w.x, wy: w.y, z: STAGE_Z };
  };

  const placeChar = (actor: Actor, slot: number) => {
    const w = slotWorld(slot);
    actor.x = w.x / 1 - 0.5; // 世界坐标 → 格号（格宽 = 1 世界单位）
    actor.y = w.y - 0.5;
    actor.z = STAGE_Z;
    // 原版 rotate = (slot−1)×15°；模型本地朝 −Y，rotation.z = yaw
    actor.yaw = THREE.MathUtils.degToRad((slot - 1) * CHAR_YAW_STEP);
    actor.update(0);
  };

  /*
   * 选中高亮：把这只角色所有网格的材质换成「同贴图、提亮过」的副本。
   * 材质是按贴图全局缓存的（`core/model.ts::getBmdMaterial`），直接改会连带
   * 其它角色一起亮，所以必须 clone 一份挂在这几个 mesh 上。
   */
  const setHighlight = (actor: Actor, on: boolean) => {
    const paint = (target: THREE.Object3D & { material?: THREE.Material | THREE.Material[] }) => {
      const ud = target.userData as { baseMat?: THREE.Material; hiMat?: THREE.Material };
      if (on) {
        ud.baseMat ??= target.material as THREE.Material;
        if (!ud.hiMat) {
          const hi = (ud.baseMat as THREE.MeshBasicMaterial).clone();
          // >1 的颜色 = 乘上去比原色更亮，配合 sRGB 输出就是「打了一层光」
          hi.color.setRGB(2.5, 2.3, 1.85);
          hi.toneMapped = false;
          ud.hiMat = hi;
        }
        target.material = ud.hiMat;
      } else if (ud.baseMat) {
        // 取消高亮要还原到「带 charLight 的那份」，不能直接回原始材质
        target.material = (ud as { litMat?: THREE.Material }).litMat ?? ud.baseMat;
      }
    };
    for (const m of actor.meshes) paint(m as unknown as THREE.Object3D & { material?: THREE.Material });
    // 武器 / 盾挂在骨骼下，单独走一遍
    for (const p of actor.props) {
      p.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) paint(mesh as unknown as THREE.Object3D & { material?: THREE.Material });
      });
    }
  };

  const paintHighlight = () => {
    for (let i = 0; i < actors.length; i++) {
      setHighlight(actors[i], slots[i]?.name === selected);
    }
  };

  /** 角色亮度倍数（原版 `CreateHero` 里 `Object.Light[0..2] = 0.3`，但我们按实测调） */
  let charLight = 0.92;

  /**
   * 角色贴图**关掉 mipmap**。
   *
   * 原版 GL 只设了 `GL_LINEAR`（`Camera.cpp` 那段纹理状态里没有 mip），
   * 我们是 `LinearMipmapLinear` —— 人物只占 200 来像素、贴图 256，稍微一缩就吃到
   * mip 层，看着发糊。关掉 mipmap 边缘会硬一点，更接近原版那种「颗粒感」。
   */
  const sharpen = (actor: Actor, on: boolean) => {
    const seen = new Set<THREE.Texture>();
    const fix = (obj: THREE.Object3D & { material?: THREE.Material | THREE.Material[] }) => {
      const mat = obj.material as THREE.MeshBasicMaterial;
      const tex = mat?.map;
      if (!tex || seen.has(tex)) return;
      seen.add(tex);
      tex.generateMipmaps = !on;
      tex.minFilter = on ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
      tex.needsUpdate = true;
    };
    for (const m of actor.meshes) fix(m as unknown as THREE.Object3D & { material?: THREE.Material });
    for (const p of actor.props) {
      p.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) fix(mesh as unknown as THREE.Object3D & { material?: THREE.Material });
      });
    }
  };

  /** 把角色的材质色乘上 `charLight`（材质是全局缓存的，必须 clone） */
  const applyCharLight = (actor: Actor, k: number) => {
    const paint = (obj: THREE.Object3D & { material?: THREE.Material | THREE.Material[] }) => {
      const ud = obj.userData as { baseMat?: THREE.Material; litMat?: THREE.Material };
      ud.baseMat = (ud.litMat ?? (obj.material as THREE.Material));
      if (!ud.litMat || !(ud.litMat as THREE.MeshBasicMaterial).color) {
        const c = (ud.baseMat as THREE.MeshBasicMaterial).clone();
        ud.litMat = c;
      }
      const m = ud.litMat as THREE.MeshBasicMaterial;
      m.color.setScalar(k);
      obj.material = m;
    };
    for (const m of actor.meshes) paint(m as unknown as THREE.Object3D & { material?: THREE.Material });
    for (const p of actor.props) {
      p.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) paint(mesh as unknown as THREE.Object3D & { material?: THREE.Material });
      });
    }
  };

  const clearChars = () => {
    for (const a of actors) {
      scene.remove(a.root);
      for (const m of a.meshes) scene.remove(m);
      for (const p of a.props) p.removeFromParent();
    }
    actors = [];
    anchors.length = 0;
  };

  /** 世界坐标 → 640×480 逻辑坐标（标签定位用） */
  const toScreen = (x: number, y: number, z: number) => {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * 640,
      y: (-v.y * 0.5 + 0.5) * 480,
      behind: v.z > 1,
    };
  };

  /**
   * 把名字标签摆到角色头顶。原版是 `Camera_ProjectWorldToScreen` 之后
   * 画两行字，这里把 DOM 标签挪到同一个投影点（每帧做，5 个元素不心疼）。
   */
  const syncLabels = () => {
    for (let i = 0; i < slots.length; i++) {
      const el = document.querySelector<HTMLElement>(
        `#char-list .char-card[data-name="${slots[i].name}"]`
      );
      const a = anchors[i];
      if (!el || !a) continue;
      const head = toScreen(a.wx, a.wy, a.z + 2.05);
      el.style.left = `${head.x.toFixed(1)}px`;
      el.style.top = `${head.y.toFixed(1)}px`;
      el.classList.toggle('offscreen', head.behind);
    }
  };

  const handle: CharSceneHandle = {
    tick(dt: number) {
      const screen = document.getElementById('charselect');
      if (!screen || screen.classList.contains('hidden')) return;
      for (const a of actors) a.update(dt);
      syncLabels();
      renderer.render(scene, camera);
    },
    async setChars(list: CharSlot[]) {
      slots = list.slice(0, CHAR_MAX);
      clearChars();

      // ① 站位先定：名字标签立刻能画出来，不等模型
      for (const s of slots) anchors.push(anchorOf(s.slot));
      syncLabels();

      /*
       * ② 模型**并发**加载。
       *
       * 以前是 `for … await createPlayer()` 串行 4 只，线上每只一个 BMD +
       * 若干装备模型，等于 4 个 RTT 周期排队；改成一轮并发，选角界面能先出来
       * 再逐个补模型（模型没到也能选、也能点进游戏）。
       */
      const built = await Promise.all(
        slots.map(async slot => {
          try {
            // 原版：ChangeCharacterExt(slot, &CharSet[1]) —— 用角色自己那套装备
            const gear = decodeCharSet(slot.charSet).equip;
            gear.cls = slot.cls & 3;
            return await createPlayer(scene, PLAYER_DIR, gear);
          } catch (err) {
            console.warn(`[char3d] 角色 ${slot.name} 模型加载失败`, err);
            return null;
          }
        })
      );

      // ③ 按顺序挂到场上（actors 顺序要和 slots 对齐：高亮/探针都按索引配对）
      for (let i = 0; i < built.length; i++) {
        const actor = built[i];
        if (!actor) continue;
        actor.attachMeshes(scene);
        placeChar(actor, slots[i].slot);
        actor.play(PlayerAction.STOP_MALE, true);
        actor.update(0);
        applyCharLight(actor, charLight);
        sharpen(actor, true);
        actors.push(actor);
        // 每挂上一只就刷一次标签（不用等 4 只全好）
        syncLabels();
      }
      paintHighlight();
      syncLabels();
      console.log(
        `[char3d] 场上角色 ${actors.length}/${slots.length}：` +
          slots
            .map(s => {
              const d = decodeCharSet(s.charSet);
              return `${s.name}@slot${s.slot} cls${d.equip.cls} helm${d.tiers.helm} armor${d.tiers.armor} wing${d.wing}`;
            })
            .join(' | ')
      );
    },
    setSelected(name: string | null) {
      selected = name;
      paintHighlight();
    },
    setScene(o) {
      if (o.rot !== undefined) pivot.rotation.z = THREE.MathUtils.degToRad(o.rot);
      if (o.offsetY !== undefined) pivot.position.y = o.offsetY;
    },
    probe() {
      const ray = new THREE.Raycaster();
      const tmp = new THREE.Vector3();
      return actors.map((a, i) => {
        /*
         * 在角色身上铺一张 7×11 的采样网格（横向 ±0.5 单位、高度 0.15..2.1），
         * 每点从相机打一条射线，落到布景上的就算被挡。
         */
        const hitsCount = new Map<string, number>();
        let blocked = 0;
        let total = 0;
        for (let ix = 0; ix < 7; ix++) {
          for (let iz = 0; iz < 11; iz++) {
            const dx = -0.5 + ix * (1.0 / 6);
            const dz = 0.15 + iz * (1.95 / 10);
            tmp.set(a.wx + dx, a.wy, STAGE_Z + dz);
            const dir = tmp.clone().sub(camera.position).normalize();
            ray.set(camera.position, dir);
            ray.far = camera.position.distanceTo(tmp) - 0.03;
            const hits = ray.intersectObject(pivot, true);
            total++;
            if (hits.length) {
              blocked++;
              const n = hits[0].object.name || '?';
              hitsCount.set(n, (hitsCount.get(n) ?? 0) + 1);
            }
          }
        }
        const head = toScreen(a.wx, a.wy, STAGE_Z + 2.05);
        const d = decodeCharSet(slots[i]?.charSet);
        return {
          name: slots[i]?.name ?? `#${i}`,
          gear: { cls: d.equip.cls, helm: d.tiers.helm, armor: d.tiers.armor, pants: d.tiers.pants, wing: d.wing, raw: (slots[i]?.charSet ?? []).join(',') },
          meshes: a.meshes.length,
          props: a.props.map(p => p.name).join('+') || '-',
          blocked: `${blocked}/${total}`,
          ratio: +(blocked / total).toFixed(2),
          blockers: [...hitsCount.entries()].sort((x, y) => y[1] - x[1]).map(([n]) => n),
          world: [+a.wx.toFixed(2), +a.wy.toFixed(2)],
          yawDeg: +THREE.MathUtils.radToDeg(a.yaw).toFixed(1),
          screen: [+head.x.toFixed(0), +head.y.toFixed(0)],
        };
      });
    },
    boxes() {
      const out: { name: string; min: number[]; max: number[] }[] = [];
      pivot.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const b = new THREE.Box3().setFromObject(mesh);
        out.push({
          name: mesh.name,
          min: b.min.toArray().map(v => +v.toFixed(2)),
          max: b.max.toArray().map(v => +v.toFixed(2)),
        });
      });
      return out;
    },
    resize,
    dispose() {
      renderer.dispose();
      canvas.remove();
      scene.clear();
    },
    stats: () => ({
      loaded: true,
      camera: camera.position.toArray().map(v => +v.toFixed(2)),
      target: camTarget.toArray().map(v => +v.toFixed(2)),
      fov: camera.fov,
    }),
    setCharSharp(on) {
      for (const a of actors) sharpen(a, on);
    },
    setLegacyGamma(on) {
      renderer.outputColorSpace = on ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
    },
    setStageFlat(on) {
      pivot.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.vertexColors = !on;
        mat.needsUpdate = true;
      });
    },
    setCharLight(k) {
      charLight = k;
      for (const a of actors) applyCharLight(a, k);
    },
    setStageLight(k) {
      pivot.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshBasicMaterial;
        if (!mat.color) return;
        mat.color.setScalar(k);
      });
    },
    setCamera(o) {
      if (o.x !== undefined) cam.x = o.x;
      if (o.y !== undefined) cam.y = o.y;
      if (o.z !== undefined) cam.z = o.z;
      if (o.pitch !== undefined) cam.pitch = o.pitch;
      if (o.yaw !== undefined) cam.yaw = o.yaw;
      if (o.roll !== undefined) cam.roll = o.roll;
      if (o.fov !== undefined) cam.fov = o.fov;
      applyCamera();
    },
  };

  console.log(
    `[char3d] 选角背景就位：Logo05.bmd ${built.bmd.meshes.length} 块 mesh` +
      `｜相机 pos=(${camera.position.toArray().map(v => v.toFixed(2)).join(', ')})` +
      ` pitch=${cam.pitch} roll=${cam.roll} fov=${cam.fov}`
  );
  return handle;
}
