/**
 * 受击动作 / 冰封箭命中冰晶 / 玄月斩补件 探针。
 *
 * 三处都来自这一轮的源码梳理：
 *   1. `remotes.onDamage` 以前只飘伤害数字 + 放打击音，被打的**动作不变**。
 *      源码：怪物 `MONSTER_ACTION.SHOCK`(4)；玩家 `0x85/0x87/0x8B/0x8C`
 *      （`PacketHandler_0x19` 的 case 0x03 会 `SetPlayerStop(target)`）。
 *   2. 冰封箭（51）源码 `case 0x33` 在**目标身上**挂两件 `CreateEffect(190)`
 *      （sub 1 / sub 2，角度差 180°）= `Skill/Ice01.bmd` 两片冰晶包裹。
 *   3. 玄月斩（55）源码 `AttackStage` 的 1267（1 帧闪光）+ 1168（0x490 = 连到目标的线），
 *      以前只配了一件 Tail，而且落在目标位置。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

let pass = 0;
let fail = 0;
const check = (l, ok, d = '') => {
  ok ? (pass++, console.log(`  ✓ ${l}${d ? '  ' + d : ''}`))
     : (fail++, console.log(`  ✗ ${l}${d ? '  ' + d : ''}`));
};

const c = await createClient('skillhurt');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`!!__MU_APP__.playerActor()`, 60000, '角色');
  await c.waitFor(`!!__MU_APP__.skillTarget()`, 30000, '靶子');
  await sleep(1400);

  /* ---------- 1. 受击动作（怪物） ---------- */
  const m0 = await c.ev(`__MU_APP__.hurt('monster')`);
  console.log('怪物受击:', JSON.stringify(m0));
  check('怪物受击播了动作（不是原地不动）', !!m0 && m0.ok === true && m0.after !== m0.before,
        JSON.stringify(m0));
  check('怪物受击动作 = SHOCK(4)', !!m0 && m0.after === 4, String(m0?.after));
  await sleep(700);
  const m1 = await c.ev(`__MU_APP__.skillTarget().action`);
  check('受击后回到待机动作', m1 !== 4, `now=${m1}`);

  /* ---------- 1b. 玩家受击动作 ---------- */
  const p0 = await c.ev(`__MU_APP__.hurt('player')`);
  console.log('玩家受击:', JSON.stringify(p0));
  check('玩家受击播了 0x85/0x87/0x8B/0x8C 之一',
        !!p0 && p0.ok === true && [0x85, 0x87, 0x8b, 0x8c].includes(p0.after),
        JSON.stringify(p0));

  /* ---------- 2. 冰封箭：两片冰晶挂在目标身上 ---------- */
  const target = await c.ev(`(() => { const t = __MU_APP__.skillTarget(); return t ? { x: t.x, y: t.y } : null; })()`);
  await c.ev(`__MU_APP__.fxClear()`);
  await sleep(200);
  const b0 = await c.ev(`__MU_APP__.fxCount()`);
  const l51 = await c.ev(`__MU_APP__.remoteSkill(51, { targetId: 0, x: ${Math.round(target.x)}, y: ${Math.round(target.y)} })`);
  await sleep(300);
  const mid = await c.ev(`__MU_APP__.fxCount()`);
  await sleep(500);
  const b1 = await c.ev(`__MU_APP__.fxCount()`);
  console.log(`冰封箭: fxCount ${b0} → ${mid} → ${b1}（${JSON.stringify(l51?.fx)}）`);
  check('冰封箭放箭 + 命中冰晶（至少 3 件）', b1 - b0 >= 3, `${b0} → ${b1}`);
  check('冰封箭标记了 Ice01×2', String(l51?.fx).includes('Ice01'), String(l51?.fx));

  /* ---------- 3. 玄月斩（55）补件 ---------- */
  const all = await c.ev(`__MU_APP__.skills()`);
  const s55 = all.find(s => s.id === 55);
  console.log('55 玄月斩 parts:', JSON.stringify(s55.parts?.map(p => `${p.kind}:${p.file}@${p.anchor}`)));
  check('55 至少 3 件（弧光 + 能量弧 + 爆闪）', (s55.parts?.length ?? 0) >= 3, `${s55.parts?.length}`);
  check('55 有连到目标的能量弧', (s55.parts || []).some(p => p.kind === 'beam' && p.file.includes('JointEnergy')),
        JSON.stringify(s55.parts?.map(p => p.file)));
  check('55 弧光挪到了身前', (s55.parts || []).some(p => p.file.includes('Tail') && p.anchor === 'front'),
        JSON.stringify(s55.parts?.map(p => `${p.file}@${p.anchor}`)));

  // 真的放一次，确认场景对象变多
  await c.ev(`__MU_APP__.fxClear()`);
  await sleep(150);
  const c0 = await c.ev(`__MU_APP__.fxCount()`);
  await c.ev(`__MU_APP__.remoteSkill(55, { targetId: 0, x: ${Math.round(target.x)}, y: ${Math.round(target.y)} })`);
  await sleep(700);
  const c1 = await c.ev(`__MU_APP__.fxCount()`);
  console.log(`55 施法: fxCount ${c0} → ${c1}`);
  check('55 施法后场景里多出对象', c1 > c0, `${c0} → ${c1}`);

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
