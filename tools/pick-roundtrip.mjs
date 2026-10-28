/**
 * 「点地面 → 落到哪一格」往返校验（离线，不连服务端，不会和别人抢账号）。
 *
 *   node tools/pick-roundtrip.mjs
 *
 * 做法：把角色周围 9×9 的格心投影到屏幕，再把那个屏幕坐标喂回
 * `__MU_APP__.pickScreen()`（和 pointerdown 完全同一条换算），
 * 看还原出来的是不是**同一格**。
 *
 * 同时量出「一格在屏幕上多少像素」，以及从角色脚下往外挪 0.3 / 0.5 格时
 * 落点会落在哪一格 —— 用来判断「点身后一格」到底是用户点在角色身上，
 * 还是拾取本身偏了。
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

const c = await createClient('roundtrip');

const PROJ = (x, y) => `(() => {
  const cam = __MU__.muCamera.camera; const V = cam.position.constructor;
  const h = __MU__.terrain.getHeight(${x}, ${y});
  const v = new V(${x}, ${y}, h).project(cam);
  const cv = document.querySelector('#app canvas'); const r = cv.getBoundingClientRect();
  return JSON.stringify([r.left + (v.x*0.5+0.5)*r.width, r.top + (-v.y*0.5+0.5)*r.height, r.width, r.height]);
})()`;

try {
  // 离线模式：点开始界面的「离线演示」，不连 GameServer
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '离线进图');
  await c.waitFor(`!!__MU_APP__.state().player`, 60000, '角色就绪');
  await sleep(2000);
  const st = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.state())`));
  const bx = Math.round(st.player.x);
  const by = Math.round(st.player.y);
  console.log(`\n离线角色起点 (${bx},${by})`);

  // 一格在屏幕上多少像素（沿两个方向量）
  const p0 = JSON.parse(await c.ev(PROJ(bx + 0.5, by + 0.5)));
  const px = JSON.parse(await c.ev(PROJ(bx + 1.5, by + 0.5)));
  const py = JSON.parse(await c.ev(PROJ(bx + 0.5, by + 1.5)));
  console.log(
    `  一格像素：+x → (${(px[0] - p0[0]).toFixed(0)},${(px[1] - p0[1]).toFixed(0)})  ` +
      `+y → (${(py[0] - p0[0]).toFixed(0)},${(py[1] - p0[1]).toFixed(0)})`
  );
  const cellPx = Math.hypot(px[0] - p0[0], px[1] - p0[1]);
  console.log(`  一格 ≈ ${cellPx.toFixed(0)}px`);

  // ---------- A. 往返：格心 → 屏幕 → 拾取 ----------
  console.log('\n[A] 格心投影 → 拾取 往返');
  let ok = 0;
  let bad = [];
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const tx = bx + dx;
      const ty = by + dy;
      const scr = JSON.parse(await c.ev(PROJ(tx + 0.5, ty + 0.5)));
      if (scr[0] < 5 || scr[1] < 5 || scr[0] > scr[2] - 5 || scr[1] > scr[3] - 5) continue;
      const got = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.pickScreen(${scr[0]}, ${scr[1]}))`));
      if (!got) {
        bad.push(`(${tx},${ty}) → 射线打空`);
        continue;
      }
      const same = got.cell[0] === tx && got.cell[1] === ty;
      const near = Math.hypot(got.x - (tx + 0.5), got.y - (ty + 0.5));
      if (same && near < 0.2) ok++;
      else bad.push(`(${tx},${ty}) → ${got.x},${got.y} cell=${got.cell} 偏${near.toFixed(2)}格`);
    }
  }
  check(`往返一致（±0.2 格内）`, bad.length === 0, `${ok} 格一致，${bad.length} 格异常`);
  for (const b of bad.slice(0, 8)) console.log('     ' + b);

  // ---------- B. 从角色脚下往外挪，落在哪一格 ----------
  console.log('\n[B] 角色脚下往外挪（判断「点身后一格」到底点到了哪）');
  const feet = JSON.parse(await c.ev(PROJ(bx + 0.5, by + 0.5)));
  for (const [ox, oy, label] of [
    [0, 0.3, '身后 0.3 格'],
    [0, 0.5, '身后 0.5 格'],
    [0, 0.7, '身后 0.7 格'],
    [0, 1.0, '身后 1.0 格'],
    [0.5, 0, '右侧 0.5 格'],
    [0, -0.5, '前方 0.5 格'],
  ]) {
    const scr = JSON.parse(await c.ev(PROJ(bx + 0.5 + ox, by + 0.5 + oy)));
    const got = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.pickScreen(${scr[0]}, ${scr[1]}))`));
    const dst = got ? Math.hypot(got.x - (bx + 0.5), got.y - (by + 0.5)) : -1;
    console.log(
      `  ${label}: 屏幕(${scr[0].toFixed(0)},${scr[1].toFixed(0)}) → ${got ? `${got.x},${got.y} cell=${got.cell}` : '打空'}` +
        `  与脚下距离=${dst.toFixed(2)}  ${got && (got.cell[0] !== bx || got.cell[1] !== by) ? '→ 相邻格✔' : '→ 还是自己这格（点了等于没点）'}`
    );
  }

  // ---------- C. 真实点击：离脚下多远才「迈一步」 ----------
  console.log('\n[C] 真实鼠标点击（点在自己这一格内也要有反应）');
  const cases = [
    [0, 0.0, '正脚下'],
    [0, 0.1, '脚下 0.1 格'],
    [0, 0.2, '脚下 0.2 格'],
    [0, 0.3, '身后 0.3 格'],
    [0, 0.5, '身后 0.5 格'],
    [0, 0.8, '身后 0.8 格'],
    [0.35, 0, '右侧 0.35 格'],
    [-0.35, 0, '左侧 0.35 格'],
  ];
  for (const [ox, oy, label] of cases) {
    await c.ev('__MU_APP__.clearClickLog()');
    const cur = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.state())`));
    const cx = Math.round(cur.player.x);
    const cy = Math.round(cur.player.y);
    const scr = JSON.parse(await c.ev(PROJ(cx + 0.5 + ox, cy + 0.5 + oy)));
    await c.dragTo(scr[0], scr[1], scr[0], scr[1], 2);
    await sleep(500);
    const log = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.clickLog())'));
    const g = log.find(l => l.trim().startsWith('ground')) || '(无)';
    const m = /goal=(-|[\d,]+)/.exec(g);
    const goal = m && m[1] !== '-' ? m[1] : null;
    console.log(`  ${label.padEnd(12)} 屏幕(${scr[0].toFixed(0)},${scr[1].toFixed(0)})  ${g.trim()}`);
    if (label !== '正脚下') {
      check(`${label} → 有目标格`, goal !== null, goal ?? '没有目标（点了等于没点）');
    }
    // 复位到原点（离线模式 setPos 不会影响别人）
    await c.ev(`__MU_APP__.setPos(${cx}, ${cy})`);
    await sleep(300);
  }

  // ---------- D. 「点第二格却去第三格」专项 ----------
  console.log('\n[D] 每个相邻格里点 3 个位置（中心 / 靠自己一侧 / 远离自己一侧）');
  let dOk = 0;
  let dBad = [];
  for (const [dx, dy] of [
    [0, 1],
    [1, 1],
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, -1],
    [-1, 0],
    [-1, 1],
  ]) {
    const bx2 = Math.round(JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.state())`)).player.x);
    const by2 = Math.round(JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.state())`)).player.y);
    const tx = bx2 + dx;
    const ty = by2 + dy;
    for (const t of [0, -0.3, 0.3]) {
      const wx = tx + 0.5 + dx * t;
      const wy = ty + 0.5 + dy * t;
      const scr = JSON.parse(await c.ev(PROJ(wx, wy)));
      if (scr[0] < 5 || scr[1] < 5 || scr[0] > scr[2] - 5 || scr[1] > scr[3] - 5) continue;
      const got = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.pickScreen(${scr[0]}, ${scr[1]}))`));
      const same = got && got.cell[0] === tx && got.cell[1] === ty;
      if (same) dOk++;
      else dBad.push(`点(${wx.toFixed(1)},${wy.toFixed(1)}) 期望格(${tx},${ty}) 实际=${got ? got.cell : '打空'}`);
    }
  }
  check('相邻格里任意位置都识别成这一格', dBad.length === 0, `${dOk} 次正确，${dBad.length} 次串格`);
  for (const b of dBad.slice(0, 10)) console.log('     ' + b);

  // ---------- E. 走一段：跨格口径是否和视觉一致 ----------
  console.log('\n[E] 走 3 格，采样「所在格」是否等于视觉格');
  {
    const s0 = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.state())`));
    const cx = Math.round(s0.player.x);
    const cy = Math.round(s0.player.y);
    const scr = JSON.parse(await c.ev(PROJ(cx + 3.5, cy + 0.5)));
    await c.dragTo(scr[0], scr[1], scr[0], scr[1], 2);
    let bad = 0;
    let samples = 0;
    for (let i = 0; i < 25; i++) {
      await sleep(160);
      const m = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.moveInfo ? {last: __MU_APP__.moveInfo().lastCell, s: __MU_APP__.state()} : null)`));
      if (!m) break;
      const wantX = Math.round(m.s.player.x);
      const wantY = Math.round(m.s.player.y);
      samples++;
      if (m.last.x !== wantX || m.last.y !== wantY) {
        bad++;
        if (bad < 4) console.log(`     ${m.s.player.x},${m.s.player.y} → lastCell=${m.last.x},${m.last.y}（应为 ${wantX},${wantY}）`);
      }
      if (m.s.pathLeft === 0) break;
    }
    check('走的过程中 lastCell 始终 = 视觉所在格', bad === 0, `${samples} 次采样，${bad} 次不一致`);
  }

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
