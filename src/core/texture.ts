/**
 * 原版纹理加载：
 *   .OZJ = 头部（通常 24 字节）+ JPEG
 *   .OZT = 4  字节头 + TGA
 *   .bmp = 8bit 索引色（Sky.bmp 等）
 * 浏览器端直接解码，无需任何预转换。
 */
import * as THREE from 'three';
import { assetUrl } from './base';

/** OZJ 头部里塞了一个假的 JPEG 头，真数据从下一个 SOI 开始 */
const OZJ_HEADER_SCAN = 64;

/**
 * 找 OZJ 里真 JPEG 的起点。
 *
 * 原本写死 24 字节，绝大多数文件是对的，但个别文件头更长 ——
 * `Skill/Mmn2.ozj` 的真 JPEG 在偏移 26，按 24 切会得到一张
 * `18432x0` 的破图（浏览器解不出来，纹理直接失效）。
 *
 * 所以改成「跳过头部里那个假 SOI，找下一个 SOI」：
 *   - 带头的文件 → 找到假头之后那个，偏移正确
 *   - 纯 JPEG（头部里没有第二个 SOI）→ 返回 0，整块交给浏览器
 */
export function jpegOffset(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length - 2, OZJ_HEADER_SCAN);
  for (let i = 2; i < limit; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8) return i;
  }
  return 0;
}

/**
 * 把一段字节当 JPEG 交给浏览器解；失败返回 null（不抛）。
 */
async function decodeJpegBytes(bytes: Uint8Array): Promise<ImageBitmap | null> {
  try {
    const blob = new Blob([bytes.slice() as unknown as BlobPart], { type: 'image/jpeg' });
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/**
 * 解 MU 的 `.OZJ`（= 可能是 MU 头 + 若干张 JPEG 串在一起）。
 *
 * **这里踩过一个大坑**：`Data/Effect/` 下 48 张图里有 **30 张**浏览器直接解不出来。
 * 原因不是文件坏了，而是这些文件里**套着 Photoshop 缩略图**：
 *
 *   FFD8 FFE0 FFED(len=0x1916)   ← 外层 APP13，长度字段和实际不符
 *     FFD8 FFE0 FFED …           ← 里面第 1 张缩略图
 *     FFD8 FFE0 FFEE FFDB FFC0 … ← 主图从**这里**才开始
 *
 * Chrome 解整段会在 APP13 结束的位置撞上熵编码数据，直接 `InvalidStateError`。
 * 从**最后一个能解的 SOI 切片**就能正常解（实测 26/26 全部救回，
 * `Explotion01` → 112×112、`smoke01`/`Thunder01` → 64×64）。
 *
 * 在修这个之前，`loadTexture` 会退回 TGA 解码 → 从 JPEG 字节里读出一个
 * 巨大的垃圾尺寸 → 加色混合后整屏一片白（陨石撞击时最明显）。
 */
async function decodeOzj(bytes: Uint8Array): Promise<ImageBitmap | null> {
  const body = bytes.subarray(jpegOffset(bytes));
  const direct = await decodeJpegBytes(body);
  if (direct) return direct;

  const soi: number[] = [];
  for (let i = 0; i < body.length - 1; i++) {
    if (body[i] === 0xff && body[i + 1] === 0xd8) soi.push(i);
  }
  // 从后往前试：主图在最后，缩略图在前
  for (let k = soi.length - 1; k >= 0; k--) {
    const bmp = await decodeJpegBytes(body.subarray(soi[k]));
    if (bmp) return bmp;
  }
  return null;
}

export class HttpError extends Error {
  constructor(
    public url: string,
    public status: number
  ) {
    super(`HTTP ${status} ${url}`);
  }
}

const bufferCache = new Map<string, Promise<Uint8Array>>();

export async function fetchBytes(rawUrl: string): Promise<Uint8Array> {
  // 统一在这里拼 `base`：调用方写 `/Data/...` 或 `Data/...` 都行
  // （GH Pages 子路径部署时 base = /mu-three/）
  const url = assetUrl(rawUrl);
  let p = bufferCache.get(url);
  if (p) return p;

  p = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new HttpError(url, res.status);

    // Vite 对不存在的静态资源会回落到 index.html（200 + text/html），
    // 这里必须识别出来当作 404，否则会把 HTML 当成模型/贴图解析。
    const type = res.headers.get('content-type') || '';
    if (type.includes('text/html') && !url.endsWith('.html')) {
      throw new HttpError(url, 404);
    }

    return new Uint8Array(await res.arrayBuffer());
  })();

  bufferCache.set(url, p);
  return p;
}

