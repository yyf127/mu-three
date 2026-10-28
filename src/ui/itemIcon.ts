/**
 * 背包格里的物品缩略图。
 *
 * 原版 `RenderItems3D`（IDA 0x004E38B0）是在**同一个 GL 上下文里**逐格调用
 * `RenderItem3D` 把 BMD 直接画进格子（框大小 = ItemAttribute.Width/Height × 20）。
 * 所以格子里其实是有透视的实时模型，不是贴图。
 *
 * H5 里没必要每帧重画 64 个模型，改成**离线渲一次、缓存成 dataURL**。
 *
 * 注意不能另开一个 WebGLRenderer：BMD 材质是全局缓存的 `MeshBasicMaterial`，
 * 换上下文后贴图不会跟着上传，渲出来是一堆纯白轮廓（实测踩过）。
 * 所以这里借主渲染器的离屏 RenderTarget，画完 readPixels 出来，
 * 材质/贴图/色彩空间全部沿用场景那一套。
 */
import * as THREE from 'three';
import { loadProto } from '../world/items';
import { itemAttr } from '../data/itemAttrs';

/** 每格 20px，缩略图按 3 倍超采样，缩小后边缘更干净 */
const SS = 3;
const CELL = 20;

let renderer: THREE.WebGLRenderer | null = null;

/** 主渲染器就绪后挂上来（main.ts 建完 renderer 立刻调） */
export function attachIconRenderer(r: THREE.WebGLRenderer) {
  renderer = r;
}

const iconCache = new Map<number, string>();
const pending = new Map<number, Promise<string | null>>();
/**
 * 悬停旋转帧缓存：`type*16+等级档` → 一圈的 dataURL。
 *
 * 原版是每帧现算角度（见 `SPIN_DEG_PER_MS`），网页端没必要每帧重渲一个 GL
 * 场景，改成**预渲染一圈**、悬停时按时间索引换图。
 */
const spinCache = new Map<number, string[]>();
const spinPending = new Map<number, Promise<string[]>>();

/**
 * 一圈切几帧。
 *
 * 帧率 = 转速 / 每帧角度：
 *   225°/秒 ÷ 36 帧（10°/帧）= **22.5fps**，眼睛连着看基本顺滑；
 *   用 24 帧就只有 15fps，减半之后会明显发顿 —— 所以帧数跟着一起加上来。
 * 帧数越多内存越大（一圈 36 张 dataURL），36 是折中。
 */
export const SPIN_FRAMES = 36;

/**
 * 悬停旋转速度（度/**毫秒**）。
 *
 * 原版（`Render/BMD_LegacyDraw.cpp:1806`，`RenderObjectScreen`）是：
 *
 * ```c
 * if (Select == 1)                          // Select = 鼠标压在这件物品的格子上
 *     angle[1] = (float)DAT_05826e08 * 0.45f;
 * ```
 *
 * `DAT_05826e08` 是 `WorldTime`，单位毫秒（`Game/Timer.cpp`），所以原版是
 * 0.45°/ms = **450°/秒**（0.8 秒一圈）—— 这就是「鼠标放上去会转」的来源，
 * 而且是**整段 yaw 被替换**掉，不叠加在角度表上。
 *
 * 实测网页端按 450°/秒 转得太急（背包格子只有 20px，转快了看着像在闪），
 * 用户要求降一半 → **0.225°/ms = 225°/秒**（1.6 秒一圈）。
 */
export const SPIN_DEG_PER_MS = 0.225;

/** 复用的离屏场景与相机（正交，从 +Z 看） */
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
camera.position.z = 5;

/** 画布：把 readPixels 的结果翻正后交给 toDataURL */
const canvas = document.createElement('canvas');

/**
 * 渲染一件物品的格子图。返回 dataURL；模型缺失时返回 null（调用方画色块）。
 *
 * @param yawDeg `null` = 用原版角度表里的 yaw（静态图标）；
 *               给值 = **替换** yaw（对应原版 `Select == 1` 的悬停旋转）。
 */
