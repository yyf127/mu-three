/**
 * 黑龙波轨迹探针 —— 验「按 0.97k MoveJoint 0x4E5 sub0 重写」后的行为。
 *
 * 源码依据（CONFIRMED_SOURCE）：
 *   - `MoveHumming(pos, angle, target, 10.0f)` **只转角度、不动位置**
 *     （SMD_Parser.cpp:745 "NO mueve la posicion"）
 *   - 位置整段寿命不变（起点 = 施法者 z+100）
 *   - `angle[0] += (rand()%32-16)*0.2`（俯仰）、`angle[2] += (rand()%32-16)*0.8`（偏航）
 *   - 抖动累积量分别 *0.6 / *0.8 衰减
 *   - 高度夹 terrain+100 ~ +400；越界把 angle[0] 设 ±5
 *
 * 断言：
 *   [A] castOf(9) 是 special 'dragon-wave'
 *   [B] 放 9 后 4 条 Laser01 常驻，位置**固定**（不绕圈）
 *   [C] 朝向（rotation.z）随帧抖动（角度在动）
 *
 * 用法：node tools/dragon-wave-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('dragon-wave');
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

  console.log('\n[A] castOf(9) 走专用渲染器');
  const spec = JSON.parse(
    await c.ev(`(async () => {
      try {
        const m = await import('/src/data/skillFx.ts');
        const sk = await import('/src/data/skills.ts');
        const s = m.castOf((await sk.loadSkills()).find(x => x.id === 9));
        return JSON.stringify({ special: s.special ?? null, parts: s.parts.length });
      } catch (e) { return JSON.stringify({ _err: String(e && e.stack || e) }); }
    })()`)
  );
  if (spec._err) throw new Error(spec._err);
  check('9 是 dragon-wave 专用渲染器', spec.special === 'dragon-wave', JSON.stringify(spec));

  console.log('\n[B] 放 9 → 4 条 Laser01，位置固定');
  await c.ev(`__MU_APP__.castSkill(9)`);
  const grab = `JSON.stringify(__MU_APP__.dragonWave())`;
  let live = [];
  for (let i = 0; i < 20 && !live.length; i++) {
    await sleep(120);
    live = JSON.parse(await c.ev(grab));
  }
  check('4 条龙波在跑', live.length === 4, `len=${live.length}`);

  // 位置固定：连续两次采样 x/y 完全一致（源码位置不动）
  const p1 = JSON.parse(await c.ev(grab));
  await sleep(260);
  const p2 = JSON.parse(await c.ev(grab));
  const sameXY =
    p1.length === p2.length &&
    p1.every((a, i) => Math.abs(a.x - p2[i].x) < 0.001 && Math.abs(a.y - p2[i].y) < 0.001);
  check('龙波位置固定（源码位置不动）', sameXY, `p1=${JSON.stringify(p1.slice(0, 2))} p2=${JSON.stringify(p2.slice(0, 2))}`);
  check('半径恒为 0（不绕圈）', p1.every(a => a.r < 0.001), JSON.stringify(p1.map(a => a.r)));

  console.log('\n[C] 朝向随帧抖动（角度在动）');
  /* 读 Laser01 的 rotation.z，间隔采样看是否变化 */
  const rotGrab = `JSON.stringify(__MU_APP__.fx().filter(e => /Laser01/.test(e.file)).map(e => e.yaw))`;
  await c.ev(`__MU_APP__.castSkill(9)`);
  await sleep(200);
  const r1 = JSON.parse(await c.ev(rotGrab));
  await sleep(200);
  const r2 = JSON.parse(await c.ev(rotGrab));
  const rotating =
    r1.length >= 1 && r2.length === r1.length && r1.some((v, i) => Math.abs(v - r2[i]) > 0.001);
  check('朝向随帧变化（角度抖动生效）', rotating, `r1=${JSON.stringify(r1)} r2=${JSON.stringify(r2)}`);

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error('[FATAL]', e && e.stack || e);
  process.exit(1);
}