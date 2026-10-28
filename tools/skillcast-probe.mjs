/**
 * 0x19 技能广播 + 0xF3/0xE6 事件倒计时 探针。
 *
 *   node tools/skillcast-probe.mjs
 *
 * （`tools/skill-probe.mjs` 是旧的离线技能菜单探针，两者不冲突：
 *   那个验「沙盘选技能 → 特效对不对」，这个验「联机收别人的技能广播」。）
 *
 * 两件事各自验证：
 *   1. **事件倒计时**：进图后服务端会推一次 `F3/E6` 整表（血色城堡 / 恶魔广场 /
 *      入侵…），客户端要解析成 `{name,status,time}` 并画在左上角。
 *   2. **技能广播**：让视野里的怪物「放技能」（伪造一条 0x19，走的是和真实收包
 *      完全相同的解析 + 表现路径），检查动作与特效文件是否按技能号取对；
 *      再验证「caster === 自己」时会被跳过（否则本地施法会双播）。
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

const c = await createClient('skillcast');

try {
  const who = await loginAs(c, '1234', '1234');
  console.log(`进图：${who.name} map=${who.mapId}`);
  await sleep(3000);

  /* ---------------- 1. 事件倒计时 ---------------- */
  const events = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.eventTimer())'));
  console.log(`\n事件表 ${events.length} 条：`);
  for (const e of events) {
    console.log(`  ${e.name}  status=${e.status}  remain=${e.remain}s  hidden=${e.hidden}`);
  }
  check('收到 0xF3/0xE6 事件表', events.length > 0, `${events.length} 条`);
  check(
    '至少一条非 BLANK（会被画出来）',
    events.some(e => e.status !== 0),
    events
      .filter(e => e.status !== 0)
      .map(e => e.name)
      .join(', ') || '全是 BLANK'
  );

  const evtDom = await c.ev(`document.querySelectorAll('.evt-line').length`);
  check('左上角画出倒计时行', Number(evtDom) > 0, `${evtDom} 行`);
  await c.shot('skill-01-events');

  /* ---------------- 2. 技能广播 ---------------- */
  const st = JSON.parse(
    await c.ev('JSON.stringify({ self: __MU_APP__.state().selfId, remotes: __MU_APP__.state().remotes })')
  );
  /*
   * 洛兰城内只有 NPC、没有怪（安全区不刷怪），所以施法者优先取怪物，
   * 没有就退到 NPC —— 两者都是 RemoteEntity，走的同一条 0x19 表现路径。
   */
  const actors = (st.remotes || []).filter(r => !r.dying);
  const monsters = actors.filter(r => r.kind === 'monster');
  console.log(`\n视野内实体 ${actors.length} 个（怪物 ${monsters.length}），selfId=${st.self}`);
  check('视野里有实体可当施法者', actors.length > 0, actors.map(a => `${a.kind}:${a.id}`).join(','));

  if (actors.length) {
    const m = monsters[0] ?? actors[0];
    // 火球（skill.bmd 4 号 → Fire01.bmd），施法者 = 这只怪，目标 = 它自己
    const ev = JSON.parse(
      await c.ev(`JSON.stringify(__MU_APP__.testSkill(4, ${m.id}, ${m.id}, true))`)
    );
    await sleep(600);
    const dbg = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillDebug())'));
    console.log(`  0x19 → ${JSON.stringify(ev)}`);
    console.log(`  处理结果 → ${JSON.stringify(dbg.last)}`);
    check('caster 是怪物时被处理（未跳过）', !dbg.last?.skipped, `skipped=${dbg.last?.skipped ?? '无'}`);
    check('技能 4（火球）取到特效 Fire01.bmd', dbg.last?.fx === 'Fire01.bmd', `fx=${dbg.last?.fx}`);
    check('success 标志（target 高字节 bit7）解析正确', ev?.success === true);
    await sleep(900);
    await c.shot('skill-02-monster-fireball');

    // 冰封（7 → Ice01.bmd）验证映射不是写死的
    await c.ev(`__MU_APP__.testSkill(7, ${m.id}, ${m.id}, true)`);
    await sleep(500);
    const dbg2 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillDebug())'));
    check('技能 7（冰封）取到特效 Ice01.bmd', dbg2.last?.fx === 'Ice01.bmd', `fx=${dbg2.last?.fx}`);
    await sleep(700);
    await c.shot('skill-03-monster-ice');

    /*
     * caster 是自己 / 不存在 都不能播：
     *   - 自己：服务端 `DataSend(lpObj->Index, …)` 会抄送一份，本地施法早播过了；
     *   - 不存在：包里带了一个不在视野里的 id（刚走出视野），静默退出即可。
     * `selfId === -1` 说明这一局视野里没有「自己」那条 0x12（城里没别人），
     * 此时两个分支都会走 no-caster，同样不能崩。
     */
    const selfProbe = st.self > 0 ? st.self : 0x7ffe;
    await c.ev(`__MU_APP__.testSkill(4, ${selfProbe}, ${m.id}, true)`);
    await sleep(300);
    const dbg3 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillDebug())'));
    const skippedOk = st.self > 0 ? dbg3.last?.skipped === 'self' : !!dbg3.last?.skipped;
    check('caster 是自己/不存在时不施法', skippedOk, `skipped=${dbg3.last?.skipped} selfId=${st.self}`);

    // 未知技能号：只播动作，不能崩
    const before = await c.ev('__MU_APP__.skillDebug().count');
    await c.ev(`__MU_APP__.testSkill(99, ${m.id}, 0, true)`);
    await sleep(300);
    const after = await c.ev('__MU_APP__.skillDebug().count');
    const dbg4 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillDebug())'));
    check(
      '未知技能号（99）只播动作、不出特效',
      Number(after) > Number(before) && dbg4.last?.fx === null,
      `fx=${dbg4.last?.fx}`
    );
  }

  console.log('\n--- 页面控制台（末尾） ---');
  console.log(c.logs.slice(-12).join('\n') || '（空）');
  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error('ERR', e.message);
  console.log(c.logs.slice(-20).join('\n'));
  try {
    await c.shot('skill-error');
  } catch {}
  process.exitCode = 1;
} finally {
  await c.close();
}