export async function fetchBytesOptional(url: string) {
  try {
    return await fetchBytes(url);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* TGA 解码（未压缩 / RLE，8/24/32bit，含索引色）                        */
/* ------------------------------------------------------------------ */

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA，行 0 = 图像顶部 */
  data: Uint8ClampedArray;
}

export function decodeTga(buf: Uint8Array, offset: number): DecodedImage {
  const r = new DataView(buf.buffer, buf.byteOffset + offset, buf.byteLength - offset);
  let p = 0;
  const idLength = r.getUint8(p++);
  const colorMapType = r.getUint8(p++);
  const imageType = r.getUint8(p++);
  p += 5; // color map spec
  p += 4; // x/y origin
  const width = r.getUint16(p, true);
  p += 2;
  const height = r.getUint16(p, true);
  p += 2;
  const bpp = r.getUint8(p++);
  const descriptor = r.getUint8(p++);

  const bytesPerPixel = bpp / 8;
  const hasColorMap = colorMapType !== 0;

  let palette: Uint8Array | null = null;
  if (hasColorMap) {
    const cmapFirst = r.getUint16(p, true);
    p += 2;
    const cmapLength = r.getUint16(p, true);
    p += 2;
    const cmapEntrySize = r.getUint8(p++);
    const entryBytes = Math.ceil(cmapEntrySize / 8);
    palette = new Uint8Array((cmapFirst + cmapLength) * 4);

    for (let i = 0; i < cmapLength; i++) {
      const o = p + i * entryBytes;
      const dst = (cmapFirst + i) * 4;
      if (entryBytes >= 3) {
        palette[dst + 0] = buf[offset + o + 2];
        palette[dst + 1] = buf[offset + o + 1];
        palette[dst + 2] = buf[offset + o + 0];
        palette[dst + 3] = entryBytes === 4 ? buf[offset + o + 3] : 255;
      }
    }
    p += cmapLength * entryBytes;
  }

  p += idLength;

  const isRle = imageType === 9 || imageType === 10 || imageType === 11;
  const pixelCount = width * height;

  if (!Number.isFinite(pixelCount) || pixelCount * bytesPerPixel > 32 * 1024 * 1024) {
    throw new Error(
      `TGA 头部异常: ${width}x${height} bpp=${bpp} type=${imageType} len=${buf.length}`
    );
  }
  const raw = new Uint8Array(pixelCount * bytesPerPixel);

  if (isRle) {
    let out = 0;
    while (out < raw.length) {
      const header = r.getUint8(p++);
      const count = (header & 0x7f) + 1;
      if (header & 0x80) {
        const px = p;
        p += bytesPerPixel;
        for (let i = 0; i < count && out < raw.length; i++) {
          for (let b = 0; b < bytesPerPixel; b++) raw[out++] = buf[offset + px + b];
        }
      } else {
        for (let i = 0; i < count && out < raw.length; i++) {
          for (let b = 0; b < bytesPerPixel; b++) raw[out++] = buf[offset + p + b];
          p += bytesPerPixel;
        }
      }
    }
  } else {
    raw.set(buf.subarray(offset + p, offset + p + raw.length));
  }

  const data = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const s = i * bytesPerPixel;
    const d = i * 4;
    if (palette) {
      const idx = raw[s] * 4;
      data[d + 0] = palette[idx + 0];
      data[d + 1] = palette[idx + 1];
      data[d + 2] = palette[idx + 2];
      data[d + 3] = palette[idx + 3];
    } else if (bytesPerPixel === 4) {
      data[d + 0] = raw[s + 2];
      data[d + 1] = raw[s + 1];
      data[d + 2] = raw[s + 0];
      data[d + 3] = raw[s + 3];
    } else if (bytesPerPixel === 3) {
      data[d + 0] = raw[s + 2];
      data[d + 1] = raw[s + 1];
      data[d + 2] = raw[s + 0];
      data[d + 3] = 255;
    } else {
      data[d + 0] = raw[s];
      data[d + 1] = raw[s];
      data[d + 2] = raw[s];
      data[d + 3] = 255;
    }
  }

  // descriptor bit5：行顺序为自底向上
  const originBottom = (descriptor & 0x20) !== 0;
  if (originBottom) {
    const rowBytes = width * 4;
    const tmp = new Uint8ClampedArray(rowBytes);
    for (let y = 0; y < height >> 1; y++) {
      const a = y * rowBytes;
      const b = (height - 1 - y) * rowBytes;
      tmp.set(data.subarray(a, a + rowBytes));
      data.copyWithin(a, b, b + rowBytes);
      data.set(tmp, b);
    }
  }

  return { width, height, data };
}

