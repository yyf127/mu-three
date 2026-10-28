/**
 * 「点身后一格 / 点脚下」探针（线上）。
 *
 *   node tools/walkback-probe.mjs
 *
 * 背景：实机反馈「角色背对某个方向时，点身后那一格走不过去，其他方向都行，
 * 只剩一个圆圈标记画在那儿」。这轮把几个可能的原因都固化成了断言：
 *
 *   1. 四个方向（含正后方）真实鼠标点击 → 都走到；
 *   2. 每一步服务端都没有纠偏（位置包不涨、`sentCell` 跟上）；
 *   3. 点自己脚下：`walk()` 返回 false（不画圈、人不动），原版也是这个行为；
 *   4. 点不可走的格（墙里）：不会把人瞬移进去，圆圈也不会画在墙里；
 *   5. 地图边缘格（x=0 / y=0）不再被判死 —— `terrainWalkable` 以前写死 `tx < 1`。
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

const c = await createClient('walkback');

const PROJ = (x, y) => `(() => {
  const cam = __MU__.muCamera.camera;
  const V = cam.position.constructor;
  const h = __MU__.terrain.getHeight(${x}, ${y});
  const v = new V(${x}, ${y}, h).project(cam);
  const cv = document.querySelector('#app canvas');
  const r = cv.getBoundingClientRect();
  return JSON.stringify([Math.round(r.left + (v.x * 0.5 + 0.5) * r.width), Math.round(r.top + (-v.y * 0.5 + 0.5) * r.height)]);
})()`;

const ST = `JSON.stringify((() => {
  const s = __MU_APP__.state(); const m = __MU_APP__.moveInfo();
  return { x: s.player.x, y: s.player.y, sent: m.sentCell, goal: m.goal, len: m.len,
           clear: m.clearReason, posPkts: __MU_APP__.packets(0x0e).length };
})())`;

try {
  const who = await loginAs(c, '1234', '1234');
  await sleep(3000);
  const p0 = JSON.parse(await c.ev(ST));
  const bx = Math.round(p0.x);
  const by = Math.round(p0.y);
  console.log(`\n角色 ${who.name} 起点 (${bx},${by})`);

  /* ---------------- A. 四个方向（含正后方）真实点击 ---------------- */
  console.log('\n[A] 四个方向各点一次（真实鼠标，含正后方）');
  const dirs = [
    [0, -1, '正后方(南)'],
    [0, 1, '正前方(北)'],
    [-1, 0, '左(西)'],
    [1, 0, '右(东)'],
  ];
  let drift = 0;
  for (const [dx, dy, label] of dirs) {
    await c.ev(`__MU_APP__.setPos(${bx}, ${by})`);
    await sleep(800);
    const e0 = JSON.parse(await c.ev(ST));
    const scr = JSON.parse(await c.ev(PROJ(bx + dx + 0.5, by + dy + 0.5)));
    await c.dragTo(scr[0], scr[1], scr[0], scr[1], 2);
    await sleep(1500);
    const e1 = JSON.parse(await c.ev(ST));
    const hit = e1.x === bx + dx && e1.y === by + dy;
    /*
     * 「有没有被纠偏」不看位置包条数（`packets()` 只保留最近 N 条，计数会回绕），
     * 看 `sentCell`（客户端认为服务端已经确认到的格）有没有和实际位置对上。
     */
    const synced = e1.sent.x === Math.round(e1.x) && e1.sent.y === Math.round(e1.y);
    if (!synced) drift++;
    check(
      `${label} (${bx + dx},${by + dy}) 走到了`,
      hit,
      `屏幕(${scr}) → (${e1.x},${e1.y}) clear=${e1.clear} sent=${JSON.stringify(e1.sent)}`
    );
  }
  check('四步之后客户端/服务端位置都对得上（没被纠偏）', drift === 0, `${drift} 次不同步`);

  /* ---------------- B. 点自己脚下 ---------------- */
  console.log('\n[B] 点自己脚下');
  await c.ev(`__MU_APP__.setPos(${bx}, ${by})`);
  await sleep(700);
  const selfWalk = await c.ev(`__MU_APP__.walk(${bx}, ${by})`);
  await sleep(400);
  const b = JSON.parse(await c.ev(ST));
  check('点脚下返回 false（不会有「圈在脚下人不动」）', selfWalk === false, `walk=${JSON.stringify(selfWalk)}`);
  check('人没有移动', b.x === bx && b.y === by, `(${b.x},${b.y})`);
  check('没有残留路径', b.len === 0, String(b.len));

  /* ---------------- C. 点不可走的格 ---------------- */
  console.log('\n[C] 点墙里（不可走）');
  // 洛兰城内往北 30 格是森林/城墙，肯定不可走
  const wallTarget = [bx, by + 30];
  const canWall = await c.ev(`__MU_APP__.canStand(${wallTarget[0]}, ${wallTarget[1]})`);
  if (canWall === false) {
    const ok = await c.ev(`__MU_APP__.walk(${wallTarget[0]}, ${wallTarget[1]})`);
    await sleep(1200);
    const w = JSON.parse(await c.ev(ST));
    check('点墙里不会把人送进去', w.y !== wallTarget[1], `结果(${w.x},${w.y})`);
    check('但会走到墙边（能走就走到最近的空地）', ok === true || w.y !== by, `walk=${ok} 结果(${w.x},${w.y})`);
  } else {
    console.log('  · 目标其实是可走的，跳过这一段');
  }

  /* ---------------- D. 地图边缘格判定 ---------------- */
  /*
   * 线上不能随便 `setPos` 到远处 —— 那只是客户端挪位置，服务端不知道，
   * 下一个位置包就把人拉回来（探针一开始就这么误判成「边缘格走不了」）。
   * 这里改成**纯查询比对**：`canStand` 不该比 `terrain.isWalkable` 更严。
   */
  console.log('\n[D] 地图边缘格（x=0 不该再被判死）');
  const edgeCheck = JSON.parse(
    await c.ev(`(() => {
      const out = { walkable: [], canStand: [], same: 0, total: 0 };
      for (let y = 0; y < 256; y += 8) {
        const w = __MU__.terrain.isWalkable(0.5, y + 0.5);
        const st = __MU_APP__.canStand(0, y);
        if (w) out.walkable.push(y);
        if (st) out.canStand.push(y);
        if (w === st) out.same++;
        out.total++;
      }
      return JSON.stringify(out);
    })()`)
  );
  console.log(`  x=0 这一列：地形可走 ${edgeCheck.walkable.length} 格，canStand 可走 ${edgeCheck.canStand.length} 格，一致 ${edgeCheck.same}/${edgeCheck.total}`);
  check(
    'x=0 的 canStand 与地形判定一致（不再被额外封死）',
    edgeCheck.same === edgeCheck.total,
    `${edgeCheck.same}/${edgeCheck.total}${edgeCheck.walkable.length ? `，地形说可走 ${edgeCheck.walkable.join(',')}` : ''}`
  );

  await c.ev(`__MU_APP__.setPos(${bx}, ${by})`);
  console.log(`\n截图：${await c.shot('walkback')}`);
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
} finally {
  try {
    const nm = await c.ev('__MU_APP__.state().char');
    if (nm) await c.ev(`__MU_APP__.chat('/gmove ${nm} 0 133 131')`);
    await sleep(800);
  } catch {
    /* 收尾失败不影响结论 */
  }
  await c.close();
}
