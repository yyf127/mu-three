/**
 * 登录界面「贴图皮肤」—— 把 `Data/Logo` 的原版图贴到 DOM 上。
 *
 * 布局不用百分比：`#login-layer` 是 640×480 的逻辑层（见 `style.css` 的
 * `.mu-layer`），这里只负责按舞台宽度整层 `scale()`，这样 CSS 里写的
 * `left/top/width` 全都能直接照抄 `Scene_Login.cpp` 的坐标。
 *
 * 贴图必须在这里注入：OZT 要手解（浏览器不认 TGA），OZJ 要切掉 24 字节
 * Webzen 头，所以不能直接写 `url(/Data/Logo/xxx.ozj)`。
 */

import { logoCssUrl, logoSprite, type LogoImage } from './logoAssets';

/** 逻辑分辨率（原版 640×480） */
const UI_W = 640;

/** 背景优先用这张（天空/远景），取不到再退 back1 */
const BG_CANDIDATES = ['Sky0.ozj', 'Sky3.ozj', 'Sky4.ozj', 'back1.OZJ'];

function setBg(el: Element | null, img: LogoImage | null, size = '100% 100%', repeat = 'no-repeat', pos = 'center') {
  if (!el || !img) return;
  const s = el as HTMLElement;
  s.style.backgroundImage = logoCssUrl(img);
  s.style.backgroundSize = size;
  s.style.backgroundRepeat = repeat;
  s.style.backgroundPosition = pos;
}

/**
 * 把 640×480 逻辑层缩放到舞台（和 `#mu-ui` 一个套路：1 单位 == 原版 1 像素）。
 * 登录、选角两层都用 `.mu-layer`，一次全刷。
 */
export function layoutLoginLayer(): number {
  const stage = document.getElementById('stage');
  if (!stage) return 1;
  const scale = (stage.clientWidth || UI_W) / UI_W;
  for (const layer of document.querySelectorAll<HTMLElement>('.mu-layer')) {
    layer.style.transform = `scale(${scale})`;
  }
  return scale;
}

let watching = false;

/** 舞台尺寸变化时跟着重算（`#stage` 由 CSS 决定大小，窗口变了才触发） */
function watchStage() {
  if (watching) return;
  const stage = document.getElementById('stage');
  if (!stage) return;
  watching = true;
  layoutLoginLayer();
  new ResizeObserver(() => layoutLoginLayer()).observe(stage);
}

/** 登录界面贴图（`Scene_LoadAccountResources` 的槽 0xC..0x12） */
export async function initLoginSkin(): Promise<{ ok: string[]; missing: string[] }> {
  const ok: string[] = [];
  const missing: string[] = [];

  watchStage();

  const [bg, logo, panel, btnOk, btnCancel] = await Promise.all([
    (async () => {
      for (const name of BG_CANDIDATES) {
        const img = await logoSprite(name);
        if (img) return { img, name };
      }
      return null;
    })(),
    logoSprite('Logo.ozj'),
    logoSprite('0account_new.ozt'),
    logoSprite('0on_botton.ozj'),
    logoSprite('0on_botton2.ozj'),
  ]);

  if (bg) {
    setBg(document.getElementById('mu-login-bg'), bg.img, 'cover');
    setBg(document.getElementById('mu-char-bg'), bg.img, 'cover');
    ok.push(bg.name);
  } else missing.push('背景');

  if (logo) {
    setBg(document.getElementById('mu-login-logo'), logo, 'contain');
    setBg(document.getElementById('mu-char-logo'), logo, 'contain');
    ok.push('Logo.ozj');
  } else missing.push('Logo.ozj');

  if (panel) {
    setBg(document.getElementById('mu-account-panel'), panel);
    ok.push('0account_new.ozt');
  } else missing.push('0account_new.ozt');

  /*
   * 按钮贴图只做「悬停态」：原版 `Scene_Login` 是鼠标进了按钮范围才
   * `GL_DrawTexture(0xd/0xe)`，常态露出的是面板 TGA 上本来就有的空 plate。
   * 所以这里写成 CSS 变量，交给 `#login .mu-btn:hover` 用。
   */
  if (btnOk) {
    document.querySelector<HTMLElement>('#login .mu-ok')?.style.setProperty('--mu-btn-hover', logoCssUrl(btnOk));
    ok.push('0on_botton.ozj');
  } else missing.push('0on_botton.ozj');

  if (btnCancel) {
    document.querySelector<HTMLElement>('#login .mu-cancel')?.style.setProperty('--mu-btn-hover', logoCssUrl(btnCancel));
    ok.push('0on_botton2.ozj');
  } else missing.push('0on_botton2.ozj');

  /* 输入框不贴图：凹槽是 0Account_new.tga 自带的，再叠 0Text_Box 就会错位 */
  console.log(
    `[login] Logo 皮肤：${ok.length} 张就位${missing.length ? `，缺 ${missing.join('/')}` : ''}（逻辑层 640×480）`
  );
  return { ok, missing };
}

