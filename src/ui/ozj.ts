/**
 * 原版 UI 贴图加载器（Data/Interface 下的 OZJ）。
 *
 * 0.97 客户端 `Texture.cpp::tex_load_ozj`（IDA 0x00529740）对 OZJ 的处理只有一句：
 * `fseek(f, 24, SEEK_SET)` 之后交给 libjpeg —— 前 24 字节是 Webzen 的自定义头
 * （一段 SOI+APP0 前缀，凑巧长得像 JPEG 的开始），真正的 JPEG 从第 24 字节的
 * `FF D8` 才开始。
 *
 * 判定就按这个规则：`d[24..25] === FF D8` 说明是 OZJ，切掉 24 字节；
 * 否则当普通 JPEG 直接用。实测 `Data/Interface` 下 79 个 .ozj 全部符合。
 *
 * OZT 是 TGA 变体（带 alpha），浏览器解不了，这里单独手解 —— 光标、位图字体、
 * 小地图边框都是 OZT，后面做对应面板时才用得上。
 */

import { UI_FILES } from '../data/uiManifest';
import { assetUrl } from '../core/base';

export const UI_DIR = '/Data/Interface/';
export interface UiSprite {
  image: HTMLImageElement;
  url: string;
  width: number;
  height: number;
  /** 贴图原始文件名（调试用） */
  source: string;
}

const cache = new Map<string, Promise<UiSprite | null>>();

function looksLikeOzj(d: Uint8Array) {
  return d.length > 26 && d[24] === 0xff && d[25] === 0xd8;
}

/* ------------------------------------------------------------------ */
/* OZT（TGA 变体）手解                                                 */
/* ------------------------------------------------------------------ */

/**
 * OZT = 标准 TGA 头 + 像素数据，只有两种：32 位未压缩（0x20）和
 * 24/32 位 RLE（0x0A）。原版 `Texture.cpp::tex_load_ozt` 就是这么读的。
 * 输出成 <canvas> 再转 blob，这样调用方可以像普通贴图一样用。
 */
function decodeOzt(d: Uint8Array): HTMLCanvasElement | null {
  if (d.length < 48) return null;
  const imgType = d[2];
  if (imgType !== 2 && imgType !== 10) return null;

  /*
   * 这里读的不是标准 TGA 头。
   *
   * Webzen 的 OZT 是 22 字节自定义头 + 裸 BGRA 像素 + 26 字节 TGA 2.0 footer：
   *
   *   [16..17] 宽（小端 u16）
   *   [18..19] 高
   *   [20]     bpp（24 或 32）
   *   [21]     描述符（bit5 = 0 表示扫描线自下而上）
   *   [22..]   像素
   *   [-26..]  footer，以 "TRUEVISION-XFILE." 结尾 —— 必须跳过
   *
   * `Interface/` 下 17 个 OZT 全部满足 `22 + w*h*(bpp/8) + 26 == 文件长度`。
   *
   * 踩过的坑：一开始以为头是 48 字节，因为 `48 + w*h*4 == 文件长度` 也成立
   * ——那只是 48-22 恰好等于 footer 长度。后果是像素相位整体错 2 字节，
   * alpha 读到邻居通道，Menu04 角饰（本来四周是透明的）渲染成一整块黑板。
   */
  const width = d[16] | (d[17] << 8);
  const height = d[18] | (d[19] << 8);
  const bpp = d[20];
  const desc = d[21];
  if (!width || !height || width > 4096 || height > 4096) return null;
  if (bpp !== 24 && bpp !== 32) return null;

  const bytesPerPixel = bpp >> 3;
  const total = width * height;
  const px = new Uint8ClampedArray(total * 4);
  let p = 22;

  // TGA 的扫描线可以自下而上（描述符 bit5 = 0 时是倒序）
  const bottomUp = (desc & 0x20) === 0;

  const writePixel = (i: number) => {
    const b = d[p];
    const g = d[p + 1];
    const r = d[p + 2];
    const a = bytesPerPixel === 4 ? d[p + 3] : 255;
    const x = i % width;
    const y = bottomUp ? height - 1 - Math.floor(i / width) : Math.floor(i / width);
    const o = (y * width + x) * 4;
    px[o] = r;
    px[o + 1] = g;
    px[o + 2] = b;
    px[o + 3] = a;
    p += bytesPerPixel;
  };

  if (imgType === 2) {
    for (let i = 0; i < total; i++) writePixel(i);
  } else {
    let i = 0;
    while (i < total && p < d.length) {
      const head = d[p++];
      const count = (head & 0x7f) + 1;
      if (head & 0x80) {
        const b = d[p];
        const g = d[p + 1];
        const r = d[p + 2];
        const a = bytesPerPixel === 4 ? d[p + 3] : 255;
        p += bytesPerPixel;
        for (let k = 0; k < count && i < total; k++, i++) {
          const x = i % width;
          const y = bottomUp ? height - 1 - Math.floor(i / width) : Math.floor(i / width);
          const o = (y * width + x) * 4;
          px[o] = r;
          px[o + 1] = g;
          px[o + 2] = b;
          px[o + 3] = a;
        }
      } else {
        for (let k = 0; k < count && i < total; k++, i++) writePixel(i);
      }
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(px, width, height), 0, 0);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* 对外接口                                                            */
/* ------------------------------------------------------------------ */

async function fetchSprite(name: string): Promise<UiSprite | null> {
  const key = name.replace(/\.(ozj|ozt)$/i, '').toLowerCase();
  const file = UI_FILES[key];
  if (!file) {
    console.warn(`[ui] Interface 里没有 ${name}`);
    return null;
  }

  let res: Response;
  try {
    res = await fetch(assetUrl(`${UI_DIR}${file}`));
  } catch {
    return null;
  }
  if (!res.ok) {
    console.warn(`[ui] 取不到 ${file}（HTTP ${res.status}）`);
    return null;
  }

  // 兜底：Vite 找不到静态文件时会回落到 index.html（200 + text/html），
  // 直接吃进 <img> 只会得到一条解码失败，看不出是路径写错了
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html')) {
    console.warn(`[ui] ${file} 被 SPA 回落到 index.html，说明路径不对`);
    return null;
  }

  const bytes = new Uint8Array(await res.arrayBuffer());

  if (/\.ozt$/i.test(file)) {
    const canvas = decodeOzt(bytes);
    if (!canvas) {
      console.warn(`[ui] OZT 解析失败 ${file}`);
      return null;
    }
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    try {
      const image = await loadImage(url);
      return { image, url, width: image.width, height: image.height, source: file };
    } catch {
      URL.revokeObjectURL(url);
      return null;
    }
  }

  const off = looksLikeOzj(bytes) ? 24 : 0;
  const body = bytes.slice(off);
  const blob = new Blob([body.buffer as ArrayBuffer], { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    return { image, url, width: image.width, height: image.height, source: file };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`decode fail ${url}`));
    img.src = url;
  });
}

/** 载入（带缓存）。找不到时返回 null，调用方自己决定兜底。 */
export function uiSprite(name: string): Promise<UiSprite | null> {
  const key = name.toLowerCase().replace(/\.(ozj|ozt)$/i, '');
  const hit = cache.get(key);
  if (hit) return hit;
  const task = fetchSprite(name);
  cache.set(key, task);
  return task;
}

/** 批量预载：面板打开前先把要用的图拉到缓存里，避免一帧一个闪 */
export async function preloadUi(names: string[]) {
  await Promise.all(names.map(n => uiSprite(n)));
}
