/**
 * `Data/Logo/` 图资源加载（登录界面 / 角色选择界面）。
 *
 * 这批文件有两种格式，判断方式都不一样，踩过好几轮才确认：
 *
 *   **OZJ（`.ozj` / `.OZJ`）** —— 前 **24 字节是 Webzen 头**，里面塞了一个
 *   「假的 JPEG 开始」（`FF D8 FF E0` + APP0 + APP13），真 JPEG 从第 24 字节才开始。
 *   直接 `new Image(src=file)` 或 `fetch → Blob` 不切头，浏览器会解出
 *   「尺寸对、内容全黑」的图（PIL 也一样：`extrema = ((0,0),(0,0),(0,0))`）。
 *   原版 `Texture.cpp::tex_load_ozj` 就是 `fseek(f, 24, SEEK_SET)` 之后交给 libjpeg。
 *
 *   **OZT（`.ozt`）** —— **4 字节头 + 标准 TGA**（32bpp，描述符 0x08）。
 *   `Interface/` 下的那批是另一种变体（22 字节头 + 裸 BGRA），
 *   所以这里先按标准 TGA 试，长度对不上再退回裸像素解。
 *
 * 输出统一是 `<canvas>`，调用方可以直接 `drawImage` 或转 CSS `background-image`。
 */

import { decodeTga } from '../core/texture';
import { assetUrl } from '../core/base';

const LOGO_DIR = '/Data/Logo/';
/**
 * `Data/Local/` 那几张（启动画面 / 读条画面）。
 *
 * 和 `Data/Logo/` 一样是 OZJ（24 字节 Webzen 头 + JPEG），只是**不走 chs 子目录**
 * —— 这几张图只有根目录一份（`Webzenlogo.ozj` / `Everyone.OZJ` /
 * `Loading01..03.ozj`），去查 `chs/` 只会白跑一次 404。
 */
const LOCAL_DIR = '/Data/Local/';

export interface LogoImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** 原始文件名（调试用） */
  source: string;
}

const cache = new Map<string, Promise<LogoImage | null>>();

/** 是不是带 24 字节 Webzen 头的 OZJ */
function ozjOffset(d: Uint8Array): number {
  // 头里那个假 SOI 之后又有一个真 SOI，判据就是「第 24 字节起是 FF D8」
  if (d.length > 26 && d[24] === 0xff && d[25] === 0xd8) return 24;
  return 0;
}