/**
 * 选角 / 新建角色界面的贴图。
 *
 * 选角这一屏的原版资源（`Scene_LoadCharSelectResources` 的 0xC..0x1D）：
 *
 *   0xC..0xF  Interface01..04 —— 屏幕四周的框，**左右各画一份、右半镜像**：
 *             0xC 256×86 → (64,0)+(320,0)   0xD 64×256 → (0,0)+(576,0)
 *             0xE 64×224 → (0,256)+(576,256) 0xF 256×32 → (64,448)+(320,448)
 *   0x10/0x11 New_character201/202 —— 「新建角色」銘牌 + 悬停文字
 *   0x12/0x13 Delete01/02 —— 左侧「删除」銘牌 + 按钮高亮
 *   0x14/0x15 Ok01/02     —— 右侧「进入」銘牌 + 按钮高亮
 *   0x16/0x17 New_character01/02 —— 新建角色面板（213×256 + 213×119）
 *
 * 銘牌的按钮/标签本来就画在底图上，高亮版本用 `--hover-img` 交给 CSS `::after` 叠。
 */
export async function initCharSkin(): Promise<void> {
  const [if1, if2, if3, if4, newArt, newHover, delArt, delHover, okArt, okHover, top, bottom] =
    await Promise.all([
      logoSprite('Interface01.ozt'),
      logoSprite('Interface02.ozt'),
      logoSprite('Interface03.ozt'),
      logoSprite('Interface04.ozt'),
      logoSprite('New_character201.ozt'),
      logoSprite('New_character202.ozj'),
      logoSprite('Delete01.ozt'),
      logoSprite('Delete02.ozj'),
      logoSprite('Ok01.ozt'),
      logoSprite('Ok02.ozj'),
      logoSprite('New_character01.ozt'),
      logoSprite('New_character02.ozt'),
    ]);

  /**
   * 框：同一张图左右各画一份。
   * 原版 `FUN_005239a0` 里 u 0→1 的那份在**右边**（原图），u 1→0 的那份在左边
   * （镜像）——所以 `.flip` 加在左侧元素上，顺序反了整圈纹理会朝外。
   */
  const frame: [string, string, LogoImage | null][] = [
    ['cf-top-l', 'cf-top-r', if1],
    ['cf-left-1', 'cf-right-1', if2],
    ['cf-left-2', 'cf-right-2', if3],
    ['cf-bot-l', 'cf-bot-r', if4],
  ];
  for (const [leftId, rightId, img] of frame) {
    if (!img) continue;
    setBg(document.getElementById(leftId), img);
    setBg(document.getElementById(rightId), img);
  }

  const plaque = (id: string, art: LogoImage | null, hover: LogoImage | null) => {
    const el = document.getElementById(id);
    if (el && art) setBg(el, art);
    if (el && hover) el.style.setProperty('--hover-img', logoCssUrl(hover));
  };
  plaque('btn-char-create', newArt, newHover);
  plaque('btn-char-delete', delArt, delHover);
  plaque('btn-char-ok', okArt, okHover);

  if (top) setBg(document.getElementById('cp-art-top'), top);
  if (bottom) setBg(document.getElementById('cp-art-bottom'), bottom);

  const got = [if1, if2, if3, if4, newArt, newHover, delArt, delHover, okArt, okHover, top, bottom].filter(Boolean).length;
  console.log(`[char] 选角皮肤：${got}/12 张就位（框 Interface01..04 / 三块銘牌 / 新建面板）`);
}
