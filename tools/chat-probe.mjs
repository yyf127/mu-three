/**
 * 聊天框探针。
 *
 *   node tools/chat-probe.mjs
 *
 * 断言四件事（全部对回客户端源码的硬编码坐标）：
 *   1. 6 行消息在 x=196、y=404-13*row，latest 在最下面
 *   2. 五个频道各一条：颜色 / 背景（0 金、4 蓝、5 绿，1/2/3 无底）
 *   3. Enter 打开输入条 → Dialogue1/Dialogue2 各 133×29 出现在 (186,415)/(320,415)
 *   4. 真键盘输入 + Enter 发送 → 服务端广播回来的 0x00 有没有进日志
 *      （自己发的也会收到一份，所以不做本地回显）
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient, loginAs } from './lib/edge-client.mjs';

const c = await createClient('chat');
try {
  await loginAs(c, '1234', '1234');
  await sleep(1500);

  // 1) 先塞五条假消息，量几何 + 取色
  const geo = JSON.parse(
    await c.ev(`(() => {
      const stage = document.querySelector('#stage').getBoundingClientRect();
      const k = stage.width / 640;
      const L = e => { const b = e.getBoundingClientRect();
        return [(b.x - stage.x) / k, (b.y - stage.y) / k, b.width / k, b.height / k].map(v => Math.round(v * 10) / 10); };
      __MU_APP__.pushChat('Alice', 'hello world', 3);
      __MU_APP__.pushChat('', 'Server notice: maintenance at 22:00', 1);
      __MU_APP__.pushChat('Bob', 'whisper to you', 2);
      __MU_APP__.pushChat('Carol', 'party up', 4);
      __MU_APP__.pushChat('Dave', 'guild meeting', 5);
      const rows = [...document.querySelectorAll('.chat-line')].map(el => {
        const body = el.querySelector('.chat-text');
        const who = el.querySelector('.chat-who');
        const cs = getComputedStyle(el);
        return {
          box: L(el),
          text: el.textContent,
          fg: body ? getComputedStyle(body).color : null,
          whoFg: who ? getComputedStyle(who).color : null,
          bg: cs.backgroundColor,
        };
      });
      return JSON.stringify({ rows, log: __MU_APP__.chatLog().lines.length });
    })()`)
  );
  console.log('日志条数:', geo.log);
  for (const r of geo.rows) {
    console.log(`  ${JSON.stringify(r.box)} ${r.text.padEnd(38)} fg=${r.fg} bg=${r.bg}`);
  }

  // 2) 真的按 Enter 开输入条
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(400);
  const open = JSON.parse(
    await c.ev(`(() => {
      const stage = document.querySelector('#stage').getBoundingClientRect();
      const k = stage.width / 640;
      const L = e => { const b = e.getBoundingClientRect();
        return [(b.x - stage.x) / k, (b.y - stage.y) / k, b.width / k, b.height / k].map(v => Math.round(v * 10) / 10); };
      const panels = [...document.querySelectorAll('.chat-panel')];
      return JSON.stringify({
        typing: __MU_APP__.chatLog().typing,
        focus: document.activeElement && document.activeElement.className,
        panels: panels.map(p => ({ box: L(p), nat: [p.naturalWidth, p.naturalHeight], hidden: p.parentElement.classList.contains('hidden') })),
        input: (() => { const el = document.querySelector('.chat-input'); return { box: L(el), hidden: el.classList.contains('hidden') }; })(),
      });
    })()`)
  );
  console.log('输入条:', JSON.stringify(open));

  // 3) 打字 + Enter 发送
  await c.send('Input.insertText', { text: 'hello from h5' });
  await sleep(200);
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(1200);

  const after = JSON.parse(
    await c.ev(`JSON.stringify({
      typing: __MU_APP__.chatLog().typing,
      last: __MU_APP__.chatLog().lines.slice(-3),
      sent: __MU_APP__.packets(0x00).length,
    })`)
  );
  console.log('发送后:', JSON.stringify(after));

  // 4) 截图：聊天区 + 输入条
  const rect = JSON.parse(
    await c.ev(`(() => { const r = document.querySelector('#stage').getBoundingClientRect();
      return JSON.stringify({ x: r.left, y: r.top, width: r.width, height: r.height }); })()`)
  );
  const k = rect.width / 640;
  await c.ev(`__MU_APP__.openChat('typing...')`);
  await sleep(300);
  const clip = { x: rect.x + 180 * k, y: rect.y + 320 * k, width: 280 * k, height: 130 * k, scale: 3 };
  const shot = await c.send('Page.captureScreenshot', { format: 'png', clip });
  writeFileSync('shots/chat-box.png', Buffer.from(shot.data, 'base64'));
  console.log('saved shots/chat-box.png');
  const full = await c.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } });
  writeFileSync('shots/chat-full.png', Buffer.from(full.data, 'base64'));
  console.log('saved shots/chat-full.png');

  const errs = c.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exc]'));
  console.log('控制台错误:', errs.length);
  for (const e of errs.slice(0, 4)) console.log('  ' + e);
} finally {
  await c.close();
}
