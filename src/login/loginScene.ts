/**
 * 登录界面 3D 背景 —— 复刻 `Scene_Login` 的 3D 部分。
 *
 * 原版登录画面不是一张贴图，而是一个真 3D 场景（`Game_SceneUpdate.cpp`
 * 的 `MoveLogInScene`，IDA @ 0x0051F900）：夕阳天空 + 海面 + 三条船 + 船的尾迹
 * + 立体 MU 字标 + 太阳，然后 `Scene_Login` 里依次
 * `Terrain_Render → Entity_RenderAll_3D → RenderBugs → Trail_RenderAll`
 * 画在 `GL_BeginViewport(0, 0x50, 0x280, 0x140)` 这个 **640×320 的横条**里
 * （y=80..400，所以上下留给黑边，登录面板正压在横条中间）。
 *
 * 物件与位姿全部照抄源码（坐标是 MU 单位，÷100 换成 three 单位）：
 *
 *   type 60  Object1/ship.smd   ×3   scale 0.8    rot_z 180
 *   type 160 Logo/Logo01.bmd    ×1   scale 0.0438  天空盒（4 张 sky*.jpg）
 *   type 161 Logo/Logo02.bmd    ×3   scale 0.8     船尾的水花 wave.jpg
 *   type 162 Logo/Logo03.bmd    ×1   scale 0.6     立体 MU 字标 logo.jpg
 *   type 163 Logo/Logo04.bmd    ×1   scale 3.0     太阳 sky4.jpg
 *
 * 相机：`MoveCamera` 的登录路径走 `CameraWalk[1..4]`，位置都是
 * (0, -1100, 500)，FOV 45°（`CameraFOV = 45.0f`），俯角 -80°。
 * 0.97 的相机朝向是「+Y 方向、往下压 10°」（-80° 是相对竖直方向量的），
 * 所以这里用 `lookAt` 表达，别直接套 three 的欧拉角。
 */

import * as THREE from 'three';
import { type Bmd, parseBmd } from '../core/bmd';
import { MODEL_SCALE, createStaticMeshes, getBoneMatrices, createRig } from '../core/model';
import { modelBlend } from '../core/blendHeuristic';
import { fetchBytes, loadTexture } from '../core/texture';

const LOGO_DIR = 'Data/Logo/';
const OBJECT_DIR = 'Data/Object1/';

/** 3D 只占舞台的一条横带（原版 `GL_BeginViewport` 是 640×320@y=80，
 *  但实机截图量出来是「整宽、上边 6%、下边 80px」，见 docs/LOGIN_SCREEN.md） */
export const LOGIN_VIEW_TOP = 28;
export const LOGIN_VIEW_HEIGHT = 372;

/**
 * MU 单位 → three 单位。
 *
 * 地形/物件那边是 1 格 = 100（`MODEL_SCALE` 和 `record.x/100` 配套），但登录场景
 * 按 1 格 = 100 摆出来，船会怼到镜头上（实测比原版大将近一倍）。拿实机截图
 * 反推的系数是 50，即这条船上「位置」按 ÷50、模型顶点还是 ÷100 走。
 */
const U = 0.012;

/** 相机（源码 `CameraWalk` wp1 + `CameraFOV`） */
const CAM_POS = new THREE.Vector3(0, -1100 * U, 500 * U);
/** -80° 相对竖直方向 → 水平往下 8°（按实机截图的水平线高度反推） */
const CAM_TILT_DOWN = THREE.MathUtils.degToRad(8);
const CAM_FOV = 45;

/**
 * 天空盒（Logo01）的额外缩放：源码表里是 0.0438，但按那个数摆，海面只有几十个单位、
 * 海平线会掉到画面 70% 的位置。实机截图反推需要 ~15 倍（= 海面 700 单位），
 * 海平线才落回 35% 左右。等 3D 构图整体重做时再回来收。
 */
const SKY_SCALE = 15;

interface Piece {
  dir: string;
  file: string;
  /** MU 单位 */
  pos: [number, number, number];
  rotZ: number;
  scale: number;
  /** 天空盒整层不吃顶点光照（不然夕阳会被压暗）；水花走加色 */
  kind: 'sky' | 'ship' | 'wave' | 'banner' | 'sun';
}