/* ------------------------------------------------------------------ */
/* 8bit BMP 解码（Sky.bmp）                                            */
/* ------------------------------------------------------------------ */

function decodeBmp8(buf: Uint8Array): DecodedImage {
  const r = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dataOffset = r.getUint32(10, true);
  const width = r.getInt32(18, true);
  const height = r.getInt32(22, true);
  const bpp = r.getUint16(28, true);
  const compression = r.getUint32(30, true);

  if (bpp !== 8 || compression !== 0) {
    throw new Error(`BMP: 不支持 bpp=${bpp} compression=${compression}`);
  }

  const paletteOffset = 14 + r.getUint32(14, true);
  const palette = new Uint8Array(1024);
  palette.set(buf.subarray(paletteOffset, paletteOffset + 1024));

  const rowSize = Math.ceil(width / 4) * 4;
  const data = new Uint8ClampedArray(width * Math.abs(height) * 4);
  const bottomUp = height > 0;
  const h = Math.abs(height);

  for (let y = 0; y < h; y++) {
    const srcRow = bottomUp ? h - 1 - y : y;
    const src = dataOffset + srcRow * rowSize;
    const dst = y * width * 4;
    for (let x = 0; x < width; x++) {
      const idx = buf[src + x] * 4;
      data[dst + x * 4 + 0] = palette[idx + 2];
      data[dst + x * 4 + 1] = palette[idx + 1];
      data[dst + x * 4 + 2] = palette[idx + 0];
      data[dst + x * 4 + 3] = 255;
    }
  }

  return { width, height: h, data };
}

/* ------------------------------------------------------------------ */
/* 纹理缓存                                                            */
/* ------------------------------------------------------------------ */

function makeTexture(img: DecodedImage, mipmap: boolean) {
  const pixels = new Uint8Array(img.width * img.height * 4);
  pixels.set(img.data.subarray(0, pixels.length));

  const tex = new THREE.DataTexture(
    pixels,
    img.width,
    img.height,
    THREE.RGBAFormat
  );
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = mipmap ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = mipmap;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export type TextureTag = 'opaque' | 'blend';

export interface LoadedTexture {
  texture: THREE.Texture;
  /** 依据扩展名判断：.tga/.ozt 走 Alpha 混合 */
  tag: TextureTag;
}

const textureCache = new Map<string, Promise<LoadedTexture | null>>();

/**
 * 纹理文件名索引（`Data/textures-index.json`，`{"小写基名": ["Skill/Fire01.ozj", …]}`）。
 *
 * MU 的 BMD 里纹理名的大小写和实际文件经常对不上：
 *   `DhorSS.jpg`   → `Skill/Dhorss.ozj`
 *   `GroundEff.jpg`→ `Skill/Groundeff.ozj`
 *   `fire01.jpg`   → `Skill/Fire01.ozj`
 * Windows 上跑原版不区分大小写，搬到浏览器走 HTTP 就全部 404 —— 技能特效
 * （`Data/Skill/*.bmd`）几乎每个都踩这个坑。有了索引就不用猜大小写，
 * 直接按小写基名查实际路径，同目录的排前面。
 */
let textureIndex: Record<string, string[]> | null = null;
let textureIndexTask: Promise<void> | null = null;

function ensureTextureIndex(): Promise<void> {
  if (textureIndexTask) return textureIndexTask;
  textureIndexTask = (async () => {
    const bytes = await fetchBytesOptional('Data/textures-index.json');
    if (!bytes) return;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      if (parsed && typeof parsed === 'object') textureIndex = parsed as Record<string, string[]>;
    } catch {
      // 索引坏了就退回「猜大小写」的老路
    }
  })();
  return textureIndexTask;
}