/** 22 字节头 + 裸 BGRA 的 OZT（`Interface/` 那批的格式，兜底用） */
function decodeOztRaw(d: Uint8Array): HTMLCanvasElement | null {
  if (d.length < 48) return null;
  const width = d[16] | (d[17] << 8);
  const height = d[18] | (d[19] << 8);
  const bpp = d[20];
  const desc = d[21];
  if (!width || !height || width > 4096 || height > 4096) return null;
  if (bpp !== 24 && bpp !== 32) return null;
  const bpr = bpp >> 3;
  if (22 + width * height * bpr > d.length) return null;

  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(width, height);
  const bottomUp = (desc & 0x20) === 0;
  let p = 22;
  for (let i = 0; i < width * height; i++) {
    const b = d[p];
    const g = d[p + 1];
    const r = d[p + 2];
    const a = bpr === 4 ? d[p + 3] : 255;
    const x = i % width;
    const y = bottomUp ? height - 1 - ((i / width) | 0) : (i / width) | 0;
    const o = (y * width + x) * 4;
    img.data[o] = r;
    img.data[o + 1] = g;
    img.data[o + 2] = b;
    img.data[o + 3] = a;
    p += bpr;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/**
 * 行序翻转（原地）。
 *
 * `decodeTga` 的输出恒为「第 0 行 = 图像底部」—— 3D 那边靠 `DataTexture`
 * 默认的 `flipY = true` 在上传时翻回来，所以一直是对的。`<canvas>` 没有
 * flipY，直接 `putImageData` 就会白倒：登录面板上下颠倒、账号框跑到面板底部
 * 去了（查了半天坐标，其实图本身是倒的）。
 */
function flipRows(data: Uint8ClampedArray, width: number, height: number) {
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

/** OZT → canvas（标准 TGA 优先，失败再退回 22 字节裸像素） */
function decodeOztCanvas(bytes: Uint8Array): HTMLCanvasElement | null {
  // 标准 TGA：第 4..5 字节是 imageType（2/10），第 16..17 才是宽度
  const type = bytes[6];
  if (type === 2 || type === 10) {
    try {
      const img = decodeTga(bytes, 4);
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const ctx = cv.getContext('2d');
      if (!ctx) return null;
      const id = ctx.createImageData(img.width, img.height);
      id.data.set(img.data);
      flipRows(id.data, img.width, img.height);
      ctx.putImageData(id, 0, 0);
      return cv;
    } catch {
      /* 落到裸像素分支 */
    }
  }
  return decodeOztRaw(bytes);
}

async function fetchLogoImage(dir: string, name: string): Promise<LogoImage | null> {
  let res: Response;
  try {
    res = await fetch(assetUrl(`${dir}${name}`));
  } catch {
    return null;
  }
  if (!res.ok) {
    console.warn(`[logo] 取不到 ${name}（HTTP ${res.status}）`);
    return null;
  }
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html')) {
    console.warn(`[logo] ${name} 被 SPA 回落到 index.html，路径不对`);
    return null;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());

  if (/\.ozt$/i.test(name)) {
    const cv = decodeOztCanvas(bytes);
    if (!cv) {
      console.warn(`[logo] OZT 解析失败 ${name}`);
      return null;
    }
    return { canvas: cv, width: cv.width, height: cv.height, source: name };
  }

  // OZJ：切掉 24 字节 Webzen 头，剩下的就是纯 JPEG
  const body = bytes.slice(ozjOffset(bytes));
  const blob = new Blob([body.buffer as ArrayBuffer], { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.decoding = 'async';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`decode ${name}`));
      el.src = url;
    });
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    cv.getContext('2d')!.drawImage(img, 0, 0);
    return { canvas: cv, width: cv.width, height: cv.height, source: name };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 取一张 `Data/Logo` 下的图（带缓存）。名字要带扩展名，例如 `back1.OZJ`。 */
export function logoSprite(name: string): Promise<LogoImage | null> {
  return spriteOf(LOGO_DIR + name);
}

/**
 * 取一张 `Data/Local` 下的图 —— 启动画面的 `Webzenlogo.ozj` / `Everyone.OZJ`、
 * 读条画面的 `Loading01..03.ozj`。
 *
 * 和 `Logo/` 那批完全一样的格式（24 字节 Webzen 头 + 纯 JPEG），只是目录不同；
 * 直接 `<img src=".../Loading01.ozj">` 是不行的 —— 浏览器按后缀猜 MIME，
 * `.ozj` 认不出来会当二进制，得自己切头再包 Blob。
 */
export function localSprite(name: string): Promise<LogoImage | null> {
  return spriteOf(LOCAL_DIR + name);
}

function spriteOf(path: string): Promise<LogoImage | null> {
  const hit = cache.get(path);
  if (hit) return hit;
  const dir = path.slice(0, path.lastIndexOf('/') + 1);
  const name = path.slice(dir.length);
  const task = fetchLogoImage(dir, name);
  cache.set(path, task);
  return task;
}

/** 一次性预热（失败的不会阻塞其它） */
export async function preloadLogo(names: string[]): Promise<Map<string, LogoImage | null>> {
  const out = new Map<string, LogoImage | null>();
  await Promise.all(
    names.map(async n => {
      out.set(n, await logoSprite(n));
    })
  );
  return out;
}

/** 转成 CSS `url(...)`（dataURL，因为 canvas 没有地址） */
export function logoCssUrl(img: LogoImage): string {
  return `url(${img.canvas.toDataURL('image/png')})`;
}
