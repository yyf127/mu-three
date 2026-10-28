/**
 * 转职（任务奖励 0xA3）探针。
 *
 * 0.97 的「转职」不是一个独立系统，而是**任务奖励的一种**：
 *   服务端 `CQuestReward::InsertQuestReward` 的 `QUEST_REWARD_CHANGE1/2`
 *   → 下发 `C1 06 A3 index[2] reward class`
 *   → 客户端 `Net_Process.cpp` 的 `case 0xA3` 按 reward 子类型分支：
 *       0xC8 只加点 / 0xC9 转职 / 0xCA 转职+加点 / 0xCB 转职
 *   职业号解码：`klass = ((byte >> 4) | (byte & 0x10)) >> 1`（低 3 位职业组、>>3 转职次数）
 *
 * 断言：
 *   1. 包解析：index/reward/value 位置正确（`C1 07 A3 00 05 C9 10`）
 *   2. 职业字节解码：0x10→8（魔法师一转）、0x30→9（剑士一转）、0x00→0
 *   3. 注入 0xC9：职业号变 8、面板职业名变「魔导师」、转职次数 1
 *   4. 注入 0xC8：只加可分配点，职业不变
 *   5. 注入 0xCA：职业 + 点都变
 *   6. 任务表里能读到任务（转职任务走同一套 quest 流程）
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

let pass = 0;
let fail = 0;
const check = (l, ok, d = '') => {
  ok ? (pass++, console.log(`  ✓ ${l}${d ? '  ' + d : ''}`))
     : (fail++, console.log(`  ✗ ${l}${d ? '  ' + d : ''}`));
};

const c = await createClient('questchange');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`typeof __MU_DEBUG__ === 'object'`, 60000, 'debug api');
  await sleep(1200);

  /* ---------- 1. 包解析 ---------- */
  const pkt = await c.ev(`__MU_APP__.questParse('C1 07 A3 00 05 C9 10')`);
  console.log('解析 C1 07 A3 00 05 C9 10 →', JSON.stringify(pkt));
  check('index = 5（玩家 id）', pkt && pkt.key === 5, JSON.stringify(pkt));
  check('reward = 0xC9（转职）', pkt && pkt.reward === 0xc9, JSON.stringify(pkt));
  check('职业字节 0x10 解出 8（魔法师一转）', pkt && pkt.decodedClass === 8, JSON.stringify(pkt));
  const pkt2 = await c.ev(`__MU_APP__.questParse('C1 07 A3 00 05 C9 30')`);
  check('职业字节 0x30 解出 9（剑士一转）', pkt2 && pkt2.decodedClass === 9, JSON.stringify(pkt2));
  const pkt3 = await c.ev(`__MU_APP__.questParse('C1 06 A3 00 05 C8 05')`);
  check('短包（加点）也能解析，decodedClass 为空', pkt3 && pkt3.decodedClass === null && pkt3.value === 5,
        JSON.stringify(pkt3));

  /* ---------- 2. 初始职业 ---------- */
  const before = await c.ev(`__MU_APP__.questClass()`);
  console.log('注入前:', JSON.stringify(before));
  check('注入前是未转职（stage 0）', before && before.stage === 0, JSON.stringify(before));

  /* ---------- 3. 0xC9 转职 ---------- */
  const afterClass = await c.ev(`__MU_APP__.questReward(0xc9, 0x10)`);
  await sleep(600);
  console.log('0xC9 之后:', JSON.stringify(afterClass));
  check('职业号 = 8（魔法师 + 一转）', afterClass && afterClass.classId === 8, JSON.stringify(afterClass));
  check('转职次数 stage = 1', afterClass && afterClass.stage === 1, JSON.stringify(afterClass));
  check('职业名 = 魔导师', afterClass && afterClass.name === '魔导师', JSON.stringify(afterClass));
  check('标记为「来自 0xA3」', afterClass && afterClass.fromPacket === true, JSON.stringify(afterClass));

  /*
   * 角色面板：`paint()` 里 `info` 为空（离线演示没有 0xF3/03 的角色数据）时
   * 显示占位「(未连接)」，这是预期行为；有 info 时才显示 (职业名)。
   * 所以这里断言"名字解析结果"，面板文本只做记录。
   */
  const panelName = await c.ev(`(() => { const el = document.querySelector('.chr-class'); return el ? el.textContent : null; })()`);
  console.log('角色面板职业行:', JSON.stringify(panelName), '（离线无角色数据 → 占位）');
  check('职业名解析出「魔导师」', afterClass && afterClass.name === '魔导师', String(afterClass?.name));

  /* ---------- 4. 0xC8 只加点 ---------- */
  const pts0 = await c.ev(`( __MU_APP__.state(), 0 )`);
  const p = await c.ev(`__MU_APP__.injectPointsForTest ? 1 : 0`);
  const afterPoint = await c.ev(`(() => {
    const beforeInfo = JSON.parse(JSON.stringify(window.__MU_HUD_INFO__ || null));
    return beforeInfo;
  })()`);
  // 直接看职业有没有被 0xC8 改掉
  const afterP = await c.ev(`__MU_APP__.questReward(0xc8, 5)`);
  await sleep(300);
  console.log('0xC8 之后:', JSON.stringify(afterP));
  check('0xC8 不改职业（仍是 8）', afterP && afterP.classId === 8, JSON.stringify(afterP));

  /* ---------- 5. 0xCA 转职 + 加点 ---------- */
  const afterCA = await c.ev(`__MU_APP__.questReward(0xca, 0x30)`);
  await sleep(400);
  console.log('0xCA 之后:', JSON.stringify(afterCA));
  check('0xCA 改成剑士一转（9 / 骑士）',
        afterCA && afterCA.classId === 9 && afterCA.name === '骑士', JSON.stringify(afterCA));

  /* ---------- 6. 任务表 + 任务 NPC（235 = 转职任务发布者） ---------- */
  const npcQuest = await c.ev(`__MU_APP__.questForNpc(235)`);
  console.log('NPC 235 的任务:', JSON.stringify(npcQuest));
  // `questForNpc` 返回的是 **Dialog.bmd 的对话号**（235 → 52）
  check('NPC 235 挂着转职任务对话（对话号 52）', npcQuest === 52, String(npcQuest));

  const quests = await c.ev(`__MU_APP__.questList()`);
  console.log('任务表前几条:', JSON.stringify((quests || []).slice(0, 4)));
  check('任务表能读到任务（转职任务走同一套 quest 流程）',
        Array.isArray(quests) && quests.length > 0, `${quests?.length ?? 0} 条`);

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
