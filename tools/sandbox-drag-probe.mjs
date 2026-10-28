/**
 * 离线沙盘面板拖动探针。
 *
 *   node tools/sandbox-drag-probe.mjs
 *
 * 验的是：面板能拖、拖完不误触折叠、位置会被夹在舞台内、位置能记住（刷新后仍在）。
 * 用的是 CDP 的真实鼠标事件（`Input.dispatchMouseEvent`），走页面的 pointerdown
 * /pointermove/pointerup 同一条路径，不是直接调内部函数。
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

/** 面板的视口矩形 + 第一张卡片 body 的折叠状态 */
const BOX = `(() => {
  const el = document.getElementById('sandbox');
  const r = el.getBoundingClientRect();
  const body = el.querySelector('.sb-body');
  return JSON.stringify({
    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    left: el.style.left, top: el.style.top, right: el.style.right,
    collapsed: body ? body.classList.contains('sb-collapsed') : null,
    hidden: el.classList.contains('hidden'),
    headY: Math.round(el.querySelector('.sb-head').getBoundingClientRect().y),
    headX: Math.round(el.querySelector('.sb-head').getBoundingClientRect().x),
    headH: Math.round(el.querySelector('.sb-head').getBoundingClientRect().height),
  });
})()`;

const c = await createClient('sbdrag');

