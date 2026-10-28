/**
 * 光标探针（离线，不连服务端）。
 *
 *   node tools/cursor-probe.mjs
 *
 * 验三件事：
 *   1. 9 种 `Data/Interface/Cursor*.ozt` 都载入并烘焙成 dataURL（talk/eye 是 2×2 动画）；
 *   2. 指到怪身上 → attack、指到地面 → arrow（默认箭头）；
 *   3. 按住左键 → 可走 push / 不可走 dontmove。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? `  ${detail}` : ''}`);
  }
};

const c = await createClient('cursor');

const PROJ = (x, y, z) => `(() => {
  const cam = __MU__.muCamera.camera; const V = cam.position.constructor;
  const v = new V(${x}, ${y}, ${z}).project(cam);
  const cv = document.querySelector('#app canvas'); const r = cv.getBoundingClientRect();
  return JSON.stringify([r.left + (v.x*0.5+0.5)*r.width, r.top + (-v.y*0.5+0.5)*r.height]);
})()`;

const CS = `document.body.style.cursor`;

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '离线进图');
  await c.waitFor(`!!__MU_APP__.state().player`, 60000, '角色就绪');
  await c.waitFor(`__MU_APP__.cursor().ready === true`, 30000, '光标烘焙完成');
  await sleep(1200);

  // ---------- A. 载入 ----------
  console.log('\n[A] 贴图载入');
  const info = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.cursor())'));
  console.log('  ', info.kinds.join('  '), `scale=${info.scale}`);
  check('9 种光标全部载入（含 eye）', info.kinds.length === 10, `${info.kinds.length} 种`);
  check('talk 是 2×2 动画（6 帧）', /talk:6/.test(info.kinds.join(',')), info.kinds.find(k => k.startsWith('talk')));
  check('默认箭头是单帧', /arrow:1/.test(info.kinds.join(',')), info.kinds.find(k => k.startsWith('arrow')));
  // 先动一下鼠标：光标是在 pointermove 里贴上去的（F12 刚打开时不动鼠标本来就没换）
  const st = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
  const gh = await c.ev(`__MU__.terrain.getHeight(${st.player.x + 2}, ${st.player.y + 1})`);
  const gp = JSON.parse(await c.ev(PROJ(st.player.x + 2, st.player.y + 1, gh)));
  await c.ptr('mouseMoved', gp[0], gp[1], { buttons: 0 });
  await sleep(300);
  const css0 = await c.ev(CS);
  check('canvas 已经贴上 url(data:image/png) 光标', /^url\("?data:image\/png/.test(css0 || ''), (css0 || '').slice(0, 40));

  // ---------- B. 指到地面 / 怪 ----------
  console.log('\n[B] hover 切换');
  const onGround = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.cursor())'));
  check('指到地面 → 鼠标下没有实体', onGround.hover === null, JSON.stringify(onGround.hover));

  // 离线没有真怪：塞一条 0x13 视野包，造一只在自己旁边
  await c.ev(`__MU_APP__.testMonster(1, ${Math.round(st.player.x) + 2}, ${Math.round(st.player.y)}, 0x7f11)`);
  await sleep(2500);
  const ents = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.remotesInfo().entities)'));
  const mon = ents.find(e => !e.dying);
  if (mon) {
    const mz = await c.ev(`__MU__.terrain.getHeight(${mon.x}, ${mon.y})`);
    const mp = JSON.parse(await c.ev(PROJ(mon.x, mon.y, mz + 0.9)));
    await c.ptr('mouseMoved', mp[0], mp[1], { buttons: 0 });
    await sleep(300);
    const onMon = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.cursor())'));
    const cssMon = await c.ev(CS);
    check(
      `指到 ${mon.kind} #${mon.id} → 识别为实体`,
      onMon.hover !== null && onMon.hover.id === mon.id,
      JSON.stringify(onMon.hover)
    );
    check('光标换成攻击样式', cssMon !== css0, onMon.hover ? onMon.hover.kind : '-');
  } else {
    console.log('  · 离线场景没有实体，跳过');
  }

  // ---------- C. 按住左键 ----------
  console.log('\n[C] 按住左键：push / dontmove');
  // 挪到远离那只怪的空白地面（怪的包围盒会盖住旁边一格，别拿它当空地）
  const freeX = Math.round(st.player.x) - 2;
  const freeY = Math.round(st.player.y) - 2;
  const freeH = await c.ev(`__MU__.terrain.getHeight(${freeX}, ${freeY})`);
  const fp = JSON.parse(await c.ev(PROJ(freeX, freeY, freeH)));
  await c.ptr('mouseMoved', fp[0], fp[1], { buttons: 0 });
  await sleep(250);
  const hoverFree = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.cursor())'));
  check('空白地面 → 无实体（箭头）', hoverFree.hover === null, JSON.stringify(hoverFree.hover));
  const cssArrow = await c.ev(CS);
  await c.ptr('mousePressed', fp[0], fp[1], { buttons: 1 });
  await sleep(150);
  const down = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.cursor())'));
  const cssDown = await c.ev(CS);
  await c.ptr('mouseReleased', fp[0], fp[1], { buttons: 0 });
  await sleep(200);
  const cssUp = await c.ev(CS);
  check('按下左键后 lmbDown = true', down.lmbDown === true, String(down.lmbDown));
  check('按住时换成 push 光标', cssDown !== cssArrow, `${(cssArrow || '').length} → ${(cssDown || '').length} 字节`);
  check('松开后回到箭头', cssUp === cssArrow, `${(cssUp || '').length} 字节`);

  // ---------- D. 右键：点一下 = 技能（不转镜头），拖动 = 转镜头 ----------
  console.log('\n[D] 右键分流（技能 vs 转镜头）');
  const fw = async () => JSON.parse(await c.ev('JSON.stringify(__MU__.muCamera.getForward())'));
  const f0 = await fw();
  // 1) 原地按下 / 松开（没有位移）→ 不该转镜头
  await c.ptr('mousePressed', fp[0], fp[1], { button: 'right', buttons: 2 });
  await sleep(120);
  await c.ptr('mouseReleased', fp[0], fp[1], { button: 'right', buttons: 0 });
  await sleep(220);
  const f1 = await fw();
  check(
    '右键单击不转镜头（走技能分支）',
    Math.hypot(f1.x - f0.x, f1.y - f0.y) < 1e-6,
    `forward ${f0.x.toFixed(3)},${f0.y.toFixed(3)} → ${f1.x.toFixed(3)},${f1.y.toFixed(3)}`
  );
  // 2) 按下后横向拖 60px → 转镜头
  await c.ptr('mousePressed', fp[0], fp[1], { button: 'right', buttons: 2 });
  for (let i = 1; i <= 6; i++) {
    await c.ptr('mouseMoved', fp[0] + i * 10, fp[1], { button: 'right', buttons: 2 });
    await sleep(20);
  }
  await c.ptr('mouseReleased', fp[0] + 60, fp[1], { button: 'right', buttons: 0 });
  await sleep(220);
  const f2 = await fw();
  check(
    '右键拖动仍然转镜头',
    Math.hypot(f2.x - f1.x, f2.y - f1.y) > 1e-4,
    `forward ${f1.x.toFixed(3)},${f1.y.toFixed(3)} → ${f2.x.toFixed(3)},${f2.y.toFixed(3)}`
  );

  // ---------- E. UI 面板上也要是游戏光标 ----------
  console.log('\n[E] 面板（背包/小地图）上的光标');
  await c.ev(`__MU_APP__.toggleInventory(true)`);
  await sleep(500);
  const panel = JSON.parse(
    await c.ev(`(() => {
      const el = document.querySelector('.minimap') || document.querySelector('#app .ui');
      if (!el) return JSON.stringify(null);
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return JSON.stringify({
        x: cx, y: cy,
        hit: hit ? (hit.tagName.toLowerCase() + (hit.className ? '.' + String(hit.className).split(' ')[0] : '')) : null,
        hitCursor: hit ? getComputedStyle(hit).cursor.slice(0, 24) : null,
      });
    })()`)
  );
  if (panel) {
    await c.ptr('mouseMoved', panel.x, panel.y, { buttons: 0 });
    await sleep(260);
    const bodyCss = await c.ev(CS);
    const onClass = await c.ev(`document.body.classList.contains('mu-custom-cursor')`);
    check('body 上挂着游戏光标（全局面板生效）', /^url\("?data:image\/png/.test(bodyCss || ''), (bodyCss || '').slice(0, 30));
    check('body 已标记 mu-custom-cursor', onClass === true, String(onClass));
    check(
      `面板元素的光标被 inherit 覆盖（${panel.hit}）`,
      /url\(/.test(panel.hitCursor || ''),
      panel.hitCursor || '(无)'
    );
    const st2 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.cursor())'));
    check('面板上不残留 hover 实体', st2.hover === null, JSON.stringify(st2.hover));
    await c.ev(`__MU_APP__.toggleInventory(false)`);
  }

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  const errs = c.logs.filter(l => /\[exc\]/.test(l));
  if (errs.length) console.log('异常:\n' + errs.slice(-6).join('\n'));
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
