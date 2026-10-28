/**
 * 「点地面完全没反应 / 只差某些方向」诊断探针。
 *
 *   node tools/click-diag.mjs
 *
 * 只打印，不做断言：看看到底是点击没进 walkToCell、还是进了但第一次
 * `canEnter` 就否掉、还是服务端纠偏把位置拉回去了。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const c = await createClient('clickdiag');

const PROJ = (x, y) => `(() => {
  const cam = __MU__.muCamera.camera;
  const V = cam.position.constructor;
  const h = __MU__.terrain.getHeight(${x}, ${y});
  const v = new V(${x}, ${y}, h).project(cam);
  const cv = document.querySelector('#app canvas');
  const r = cv.getBoundingClientRect();
  return JSON.stringify([r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height]);
})()`;

const ST = `JSON.stringify((() => {
  const s = __MU_APP__.state(); const m = __MU_APP__.moveInfo();
  return { x: +s.player.x.toFixed(3), y: +s.player.y.toFixed(3),
           last: m.lastCell, goal: m.goal, len: m.len, cursor: m.cursor,
           clear: m.clearReason, sent: m.sentCell, dir: m.dir };
})())`;

try {
  const who = await loginAs(c, '1234', '1234');
  await sleep(2500);
  const p0 = JSON.parse(await c.ev(ST));
  const bx = Math.round(p0.x);
  const by = Math.round(p0.y);
  console.log(`\n角色 ${who.name} 起点 (${bx},${by})`, p0);

  console.log('\n[A] 8 方向逐个真实点击（每次先 setPos 回原点）');
  const dirs = [
    [0, -1, 'N  ↑'],
    [1, -1, 'NE ↗'],
    [1, 0, 'E  →'],
    [1, 1, 'SE ↘'],
    [0, 1, 'S  ↓'],
    [-1, 1, 'SW ↙'],
    [-1, 0, 'W  ←'],
    [-1, -1, 'NW ↖'],
  ];
  for (const [dx, dy, label] of dirs) {
    await c.ev(`__MU_APP__.setPos(${bx}, ${by})`);
    await sleep(500);
    const tx = bx + dx;
    const ty = by + dy;
    const stand = await c.ev(`__MU_APP__.canStand(${tx}, ${ty})`);
    const pathLen = await c.ev(`__MU_APP__.pathTo(${tx}, ${ty})`);
    const scr = JSON.parse(await c.ev(PROJ(tx + 0.5, ty + 0.5)));
    const before = JSON.parse(await c.ev(ST));
    await c.dragTo(scr[0], scr[1], scr[0], scr[1], 2);
    await sleep(1200);
    const after = JSON.parse(await c.ev(ST));
    const moved = Math.abs(after.x - bx) > 0.01 || Math.abs(after.y - by) > 0.01;
    console.log(
      `  ${label} (${tx},${ty}) stand=${stand} pathLen=${pathLen} ` +
        `screen=(${scr[0].toFixed(0)},${scr[1].toFixed(0)}) ` +
        `goal=${
          after.goal ? `${after.goal.x},${after.goal.y}` : '-'
        } len=${after.len} clear=${after.clear} ` +
        `pos=${after.x},${after.y} ${moved ? '移动✔' : '没动✘'}`
    );
  }

  console.log('\n[B] 远距离点击（原点 +5,+3）');
  await c.ev(`__MU_APP__.setPos(${bx}, ${by})`);
  await sleep(500);
  {
    const tx = bx + 5;
    const ty = by + 3;
    const pathLen = await c.ev(`__MU_APP__.pathTo(${tx}, ${ty})`);
    const scr = JSON.parse(await c.ev(PROJ(tx + 0.5, ty + 0.5)));
    await c.dragTo(scr[0], scr[1], scr[0], scr[1], 2);
    await sleep(2500);
    const after = JSON.parse(await c.ev(ST));
    console.log(`  target (${tx},${ty}) pathLen=${pathLen} → pos=${after.x},${after.y} clear=${after.clear}`);
  }

  console.log('\n[C] 屏幕各处点击（不投影，直接按画布网格随机点 6 处）');
  for (const [fx, fy] of [
    [0.35, 0.55],
    [0.5, 0.55],
    [0.65, 0.55],
    [0.5, 0.45],
    [0.5, 0.65],
    [0.4, 0.7],
  ]) {
    await c.ev(`__MU_APP__.setPos(${bx}, ${by})`);
    await sleep(400);
    const rect = JSON.parse(
      await c.ev(
        `(() => { const r = document.querySelector('#app canvas').getBoundingClientRect(); return JSON.stringify({l:r.left,t:r.top,w:r.width,h:r.height}); })()`
      )
    );
    const sx = rect.l + rect.w * fx;
    const sy = rect.t + rect.h * fy;
    await c.dragTo(sx, sy, sx, sy, 2);
    await sleep(1200);
    const after = JSON.parse(await c.ev(ST));
    console.log(
      `  (${fx},${fy}) → goal=${after.goal ? `${after.goal.x},${after.goal.y}` : '-'} len=${after.len} pos=${after.x},${after.y} clear=${after.clear}`
    );
  }

  console.log('\n[D] 控制台/异常日志');
  const errs = c.logs.filter(l => /\[exc\]|error|Error/.test(l));
  console.log(errs.length ? errs.slice(-15).join('\n') : '  （无）');
} finally {
  await c.close();
}