/** 按索引挑候选：同目录优先，其次其它目录（有些纹理共用） */
function indexCandidates(dir: string, base: string, preferTga = false): string[] {
  if (!textureIndex) return [];
  const leaf = base.slice(base.lastIndexOf('/') + 1).toLowerCase();
  const hits = textureIndex[leaf];
  if (!hits || !hits.length) return [];
  const dirRel = dir.replace(/^\/?Data\//i, '').toLowerCase();
  const same = hits.filter(p => p.toLowerCase().startsWith(dirRel));
  const rest = hits.filter(p => !p.toLowerCase().startsWith(dirRel));
  /*
   * **同名但后缀不同的贴图要按「BMD 里声明的后缀」优先**。
   *
   * `Data/Object1` 里有一批同名双份：
   *   ston02.OZJ 30.6KB（不带 alpha）/ ston02.OZT  4.1KB（32×32，带 alpha 的壳）
   *   tree_01.OZJ 15.9KB          / tree_01.OZT 4.1KB
   *
   * 原版 `BMD_LegacyLoading.cpp` 是按**声明后缀**分派：
   *   `extChar == 't'` → `OpenTGA`（找 .OZT）；否则 `OpenJPG`（找 .OZJ）。
   * 以前这里不管声明、索引里 .OZJ 排前面就选中 OZJ ——
   * 于是 `ston02.tga` / `tree_a.tga` 这类「本来要用带 alpha 的 OZT」的 mesh
   * 拿到了不带 alpha 的 JPEG，表现就是**部分模型纹理/镂空不对**。
   *
   * 现在：声明 .tga/.ozt → OZT 排前；声明 .jpg/.ozj → OZJ 排前；另一个仍作兜底。
   */
  const rank = (p: string) => {
    const isTga = /\.ozt$/i.test(p);
    if (preferTga) return isTga ? 0 : 1;
    return isTga ? 1 : 0;
  };
  const order = (list: string[]) => [...list].sort((a, b) => rank(a) - rank(b));
  return [...order(same), ...order(rest)].map(p => (p.startsWith('Data/') ? p : `Data/${p}`));
}

/** 根据 MU 的 TexturePath（如 "tree.jpg" / "Tree_a.tga"）拼出实际资源名 */
export function resolveTextureCandidates(dir: string, texturePath: string) {
  const clean = texturePath.replace(/\\/g, '/').trim();
  const base = clean.replace(/\.[^./]+$/, '');
  const ext = (clean.split('.').pop() || '').toLowerCase();
  /**
   * `.tga` 和 `.ozt` 都是「TGA 套一层 OZT 壳」。
   *
   * BMD 里的 TexturePath 写的是 `.tga`（`Tree_a.tga` → 盘上是 `Tree_a.OZT`），
   * 而技能贴图表（`Scene_AssetLoad.cpp` 的 `OpenTGA`）拿到的是**已经带 .OZT 后缀**
   * 的实盘名。只认 `.tga` 的话，`.OZT` 会被当成 OZJ 交给 `createImageBitmap`
   * 去解 JPEG —— 直接 `InvalidStateError`，特效静默消失（流星焰就是这么丢的）。
   */
  const isTga = ext === 'tga' || ext === 'ozt';
  /*
   * 兜底候选**两种后缀都试，且 OZJ 优先**（理由同上：同名时 OZT 常是空壳占位）。
   * BMD 里写的扩展名只用来决定"先解哪种格式"，不再决定"找哪个文件" ——
   * 解码器本身也是按文件头判断的（见下面的 looksJpeg）。
   */
  /** 声明 .tga/.ozt → OZT 优先；否则 OZJ 优先（另一个作兜底） */
  const exts = isTga
    ? ['.OZT', '.ozt', '.OZJ', '.ozj']
    : ['.OZJ', '.ozj', '.OZT', '.ozt'];

  /**
   * 没有索引时的兜底：原样 + 首字母大写两种写法。
   * MU 的 BMD 里纹理名一律写小写（`fire01.jpg`），实际文件多半是首字母大写。
   */
  const slash = base.lastIndexOf('/');
  const head = base.slice(0, slash + 1);
  const leaf = base.slice(slash + 1);
  const cap = head + leaf.charAt(0).toUpperCase() + leaf.slice(1);
  const caps = Array.from(new Set([base, cap]));

  const candidates: string[] = indexCandidates(dir, base, isTga);
  for (const b of caps) {
    for (const e of exts) {
      candidates.push(`${dir}${b}${e}`, `Data/${b}${e}`);
    }
  }

  return { candidates: Array.from(new Set(candidates)), isTga };
}

export async function loadTexture(
  dir: string,
  texturePath: string,
  mipmap = true
): Promise<LoadedTexture | null> {
  await ensureTextureIndex();
  const { candidates } = resolveTextureCandidates(dir, texturePath);
  const key = `${candidates[0]}|${mipmap}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const task = (async () => {
    /** 按字节解码 TGA；解不出（或解出 0 尺寸 / 离谱尺寸）返回 null */
    const tryTga = (bytes: Uint8Array) => {
      const img = decodeTga(bytes, 4);
      if (!img || img.width <= 0 || img.height <= 0) return null;
      // JPEG 字节按 TGA 头解会读出一个巨大的假尺寸（曾经解出 18432x0）
      if (img.width > 4096 || img.height > 4096) {
        console.warn(`[texture] TGA 解出离谱尺寸 ${img.width}x${img.height}，丢弃`);
        return null;
      }
      return img;
    };
    /** 按字节解码 OZJ/JPEG；失败返回 null */
    const tryJpeg = (bytes: Uint8Array) => decodeOzj(bytes);

    for (const url of candidates) {
      const bytes = await fetchBytesOptional(url);
      if (!bytes) continue;

      /*
       * 按**实际取到的那个文件**决定解码方式，不能按「候选列表」判。
       *
       * 之前 `isTga` 是按 `candidates[0]` 的扩展名算的：BMD 里写的是 `ston02.tga`，
       * 但磁盘上只有 `ston02.OZJ`（真 JPEG），候选会落到第二个 —— 却仍然走 TGA 解码。
       * TGA 头正好从 JPEG 里读出 `18432x0`，于是生成一个 `data.length = 0` 的
       * DataTexture，上传静默失败 → 石头和树全黑。
       *
       * 现在：先按扩展名走首选路径，失败再换另一种（扩展名和内容不符的 MU 文件不少）。
       */
      const ext = (url.split('.').pop() || '').toLowerCase();
      const preferTga = ext === 'tga' || ext === 'ozt';
      /** SOI / APP0：确定是 JPEG，绝不能再按 TGA 去解（会解出垃圾尺寸） */
      const looksJpeg = bytes[0] === 0xff && (bytes[1] === 0xd8 || bytes[1] === 0xe0);

      if (preferTga) {
        const img = tryTga(bytes);
        if (img) return { texture: makeTexture(img, mipmap), tag: 'blend' } as LoadedTexture;
      }

      const bmp = await tryJpeg(bytes);
      if (bmp) {
        const tex = new THREE.Texture(bmp);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = mipmap ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
        tex.generateMipmaps = mipmap;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        return { texture: tex, tag: 'opaque' } as LoadedTexture;
      }

      if (!preferTga && !looksJpeg) {
        const img = tryTga(bytes);
        if (img) return { texture: makeTexture(img, mipmap), tag: 'blend' } as LoadedTexture;
      }

      console.warn(
        `[texture] 两种解码都失败，跳过：${url}（${bytes.length}B，ext=${ext || '?'}）`
      );
    }

    console.warn(`[texture] 未找到 ${texturePath} (dir=${dir})`);
    return null;
  })();

  /*
   * 给贴图挂上 bmd 里写的那个路径名。
   * 物件是**按材质合并**的（一个 mesh 装几百个实例），想反查「这个材质是哪个
   * 模型用的」只能靠贴图名（`__MU_DEBUG__.objectMaterial('38')`）。
   */
  const named = task.then(r => {
    if (r?.texture && !r.texture.name) r.texture.name = texturePath;
    return r;
  });
  textureCache.set(key, named);
  return named;
}

export async function loadSkyTexture(url: string) {
  const bytes = await fetchBytes(url);
  const img = decodeBmp8(bytes);
  if (!img || img.width <= 0 || img.height <= 0) {
    throw new Error(`[texture] 天空图解出 0 尺寸：${url}`);
  }
  const tex = makeTexture(img, true);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** 解出原始 RGBA 像素（地形贴图数组用） */
export async function loadImageData(
  url: string,
  ozj = true
): Promise<DecodedImage | null> {
  const bytes = await fetchBytesOptional(url);
  if (!bytes) return null;

  if (!ozj) return decodeTga(bytes, 4);

  // 同样的「套缩略图」问题：TerrainLight / Tile* 里也有直接解不出来的，走同一个修复路径
  const bmp = await decodeOzj(bytes);
  if (!bmp) {
    console.warn(`[texture] OZJ 解不出：${url}`);
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  bmp.close();
  return { width: canvas.width, height: canvas.height, data };
}
