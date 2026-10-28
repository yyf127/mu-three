/** F1 帮助窗探针（离线，读 chs/Text.bmd 120..157） */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
let pass = 0, fail = 0;
const check = (l, ok, d='') => { ok ? (pass++, console.log(`  ✓ ${l}${d?'  '+d:''}`)) : (fail++, console.log(`  ✗ ${l}${d?'  '+d:''}`)); };
const c = await createClient('help');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '离线进图');
  await c.waitFor(`document.getElementById('mu-ui').getBoundingClientRect().width > 0`, 20000, 'UI 可见');
  await sleep(500);

  await c.ev(`__MU_APP__.help()`);
  await sleep(500);
  const lines = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.helpSnapshot())'));
  console.log(`\n帮助窗：${lines ? lines.length : 0} 行`);
  for (const l of (lines || []).slice(0, 6)) console.log('  ' + l);
  check('帮助窗打开了且有内容', !!lines && lines.length >= 30, `${lines ? lines.length : 0} 行`);
  check('标题「快捷键说明」', (lines || []).some(l => /快捷键说明/.test(l)), '');
  check('F1 那行来自原文（F1 : 帮助 On/Off）', (lines || []).some(l => /F1\s*:\s*帮助/.test(l)), '');
  check('聊天指令标题', (lines || []).some(l => /聊天指令说明/.test(l)), '');
  check('有中文指令行（/组队 或 /交易）', (lines || []).some(l => /\/组队|\/交易/.test(l)), '');
  check('帮助窗里没有乱码（替换字符）', !(lines || []).some(l => /\uFFFD/.test(l)), '');

  // F1 再按一次关闭
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
  await sleep(300);
  const after = await c.ev('JSON.stringify(__MU_APP__.helpSnapshot())');
  check('再按 F1 关闭', after === 'null', after);

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally { await c.close(); }
