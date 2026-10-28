/**
 * 启动画面 / 读条画面的探针。
 *
 *   node tools/splash-probe.mjs
 *
 * 验的是原版两张位图的**位置和尺寸**（全部来自源码常量，不是我瞎调的）：
 *
 *   `Scene_Intro.cpp`   Webzenlogo `(640*0.5-128, 640*0.375-97.5)` = (192, 142.5) 256×195
 *                       Everyone   `(640-120, 0)`               = (520, 0)     120×60
 *   `Scene_Loading.cpp` Loading01  (0,100) 256×256
 *                       Loading02  (256,100) 128×256
 *                       Loading03  (384,100) 256×256
 *
 * 逻辑层是 640×480 加 `scale()`，所以量 `getBoundingClientRect()` 时
 * 要除以 `window.__MU_SPLASH_SCALE__`（= stage.clientWidth / 640）。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('splash');
const ev = e => c.ev(e);
const shot = async f => {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(f, Buffer.from(r.data, 'base64'));
};

/** 逻辑坐标（除以整层缩放） */
const boxes = async ids =>
  JSON.parse(
    await ev(`(() => {
      const stage = document.getElementById('stage');
      const scale = (stage.clientWidth || 640) / 640;
      // 舞台是居中定位的，getBoundingClientRect 含舞台原点 → 先减掉再除以缩放
      const sr = stage.getBoundingClientRect();
      const out = {};
      for (const id of ${JSON.stringify(ids)}) {
        const el = document.getElementById(id);
        if (!el) { out[id] = null; continue; }
        const r = el.getBoundingClientRect();
        const has = (el.style.backgroundImage || 'none') !== 'none';
        out[id] = {
          left: +((r.left - sr.left) / scale).toFixed(1),
          top: +((r.top - sr.top) / scale).toFixed(1),
          w: +(r.width / scale).toFixed(1),
          h: +(r.height / scale).toFixed(1),
          painted: has,
          shown: el.style.display !== 'none',
        };
      }
      return JSON.stringify({ scale: +scale.toFixed(4), out });
    })()`)
  );

try {
  // 页面刚起来，启动画面应该在
  await c.waitFor(`!document.getElementById('intro').classList.contains('hidden')`, 8000, '启动画面出现');
  await sleep(700);

  const a = await boxes(['intro-logo', 'intro-esrb']);
  console.log('启动画面 scale =', a.scale);
  console.log('  Webzenlogo', JSON.stringify(a.out['intro-logo']), '（期望 left 192, top 142.5, 256×195）');
  console.log('  Everyone  ', JSON.stringify(a.out['intro-esrb']), '（期望 left 520, top 0, 120×60）');
  await shot('shots/intro-splash.png');

  const logoOk =
    a.out['intro-logo'] &&
    a.out['intro-logo'].painted &&
    Math.abs(a.out['intro-logo'].left - 192) < 1.5 &&
    Math.abs(a.out['intro-logo'].top - 142.5) < 1.5 &&
    Math.abs(a.out['intro-logo'].w - 256) < 1.5 &&
    Math.abs(a.out['intro-logo'].h - 195) < 1.5;
  const esrbOk =
    a.out['intro-esrb'] &&
    a.out['intro-esrb'].painted &&
    Math.abs(a.out['intro-esrb'].left - 520) < 1.5 &&
    Math.abs(a.out['intro-esrb'].w - 120) < 1.5;
  console.log(logoOk ? '  ✓ logo 位置/尺寸/贴图都对' : '  ✗ logo 不对');
  console.log(esrbOk ? '  ✓ Everyone 位置/尺寸/贴图都对' : '  ✗ Everyone 不对');

  // 点一下就跳过
  await c.ptr('mousePressed', 320, 240);
  await sleep(30);
  await c.ptr('mouseReleased', 320, 240);
  await c.waitFor(`document.getElementById('intro').classList.contains('hidden')`, 5000, '点击跳过启动画面');
  console.log('  ✓ 点一下跳过');
  await c.waitFor(`!!document.getElementById('login-account')`, 8000, '登录界面');

  // 进游戏，读条画面
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 90000, '选角');
  await sleep(2200);
  await ev(`(() => { const b = document.querySelectorAll('.char-card')[3]; b && b.click(); })()`);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);

  // 读条画面只存在几秒，抢一张截图
  let captured = false;
  for (let i = 0; i < 40; i++) {
    const vis = await ev(`!document.getElementById('loading').classList.contains('hidden')`);
    if (vis) {
      await sleep(900);
      const b = await boxes(['ld-t1', 'ld-t2', 'ld-t3', 'loading-fill', 'loading-msg']);
      console.log('读条画面 scale =', b.scale);
      for (const id of ['ld-t1', 'ld-t2', 'ld-t3']) {
        console.log(`  ${id}`, JSON.stringify(b.out[id]));
      }
      console.log('  进度条', JSON.stringify(b.out['loading-fill']), JSON.stringify(b.out['loading-msg']));
      await shot('shots/loading-screen.png');
      const t = b.out['ld-t1'] || {};
      const t2 = b.out['ld-t2'] || {};
      const t3 = b.out['ld-t3'] || {};
      const tilesOk =
        t.painted && Math.abs(t.left - 0) < 1.5 && Math.abs(t.top - 100) < 1.5 && Math.abs(t.w - 256) < 1.5 && Math.abs(t.h - 256) < 1.5 &&
        t2.painted && Math.abs(t2.left - 256) < 1.5 && Math.abs(t2.w - 128) < 1.5 &&
        t3.painted && Math.abs(t3.left - 384) < 1.5 && Math.abs(t3.w - 256) < 1.5;
      console.log(tilesOk ? '  ✓ 三张 Loading 位置/尺寸/贴图都对（0/256/384, y=100, 256/128/256×256）' : '  ✗ Loading 拼图不对');
      captured = true;
      break;
    }
    await sleep(400);
  }
  if (!captured) console.log('  ✗ 没抢到读条画面（进图太快？）');

  await c.waitFor(`__MU_APP__.state().mapId !== null`, 120000, '进图');
  console.log('  ✓ 进游戏', JSON.stringify((await ev(`JSON.stringify(__MU_APP__.state().mapName)`))));
  console.log(logoOk && esrbOk && captured ? 'PASS' : 'FAIL');
} finally {
  await c.close();
}
