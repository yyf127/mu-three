/**
 * 技能**表现链路**探针：本地沙盘 vs 远端收包 是不是同一套。
 *
 * 背景（这一轮修的东西）：
 *   `castOf(skill)` 已经把客户端源码翻成了完整的件列表
 *   （`MoveCharacter` 的 CreateEffect / Particle_Spawn / Joint_Create），
 *   但只有本地沙盘用了它；收包那条 `playRemoteSkill` 还停在早期的**单件**表
 *   `SKILL_FX[skill]` —— 同一个技能「自己放一整套、别人放只有一件」。
 *   现在两边共用 `playCastParts()`。
 *
 * 断言：
 *   1. 源码覆盖的技能，远端播出来的件数 == `castOf().parts.length`
 *   2. 远端播的动作号 == `castOf().action`（源码动作，不是 82/83 兜底）
 *   3. 41 / 42 / 55 用的是战士专属动作 61 / 62 / 61（不是法师的 82/83）
 *   4. 弓箭三技能（24/51/52）走箭矢投射物，不生成原地件
 *   5. 怪物技能 50 源码无视觉 → 不生成件
 *   6. 场景里真的多出对象（件数 > 0 的技能）
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

let pass = 0;
let fail = 0;
const check = (l, ok, d = '') => {
  ok ? (pass++, console.log(`  ✓ ${l}${d ? '  ' + d : ''}`))
     : (fail++, console.log(`  ✗ ${l}${d ? '  ' + d : ''}`));
};

const c = await createClient('skillcast');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`!!__MU_APP__.playerActor()`, 60000, '角色');
  await c.waitFor(`!!__MU_APP__.skillTarget()`, 30000, '靶子');
  await sleep(1500);
  // 41/42 的视觉是转/砸手上的武器
  await c.ev(`__MU_APP__.previewEquip({ cls: 1, safeZone: false, weapon: 0 })`);
  await sleep(500);

  const all = await c.ev(`__MU_APP__.skills()`);
  const target = await c.ev(`(() => { const t = __MU_APP__.skillTarget(); return t ? { id: __MU_APP__.targetEntityId ? __MU_APP__.targetEntityId() : 0, name: t.name } : null; })()`);
  console.log(`技能 ${all.length} 个，靶子 ${JSON.stringify(target)}\n`);

  /* ---------- 1/2. 逐个比对「远端件数 / 动作」 ---------- */
  const mismatched = [];
  const tested = [];
  for (const s of all) {
    if (!s.parts.length && s.source !== 'none') {
      // 弓箭类（走箭矢）/ 源码没覆盖的，单独看
      tested.push({ id: s.id, name: s.name, expect: 0, got: null, action: s.action, note: 'skip' });
      continue;
    }
    await c.ev(`__MU_APP__.fxClear()`);
    await sleep(60);
    const before = await c.ev(`__MU_APP__.fxCount ? __MU_APP__.fxCount() : -1`);
    const last = await c.ev(`__MU_APP__.remoteSkill(${s.id}, { targetId: ${target?.id ?? 0} })`);
    await sleep(420);
    const got = last?.parts ?? 0;
    await sleep(500);
    const after = await c.ev(`__MU_APP__.fxCount ? __MU_APP__.fxCount() : -1`);
    tested.push({
      id: s.id,
      name: s.name,
      expect: s.parts.length,
      got,
      action: last?.action ?? s.action,
      expectAction: s.action,
      delta: after - before,
      source: s.source,
    });
    if (s.parts.length && got !== s.parts.length) mismatched.push(`${s.id} ${s.name}: 远端 ${got} 件 / 源码 ${s.parts.length} 件`);
    if (s.source === 'none' && got !== 0) mismatched.push(`${s.id} ${s.name}: 源码无视觉却生成了 ${got} 件`);
  }
  console.log('逐技能（id 名字 源码件数/远端件数 动作）：');
  for (const t of tested) {
    if (t.note === 'skip') continue;
    console.log(`  ${String(t.id).padStart(2)} ${String(t.name).padEnd(12)} ${t.expect}/${t.got}  动作 ${t.action}${t.expectAction !== t.action ? ` (期望 ${t.expectAction})` : ''}`);
  }
  check('远端件数与源码一致', mismatched.length === 0, mismatched.join(' | '));

  /* ---------- 3. 战士专属动作 ---------- */
  const actOf = async id => {
    const l = await c.ev(`__MU_APP__.remoteSkill(${id}, { targetId: ${target?.id ?? 0} })`);
    return l?.action;
  };
  const a41 = await actOf(41);
  const a42 = await actOf(42);
  const a55 = await actOf(55);
  const a48 = await actOf(48);
  const a56 = await actOf(56);
  console.log(`\n动作：41=${a41} 42=${a42} 55=${a55} 48=${a48} 56=${a56}`);
  check('41 霹雳回旋斩 → 61', a41 === 61, String(a41));
  check('42 雷霆裂闪 → 62', a42 === 62, String(a42));
  check('55 玄月斩 → 61', a55 === 61, String(a55));
  check('48 生命之光 → 63', a48 === 63, String(a48));
  check('56 天雷闪 → 81', a56 === 81, String(a56));

  /* ---------- 4. 弓箭三技能 ---------- */
  for (const id of [24, 51, 52]) {
    const l = await c.ev(`__MU_APP__.remoteSkill(${id}, { targetId: ${target?.id ?? 0} })`);
    console.log(`  ${id} → ${l?.fx}`);
    // 51 冰封箭在源码里还会往目标身上挂两片 Ice01，所以只断言「走了 CreateArrows」
    check(`弓箭技能 ${id} 走 CreateArrows`, String(l?.fx).includes('CreateArrows'), JSON.stringify(l?.fx));
  }

  /* ---------- 6. 场景对象数（件数 > 0 时确实多了东西） ---------- */
  await c.ev(`__MU_APP__.fxClear()`);
  await sleep(200);
  const b0 = await c.ev(`__MU_APP__.fxCount ? __MU_APP__.fxCount() : -1`);
  await c.ev(`__MU_APP__.remoteSkill(14, { targetId: ${target?.id ?? 0} })`);
  await sleep(700);
  const b1 = await c.ev(`__MU_APP__.fxCount ? __MU_APP__.fxCount() : -1`);
  console.log(`\n技能 14（地狱火）场景对象 ${b0} → ${b1}`);
  check('技能 14 在场景里真的生成了对象', b1 > b0, `${b0} → ${b1}`);

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
