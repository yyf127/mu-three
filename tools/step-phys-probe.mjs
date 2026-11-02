/**
 * 阶梯物理探针 —— 验「MoveEffect 通用阶梯」不再是一根匀速直线。
 *
 * 源码 `MoveEffect.cpp` LAB_004695b5 段（陨石 191 走的就是它）逐帧：
 *   1. `pos.z += grav`        下落
 *   2. `grav -= const`        加速下落
 *   3. `vel.x/y *= 0.93`      水平减速（drag）
 *   4. `scale *= 0.9`         越接近落地越小（shrink）
 *   5. `rand()%10==0` → 喷 0x4c5 火星尾迹（trailEvery）
 *
 * 断言：
 *   [A] castOf(2) 的陨石 model 件带 drag/shrink/trailEvery
 *   [B] 放 2 陨石后，fx() 的该件 z 逐帧下降、且下降速度变快（加速）
 *   [C] 该件 scale 随生命期缩小
 *   [D] 飞行途中出现尾迹粒子（fxSprites 有 Spark02/Spark01）
 *
 * 用法：node tools/step-phys-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('step-phys');
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
  await sleep(1500);

  console.log('\n[A] castOf(2) 陨石件的阶梯参数');
  const spec = JSON.parse(
    await c.ev(`(async () => {
      try {
        const m = await import('/src/data/skillFx.ts');
        const sk = await import('/src/data/skills.ts');
        const list = await sk.loadSkills();
        const s = m.castOf(list.find(x => x.id === 2));
        return JSON.stringify(s.parts.filter(p => p.kind === 'model').map(p => ({
          file: p.file, drop: p.drop, vel: p.vel, drag: p.drag, shrink: p.shrink, trailEvery: p.trailEvery, trailFile: p.trailFile,
        })));
      } catch (e) { return JSON.stringify({ _err: String(e && e.stack || e) }); }
    })()`)
  );
  if (spec._err) throw new Error(spec._err);
  const met = spec.find(p => p.drag || p.shrink || p.trailEvery);
  check('陨石件带阶梯参数（drag/shrink/trailEvery）', !!met, JSON.stringify(spec));
  if (met) {
    check('  drag > 0（减速）', met.drag > 0, `drag=${met.drag}`);
    check('  shrink > 0（缩小）', met.shrink > 0, `shrink=${met.shrink}`);
    check('  trailEvery > 0（尾迹）', met.trailEvery > 0, `trailEvery=${met.trailEvery}`);
  }

  console.log('\n[B/C] 放 2 陨石 → 轮询采样 z / scale / 尾迹');
  await c.ev(`__MU_APP__.castSkill(2)`);
  /*
   * 陨石 0.64s 就落地，尾迹粒子 life 只有 0.4s —— 一次性抓容易错过。
   * 这里每 100ms 轮询一趟，边采陨石位置/缩放，边记尾迹是否出现过。
   */
  const sample = `JSON.stringify({
    fx: __MU_APP__.fx().filter(e => /Fire01/.test(e.file)).map(e => ({ z: e.at[2], s: e.scale, tc: e.trailCount })),
    sp: __MU_APP__.fxSprites().map(s => s.file),
  })`;
  const zs = [];
  const ss = [];
  let sawTrail = false;
  let trailCount = 0;
  // 陨石 ~5 帧（0.2s）就落地，采样必须够密（30ms）
  for (let i = 0; i < 20; i++) {
    await sleep(30);
    const snap = JSON.parse(await c.ev(sample));
    if (snap.fx[0]) {
      zs.push(snap.fx[0].z);
      ss.push(snap.fx[0].s);
      trailCount = Math.max(trailCount, snap.fx[0].tc ?? 0);
    }
    if (snap.sp.some(f => /Spark01|Spark02/.test(f))) sawTrail = true;
  }

  // 下落：序列里应出现「z 严格递减」的相邻对（落地后趋平是正常的）
  let descents = 0;
  for (let i = 1; i < zs.length; i++) if (zs[i] < zs[i - 1] - 0.05) descents++;
  check('陨石 z 逐帧下降（下落）', descents >= 2, `descents=${descents} z=${JSON.stringify(zs)}`);
  if (descents >= 2) {
    // 加速：递减区间里最大步长应 > 首步（重力在累加）
    let maxStep = 0;
    let firstStep = 0;
    for (let i = 1; i < zs.length; i++) {
      const d = zs[i - 1] - zs[i];
      if (d > 0.05) {
        if (!firstStep) firstStep = d;
        maxStep = Math.max(maxStep, d);
      }
    }
    check('出现加速下落（后段位移 > 首段）', maxStep > firstStep * 1.05, `first=${firstStep.toFixed(3)} max=${maxStep.toFixed(3)}`);
  }
  const shrinking = ss.length >= 3 && ss[0] > ss[ss.length - 1];
  check('陨石 scale 随生命期缩小', shrinking, `scale=${JSON.stringify(ss)}`);

  console.log('\n[D] 飞行途中喷尾迹粒子');
  check('尾迹计数 > 0（trailSpawner 被调用）', trailCount > 0, `trailCount=${trailCount}`);
  check('出现尾迹火花（Spark01/Spark02）', sawTrail, `sawTrail=${sawTrail}`);

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error('[FATAL]', e && e.stack || e);
  process.exit(1);
}