const SHIP_SPOTS: [number, number, number][] = [
  [-700, 700, 0],
  [400, 400, 0],
  [-200, -400, 0],
];

const PIECES: Piece[] = [
  { dir: LOGO_DIR, file: 'Logo01', pos: [0, -520, 0], rotZ: 0, scale: 0.0438, kind: 'sky' },
  { dir: LOGO_DIR, file: 'Logo03', pos: [0, -600, 480], rotZ: 0, scale: 0.6, kind: 'banner' },
  { dir: LOGO_DIR, file: 'Logo04', pos: [-110, 1600, 50], rotZ: 0, scale: 3, kind: 'sun' },
  ...SHIP_SPOTS.flatMap<Piece>((pos): Piece[] => [
    { dir: OBJECT_DIR, file: 'Ship01', pos, rotZ: 180, scale: 0.8, kind: 'ship' },
    { dir: LOGO_DIR, file: 'Logo02', pos, rotZ: 180, scale: 0.8, kind: 'wave' },
  ]),
];

async function loadBmd(dir: string, file: string): Promise<Bmd | null> {
  for (const name of [`${dir}${file}.bmd`, `${dir}${file}.BMD`]) {
    try {
      return parseBmd(await fetchBytes(name));
    } catch {
      /* 换下一个大小写 */
    }
  }
  console.warn(`[login3d] 读不到 ${dir}${file}.bmd`);
  return null;
}

/** 一个 BMD 整只烘成静态几何（材质按 mesh 分，船有 10 张图） */
async function buildPiece(piece: Piece): Promise<THREE.Group | null> {
  const bmd = await loadBmd(piece.dir, piece.file);
  if (!bmd) return null;

  const rig = createRig(bmd, MODEL_SCALE);
  const boneMatrices = getBoneMatrices(rig);

  const group = new THREE.Group();
  group.name = `login:${piece.file}`;
  for (const mesh of bmd.meshes) {
    const tex = await loadTexture(piece.dir, mesh.texturePath);
    const mb = modelBlend(tex?.texture ?? null, tex?.tag === 'blend', mesh.texturePath);
    /*
     * 字标是两张图叠出来的（和原版一致）：
     *   `logo.jpg`  —— 铬字本体，**黑底不透明**。实机截图里字标左右两侧的帆布/
     *                  天空是在一条竖边上突然截断的，说明那块底板确实画了，
     *                  只是黑得跟夜空差不多，看不出「黑方板」。
     *   `logo2.jpg` —— 橙色光晕，走加色叠在字上（所以字边缘发暖）。
     * 光晕要后画、不写深度（同深度用 LEQUAL 才能盖住字），但**保留深度测试**，
     * 否则会糊到挡在前面的船帆上。
     */
    const isGlow = /logo2/i.test(mesh.texturePath);
    const additive =
      piece.kind === 'wave' || piece.kind === 'sun' || (piece.kind === 'banner' && isGlow) || mb.additive;
    const one = { ...bmd, meshes: [mesh] };
    const s = createStaticMeshes(
      one,
      boneMatrices,
      tex?.texture ?? null,
      mb.cutout && !additive,
      undefined,
      additive,
      mb.soft
    );
    const mat = s.material as THREE.MeshBasicMaterial;
    if (piece.kind === 'sky' || piece.kind === 'banner') {
      /*
       * 天空盒和字标是「原画自带光照」的：再乘一遍顶点光照会整体压暗，
       * 夕阳那个橙色高光会变成脏褐色。直接铺原图。
       */
      mat.vertexColors = false;
      mat.toneMapped = false;
    }
    if (isGlow) {
      mat.depthWrite = false;
      mat.opacity = 1;
    }
    for (const geo of s.geometries) {
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      if (isGlow) m.renderOrder = 1;
      group.add(m);
    }
  }

  group.position.set(piece.pos[0] * U, piece.pos[1] * U, piece.pos[2] * U);
  group.rotation.z = THREE.MathUtils.degToRad(piece.rotZ);
  group.scale.setScalar(piece.scale);
  return group;
}