export async function itemIcon(
  type: number,
  itemLevel = 0,
  yawDeg: number | null = null
): Promise<string | null> {
  /*
   * 缓存 key：
   *   - `type` / 等级档：`modelId 860`（翅膀那类）的角度按 `(Level >> 3) & 0xF` 分档
   *   - yaw 槽：0 = 静态图，1..360 = 悬停旋转帧
   */
  const band = ((itemLevel >> 3) & 0x0f) % 16;
  const yawSlot = yawDeg === null ? 0 : 1 + (((Math.round(yawDeg) % 360) + 360) % 360);
  const key = (type * 16 + band) * 401 + yawSlot;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const running = pending.get(key);
  if (running) return running;

  const task = (async () => {
    if (!renderer) return null;

    const attr = itemAttr(type);
    const cw = Math.max(1, attr.w) * CELL * SS;
    const ch = Math.max(1, attr.h) * CELL * SS;

    const proto = await loadProto(type);
    /*
     * 没有模型的物品给一张**占位图**，不要留空。
     * 0.97 里有极少数物品确实没有模型（例如 type 435「大天使之武器」，
     * 模型槽 835 原版就没加载），原版画出来是一个空格子 ——
     * 但玩家看到空格子会以为背包坏了 / 那件东西不存在。
     */
    if (!proto) return placeholder(cw, ch);

    const group = new THREE.Group();

    for (const part of proto.parts) {
      // 几何是共享的，这里只借用来画，不动它
      group.add(new THREE.Mesh(part.geometry, part.material));
    }

    // 摆正：**照抄原版角度表**（见 anglesFor 的注释）。
    // 悬停时 yaw 被替换成传入值（原版 `if (Select == 1) angle[1] = WorldTime*0.45`）。
    const [ax, ay, az] = anglesFor(type + 400, Math.floor((itemLevel >> 3) & 0x0f));
    group.quaternion.copy(muEulerToThreeQuat(ax, yawDeg === null ? ay : yawDeg, az));

    // 让包围盒中心落在原点，正交相机再按旋转后的实际尺寸取景
    group.updateMatrixWorld(true);
    const world = new THREE.Box3().setFromObject(group);
    const center = world.getCenter(new THREE.Vector3());
    group.position.set(-center.x, -center.y, -center.z);

    group.updateMatrixWorld(true);
    const fit = new THREE.Box3().setFromObject(group);
    const size = fit.getSize(new THREE.Vector3());
    const bw = Math.max(size.x, 1e-3);
    const bh = Math.max(size.y, 1e-3);
    const aspect = cw / ch;
    const viewW = Math.max(bw, bh * aspect) * 1.16;
    const viewH = viewW / aspect;
    camera.left = -viewW / 2;
    camera.right = viewW / 2;
    camera.top = viewH / 2;
    camera.bottom = -viewH / 2;
    camera.updateProjectionMatrix();

    scene.add(group);

    const rt = new THREE.WebGLRenderTarget(cw, ch, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
    });
    // 必须是 sRGB：主渲染器 outputColorSpace = SRGB，往 linear 的 target 写
    // 会丢掉那一步编码，读回来整体发白。
    rt.texture.colorSpace = THREE.SRGBColorSpace;

    const prevTarget = renderer.getRenderTarget();
    const prevClearAlpha = renderer.getClearAlpha();
    const prevClearColor = new THREE.Color();
    renderer.getClearColor(prevClearColor);

    let url: string | null = null;
    try {
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);

      const buf = new Uint8Array(cw * ch * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, cw, ch, buf);

      // WebGL 的原点在左下，ImageData 在左上，逐行翻过来
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const img = ctx.createImageData(cw, ch);
      const rowBytes = cw * 4;
      for (let y = 0; y < ch; y++) {
        const src = (ch - 1 - y) * rowBytes;
        img.data.set(buf.subarray(src, src + rowBytes), y * rowBytes);
      }
      ctx.putImageData(img, 0, 0);
      url = canvas.toDataURL('image/png');
    } finally {
      scene.clear();
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(prevClearColor, prevClearAlpha);
      rt.dispose();
    }

    if (url) iconCache.set(key, url);
    // 调试变体不写缓存（同一 type 用不同参数渲染时要能重来）
    if (iconDebug.order !== 'ZYX' || iconDebug.yUp || iconDebug.noConj) iconCache.delete(key);
    return url;
  })();

  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}

/**
 * 模型缺失时的占位图：暗金方块 + 深色描边，尺寸和格子一致。
 *
 * 和 `world/items.ts` 里地面兜底用的金色小方块是同一套观感，
 * 一眼就能看出「这件东西是有的，只是没有模型」，而不是空格子。
 */
