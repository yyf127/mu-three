/**
 * 长距离点击 / 连续点击 / 身后点击的轨迹诊断（不做 setPos，纯真实点击）。
 *
 *   node tools/click-trace.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const c = await createClient('clicktrace');

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
  return { x: +s.player.x.toFixed(2), y: +s.player.y.toFixed(2),
           last: m.lastCell, goal: m.goal, len: m.len, cursor: m.cursor,
           clear: m.clearReason, sent: m.sentCell, out: m.outSteps, blocked: m.blocked };
})())`;

const click = async (tx, ty) => {
  const scr = JSON.parse(await c.ev(PROJ(tx, ty)));
  await c.dragTo(scr[0], scr[1], scr[0], scr[1], 2);
  return scr;
};

const trace = async (ms, tag) => {
  const out = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = JSON.parse(await c.ev(ST));
    out.push(`${s.x},${s.y}(len${s.len}/${s.cursor}${s.clear ? ' ' + s.clear : ''})`);
    await sleep(250);
  }
  console.log(`  ${tag}: ${out.join(' → ')}`);
};

try {
  const who = await loginAs(c, '1234', '1234');
  await sleep(2500);
  const p0 = JSON.parse(await c.ev(ST));
  console.log(`\n角色 ${who.name} 起点 (${p0.x},${p0.y})`, p0);

  const bx = Math.round(p0.x);
  const by = Math.round(p0.y);

  console.log('\n[A] 远距离点击 (+4,+2)');
  console.log('  scr=', await click(bx + 4 + 0.5, by + 2 + 0.5));
  await trace(3000, '轨迹');
  let s = JSON.parse(await c.ev(ST));
  console.log(`  结果 pos=${s.x},${s.y} 期望=${bx + 4},${by + 2}`, s);

  console.log('\n[B] 走的过程中改点 (+0,+3)（模拟连续点击）');
  await click(bx + 4 + 0.5, by + 2 + 0.5);
  await sleep(500);
  const mid = JSON.parse(await c.ev(ST));
  console.log(`  半路 pos=${mid.x},${mid.y} len=${mid.len}`);
  const nowX = Math.round(mid.x);
  const nowY = Math.round(mid.y);
  await click(nowX + 0.5, nowY + 3 + 0.5);
  await trace(3000, '轨迹');
  s = JSON.parse(await c.ev(ST));
  console.log(`  结果 pos=${s.x},${s.y} 期望=${nowX},${nowY + 3}`, s);

  console.log('\n[C] 原地停稳后，逐个方向点身后一格（相对朝向 +0 反向）');
  for (const [dx, dy, label] of [
    [0, -1, '↑ 面北 → 点南'],
    [1, -1, '↗ 面东北 → 点西南'],
    [1, 0, '→ 面东 → 点西'],
    [0, 1, '↓ 面南 → 点北'],
    [-1, 1, '↙ 面西南 → 点东北'],
    [-1, 0, '← 面西 → 点东'],
  ]) {
    s = JSON.parse(await c.ev(ST));
    const cx = Math.round(s.x);
    const cy = Math.round(s.y);
    // 先朝这个方向走一格再回来，制造「面朝这个方向」的状态
    await click(cx + dx + 0.5, cy + dy + 0.5);
    await sleep(900);
    await click(cx + 0.5, cy + 0.5);
    await sleep(1200);
    const back = JSON.parse(await c.ev(ST));
    // 现在点身后
    await click(cx - dx + 0.5, cy - dy + 0.5);
    await sleep(1200);
    const aft = JSON.parse(await c.ev(ST));
    console.log(
      `  ${label}: 回位=${back.x},${back.y} → 身后(${cx - dx},${cy - dy}) 结果=${aft.x},${aft.y} ` +
        `${aft.x === cx - dx && aft.y === cy - dy ? '到达✔' : '失败✘'} goal=${
          aft.goal ? `${aft.goal.x},${aft.goal.y}` : '-'
        } len=${aft.len} clear=${aft.clear}`
    );
    if (!(aft.x === cx - dx && aft.y === cy - dy)) {
      const log = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.clickLog())'));
      for (const line of log) console.log('      ' + line);
    }
  }

  console.log('\n[D] 报文头（服务端最近发的）');
  console.log(' ', JSON.stringify((await c.ev('JSON.stringify(__MU_APP__.heads())')) || '').slice(0, 400));

  const errs = c.logs.filter(l => /\[exc\]/.test(l));
  console.log('\n[E] 异常:', errs.length ? errs.slice(-8).join('\n') : '（无）');
} finally {
  await c.close();
}