export interface LoginSceneHandle {
  /** 贴图/模型都就位了没有 */
  readonly ready: boolean;
  /** 每帧调用（自己内部判登录界面是否可见） */
  tick(dt: number): void;
  resize(): void;
  dispose(): void;
  /** 调试用：物件数量、相机位置 */
  stats(): { pieces: number; camera: number[]; fov: number };
  /** 调试用：临时改相机（调构图用，不落盘） */
  setCamera(o: { x?: number; y?: number; z?: number; tilt?: number; fov?: number }): void;
  /** 调试用：临时改天空盒缩放 */
  setSkyScale(k: number): void;
}

/**
 * 在 `host` 里建一块 canvas 并渲染登录 3D。
 * 失败（模型全读不到）返回 null，调用方保持原来的 2D 天空背景。
 */
export async function createLoginScene(host: HTMLElement): Promise<LoginSceneHandle | null> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' });
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM_FOV, 2, 0.2, 900);
  camera.up.set(0, 0, 1);

  const groups = await Promise.all(PIECES.map(buildPiece));
  const loaded = groups.filter((g): g is THREE.Group => !!g);
  for (const g of loaded) scene.add(g);

  if (!loaded.length) {
    renderer.dispose();
    canvas.remove();
    return null;
  }

  /*
   * 相机：站在 (0,-11,5)，朝 +Y 看、往下 10°。
   * 再叠一点点海浪似的晃动（原版登录相机也是慢慢漂的），幅度小到不影响取景。
   */
  const camPos = CAM_POS.clone();
  const lookAt = new THREE.Vector3();
  const camBase = { x: CAM_POS.x, y: CAM_POS.y, z: CAM_POS.z, tilt: CAM_TILT_DOWN, fov: CAM_FOV };
  let time = 0;

  const resize = () => {
    const w = host.clientWidth || 640;
    const h = host.clientHeight || 320;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  resize();

  const place = () => {
    camPos.x = camBase.x + Math.sin(time * 0.23) * 0.12;
    camPos.y = camBase.y;
    camPos.z = camBase.z + Math.sin(time * 0.37) * 0.05;
    camera.position.copy(camPos);
    lookAt.set(
      camPos.x,
      camPos.y + Math.cos(camBase.tilt) * 10,
      camPos.z - Math.sin(camBase.tilt) * 10
    );
    camera.lookAt(lookAt);
  };
  place();

  let skyScale = SKY_SCALE;
  const applySkyScale = () => {
    for (const g of loaded) if (g.name === 'login:Logo01') g.scale.setScalar(0.0438 * skyScale);
  };
  applySkyScale();

  const handle: LoginSceneHandle = {
    ready: true,
    tick(dt: number) {
      const login = document.getElementById('login');
      if (!login || login.classList.contains('hidden')) return;
      time += dt;
      place();
      renderer.render(scene, camera);
    },
    resize,
    dispose() {
      renderer.dispose();
      canvas.remove();
      scene.clear();
    },
    stats: () => ({
      pieces: loaded.length,
      camera: camera.position.toArray().map(v => +v.toFixed(2)),
      fov: +camera.fov.toFixed(1),
    }),
    setCamera(o) {
      if (o.x !== undefined) camBase.x = o.x;
      if (o.y !== undefined) camBase.y = o.y;
      if (o.z !== undefined) camBase.z = o.z;
      if (o.tilt !== undefined) camBase.tilt = THREE.MathUtils.degToRad(o.tilt);
      if (o.fov !== undefined) {
        camBase.fov = o.fov;
        camera.fov = o.fov;
        camera.updateProjectionMatrix();
      }
      place();
    },
    setSkyScale(k) {
      skyScale = k;
      applySkyScale();
    },
  };

  console.log(
    `[login3d] 登录 3D 就位：${loaded.length}/${PIECES.length} 个物件，` +
      `视口 640×${LOGIN_VIEW_HEIGHT}@y=${LOGIN_VIEW_TOP}，FOV ${CAM_FOV}`
  );
  return handle;
}