function placeholder(cw: number, ch: number): string {
  const hit = iconCache.get(-1 * (cw * 1000 + ch));
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const ctx = cv.getContext('2d');
  if (!ctx) return '';
  const pad = Math.min(cw, ch) * 0.24;
  ctx.fillStyle = 'rgba(70, 54, 22, 0.85)';
  ctx.fillRect(pad, pad, cw - pad * 2, ch - pad * 2);
  ctx.strokeStyle = 'rgba(226, 186, 92, 0.95)';
  ctx.lineWidth = Math.max(1, Math.round(SS * 0.8));
  ctx.strokeRect(pad, pad, cw - pad * 2, ch - pad * 2);
  // 中间一个小菱形，暗示"物品"
  const cx = cw / 2;
  const cy = ch / 2;
  const r = Math.min(cw, ch) * 0.16;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 214, 128, 0.95)';
  ctx.fill();
  const url = cv.toDataURL('image/png');
  iconCache.set(-1 * (cw * 1000 + ch), url);
  return url;
}

/** 清空缓存（换角色 / 重登） */
export function clearItemIcons() {
  iconCache.clear();
  spinCache.clear();
}

/**
 * 取一件物品**悬停旋转**的一圈帧（`SPIN_FRAMES` 张，等角度）。
 *
 * 对应原版 `RenderObjectScreen` 的 `Select == 1` 分支：鼠标压在物品格上时
 * yaw 由 `WorldTime * 0.45` 直接驱动。我们预渲染一圈，播放时按时间索引，
 * 不每帧开 GL。
 *
 * 没有模型的物品（`placeholder`）返回空数组 —— 占位色块转起来只会更怪。
 */
export function itemSpinFrames(type: number, itemLevel = 0): Promise<string[]> {
  const band = ((itemLevel >> 3) & 0x0f) % 16;
  const key = type * 16 + band;
  const hit = spinCache.get(key);
  if (hit) return Promise.resolve(hit);
  const running = spinPending.get(key);
  if (running) return running;

  const task = (async () => {
    // 没有模型的物品（`placeholder`）不转 —— 占位色块转起来只会更怪
    if (!(await loadProto(type))) return [];
    const frames: string[] = [];
    for (let i = 0; i < SPIN_FRAMES; i++) {
      const url = await itemIcon(type, itemLevel, (360 * i) / SPIN_FRAMES);
      if (!url) break;
      frames.push(url);
    }
    // 只有真的一圈都渲出来了才进缓存，否则下次重试
    if (frames.length === SPIN_FRAMES) {
      spinCache.set(key, frames);
      // 一圈十几张 dataURL 不小，缓存超过 12 种物品就把最早的踢掉
      while (spinCache.size > 12) {
        const first = spinCache.keys().next().value;
        if (first === undefined || first === key) break;
        spinCache.delete(first);
      }
    }
    return frames;
  })();

  spinPending.set(key, task);
  void task.finally(() => spinPending.delete(key));
  return task;
}

/**
 * 原版每个模型号的固定欧拉角（`RenderObjectScreen` @0x004E13A0，
 * `Render/BMD_LegacyDraw.cpp:1750`）。
 *
 * **参数是 modelId，不是 item type** —— `RenderItem3D` 里先算
 * `modelId = Type + 400`（459/457/469/435 有覆盖），再传给
 * `RenderObjectScreen`。所以判断条件里的 `400..591` 对应的是物品 type 0..191。
 *
 * ```c
 * if      (Type == 535 || Type == 543)          (0,   270, 15)
 * else if (Type == 545)                         (0,   90,  15)
 * else if (Type >= 536 && Type < 560)           (90,  180, 20)
 * else if (Type == 506)                         (180, 270, 20)
 * else if (Type >= 400 && Type < 592)           (180, 270, 15)   // 普通装备
 * else if (Type >= 592 && Type < 624)           (270, 270, 0)
 * else if (Type == 819)                         (-90, -20, 0)
 * else if (Type == 832 || Type == 833)          (270, -10, 0)
 * else if (Type == 834)                         (290, 0,   0)
 * else if (Type == 958)                         (-90, -20, -20)
 * else if (Type >= 828 && Type < 848 && !830 && !831)  (360, 0, 0)
 * else if (Type == 860)                         按 (Level>>3) 分 180/270/90
 * else if (Type == 952 || Type == 954)          (270, 0,   0)
 * else if (Type == 953)                         (270, 90,  0)
 * else if (Type == 868)                         (270, 0,   0)
 * else                                          (270, -10, 0)
 * ```
 *
 * 注意默认分支是 `(270, -10, 0)`，**不是** 400..591 那个 `(180, 270, 15)` ——
 * 药水、宝石、卷轴那些 type >= 192 的都走默认。
 */
