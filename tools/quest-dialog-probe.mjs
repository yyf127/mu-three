/** 任务 → 对话链探针（离线，读 chs/quest.bmd + chs/Dialog.bmd） */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
let pass = 0, fail = 0;
const check = (l, ok, d='') => { ok ? (pass++, console.log(`  ✓ ${l}${d?'  '+d:''}`)) : (fail++, console.log(`  ✗ ${l}${d?'  '+d:''}`)); };
const c = await createClient('questdlg');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '离线进图');
  await c.waitFor(`document.getElementById('mu-ui').getBoundingClientRect().width > 0`, 20000, 'UI 可见');
  await sleep(600);

  const list = JSON.parse(await c.ev(`(async () => JSON.stringify(await __MU_APP__.questList()))()`));
  console.log(`\n任务表：${list.length} 条有 NPC`);
  for (const q of list.slice(0, 4)) console.log(`  #${q.index} npc=${q.npc} ${JSON.stringify(q.name)} dialogs=${q.dialogs.join(',')}`);
  check('任务表能解出中文名', list.length > 0 && /寻找/.test(list[0].name), list[0] && list[0].name);
  check('任务 0 的 NPC 是 235（圣导士塞维娜）', list[0] && list[0].npc === 235, String(list[0] && list[0].npc));
  check('任务 0 的第一个对话号是 52', list[0] && list[0].dialogs[0] === 52, String(list[0] && list[0].dialogs[0]));

  const idx = await c.ev(`__MU_APP__.questForNpc(235)`);
  check('questForNpc(235) → 52', idx === 52, String(idx));
  const none = await c.ev(`__MU_APP__.questForNpc(1)`);
  check('没有任务的 NPC 返回 -1', none === -1, String(none));

  // 显示第 52 条：应当是塞维娜的任务开场白
  await c.ev(`__MU_APP__.dialog(${idx})`);
  await sleep(400);
  const d = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.dialogSnapshot())'));
  console.log('\n[52]', JSON.stringify(d && d.text.slice(0, 50)), d && d.answers);
  check('第 52 条能打开且是中文', !!d && /[\u4e00-\u9fa5]/.test(d.text), d ? d.text.slice(0, 24) : 'null');

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally { await c.close(); }
