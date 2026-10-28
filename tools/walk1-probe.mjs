/**
 * 「走一格」探针：相邻 1 格必须是**平滑插值走过去**，不能瞬移。
 *
 *   node tools/walk1-probe.mjs
 *
 * 为什么单独验这一条：之前试过「相邻格直接落位 + 播走步动作」（原版一格一跳的做法），
 * 实机看起来是「人没走、位置滑过去」的滑步。所以退回到正常插值，只保留
 * 「逻辑整数格号 + 渲染格心」这层偏移。
 *
 * 断言：
 *   1. 点相邻格（含身后）→ 采样里能抓到**中间位置**（不是一步到位）；
 *   2. 全程单调靠近目标（不来回跳）；
 *   3. 落点是目标整数格，渲染位置 = 格号 + 0.5（格心）；
 *   4. 走的时候播的是走步动作，停下来回到待机。
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

const c = await createClient('walk1');

const PROJECT = (x, y) => `(() => {
  const cam = __MU__.muCamera.camera;
  const V = cam.position.constructor;
  const h = __MU__.terrain.getHeight(${x}, ${y});
  const v = new V(${x}, ${y}, h).project(cam);
  const cv = document.querySelector('#app canvas');
  const r = cv.getBoundingClientRect();
  return JSON.stringify([Math.round(r.left + (v.x * 0.5 + 0.5) * r.width), Math.round(r.top + (-v.y * 0.5 + 0.5) * r.height)]);
})()`;

const POS = `JSON.stringify((() => {
  const p = __MU__.player.root.position;
  const s = __MU_APP__.state();
  return {
    x: s.player.x, y: s.player.y,
    wx: +p.x.toFixed(3), wy: +p.y.toFixed(3),
    action: __MU__.player.action,
    pathLeft: s.pathLeft,
  };
})())`;

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!document.getElementById('sandbox').classList.contains('hidden')`, 120000);
  await sleep(2500);
  await c.ev(`document.getElementById('sandbox').classList.add('hidden')`);
  await sleep(600);

  /** 站定并等相机落位（headless 10fps，lerp 很慢） */
  async function stand(x, y) {
    await c.ev(`__MU_APP__.setPos(${x}, ${y})`);
    let prev = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const cur = JSON.parse(await c.ev(PROJECT(x + 0.5, y + 0.5)));
      if (prev && Math.abs(cur[0] - prev[0]) <= 1 && Math.abs(cur[1] - prev[1]) <= 1) return;
      prev = cur;
    }
  }

  /**
   * 点一格并密集采样。
   *
   * 1 格在本地大约 0.18 秒（WALK_SPEED ≈ 5.4 格/秒），headless 只有 ~10fps，
   * 所以采样间隔压到 25ms，尽量多抓几帧中间态。
   */
  async function clickAndSample(tx, ty) {
    const before = JSON.parse(await c.ev(POS));
    /*
     * 用 `walk()` 而不是真实鼠标：headless 里一次 `dragTo` 要 900ms 左右
     * （好几次 CDP 往返），而 1 格只要 0.18 秒 —— 等它返回时人早走完了，
     * 采不到任何中间态。`walk()` 内部就是 `walkToCell`，和点击同一条路。
     */
    const ok = await c.ev(`__MU_APP__.walk(${tx}, ${ty})`);
    const samples = [];
    for (let i = 0; i < 24; i++) {
      const s = JSON.parse(await c.ev(POS));
      samples.push(s);
      if (s.pathLeft === 0 && i > 1) break;
      await sleep(12);
    }
    await sleep(400);
    const after = JSON.parse(await c.ev(POS));
    return { before, samples, after, ok };
  }

  /* ---------------- A. 身后相邻 1 格 ---------------- */
  console.log('\n[A] 点身后相邻 1 格（0,1 → 0,2 这种单步）');
  await stand(133, 131);
  await c.ev('__MU__.player.yaw = 0'); // 面向东，目标是西（身后）
  await sleep(300);
  const a = await clickAndSample(132, 131);
  const midA = a.samples.filter(s => (s.x !== 132 || s.y !== 131) && (s.x !== 133 || s.y !== 131));
  console.log(`  walk 返回 ${a.ok}，采样 ${a.samples.length} 次，中间态 ${midA.length} 个：${midA.map(s => `(${s.x.toFixed(2)},${s.y.toFixed(2)})`).join(' ') || '（无）'}`);
  console.log(`  最终 (${a.after.x},${a.after.y}) 渲染 three(${a.after.wx},${a.after.wy}) 动作=${a.after.action}`);

  check('有中间位置（是走过去，不是瞬移）', midA.length >= 1, `${midA.length} 个中间态`);
  check('落点是目标整数格', a.after.x === 132 && a.after.y === 131, `(${a.after.x},${a.after.y})`);
  check(
    '渲染位置 = 格号 + 0.5（站在格心，不是格子角）',
    Math.abs(a.after.wx - (a.after.x + 0.5)) < 0.03 && Math.abs(a.after.wy - (a.after.y + 0.5)) < 0.03,
    `three(${a.after.wx},${a.after.wy})`
  );
  check('停下来路径已清空', a.after.pathLeft === 0, String(a.after.pathLeft));

  /*
   * 关键一条：**没有大跳**。
   *
   * 之前「跨格就算到达 + 对齐到格号」时，最后一步会从格子边缘直接跳到格心
   * （0.7~1.0 格），看着就是滑步。headless 只有 ~10fps，正常每帧位移 ≈ 0.54 格，
   * 所以相邻采样的最大位移超过 0.7 就说明又有硬跳了。
   */
  let maxStep = 0;
  for (let i = 1; i < a.samples.length; i++) {
    maxStep = Math.max(maxStep, Math.hypot(a.samples[i].x - a.samples[i - 1].x, a.samples[i].y - a.samples[i - 1].y));
  }
  check('相邻采样没有大跳（< 0.7 格/帧）', maxStep < 0.7, `最大 ${maxStep.toFixed(2)} 格`);

  /* ---------------- B. 另一个方向的 1 格 ---------------- */
  /*
   * 洛兰城中心 NPC 扎堆，固定方向经常撞到人（撞人 → 清路径停住）。
   * 这里四个方向各试一次，取第一个**真的走到了**的，再断言它的中间态。
   */
  console.log('\n[B] 再走一格（取一个走得通的方向）');
  await stand(133, 131);
  let b = null;
  let bTarget = null;
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const tx = 133 + dx;
    const ty = 131 + dy;
    const tryOne = await clickAndSample(tx, ty);
    if (tryOne.after.x === tx && tryOne.after.y === ty) {
      b = tryOne;
      bTarget = [tx, ty];
      break;
    }
    console.log(`  · (${tx},${ty}) 走不到（${tryOne.after.x},${tryOne.after.y}），换方向`);
    await stand(133, 131);
  }
  check('至少有一个方向的单步能走通', !!b, bTarget ? `(${bTarget})` : '四个方向都不通');
  if (b) {
    const midB = b.samples.filter(s => (s.x !== 133 || s.y !== 131) && (s.x !== bTarget[0] || s.y !== bTarget[1]));
    const flat = [...new Set(midB.map(s => `(${s.x.toFixed(2)},${s.y.toFixed(2)})`))];
    console.log(`  中间态 ${flat.join(' ') || '（无）'}，最终 (${b.after.x},${b.after.y})`);
    check('这个方向的单步也是插值', midB.length >= 1, `${midB.length} 个中间态`);
    check('落点正确', b.after.x === bTarget[0] && b.after.y === bTarget[1], `(${b.after.x},${b.after.y})`);
  }

  /* ---------------- C. 单调性：不来回跳 ---------------- */
  console.log('\n[C] 位置单调靠近目标（没有回弹）');
  // 用 A 段的采样：x 应该从 133 一路减到 132，不能升回去
  const xs = a.samples.map(s => s.x);
  let back = 0;
  for (let i = 1; i < xs.length; i++) {
    /*
     * 允许 ≤0.1 的「修正」：一帧走 0.26 格，最后一帧可能冲过目标 0.04，
     * 再到点判定把它吸附回来（131.96 → 132.00）。这不算回弹，
     * 真正的回弹是往**反方向**跑出去（> 0.1）。
     */
    if (xs[i] > xs[i - 1] + 0.1) back++;
  }
  check('x 没有反向回弹（只有 ≤0.1 的到点修正）', back === 0, `${back} 次回弹，序列 ${xs.map(v => v.toFixed(2)).join(' ')}`);

  /* ---------------- D. 动作：走的时候是走步，停下回待机 ---------------- */
  /*
   * 直接用 A 段的采样：那一整段是完整的「点一下 → 走过去 → 停」，中间帧都在。
   * （不再单独再走一次 —— 洛兰城中心 NPC 一直动，重试方向很容易撞人，
   *   撞人时角色还停在走路动作上，断言会误报。）
   */
  console.log('\n[D] 动作切换（复用 A 段的采样）');
  const actsA = [...new Set(a.samples.map(v => v.action))];
  console.log(`  静置动作=${a.before.action}，过程中出现过 ${actsA.join(',')}，停下=${a.after.action}`);
  check('静置时是待机动作', a.before.action === 1, String(a.before.action));
  check('走的过程中切到走步动作（13..20 / 30..31）', actsA.some(v => v !== 1), actsA.join(','));
  check('停下后回到待机动作', a.after.action === 1, String(a.after.action));

  console.log(`\n截图：${await c.shot('walk1')}`);
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
} finally {
  await c.close();
}
