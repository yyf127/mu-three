/** NPC 对话窗探针（离线，读 Data/Local/chs/Dialog.bmd） */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
let pass = 0, fail = 0;
const check = (l, ok, d='') => { ok ? (pass++, console.log(`  ✓ ${l}${d?'  '+d:''}`)) : (fail++, console.log(`  ✗ ${l}${d?'  '+d:''}`)); };
const c = await createClient('dialog');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '离线进图');
  await c.waitFor(`document.querySelector('.npc-dialog') !== null`, 20000, '对话窗已建');
  // UI 层在进图前是隐藏的（rect 全 0），等它真正显示出来再量
  await c.waitFor(`document.getElementById('mu-ui').getBoundingClientRect().width > 0`, 20000, 'UI 层可见');
  await sleep(800);

  // [A] 打开第 6 条（合成 NPC，4 个答案，答案 1 链接到第 7 条）
  await c.ev(`__MU_APP__.dialog(6)`);
  await sleep(400);
  const s0 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.dialogSnapshot())'));
  console.log('\n[6]', JSON.stringify(s0 && s0.text.slice(0, 40)), s0 && s0.answers);
  check('第 6 条对话文本是中文原文', /金不足是不能给您合成/.test(s0.text), s0.text.slice(0, 30));
  check('答案 4 条（合成？/金不足？/研究.../再见~）', s0.answers.length === 4, String(s0.answers.length));

  const dom = JSON.parse(await c.ev(`JSON.stringify({
    lines: document.querySelector('.nd-text').textContent.split('\\n').length,
    textWidth: document.querySelector('.nd-text').getBoundingClientRect().width,
    answers: [...document.querySelectorAll('.nd-answer')].map(b => b.textContent),
    rect: (() => { const r = document.querySelector('.npc-dialog').getBoundingClientRect(); return {w: Math.round(r.width), h: Math.round(r.height)}; })(),
    bg: !!document.querySelector('.nd-bg'),
  })`));
  console.log('[DOM]', JSON.stringify(dom));
  check('正文不超过 7 行', dom.lines <= 7, `${dom.lines} 行`);
  check('答案渲染成「1) …」', /^1\) /.test(dom.answers[0]), dom.answers[0]);
  check('Message_box 底板已加载', dom.bg === true, String(dom.bg));

  // [B] 点答案 1 → 跳到第 7 条
  await c.ev(`document.querySelectorAll('.nd-answer')[0].click()`);
  await sleep(400);
  const s1 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.dialogSnapshot())'));
  console.log('\n[7]', JSON.stringify(s1 && s1.text), s1 && s1.answers);
  check('答案 1 跳到第 7 条（这里可以合成物品）', !!s1 && /合成物品/.test(s1.text), s1 ? s1.text : 'null');

  // [C] 数字键 2 选中第 7 条的第 2 个答案（link=-1 → 关闭）
  await c.ev(`document.querySelector('.npc-dialog').dispatchEvent(new Event('x'))`);
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '2', code: 'Digit2', windowsVirtualKeyCode: 50 });
  await sleep(300);
  const s2 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.dialogSnapshot())'));
  check('数字键选答案后关窗（link<0）', s2 === null, JSON.stringify(s2));

  // [D] 无答案的对话补「结束对话」
  await c.ev(`__MU_APP__.dialog(3)`);
  await sleep(300);
  const s3 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.dialogSnapshot())'));
  const a3 = JSON.parse(await c.ev(`JSON.stringify([...document.querySelectorAll('.nd-answer')].map(b => b.textContent))`));
  check('无答案时补一条「结束对话」', a3.length === 1 && /结束对话/.test(a3[0]), a3.join(','));
  check('第 3 条文本正确', !!s3 && /听听风吹过/.test(s3.text), s3 ? s3.text.slice(0, 20) : 'null');

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally { await c.close(); }
