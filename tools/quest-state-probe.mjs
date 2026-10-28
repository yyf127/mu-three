/**
 * 任务对话「按状态选文案 + 状态变化后重开」的探针（`docs/migration/known-issues.md` C8）。
 *
 *   node tools/quest-state-probe.mjs
 *
 * 原版链路（CONFIRMED_SOURCE）：
 *   `Net_Process.cpp:7213`（0xA1）/ `:7223`（0xA2 且 result==0）
 *     → `CSQuest::ShowQuestNpcWindow(-1)` → `CheckQuestState(0xff)`
 *     → `FindQuestContext(act, 0|1|2|3)` 挑四段文本之一 → `ShowDialogText`
 *
 * quest.bmd 每个职业段的四段对话在 `+10/+12/+14/+16`（short[5..8]）：
 *   任务 0（235 塞维娜「寻找帝王之书」）= 52 / 54 / 55 / 56
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('queststate');
const ev = e => c.ev(e);
const snap = async () => {
  const raw = await ev(`JSON.stringify(__MU_APP__.dialogSnapshot())`);
  return raw && raw !== 'null' ? JSON.parse(raw) : null;
};

try {
  await c.waitFor(`!!window.__MU_APP__`, 25000, 'app');

  // 1) 状态 → 对话号
  //    任务 0 texts = 52 / 54 / 55 / 56
  //      52 = 开场「寻找帝王之书」
  //      54 = 进行中·东西没齐「去找回帝王之书吧」
  //      55 = 进行中·东西齐了「您真的找回了帝王之书」
  //      56 = 完成
  for (const [state, key, want, why] of [
    [0, 'shown', 52, '未接'],
    [1, 'shownInProgress', 54, '进行中·没齐'],
    [1, 'shownReadyToHandIn', 55, '进行中·齐了'],
    [2, 'shown', 56, '已完成'],
  ]) {
    const r = JSON.parse(await ev(`(async () => JSON.stringify(await __MU_APP__.questTextOf(0, ${state})))()`));
    console.log(`任务 0 状态 ${state}（${why}）→ 对话 ${r?.[key]}（期望 ${want}）texts=${JSON.stringify(r?.texts)}`);
  }

  // 2) 从对话窗点「接受」→ 0xA2 回来 → 按新状态重开
  await c.waitFor(`!!document.getElementById('login-account')`, 20000, '登录');
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 60000, '选角');
  await sleep(2500);
  await ev(`(() => { const b = document.querySelectorAll('.char-card')[3]; b && b.click(); })()`);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);
  await c.waitFor(`__MU_APP__.state().mapId !== null`, 120000, '地图');
  await sleep(1500);

  // 2) 从「接受」那条答案点下去 → 0xA2 回来 → 按新状态重开
  //    任务 1（奇迹大陆的3种宝物）四段文本 = 60/61/62/72，接受选项在对话 60 里
  const shown = await ev(`(async () => JSON.stringify(await __MU_APP__.questDialogShow(1, 0)))()`);
  await sleep(300);
  console.log('任务 1 状态 0 → 对话', shown, '（期望 60）');
  const clicked = await ev(`(() => {
    const btn = document.querySelector('#mu-ui .npc-dialog .nd-answer');
    if (!btn) return 'no-answer';
    btn.click();
    return 'clicked';
  })()`);
  await sleep(200);
  // 模拟 0xA2 result=0 state=1（接取成功）
  const fed = await ev(`(async () => JSON.stringify(__MU_APP__.questResultFeed(1, 1)))()`);
  await sleep(600);
  const after = await snap();
  // 接取后 state=1、背包里没有断魂之剑 → 61「找到断魂之剑就回来找我吧」
  // （62 是「您真的找到了断魂之剑」，要有物品才出，见 tools/quest-items-probe.mjs）
  console.log('  点答案 →', clicked, ' 0xA2 回执 →', fed, ' 之后对话窗 idx =', after?.index, '（期望 61 = 进行中·没齐）');
  console.log(after?.index === 61 ? '✓ 状态变化后按新状态重开了对话' : '✗ 没有按状态重开');
} finally {
  await c.close();
}
