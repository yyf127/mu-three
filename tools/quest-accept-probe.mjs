/** 对话答案 → 任务发包链路（离线：只看有没有走到发包分支） */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
let pass = 0, fail = 0;
const check = (l, ok, d='') => { ok ? (pass++, console.log(`  ✓ ${l}${d?'  '+d:''}`)) : (fail++, console.log(`  ✗ ${l}${d?'  '+d:''}`)); };
const c = await createClient('qaccept');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`document.getElementById('mu-ui').getBoundingClientRect().width > 0`, 20000, 'UI');
  await sleep(600);

  const info = JSON.parse(await c.ev(`(async () => JSON.stringify(await __MU_APP__.questDialogOpen(235)))()`));
  console.log('\n任务:', JSON.stringify(info));
  check('打开塞维娜(235)的任务对话', !!info && info.index === 0, JSON.stringify(info));

  const active = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.questDialog())'));
  check('当前对话记住了任务号', active && active.index === 0, JSON.stringify(active));

  /*
   * 52 号对话的答案 return=-1（只是"再聊聊"），真正"接受"在第 53 条的答案 2
   * （`哇~让我去试试吧！` → ret=1）。这里直接打开 53 点它。
   */
  await c.ev(`__MU_APP__.dialog(53)`);
  await sleep(400);
  const ansCount = await c.ev(`document.querySelectorAll('.nd-answer').length`);
  console.log('  53 号答案数 =', ansCount);
  await c.ev(`document.querySelectorAll('.nd-answer')[1].click()`);
  await sleep(500);
  const logs = (c.logs || []).filter(l => l.includes('[quest]'));
  console.log('  日志:', logs.slice(-2).join(' | '));
  check('点「接受」答案走到了发包分支（return=1）', logs.some(l => /return=1/.test(l)), logs.slice(-1).join(''));
  check('没有崩（对话层仍在）', (await c.ev(`!!document.querySelector('.npc-dialog')`)) === true, '');

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally { await c.close(); }
