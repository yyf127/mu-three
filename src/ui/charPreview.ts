/**
 * 新建角色面板里的**职业头像**。
 *
 * 面板上那块 74×79 的框（`GL_BeginViewport(0x11d, y+0x5a, 0x4a, 0x4f)`）画的是
 * `Data/Logo/Face01..04.bmd` —— 四个职业的**半身像**，不是玩家模型：
 *
 *   Face01 = 마법사（魔法师，贴图 magic_01..03） → 职业 0
 *   Face02 = warrior（剑士）                    → 职业 1
 *   Face03 = fairy（弓箭手）                    → 职业 2
 *   Face04 = 마검사_얼굴（魔剑士）                → 职业 3
 *
 * 每只都有 20~51 帧的待机动作，这里只烘第 0 帧。
 * 渲一次缓存成 dataURL —— 和 `itemIcon.ts` 一套做法：借主渲染器的 RenderTarget，
 * 不另开 WebGL 上下文（BMD 材质是全局缓存的，换上下文贴图会全白）。
 */

import * as THREE from 'three';
import { buildBmdGroup } from '../core/bmdProp';

/** 面板里那块预览框的尺寸（源码 0x4a × 0x4f） */
const W = 74;
const H = 79;
/** 超采样倍数，缩小后边缘更干净 */
const SS = 3;

const FACE_DIR = '/Data/Logo/';

let renderer: THREE.WebGLRenderer | null = null;

/** 主渲染器就绪后挂上来（main.ts 建完 renderer 立刻调） */
export function attachCharPreviewRenderer(r: THREE.WebGLRenderer) {
  renderer = r;
}

const cache = new Map<number, string>();
const pending = new Map<number, Promise<string | null>>();

const canvas = document.createElement('canvas');

export async function charPreview(cls: number): Promise<string | null> {
  const hit = cache.get(cls);
  if (hit) return hit;
  const running = pending.get(cls);
  if (running) return running;

  const task = (async () => {
    if (!renderer) return null;

    const cw = W * SS;
    const ch = H * SS;
    const scene = new THREE.Scene();

    // 职业 0..3 → Face01..04.bmd
    const built = await buildBmdGroup(FACE_DIR, `Face0${(cls & 3) + 1}`);
    if (!built) {
      console.warn(`[charPreview] 职业 ${cls} 的头像模型读不到`);
      return null;
    }
    /*
     * 半身像的朝向是「脸朝 -X」，而相机在 -Y 那一侧 → 正面看过去是侧脸。
     * 绕 Z 转 +90° 把脸转给相机（四个职业同一套模型约定）。
     */
    built.group.rotation.z = Math.PI / 2;
    scene.add(built.group);
    scene.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(built.group);
    if (box.isEmpty()) {
      console.warn(`[charPreview] 职业 ${cls} 没有网格`);
      return null;
    }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const fovV = 26;
    const camera = new THREE.PerspectiveCamera(fovV, W / H, 0.02, 60);
    /*
     * 取景要同时满足「高度塞得下」和「宽度塞得下」（框是 74×79，竖比横窄），
     * 取两者较大的距离，再留 6% 边距。只按高度算的话头像会缩成小小一个。
     */
    const tanV = Math.tan((fovV * Math.PI) / 360);
    const tanH = tanV * (W / H);
    const dist =
      Math.max(size.z / 2 / tanV, Math.max(size.x, size.y) / 2 / tanH) * 1.1;
    const yaw = THREE.MathUtils.degToRad(8);
    /*
     * 视线稍微抬到「脸」的高度（而不是包围盒正中 = 胸口）：
     * 这块框是半身像，正对着胸口看会把头发顶到框外。
     */
    const lookZ = center.z + size.z * 0.2;
    camera.position.set(
      center.x + Math.sin(yaw) * dist,
      center.y - Math.cos(yaw) * dist,
      lookZ
    );
    camera.up.set(0, 0, 1);
    camera.lookAt(center.x, center.y, lookZ);
    camera.updateProjectionMatrix();

    const rt = new THREE.WebGLRenderTarget(cw, ch, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
    });
    // 必须 sRGB：主渲染器 outputColorSpace = SRGB，往 linear 的 target 写会发白
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

      // WebGL 原点在左下，ImageData 在左上，逐行翻
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

    if (url) cache.set(cls, url);
    return url;
  })();

  pending.set(cls, task);
  try {
    return await task;
  } finally {
    pending.delete(cls);
  }
}
