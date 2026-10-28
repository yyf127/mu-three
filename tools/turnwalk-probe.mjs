/**
 * 「先转身、再走过去」探针（8 方向）。
 *
 *   node tools/turnwalk-probe.mjs          # 软件渲染（帧率低，只看逻辑）
 *   MU_GPU=1 node tools/turnwalk-probe.mjs # 硬件渲染（真实帧率）
 *
 * 每一步断言三件事：
 *   1. 点下去**同一帧**朝向就已经掰到目标方向（不是走两步才转过来）；
 *   2. 位移方向 = 目标方向（不会先往反方向滑半步）；
 *   3. 最终停在目标格上（差 < 0.05）。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

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

const c = await createClient('turnwalk');

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
  return { x: +s.player.x.toFixed(3), y: +s.player.y.toFixed(3), yaw: s.player.yaw,
           act: s.player.action, len: m.len, cur: m.cursor, dir: m.dir, clear: m.clearReason,
           goal: m.goal };
})())`;

try {
  /*
   * 默认离线（点「离线演示」）—— 不连 GameServer，不会和正在玩的人抢账号。
   * 需要验联机（含服务端纠偏）时加 `ONLINE=1`。
   */
  const online = process.env.ONLINE === '1';
  const who = online
    ? await loginAs(c, '1234', '1234')
    : (await c.ev(`__MU_APP__.offline()`),
      await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '离线进图'),
      await c.waitFor(`!!__MU_APP__.state().player`, 60000, '角色就绪'),
      { name: 'offline' });
  await sleep(2500);
  const fps = await c.ev(`new Promise(r => { let n = 0; const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 > 1000) r((n * 1000 / (performance.now() - t0)).toFixed(1)); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick); })`);
  console.log(`\n角色 ${who.name}  渲染帧率 ≈ ${fps} fps`);

  const dirs = [
    [0, -1, 'N'],
    [1, -1, 'NE'],
    [1, 0, 'E'],
    [1, 1, 'SE'],
    [0, 1, 'S'],
    [-1, 1, 'SW'],
    [-1, 0, 'W'],
    [-1, -1, 'NW'],
  ];

  let cur = JSON.parse(await c.ev(ST));
  // 先站到整数格上，避免起始就是半格
  await c.ev(`__MU_APP__.walkTo(${Math.round(cur.x)}, ${Math.round(cur.y)})`);
  await sleep(1200);

  /** 模型朝向和世界方向的固定偏移（第一次转身时标定，之后用来断言） */
  let yawOffset = null;

  for (const [dx, dy, label] of dirs) {
    const before = JSON.parse(await c.ev(ST));
    const bx = Math.round(before.x);
    const by = Math.round(before.y);
    const tx = bx + dx;
    const ty = by + dy;
    const standable = await c.ev(`__MU_APP__.canStand(${tx}, ${ty})`);
    const scr = JSON.parse(await c.ev(PROJ(tx + 0.5, ty + 0.5)));

    await c.dragTo(scr[0], scr[1], scr[0], scr[1], 2);

    /*
     * 软件渲染只有 7fps 左右，鼠标事件到 DOM 之间可能隔着 100ms+，
     * 立刻读 state 会读到「点击还没生效」的旧值。这里轮询 clickLog：
     * 出现 ground 行（说明 pointerdown 已经跑完、路径也建好了）再读。
     */
    let goalFromLog = null;
    for (let i = 0; i < 12; i++) {
      const log = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.clickLog())'));
      const g = [...log].reverse().find(l => l.trim().startsWith('ground'));
      if (g) {
        const m = /goal=(-|[\d,]+)/.exec(g);
        goalFromLog = m && m[1] !== '-' ? m[1].split(',').map(Number) : null;
        break;
      }
      await sleep(80);
    }
    const t1 = JSON.parse(await c.ev(ST));

    /*
     * 目标格可能被墙/人占着，实际目标是 `goal`（可能是邻近的空格）。
     * 朝向和位移一律按**实际目标**判断，不是按点击的那一格。
     */
    const gx = goalFromLog ? goalFromLog[0] : null;
    const gy = goalFromLog ? goalFromLog[1] : null;
    if (gx === null) {
      /*
       * 没生成路径只有两种正当情况：
       *   - 点中的格就是脚下（原版也没反应）；
       *   - 点中的格地形上就走不了（墙里/水里）—— 原版同样是没反应。
       * 其余都算缺陷（有地面却走不了）。
       */
      const self = Math.floor(before.x) === tx && Math.floor(before.y) === ty;
      const terrainOk = await c.ev(`__MU__.terrain.isWalkable(${tx + 0.5}, ${ty + 0.5})`);
      check(
        `${label} → (${tx},${ty})`,
        self || !terrainOk,
        `没路径（点击格可站=${standable} 地形可走=${terrainOk} 是否脚下=${self}）` +
          ' | ' +
          (JSON.parse(await c.ev('JSON.stringify(__MU_APP__.clickLog())')).slice(-2).join(' | '))
      );
      continue;
    }

    const want = Math.atan2(gy - before.y, gx - before.x);
    if (yawOffset === null) yawOffset = wrap(t1.yaw - want);
    const yawErr = Math.abs(wrap(t1.yaw - want - yawOffset));

    // 立刻再取一次：位移方向必须和「走向目标」的方向一致
    await sleep(180);
    const t2 = JSON.parse(await c.ev(ST));
    const vx = t2.x - before.x;
    const vy = t2.y - before.y;
    const moving = Math.hypot(vx, vy) > 0.01;
    const dirOk = moving ? dot(vx, vy, gx - before.x, gy - before.y) > 0.9 : t2.len > 0;

    // 等走到（软件渲染慢，最多 4 秒）
    let t3 = t2;
    for (let i = 0; i < 20; i++) {
      t3 = JSON.parse(await c.ev(ST));
      if (t3.len === 0 && Math.abs(t3.x - gx) < 0.06 && Math.abs(t3.y - gy) < 0.06) break;
      await sleep(200);
    }
    const arrived = Math.abs(t3.x - gx) < 0.06 && Math.abs(t3.y - gy) < 0.06;

    check(
      `${label} → 点(${tx},${ty}) 走(${gx},${gy})`,
      arrived && yawErr < 0.06 && dirOk,
      `可站=${standable} 转身误差=${yawErr.toFixed(3)} 位移同向=${dirOk} 终点=${t3.x},${t3.y} len=${t3.len}`
    );
  }

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  const errs = c.logs.filter(l => /\[exc\]/.test(l));
  if (errs.length) console.log('异常:\n' + errs.slice(-6).join('\n'));
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}

/** 朝向可能刚好绕了 2π，用 sin/cos 比较 */
function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** 两个方向向量的余弦（位移方向和目标方向是否同向） */
function dot(vx, vy, dx, dy) {
  const n = Math.hypot(vx, vy) * Math.hypot(dx, dy);
  if (!n) return 0;
  return (vx * dx + vy * dy) / n;
}