function anglesFor(modelId: number, level: number): [number, number, number] {
  if (modelId === 535 || modelId === 543) return [0, 270, 15];
  if (modelId === 545) return [0, 90, 15];
  if (modelId >= 536 && modelId < 560) return [90, 180, 20];
  if (modelId === 506) return [180, 270, 20];
  if (modelId >= 400 && modelId < 592) return [180, 270, 15];
  if (modelId >= 592 && modelId < 624) return [270, 270, 0];
  if (modelId === 819) return [-90, -20, 0];
  if (modelId === 832 || modelId === 833) return [270, -10, 0];
  if (modelId === 834) return [290, 0, 0];
  if (modelId === 958) return [-90, -20, -20];
  if (modelId >= 828 && modelId < 848 && modelId !== 830 && modelId !== 831) return [360, 0, 0];
  if (modelId === 860) {
    if (level === 0) return [180, 0, 0];
    if (level === 1) return [270, 90, 0];
    return [90, 0, 0];
  }
  if (modelId === 952 || modelId === 954) return [270, 0, 0];
  if (modelId === 953) return [270, 90, 0];
  if (modelId === 868) return [270, 0, 0];
  return [270, -10, 0];
}

const DEG = Math.PI / 180;

/**
 * 朝向算法的**调试开关**。
 *
 * 原版角度表的语义只能靠实测确认（`EulerToQuat` 展开出来到底是 three 的哪个
 * EulerOrder、要不要补 Z-up → Y-up 的基变换），所以留一组开关给
 * `tools/icon-orient-probe.mjs` 扫参数用。默认值就是最终采用的那组。
 */
export const iconDebug = {
  /**
   * **ZYX**。原版 `EulerToQuat` 展开出来就是这个顺序：
   *
   * ```c
   * q[0] = sz*cy*cx - cz*sy*sx   // x
   * q[1] = cz*sy*cx + sz*cy*sx   // y
   * q[2] = cz*cy*sx - sz*sy*cx   // z
   * q[3] = cz*cy*cx + sz*sy*sx   // w
   * ```
   *
   * 和 three.js `Euler(x, y, z, 'ZYX')` 逐项一致。
   */
  order: 'ZYX' as THREE.EulerOrder,
  /**
   * **false** —— 不要补「Z-up → Y-up」的基变换。
   *
   * 这条是实测出来的，和直觉相反：BMD 顶点是按 MU 坐标原样解析的
   * （`core/bmd.ts` 没换分量），所以模型本来就在 MU 空间里；直接把原版欧拉角
   * 套上去、相机从 three 的 +Z 看，就等于「MU 空间里从 +Y 方向看」——
   * 这正是原版 `RenderItem3D` 做 UI 图标时相机的位置（`Camera_BuildMouseRay`
   * 把模型放到相机正前方 0.1 处）。再加 `rotateX(-90°)` 等于多转 90°，
   * 剑就横过来了。
   */
  yUp: false,
  /** 直接乘（不做共轭），对照用 */
  noConj: false,
};

/**
 * MU 的欧拉角 → three.js 四元数。
 *
 * 原版 `EulerToQuat`（`Render_LegacyTransforms.cpp:91`）展开后就是
 * **XYZ 顺序**（`q = qx * qy * qz`），而且四元数存成 `(x, y, z, w)`：
 *
 * ```c
 * q[0] = sx*cy*cz - cx*sy*sz      // x
 * q[1] = sx*cy*sz + cx*sy*cz      // y
 * q[2] = cx*cy*sz - sx*sy*cz      // z
 * q[3] = cx*cy*cz + sx*sy*sz      // w
 * ```
 *
 * 和 three.js `Euler(ax, ay, az, 'XYZ')` 完全一致，所以直接构造即可。
 *
 * 唯一要补的是**上方向**：MU 是 Z-up（Z 朝上），three 是 Y-up。BMD 顶点是按
 * MU 坐标解析的（`core/bmd.ts` 一个分量都没换），所以这里再套一个
 * `rotateX(-90°)` 把 Z-up 扳成 Y-up，相机从 +Z 看过去就是「正面」。
 */
function muEulerToThreeQuat(ax: number, ay: number, az: number): THREE.Quaternion {
  const { order, yUp, noConj } = iconDebug;
  const qMu = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(ax * DEG, ay * DEG, az * DEG, order)
  );
  if (!yUp) return qMu;
  // Z-up → Y-up：绕 X 轴 -90°（默认不用，见 iconDebug.yUp 的说明）
  const c = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  return noConj ? c.clone().multiply(qMu) : c.clone().multiply(qMu).multiply(c.clone().invert());
}
