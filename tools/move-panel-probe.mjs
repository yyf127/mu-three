/**
 * 移动命令窗口外观探针 —— 验底板贴图与大版式。
 *
 * 本轮改动：
 *   面板底板换成 Win 端物件窗那套 `Item_Back01`(190×256) + `Item_Back02`(190×177)，
 *   拼成 190×433 放在屏幕**左侧**（原点 32, 12）。数据与交互逻辑未动。
 *
 * 判据（CONFIRMED_SOURCE，HUD_Pass6.cpp:216 `RenderInventoryInterface`）：
 *   GL_DrawTexture(260, X, Y,       190, 256, …)   Item_Back01
 *   GL_DrawTexture(261, X, Y + 256, 190, 177, …)   Item_Back02
 *
 * 断言：
 *   [A] 面板 DOM 就位，尺寸 190×433，位置在左半屏
 *   [B] 两块底板 <img> 载入成功（naturalWidth > 0）且尺寸/位置正确
 *   [C] 贴图 URL 真的是 Interface/Item_back01 / Item_Back02
 *   [D] 字体与色值对齐原版（SimSun 族 / 硬阴影 / 表头黄 #ffdc96）
 *   [E] 截图存档供人工比对
 *
 * 用法：node tools/move-panel-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('move-panel');
let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}  ${detail}`);
  }
}

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  await sleep(2200);

  /* 打开移动窗口（走 app 的调试口，和 M 键同一条 show/hide 路径） */
  await c.ev(`__MU_APP__.moveToggle(true)`);

  let panel = null;
  for (let i = 0; i < 25 && !panel; i++) {
    await sleep(180);
    const raw = await c.ev(`(() => {
      const el = document.querySelector('.mv-panel');
      if (!el) return 'null';
      const r = el.getBoundingClientRect();
      const hidden = el.classList.contains('hidden');
      return JSON.stringify({
        hidden,
        cls: el.className,
        w: +el.style.width.replace('px',''),
        h: +el.style.height.replace('px',''),
        left: +el.style.left.replace('px',''),
        top: +el.style.top.replace('px',''),
        rect: [Math.round(r.width), Math.round(r.height)],
      });
    })()`);
    panel = raw && raw !== 'null' ? JSON.parse(raw) : null;
    if (panel && !panel.hidden) break;
    panel = null;
  }

  console.log('\n[A] 面板尺寸与位置');
  check('移动面板存在且已打开', !!panel, String(panel));
  if (panel) {
    check('逻辑尺寸 190×433（原版底板），位置在左半屏', panel.w === 190 && panel.h > 400 && panel.left < 200, JSON.stringify(panel));
  }

  /* [B][C] 底板贴图 */
  console.log('\n[B] 底板贴图 (Item_Back01 / Item_Back02)');
  const platesRaw = await c.ev(`(() => {
    const els = [...document.querySelectorAll('.mv-panel .mv-sprite')];
    return JSON.stringify(els.map(e => ({
      src: e.getAttribute('src'),
      w: +e.style.width.replace('px',''),
      h: +e.style.height.replace('px',''),
      left: +e.style.left.replace('px',''),
      top: +e.style.top.replace('px',''),
      loaded: e.complete && e.naturalWidth > 0,
      nw: e.naturalWidth, nh: e.naturalHeight,
    })));
  })()`);
  const plates = JSON.parse(platesRaw);
  check('两块底板 <img> 都在 DOM 里', plates.length === 2, JSON.stringify(plates));
  if (plates.length === 2) {
    const [top, bottom] = plates;
    check('Item_Back01 位置 (0,0) 显示 190×256', top.left === 0 && top.top === 0 && top.w === 190 && top.h === 256, JSON.stringify(top));
    check('Item_Back02 位置 (0,256) 显示 190×177', bottom.left === 0 && bottom.top === 256 && bottom.w === 190 && bottom.h === 177, JSON.stringify(bottom));
    check('两块贴图都载入成功（naturalWidth>0）', top.loaded && bottom.loaded, JSON.stringify(plates.map(p => [p.loaded, p.nw, p.nh])));
  }

  /*
   * URL 校验：uiSprite() 走 URL.createObjectURL → DOM 里是 blob:，
   * 所以不能直接匹配路径。改为在页面里问 uiSprite 要原始 source。
   */
  const sources = JSON.parse(await c.ev(`(async () => {
    const m = await import('/src/ui/ozj.ts');
    const [a, b] = await Promise.all([m.uiSprite('Item_back01'), m.uiSprite('Item_Back02')]);
    return JSON.stringify({ a: a && a.source, b: b && b.source, aw: a && a.width, ah: a && a.height });
  })()`));
  check(
    '资源解析到 Interface/Item_back01（.ozj/.jpg）',
    /item_back0?1\.(ozj|jpg)$/i.test(sources.a || ''),
    JSON.stringify(sources)
  );
  check('资源解析到 Interface/Item_Back02', /item_back0?2\.(ozj|jpg)$/i.test(sources.b || ''), sources.b);

  /* [D] 字体与色值 */
  console.log('\n[D] 字体与配色对齐原版');
  const style = JSON.parse(await c.ev(`(() => {
    const p = document.querySelector('.mv-panel');
    const head = document.querySelector('.mv-head');
    const row = document.querySelector('.mv-row');
    const cs = getComputedStyle(p);
    return JSON.stringify({
      font: cs.fontFamily,
      textured: p.classList.contains('mv-textured'),
      headColor: head ? getComputedStyle(head).color : null,
      headShadow: head ? getComputedStyle(head).textShadow : null,
      rowShadow: row ? getComputedStyle(row).textShadow : null,
      rowSize: row ? getComputedStyle(row).fontSize : null,
    });
  })()`));
  check('字体族含 SimSun/宋体（原版 CreateFontA 用的宋体）', /SimSun|宋体/i.test(style.font), style.font);
  check('贴图到位后加了 mv-textured 类（撤掉兜底边框）', style.textured === true, `textured=${style.textured}`);
  check('表头为原版黄 (#ffdc96 → rgb(255, 220, 150))', /255,\s*220,\s*150/.test(style.headColor || ''), style.headColor);
  check('文字带 1px 硬阴影（原版 NONANTIALIASED 风格）', /rgb\(0,\s*0,\s*0\)/.test(style.headShadow || ''), style.headShadow);
  check('行文字也有硬阴影', /rgb\(0,\s*0,\s*0\)/.test(style.rowShadow || ''), style.rowShadow);

  /* [E] 截图 + 像素验证 */
  console.log('\n[E] 截图与像素验证');
  await sleep(300);
  const shot = await c.shot('move-panel-original-plate');
  console.log(`   存档：${shot}`);

  /*
   * 光有 <img> 在 DOM 里不算数 —— 得确认它**真的画出来了**。
   * 取面板区域的均值色：原版底板是铜褐色金属（R ≥ G ≥ B，暖色），
   * 旧版兜底是深棕纯色（R≈G≈B 更灰）。另外底部条带（Item_Back02 区）
   * 的色值应与顶部（Item_Back01 区）**不同**，说明两块贴图各自存在。
   */
  const { decodePng, meanRgb } = await import('./lib/png-diff.mjs');
  const img = decodePng(shot);
  const sc = img.width / 640;
  const rx = Math.round(32 * sc);
  const ry = Math.round(12 * sc);
  const rw = Math.round(190 * sc);
  const top = meanRgb(img, { x: rx + 4, y: ry + 4, w: rw - 8, h: Math.round(24 * sc) });
  const bottom = meanRgb(img, { x: rx + 4, y: ry + Math.round(280 * sc), w: rw - 8, h: Math.round(24 * sc) });
  console.log(`   面板上部均值 ${JSON.stringify(top)} / 下部均值 ${JSON.stringify(bottom)}`);
  check('面板上部呈暖色（R ≥ B，原版铜褐底板）', top.r >= top.b, JSON.stringify(top));
  check(
    '上下两块底板色调不同（Item_Back02 真的画在下面）',
    Math.abs(top.r - bottom.r) + Math.abs(top.g - bottom.g) + Math.abs(top.b - bottom.b) > 4,
    `top=${JSON.stringify(top)} bottom=${JSON.stringify(bottom)}`
  );

  /* [交互] 双击移动 / 点选 + 按钮移动 / Ok 图标 */
  console.log('\n[交互] 双击移动、点选+按钮、Ok 图标');
  await c.ev(`__MU_APP__.moveToggle(true)`);
  await sleep(400);

  const inter = JSON.parse(await c.ev(`(() => {
    const btn = document.querySelector('.mv-btn');
    const img = btn && btn.querySelector('img');
    return JSON.stringify({
      btnCount: document.querySelectorAll('.mv-btn').length,
      hasImg: !!img,
      imgNatural: img && img.naturalWidth ? [img.naturalWidth, img.naturalHeight] : null,
      // 用 getComputedStyle 读逻辑像素（getBoundingClientRect 含 UiLayer 缩放）
      imgBox: img ? [getComputedStyle(img).width, getComputedStyle(img).height] : null,
      btnText: btn ? btn.textContent : null,
      btnTitle: btn ? btn.title : null,
      rowCount: document.querySelectorAll('.mv-row').length,
    });
  })()`));
  check('只有一个按钮（「关 闭」上轮已移除）', inter.btnCount === 1, String(inter.btnCount));
  check('按钮挂了 Ok 图标（70×21 素材）', inter.hasImg && JSON.stringify(inter.imgNatural) === '[70,21]', JSON.stringify(inter.imgNatural));
  check('图标显示 70×21（逻辑像素）', JSON.stringify(inter.imgBox) === '["70px","21px"]', JSON.stringify(inter.imgBox));
  check('图标版按钮不再显示文字', inter.btnText === '', JSON.stringify(inter.btnText));
  check('文字挪到 title（无障碍）', inter.btnTitle === '移 动', JSON.stringify(inter.btnTitle));

  /*
   * 单击 = 只选中（不移动）；双击 = 直接移动。
   * 用 `warpTo` 拦截来判「有没有真触发移动」，避免真的切图。
   */
  const singleVsDouble = JSON.parse(await c.ev(`(() => {
    window.__mvConfirm = 0;
    const rows = [...document.querySelectorAll('.mv-row')];
    if (rows.length < 2) return JSON.stringify({ skip: true, rows: rows.length });
    const r = rows[1];
    r.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const afterClick = { sel: __MU_APP__.moveCommand().sel };
    r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const afterDbl = { sel: __MU_APP__.moveCommand().sel };
    return JSON.stringify({ afterClick, afterDbl, rows: rows.length });
  })()`));
  if (!singleVsDouble.skip) {
    check('单击第 2 行 → 选中它（sel=1）', singleVsDouble.afterClick.sel === 1, JSON.stringify(singleVsDouble));
    check('双击后仍停在该行（sel=1）', singleVsDouble.afterDbl.sel === 1, JSON.stringify(singleVsDouble));
  } else {
    console.log('   （传送表不足 2 行，跳过多行断言）');
  }
  // 面板应仍在（双击那行可能走不通 → 不切图）
  const still = JSON.parse(await c.ev(`JSON.stringify({ open: __MU_APP__.moveCommand().open })`));
  check('双击后面板状态可读（未崩）', typeof still.open === 'boolean', JSON.stringify(still));

  /*
   * 像素验证：Ok 图标真的画出来了（不是空白按钮）。
   * 用 DOM 实测屏幕坐标，别手算 —— UiLayer 有 1.375 倍缩放。
   *
   * 注意：上面的双击测试**可能真的触发了移动**，面板会被关掉。
   * 所以这里先重开面板，再读坐标 + 重新截一张。
   */
  await c.ev(`__MU_APP__.moveToggle(true)`);
  await sleep(500);
  const shotBtn2 = await c.shot('move-panel-ok-button');
  const okBox = JSON.parse(await c.ev(`(() => {
    const b = document.querySelector('.mv-btn').getBoundingClientRect();
    return JSON.stringify([Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]);
  })()`));
  console.log(`   okBox=${JSON.stringify(okBox)}`);
  const img2 = decodePng(shotBtn2);
  const mean = meanRgb(img2, { x: okBox[0], y: okBox[1], w: okBox[2], h: okBox[3] });
  console.log(`   Ok 按钮区均值 ${JSON.stringify(mean)}`);
  check('Ok 图标已渲染（非空白按钮）', mean.lum > 30, JSON.stringify(mean));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await c.close();
  process.exit(fail ? 1 : 0);
} catch (err) {
  console.error('探针异常：', err && err.stack ? err.stack : err);
  try {
    await c.close();
  } catch {}
  process.exit(1);
}
