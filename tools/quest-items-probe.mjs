/**
 * 任务物品条件（`known-issues` C11）的探针。
 *
 *   node tools/quest-items-probe.mjs
 *
 * 原版链路：
 *   `CSQuest::CheckActCondition`（Scene_CharSelect_Nav.cpp:103）
 *     → `CSQuest_FindQuestItemsInInven(type, count, -1)`（Runtime_Medium.cpp:689）
 *        遍历背包 8×8 格数 Type 匹配件数，够了返回 0
 *     → 齐了就走 `FindQuestContext(act, 1)`（可以交了）
 *        没齐走 `FindQuestContext(act, 2)`（还在进行中）
 *
 * `quest.bmd` 里物品条件在职业段 +2/+3/+4：
 *   Type = (+2) << 5 | (+3)，数量 = +4
 *   任务 0「寻找帝王之书」→ 471 帝王之书 ×1
 *   任务 1「三种宝物」   → 472 断魂之剑 / 473 精灵之泪 / 474 先知之魂 各 1
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('questitems');
const ev = e => c.ev(e);
const st = async () => JSON.parse(await ev(`JSON.stringify(__MU_APP__.state())`));

try {
  // 1) 纯数据层：不登录也能查
  await c.waitFor(`!!window.__MU_APP__`, 25000, 'app');
  const t0 = JSON.parse(await ev(`(async () => JSON.stringify(await __MU_APP__.questTextOf(0, 1)))()`));
  const t1 = JSON.parse(await ev(`(async () => JSON.stringify(await __MU_APP__.questTextOf(1, 1)))()`));
  console.log('任务 0「寻找帝王之书」：物品 =', JSON.stringify(t0.items), ' texts =', JSON.stringify(t0.texts));
  console.log('  进行中(没齐) →', t0.shownInProgress, ' 可交(齐了) →', t0.shownReadyToHandIn);
  console.log('任务 1「三种宝物」：物品 =', JSON.stringify(t1.items), ' texts =', JSON.stringify(t1.texts));
  console.log('  进行中(没齐) →', t1.shownInProgress, ' 可交(齐了) →', t1.shownReadyToHandIn);

  const parseOk = t0.items && t0.items.type === 471 && t0.items.count === 1 && t1.items && t1.items.type === 472;
  console.log(parseOk ? '✓ 物品条件解析正确（471 帝王之书 / 472 断魂之剑）' : '✗ 物品条件解析不对');

  // 2) 真实会话：背包空 → 没齐；塞一个 → 齐了
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 90000, '选角');
  await sleep(2200);
  await ev(`(() => { const b = document.querySelectorAll('.char-card')[3]; b && b.click(); })()`);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);
  await c.waitFor(`__MU_APP__.state().mapId !== null`, 120000, '进图');
  await sleep(1500);

  const empty = JSON.parse(await ev(`(async () => JSON.stringify(await __MU_APP__.questItems(1)))()`));
  console.log('背包空 →', JSON.stringify(empty), '（期望 got 0, ok false）');

  // 塞一件「断魂之剑」（TYPE 472）到背包第 12 格
  await ev(`(() => { __MU_APP__.mockInventory([{ slot: 12, type: 472 }]); return 1; })()`);
  await sleep(600);
  const full = JSON.parse(await ev(`(async () => JSON.stringify(await __MU_APP__.questItems(1)))()`));
  console.log('背包有 1 件 472 →', JSON.stringify(full), '（期望 got 1, ok true）');

  // 3) 状态 1 + 物品齐了 → 对话用「可以交」那条
  const during = JSON.parse(await ev(`(async () => JSON.stringify(await __MU_APP__.questTextOf(1, 1)))()`));
  console.log(`状态 1 且物品齐了 → shown = ${during.shown}（期望 ${during.shownReadyToHandIn}），hasItems = ${during.hasItems}`);

  // 4) 真开对话窗看对话号
  const shown = await ev(`(async () => JSON.stringify(await __MU_APP__.questDialogShow(1, 1)))()`);
  const snap = JSON.parse(await ev(`JSON.stringify(__MU_APP__.dialogSnapshot())`));
  console.log('questDialogShow(1, 1) →', shown, ' 对话窗 idx =', snap?.index, `（期望 ${during.shownReadyToHandIn}）`);

  // 5) 把物品拿走 → 回到「进行中」
  await ev(`(() => { __MU_APP__.mockInventory([]); return 1; })()`);
  await sleep(400);
  const back = await ev(`(async () => JSON.stringify(await __MU_APP__.questDialogShow(1, 1)))()`);
  const snap2 = JSON.parse(await ev(`JSON.stringify(__MU_APP__.dialogSnapshot())`));
  console.log('清空背包后再开 →', back, ' 对话窗 idx =', snap2?.index, `（期望 ${during.shownInProgress}）`);

  const ok =
    parseOk &&
    empty.ok === false &&
    full.ok === true &&
    during.shown === during.shownReadyToHandIn &&
    snap?.index === during.shownReadyToHandIn &&
    snap2?.index === during.shownInProgress;
  console.log(ok ? 'PASS' : 'FAIL');
} finally {
  await c.close();
}
