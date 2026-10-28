/**
 * 任务系统探针（0xA0 状态表 / 0xA1 / 0xA2 / Data/Quest 数据表）。
 *
 *   node tools/quest-probe.mjs
 *   node tools/quest-probe.mjs 账号 密码
 *
 * 断言分两层：
 *   1. **真实服务端**：登录后会推 0xA0（50 字节 bitmask），客户端要能解析；
 *      窗口能打开、任务列表来自 `Data/Quest/*.txt`、详情里的等级/目标/奖励正确。
 *   2. **UI 状态机**：`injectQuestResult` 注入 0xA2 回执（走和收包同一条
 *      `applyQuestResult`），验证「未接 → 进行中 → 已完成」的列表与按钮变化。
 *
 * 为什么不直接让服务端接受任务：`Quest.txt` 里这两个任务都要求**等级 150**，
 * 测试账号等级不够，服务端 `GetInfoByIndex` 过滤后**静默不回包**（不是回 0xFF）。
 * 所以「点接取」这一步只验证包发出去了、连接没断；状态流转用注入验证。
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

const c = await createClient('quest');

try {
  const who = await loginAs(c, account, password);
  console.log(`进图：${who.name} map=${who.mapId}`);
  await sleep(2500);

  /* ---------------- 1. 0xA0 状态表 ---------------- */
  const sawA0 = c.logs.some(l => l.includes('[quest] 0xA0'));
  check('收到 0xA0 任务状态表', sawA0, sawA0 ? '' : '日志里没有 [quest] 0xA0');

  /* ---------------- 2. 数据表 + 窗口 ---------------- */
  const opened = await c.ev('__MU_APP__.openQuests()');
  check('任务窗口打开', opened === true);

  const view = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.questPanelView())'));
  check('数据表解析出任务', view.quests.length >= 2, `${view.quests.length} 个`);
  check(
    '任务标题来自目标（金币/物品）',
    view.quests.some(q => /Zen|×/.test(q.title)),
    view.quests.map(q => q.title).join(' | ')
  );

  const states = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.quests())')).states;
  check('状态位被展开成 任务号→状态', Object.keys(states).length >= 2, JSON.stringify(states));

  /* ---------------- 3. 详情（等级 / 目标 / 奖励） ---------------- */
  await c.ev('__MU_APP__.selectQuest(0)');
  await sleep(200);
  const detail0 = await c.ev('__MU_APP__.questPanelView().detail');
  check('详情显示需求等级 150', /需求等级：150/.test(detail0), detail0.split('\n')[0]);
  check('详情显示目标（Zen 或物品）', /目标：/.test(detail0));
  check('详情显示奖励', /奖励：/.test(detail0), detail0.split('\n').slice(-2).join('/'));

  const action0 = await c.ev('__MU_APP__.questPanelView().action');
  check('未接取时按钮是「接取」', action0 === '接取', `按钮=${action0}`);

  /* ---------------- 4. 点接取：包能发出去、连接不断 ---------------- */
  await c.ev('__MU_APP__.questAction(0)');
  await sleep(1500);
  const alive = await c.ev(`__MU_APP__.state().screen === 'game'`);
  check('点接取后连接没被断开', alive === true);
  check('0xA2 上行已发出', c.logs.some(l => l.includes('[quest] 0xA2 index=0')));

  /* ---------------- 5. 注入回执：状态机与 UI ---------------- */
  const v1 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.injectQuestResult(0, 0, 1))'));
  await sleep(200);
  const row1 = v1.quests.find(q => q.index === 0);
  check('注入「接取成功」→ 状态 1（进行中）', row1?.state === 1, `state=${row1?.state}`);
  check('按钮变成「完成」', v1.action === '完成', `按钮=${v1.action}`);
  check('详情切到进行中的目标（物品 471）', /×1/.test(v1.detail), v1.detail.split('\n').slice(-1)[0]);

  const v2 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.injectQuestResult(0, 0, 2))'));
  await sleep(200);
  const row2 = v2.quests.find(q => q.index === 0);
  check('注入「完成」→ 状态 2（已完成）', row2?.state === 2, `state=${row2?.state}`);
  check('已完成时按钮隐藏', v2.action === null, `按钮=${v2.action}`);

  const v3 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.injectQuestResult(0, 255, 1))'));
  const row3 = v3.quests.find(q => q.index === 0);
  check('注入失败回执（0xFF）不改状态', row3?.state === 2, `state=${row3?.state}`);

  /* ---------------- 6. 关闭 ---------------- */
  await c.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true }))`);
  await sleep(300);
  const closed = await c.ev('__MU_APP__.quests().open');
  check('J 键关闭任务窗口', closed === false);

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error('ERR', e.message);
  console.log(c.logs.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  await c.close();
}
