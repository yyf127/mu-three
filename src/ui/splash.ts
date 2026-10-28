/**
 * 启动画面 + 读条画面 —— 原版 `Scene_Intro`（0x005137A0）和 `Scene_Loading`（0x00524B20）。
 *
 * ## 一、启动画面（`Local/Webzenlogo.jpg` + `Local/Everyone.jpg`）
 *
 * 源码 `Scene_Intro.cpp`：
 *
 * ```c
 * OpenJPG("Local/Webzenlogo.jpg", 0xc, ...);
 * OpenJPG("Local/Everyone.jpg",   0xd, ...);
 * glClear(...);  GL_Begin2D();  glColor3f(1,1,1);
 * GL_DrawTexture(0xc, 640*0.5 - 128,  640*0.375 - 97.5, 256, 195, 0,0, 1.0, 0.76171875, 0,0);
 * GL_DrawTexture(0xd, 640 - 120,      0,                120,  60, 0,0, 0.9375, 0.9375, 0,0);
 * ```
 *
 * 常量出自 `globals.cpp`：`_DAT_00552504 = 0.5`（居中系数）、`_DAT_005529bc = 128`
 * （logo 半宽）、`_DAT_00552d3c = 0.375`、`_DAT_00552d38 = 97.5`、
 * `_DAT_00552908 = 120`（Everyone 宽）。算出来就是 **logo 在 (192,142.5) 256×195
 * 正中**，**Everyone 在 (520,0) 120×60 右上角**。
 *
 * 原版这一屏只画一帧就 `SceneFlag = 2`（直接进登录），因为资产在
 * `Scene_LoadGameAssets` 里早就加载好了。网页端反过来 —— 这时候登录背景、
 * 登录面板、选角 3D 都还在下载，所以这一屏正好用来**盖住首屏加载**：
 * 至少显示 1.6 秒，图片到位后再淡出。
 *
 * ## 二、读条画面（`Local/Loading01..03.ozj`）
 *
 * 源码 `Scene_Loading.cpp` 把三张图**横着拼**在 y=100：
 *
 * | 槽 | 文件 | x | 尺寸 |
 * |---|---|---|---|
 * | 0x1e | `Loading01.ozj` | 0 | 256×256 |
 * | 0x1f | `Loading02.ozj` | 256 | 128×256 |
 * | 0x20 | `Loading03.ozj` | 384 | 256×256 |
 *
 * 三张拼起来正好是 640 宽、256 高的一条（贴图原始尺寸也是 256/128/256 × 256，
 * 没有拉伸）。原版这里同样是一帧就过；我们进图要解 BMD 和地形，会停十几秒，
 * 所以在图下面补了一条进度条（原版没有，纯属网页端需要）。
 */

import { localSprite, logoCssUrl } from './logoAssets';
import { layoutLoginLayer } from './loginSkin';

/* ------------------------------------------------------------------ */
/* 布局常量（640×480 逻辑坐标，全部来自源码）                          */
/* ------------------------------------------------------------------ */
/** Webzen logo：`640*0.5 - 128` / `640*0.375 - 97.5` / 256×195 */
const INTRO_LOGO = { left: 192, top: 142.5, width: 256, height: 195 };
/** ESRB "Everyone" 角标：`640 - 120` / `0` / 120×60 */
const INTRO_ESRB = { left: 520, top: 0, width: 120, height: 60 };

/** 三张 Loading 的横排位置（`Scene_Loading.cpp` 的三个 GL_DrawTexture） */
const LOADING_TILES = [
  { id: 'ld-t1', name: 'Loading01.ozj', left: 0, top: 100, width: 256, height: 256 },
  { id: 'ld-t2', name: 'Loading02.ozj', left: 256, top: 100, width: 128, height: 256 },
  { id: 'ld-t3', name: 'Loading03.ozj', left: 384, top: 100, width: 256, height: 256 },
];

/* ------------------------------------------------------------------ */
/* 启动画面                                                            */
/* ------------------------------------------------------------------ */
let introEl: HTMLElement | null = null;

function paintBox(el: HTMLElement | null, css: string | null, box: { left: number; top: number; width: number; height: number }) {
  if (!el) return;
  el.style.left = `${box.left}px`;
  el.style.top = `${box.top}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
  el.style.display = 'block';
  if (css) el.style.backgroundImage = css;
}

/**
 * 把两张启动图和三张读条图一起取下来（并行，失败各自降级）。
 * @returns 启动画面那两张里成功画上去了几张（0 = 全失败）
 */
async function loadArt(): Promise<number> {
  const [logo, esrb, ...tiles] = await Promise.all([
    localSprite('Webzenlogo.ozj'),
    localSprite('Everyone.OZJ'),
    ...LOADING_TILES.map(t => localSprite(t.name)),
  ]);

  paintBox(document.getElementById('intro-logo'), logo ? logoCssUrl(logo) : null, INTRO_LOGO);
  // 取不到就整块不显示：原版这一屏只有两张图，缺一张画个空框更难看
  const esrbEl = document.getElementById('intro-esrb');
  if (esrbEl) {
    if (esrb) paintBox(esrbEl, logoCssUrl(esrb), INTRO_ESRB);
    else esrbEl.style.display = 'none';
  }

  LOADING_TILES.forEach((t, i) => {
    const img = tiles[i];
    const el = document.getElementById(t.id);
    if (!el) return;
    if (!img) {
      // 缺图不留空洞：整条底板用深色顶上去，进度条照常走
      el.style.display = 'none';
      return;
    }
    paintBox(el, logoCssUrl(img), t);
  });
  return (logo ? 1 : 0) + (esrb ? 1 : 0);
}

const delay = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms));

/**
 * 显示启动画面并至少停留 `minMs`，然后淡出。
 *
 * - 图片本身也在这里等；取不到（离线 / 路径不对）就只显示黑屏走人，
 *   不能让首屏卡在一个永远不消失的黑幕上。
 * - **点一下就跳过** —— 老玩家不需要看 logo，探针也不想多等 1.6 秒。
 */
export async function runIntro(minMs = 1600): Promise<void> {
  introEl = document.getElementById('intro');
  if (!introEl) return;
  layoutLoginLayer();
  introEl.classList.remove('hidden', 'fade-out');

  let skip: () => void = () => {};
  const skipped = new Promise<void>(r => {
    skip = r;
  });
  introEl.addEventListener('pointerdown', skip, { once: true });

  const art = loadArt().catch(err => {
    console.warn('[splash] 启动图加载失败', err);
    return 0;
  });
  await Promise.race([Promise.all([art, delay(minMs)]), skipped]);
  const painted = await art;
  introEl.removeEventListener('pointerdown', skip);

  // 一张图都没画出来就别磨蹭了（黑屏 1.6 秒比直接进登录更像卡死）
  if (!painted) {
    introEl.classList.add('hidden');
    return;
  }
  introEl.classList.add('fade-out');
  await delay(420);
  introEl.classList.add('hidden');
  introEl.classList.remove('fade-out');
}

/* ------------------------------------------------------------------ */
/* 读条画面                                                            */
/* ------------------------------------------------------------------ */
/** 提前把三张读条图挂上（进图时才 started，现拿就来不及了） */
export function initLoadingArt(): void {
  void loadArt().catch(err => console.warn('[splash] 读条图加载失败', err));
}