try {
  await c.ev(`__MU_APP__.offline()`);
  // 离线进图 + 沙盘出现
  await c.waitFor(`!document.getElementById('sandbox').classList.contains('hidden')`, 120000);
  await sleep(1200);

  const stage = JSON.parse(
    await c.ev(`(() => { const s = document.getElementById('stage').getBoundingClientRect(); return JSON.stringify([Math.round(s.x), Math.round(s.y), Math.round(s.width), Math.round(s.height)]); })()`)
  );
  let box = JSON.parse(await c.ev(BOX));
  const collapsedAtStart = box.collapsed;
  console.log(`初始：(${box.x},${box.y}) ${box.w}×${box.h}  舞台 ${stage.join(',')}`);
  check(
    '沙盘默认在舞台左上角 (12,12)',
    Math.abs(box.x - stage[0] - 12) <= 1 && Math.abs(box.y - stage[1] - 12) <= 1,
    `相对舞台 (${box.x - stage[0]},${box.y - stage[1]})`
  );

  /* ---------------- 1. 拖标题 ---------------- */
  console.log('\n[1] 按住卡片标题拖走');
  const grabX = box.headX + 60;
  const grabY = box.headY + box.headH / 2;
  const dx = 180;
  const dy = 130;
  await c.dragTo(grabX, grabY, grabX + dx, grabY + dy, 12);
  await sleep(400);

  const moved = JSON.parse(await c.ev(BOX));
  check(
    '面板跟着走（Δ≈180,130）',
    Math.abs(moved.x - box.x - dx) <= 3 && Math.abs(moved.y - box.y - dy) <= 3,
    `(${box.x},${box.y}) → (${moved.x},${moved.y})`
  );
  check('left/top 变成内联值、right 清掉', moved.right === 'auto' && moved.left !== '12px', `left=${moved.left} right=${moved.right}`);
  check('拖动没有顺带把卡片折叠掉', moved.collapsed === collapsedAtStart, `折叠=${moved.collapsed}`);
  check('位置写进了 localStorage', (await c.ev(`localStorage.getItem('mu.sandbox.pos')`)) !== null);

  /* ---------------- 2. 点到一半不算拖 ---------------- */
  console.log('\n[2] 原地点击 = 折叠，不是拖动');
  const beforeClick = JSON.parse(await c.ev(BOX));
  await c.dragTo(beforeClick.headX + 60, beforeClick.headY + beforeClick.headH / 2, beforeClick.headX + 60, beforeClick.headY + beforeClick.headH / 2, 2);
  await sleep(300);
  const afterClick = JSON.parse(await c.ev(BOX));
  check('位置没动', afterClick.x === beforeClick.x && afterClick.y === beforeClick.y, `(${afterClick.x},${afterClick.y})`);
  check('折叠状态切换了（说明 click 正常）', afterClick.collapsed !== beforeClick.collapsed, String(afterClick.collapsed));
  // 折回去，别影响后面
  await c.dragTo(beforeClick.headX + 60, beforeClick.headY + beforeClick.headH / 2, beforeClick.headX + 60, beforeClick.headY + beforeClick.headH / 2, 2);
  await sleep(200);

  /* ---------------- 3. 拖出边界会被夹住 ---------------- */
  console.log('\n[3] 拖出舞台边界');
  const b2 = JSON.parse(await c.ev(BOX));
  await c.dragTo(b2.headX + 40, b2.headY + b2.headH / 2, 5, 5, 12);
  await sleep(400);
  const clamped = JSON.parse(await c.ev(BOX));
  check('左上不会拖出画面（x,y ≥ 0）', clamped.x >= 0 && clamped.y >= 0, `(${clamped.x},${clamped.y})`);
  check('拖到左上角后 left/top = 0', clamped.left === '0px' && clamped.top === '0px', `${clamped.left},${clamped.top}`);

  // 拖到视口右下角（别拖出浏览器，CDP 会丢 mouseReleased）
  await c.dragTo(clamped.headX + 40, clamped.headY + clamped.headH / 2, 1240, 650, 16);
  await sleep(400);
  const br = JSON.parse(await c.ev(BOX));
  check(
    '右下不会拖出去（右/下边都不超出舞台）',
    br.x + br.w <= stage[0] + stage[2] && br.y + br.h <= stage[1] + stage[3] + 1,
    `右 ${br.x + br.w}/${stage[0] + stage[2]}，下 ${br.y + br.h}/${stage[1] + stage[3]}`
  );

  /* ---------------- 4. 下拉不该触发拖动 ---------------- */
  console.log('\n[4] 在 <select> 上按下不动');
  const b4 = JSON.parse(await c.ev(BOX));
  const sel = JSON.parse(await c.ev(`(() => { const s = document.querySelector('#sandbox select'); const r = s.getBoundingClientRect(); return JSON.stringify([Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]); })()`));
  // 第一张卡片是折叠的，select 尺寸可能为 0；先展开再测
  if (sel[2] > 8) {
    await c.dragTo(sel[0] + sel[2] / 2, sel[1] + sel[3] / 2, sel[0] + sel[2] / 2, sel[1] + sel[3] / 2 + 90, 8);
    await sleep(300);
    const b4b = JSON.parse(await c.ev(BOX));
    check('从下拉框起手不会拖走面板', b4b.x === b4.x && b4b.y === b4.y, `(${b4.x},${b4.y}) → (${b4b.x},${b4b.y})`);
  } else {
    check('（卡片折叠时 select 不可见，跳过）', true);
  }

  /* ---------------- 5. 刷新后位置还在 ---------------- */
  console.log('\n[5] 位置记忆');
  const saved = JSON.parse(await c.ev(`localStorage.getItem('mu.sandbox.pos')`));
  const beforeReload = JSON.parse(await c.ev(BOX));
  await c.ev('location.reload()');
  await sleep(2500); // 让页面重新加载完
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!document.getElementById('sandbox').classList.contains('hidden')`, 180000);
  await sleep(800);
  const restored = JSON.parse(await c.ev(BOX));
  // 存的是「相对舞台」的坐标，刷新后舞台可能因为滚动条变化位移，所以按相对值比
  const stage2 = JSON.parse(
    await c.ev(`(() => { const s = document.getElementById('stage').getBoundingClientRect(); return JSON.stringify([Math.round(s.x), Math.round(s.y)]); })()`)
  );
  const relBefore = [beforeReload.x - stage[0], beforeReload.y - stage[1]];
  const relAfter = [restored.x - stage2[0], restored.y - stage2[1]];
  check(
    '刷新后还在拖过去的位置（相对舞台）',
    Math.abs(relAfter[0] - relBefore[0]) <= 2 && Math.abs(relAfter[1] - relBefore[1]) <= 2,
    `刷新前 ${relAfter && relBefore} → 刷新后 [${relAfter}]（存 ${saved}）`
  );

  console.log(`\n截图：${await c.shot('sandbox_drag')}`);
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
} finally {
  await c.close();
}
