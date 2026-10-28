/**
 * 技能剩余三条包（0x1B 取消 / 0x1E 持续技能 / 0xB0 队友传送）。
 *
 *   node tools/skill-packet-probe.mjs
 *   node tools/skill-packet-probe.mjs 账号 密码
 *
 * 分三层：
 *
 *   1. **线上字节**：把四条上行造出来逐字节比对 —— 重点是
 *      **0x1E 的目标索引是 big-endian、0xB0 的索引是 little-endian**
 *      （同一个「目标索引」，两条包方向相反，这是最容易写反的地方）。
 *   2. **收包表现**：伪造 0x1E / 0x1B 下行，走真实的解析 + 表现路径，
 *      断言「落点用的是包里的 x/y，不是施法者脚下」。
 *   3. **真实发送**：`castOnline` 按技能号自动选 0x1E/0x19；
 *      `cancelSkill` / `recallAlly` 发出去连接不断。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const account = process.argv[2] || '1234';
const password = process.argv[3] || '1234';

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

const c = await createClient('skillpkt');

try {
  const who = await loginAs(c, account, password);
  console.log(`进图：${who.name} selfId=${await c.ev('__MU_APP__.state().selfId')}`);
  await sleep(2500);

  /* ================= A. 线上字节 ================= */
  console.log('\n[字节] 0x1E 持续技能（C3 0B）');
  const dur = await c.ev(
    `__MU_APP__.skillPacketHex.duration(41, 133, 131, 64, 0, 0, 0x1F40)`
  );
  check(
    '0x1E = c3 0b 1e skill x y dir dis angle idxHi idxLo',
    dur === 'c3 0b 1e 29 85 83 40 00 00 1f 40',
    dur
  );
  check('长度 11 字节', dur.split(' ').length === 11, `${dur.split(' ').length}`);
  check(
    '目标索引 big-endian（0x1F40 → 1f 40）',
    dur.endsWith('1f 40'),
    dur.split(' ').slice(9).join(' ')
  );

  console.log('\n[字节] 0x19 单体技能（C3 06）');
  const atk = await c.ev(`__MU_APP__.skillPacketHex.attack(3, 0x1F40)`);
  check('0x19 = c3 06 19 skill hi lo', atk === 'c3 06 19 03 1f 40', atk);

  console.log('\n[字节] 0xB0 队友传送（C3 07 —— HackPacketCheck 要求加密）');
  const ally = await c.ev(`__MU_APP__.skillPacketHex.ally(0x1F40, 133, 131)`);
  check(
    '0xB0 = c3 07 b0 idxLo idxHi x y（发 C1 会被服务端断开）',
    ally === 'c3 07 b0 40 1f 85 83',
    ally
  );
  check(
    '索引 **little-endian**（0x1F40 → 40 1f，和 0x1E 相反）',
    ally.split(' ').slice(3, 5).join(' ') === '40 1f',
    ally.split(' ').slice(3, 5).join(' ')
  );

  console.log('\n[字节] 0x1D 多目标技能（C3 0C）');
  const multi = await c.ev(`__MU_APP__.skillPacketHex.multi(5, 133, 131, 0, [0x1F40, 0x0BB8])`);
  check(
    '0x1D = c3 size 1d skill x y serial count (idxHi idxLo)×count',
    multi === 'c3 0c 1d 05 85 83 00 02 1f 40 0b b8',
    multi
  );
  // 注意 size 字节是十六进制字符串，`Number('0c')` 会是 NaN
  check('size = 8 + count*2', parseInt(multi.split(' ')[1], 16) === 8 + 2 * 2, multi.split(' ')[1]);
  const multi6 = await c.ev(`__MU_APP__.skillPacketHex.multi(41, 1, 2, 0, [1,2,3,4,5,6,7])`);
  check('目标数封顶 5', multi6.split(' ')[7] === '05', multi6.split(' ').slice(7, 8).join(''));

  console.log('\n[字节] 0x1B 取消技能（C3 06）');
  const cancel = await c.ev(`__MU_APP__.skillPacketHex.cancel(8, 0x1F40)`);
  check('0x1B = c3 06 1b skill hi lo', cancel === 'c3 06 1b 08 1f 40', cancel);

  /* ================= B. 收包表现 ================= */
  console.log('\n[收包] 0x1E 落点必须用包里的 x/y');
  // 先造一个「远端玩家」当施法者（id 0x7e01 = 32257）
  const casterId = 0x7e01;
  const p0 = (await c.ev('__MU_APP__.state()')).player;
  await c.ev(
    `__MU_APP__.testPlayer('DurCaster', ${Math.max(1, Math.floor(p0.x) - 3)}, ${Math.max(1, Math.floor(p0.y) - 3)}, ${casterId})`
  );
  await sleep(400);
  check(
    '假施法者已进入视野',
    (await c.ev('__MU_APP__.state()')).remotes.some(r => r.id === casterId),
    JSON.stringify((await c.ev('__MU_APP__.state()')).remotes.map(r => `${r.id}:${r.name}`))
  );

  const before = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillDebug())'));
  const ev = JSON.parse(
    await c.ev(`JSON.stringify(__MU_APP__.testDurationSkill(10, ${casterId}, 150, 120, 128))`)
  );
  check('0x1E 解析：skill=10', ev && ev.skill === 10, JSON.stringify(ev));
  check('0x1E 解析：x/y 来自包里', ev && ev.x === 150 && ev.y === 120, `${ev?.x},${ev?.y}`);
  check('0x1E 解析：dir 来自包里', ev && ev.dir === 128, `${ev?.dir}`);
  check('0x1E 解析：targetId 归 0（群攻无目标）', ev && ev.targetId === 0, `${ev?.targetId}`);

  await sleep(700);
  const after = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillDebug())'));
  check('duration 计数 +1', after.duration === before.duration + 1, `${before.duration} → ${after.duration}`);
  check(
    '真的生成了特效（地狱火）',
    !!after.last && !!after.last.fx && after.last.skipped === undefined,
    JSON.stringify(after.last)
  );

  console.log('\n[收包] 0x1B 取消技能');
  const beforeC = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillDebug())'));
  const cc = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.testSkillCancel(8, 9000))`));
  check('0x1B 解析 skill=8 index=9000', cc && cc.skill === 8 && cc.index === 9000, JSON.stringify(cc));
  const afterC = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillDebug())'));
  check('cancels 计数 +1', afterC.cancels === beforeC.cancels + 1, `${beforeC.cancels} → ${afterC.cancels}`);

  /* ================= C. 真实发送 ================= */
  console.log('\n[发送] castOnline 按技能号自动选包');
  const logMark = c.logs.length;
  await c.ev('__MU_APP__.castOnline(41, 0)');
  await sleep(700);
  const l41 = c.logs.slice(logMark).find(l => l.includes('[skill] 在线施法 41')) ?? '';
  check('技能 41（旋风斩）→ 0x1E', /→ 0x1E/.test(l41), l41);

  const mark2 = c.logs.length;
  await c.ev('__MU_APP__.castOnline(3, 0)');
  await sleep(700);
  const l3 = c.logs.slice(mark2).find(l => l.includes('[skill] 在线施法 3')) ?? '';
  check('技能 3（雷电）→ 0x19', /→ 0x19/.test(l3), l3);

  const mark3 = c.logs.length;
  await c.ev('__MU_APP__.cancelSkill(8, 9000)');
  await sleep(600);
  check(
    '0x1B 上行发出去不报错',
    (await c.ev(`__MU_APP__.state().screen === 'game'`)) === true
  );
  void mark3;

  const markM = c.logs.length;
  await c.ev(`__MU_APP__.multiSkill(41, [${casterId}])`);
  await sleep(600);
  check(
    '0x1D 上行发出（日志确认）',
    c.logs.slice(markM).some(l => l.includes('[skill] 0x1D 多目标'))
  );

  const mark4 = c.logs.length;
  await c.ev(`__MU_APP__.recallAlly(${casterId}, 133, 131)`);
  await sleep(600);
  check(
    '0xB0 上行发出（日志确认）',
    c.logs.slice(mark4).some(l => l.includes('[skill] 0xB0 传送队友'))
  );

  const alive = await c.ev(`__MU_APP__.state().screen === 'game'`);
  check('三条上行发完连接没被断开', alive === true);

  /* ================= D. 自身施法也要有表现 ================= */
  console.log('\n[自身] allowSelf：本地先演一遍');
  const beforeSelf = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillDebug())'));
  const retSelf = await c.ev('__MU_APP__.castOnline(5, 0)');
  await sleep(900);
  const afterSelf = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillDebug())'));
  check('castOnline 返回 true（真的发了）', retSelf === true, JSON.stringify(retSelf));
  check(
    'castOnline 让 skillDebug.count 增加（本地播了）',
    afterSelf.count > beforeSelf.count,
    `${beforeSelf.count} → ${afterSelf.count}`
  );
  check(
    '没被当成「自己 → 跳过」',
    afterSelf.last && afterSelf.last.skipped !== 'self',
    JSON.stringify(afterSelf.last?.skipped ?? null)
  );

  await c.shot('skill-packet');

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error('ERR', e.message);
  console.log(c.logs.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  await c.close();
}
