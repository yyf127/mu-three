/**
 * 战盟标志（`CreateGuildMark` + `RenderGuildMarkOnShield`）。
 *
 * 服务端下发的 `Mark` 是 32 字节 = 8×8 格、每格 4bit（`packGuildMark` 的逆向）。
 * 原版的做法很不「贴图」：它用 16 色调色板把 64 格**逐像素写进一张 8×8 的
 * RGBA 纹理**，再把这张纹理画到角色盾牌骨骼上的一个小 quad 上
 * （`RenderGuildMarkOnShield`，`Entity_UpdateRender.cpp:59`）。
 *
 * 调色板见 `net/game.ts::GUILD_MARK_COLORS`（`GuildMark_InitializePalette`），
 * 0 号是**透明**（编辑器里的橡皮），所以标志背景是镂空的。
 *
 * 挂点：原版用骨骼 26，局部位移 `(20, -5, -10)`（有盾 676 时 z 换 -18），
 * quad 尺寸 `5 × 7`。骨骼 26 在 `player.bmd` 里是 `Bip01 R UpperArm` ——
 * 这个 0.97 客户端就是把它画在右臂外侧（不是严格贴在盾面上），我们照抄，
 * 位置偏差用 `GUILD_MARK_POSE` 微调即可。
 */
import * as THREE from 'three';
import { GUILD_MARK_COLORS, unpackGuildMark } from '../net/game';

/** 一格 = 1/8 张脸，像素风要关掉平滑 */
const MARK_SIZE = 8;

/** 挂点与尺寸（米）。原版是 5×7 游戏单位 = 0.05×0.07，太小，这里放大到能看清 */
export const GUILD_MARK_POSE = {
  /** `player.bmd` 的骨骼序号；`Bip01 R UpperArm` */
  bone: 26,
  /** 相对骨骼的局部位移（米） */
  offset: [0.02, -0.005, -0.01] as [number, number, number],
  /**
   * billboard 尺寸（米）。原版是 5×7 游戏单位 = 0.05×0.07，实际画出来只有
   * 几个像素（角色身高 2.25 m），所以放大到 0.2×0.26 才能看清图案。
   */
  width: 0.2,
  height: 0.26,
};

/** `#rrggbb` / `transparent` → 0..255 的 RGBA */
function parseColor(css: string, alpha = 255): [number, number, number, number] {
  if (!css || css === 'transparent') return [0, 0, 0, 0];
  const hex = css.replace('#', '');
  const n = Number.parseInt(hex, 16);
  if (!Number.isFinite(n)) return [0, 0, 0, alpha];
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, alpha];
}

const PALETTE = GUILD_MARK_COLORS.map(c => parseColor(c));

/**
 * 32 字节标志 → 8×8 的 `DataTexture`。
 *
 * 行序手动翻过来：`DataTexture` 在 three 里默认 `flipY = false`，
 * 而标志数据是**从上往下**第 0 行开始存的，不翻的话图是倒的。
 */
export function guildMarkTexture(mark: Uint8Array): THREE.DataTexture {
  const cells = unpackGuildMark(mark);
  const data = new Uint8Array(MARK_SIZE * MARK_SIZE * 4);
  for (let row = 0; row < MARK_SIZE; row++) {
    const src = row * MARK_SIZE;
    const dst = (MARK_SIZE - 1 - row) * MARK_SIZE;
    for (let x = 0; x < MARK_SIZE; x++) {
      const [r, g, b, a] = PALETTE[cells[src + x] ?? 0] ?? [0, 0, 0, 0];
      const o = (dst + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(data, MARK_SIZE, MARK_SIZE, THREE.RGBAFormat);
  // 像素风：最近邻放大，不然 8×8 糊成一团
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 做一块带标志的 billboard。`null` 表示这个标志是全透明的（没有任何着色格），
 * 调用方直接当「没有标志」处理。
 *
 * 用 `Sprite` 而不是 `Mesh`：原版 `RenderGuildMarkOnShield` 最后一步是
 * `GL_DrawBillboard(5, 7, matrix)` —— **永远正对镜头**。用固定朝向的 quad
 * 会跟着手臂转，侧身时整块消失（试过，贴着右臂的是个「片」，看起来像贴纸脱落）。
 */
export function guildMarkMesh(mark: Uint8Array): THREE.Sprite | null {
  let painted = false;
  const cells = unpackGuildMark(mark);
  for (const c of cells) {
    if (c) {
      painted = true;
      break;
    }
  }
  if (!painted) return null;

  const tex = guildMarkTexture(mark);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    // 原版开了 alpha test：0 号色整格镂空，不开的话边缘会有一圈黑
    alphaTest: 0.5,
    depthWrite: false,
    fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.name = 'guild-mark';
  sprite.scale.set(GUILD_MARK_POSE.width, GUILD_MARK_POSE.height, 1);
  // 别让名字标签/血条把它盖住
  sprite.renderOrder = 2;
  return sprite;
}

/** 释放纹理（同一个标志反复换时要调，否则纹理泄漏）。`Sprite` 不带几何体 */
export function disposeGuildMark(sprite: THREE.Sprite) {
  sprite.removeFromParent();
  const mat = sprite.material;
  mat.map?.dispose();
  mat.dispose();
}
