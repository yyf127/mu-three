/**
 * 服务器传送窗口（`0x30 result=5`）的探针。
 *
 *   node tools/server-division-probe.mjs
 *
 * 本机 GameServer 的 `MonsterSetBase.txt` 里没有 234 号 NPC，真实会话收不到
 * `0x30 result=5`，所以界面用 `__MU_APP__.serverDivision()` 注入，
 * 断言布局 / 勾选 / 二次确认 / 退出全部按原版走：
 *
 *   `RenderServerDivision`（HUD_Pass6.cpp:323）
 *     底板 450,0 190×433 · 标题 8 行居中在 545，y=50 起每行 20
 *     复选框 475,240 16×16 · 说明 494,245
 *     确定 485,320 · 取消 485,350，都是 120×24
 *   `ServerTransfer_HitTest`（SecondPassword.cpp:1019）
 *     没勾选时点「确定」无反应；勾了才弹确认框
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('svd');
const ev = e => c.ev(e);
const snap = async () => JSON.parse(await ev(`JSON.stringify(__MU_APP__.serverDivisionState())`));

let pass = true;
const check = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) pass = false;
};

/** 逻辑坐标 → 屏幕坐标（面板层是 640×480 的 #mu-ui，跟着舞台 scale） */
const toScreen = async (x, y) =>
  JSON.parse(
    await ev(`(() => {
      const l = document.getElementById('mu-ui');
      const s = (document.getElementById('stage').clientWidth || 640) / 640;
      const r = l.getBoundingClientRect();
      return JSON.stringify({ x: r.left + ${x} * s, y: r.top + ${y} * s });
    })()`)
  );

const click = async (x, y) => {
  const p = await toScreen(x, y);
  const hit = await ev(`(() => {
    const el = document.elementFromPoint(${p.x}, ${p.y});
    return el ? el.tagName + '.' + (el.className || '') : 'null';
  })()`);
  console.log(`    [diag] 逻辑(${x},${y}) → 屏幕(${p.x.toFixed(0)},${p.y.toFixed(0)}) 命中 ${hit}`);
  await c.ptr('mousePressed', p.x, p.y);
  await sleep(40);
  await c.ptr('mouseReleased', p.x, p.y);
  await sleep(260);
};

try {
  await c.waitFor(`!!document.getElementById('login-account')`, 25000, '登录');
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 90000, '选角');
  await sleep(2200);
  await ev(`(() => { const b = document.querySelectorAll('.char-card')[3]; b && b.click(); })()`);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);
  await c.waitFor(`__MU_APP__.state().mapId !== null`, 120000, '进图');
  await sleep(1600);

  // 1) 打开
  const s0 = JSON.parse(await ev(`JSON.stringify(__MU_APP__.serverDivision(true))`));
  await sleep(700); // 等贴图
  console.log('面板几何：', JSON.stringify({ panel: s0.panel, check: s0.check, ok: s0.ok, cancel: s0.cancel }));
  check(s0.open, '窗口打开');
  check(s0.panel.x === 450 && s0.panel.w === 190, '底板贴右边缘（x=450, w=190）');
  check(s0.check.x === 475 && s0.check.y === 240 && s0.check.w === 16, '复选框 (475,240) 16×16');
  check(s0.ok.x === 485 && s0.ok.y === 320 && s0.ok.w === 120 && s0.ok.h === 24, '确定 (485,320) 120×24');
  check(s0.cancel.y === 350, '取消 (485,350)');
  console.log('  标题 8 行：');
  s0.lines.forEach((l, i) => console.log(`    ${i}: ${l}`));
  check(s0.lines.length === 8 && s0.lines.every(l => l.length > 0), '8 行标题文案都取到了（GlobalText[462..469]）');

  // 2) 没勾选点「确定」→ 什么都不该发生
  await click(545, 332);
  const s1 = await snap();
  check(!s1.confirming, '没勾选时点「确定」无反应（原版 `DAT_083a4124` 那个判断）');

  // 3) 勾选 → 确定 → 二次确认
  await click(483, 248);
  const s2 = await snap();
  check(s2.accepted, '点复选框 → accepted = true');

  await click(545, 332);
  const s3 = await snap();
  check(s3.confirming, '勾选后点「确定」→ 弹二次确认框');

  const shot1 = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shots/server-division-confirm.png', Buffer.from(shot1.data, 'base64'));

  // 4) 确认框点「取消」→ 回到条款界面（窗口还开着）
  const noBtn = JSON.parse(
    await ev(`(() => {
      const b = document.querySelector('#svd-panel .svd-no');
      const r = b.getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    })()`)
  );
  await c.ptr('mousePressed', noBtn.x, noBtn.y);
  await sleep(40);
  await c.ptr('mouseReleased', noBtn.x, noBtn.y);
  await sleep(300);
  const s4 = await snap();
  check(!s4.confirming && s4.open, '确认框点「取消」→ 只关确认框，窗口还在');

  // 5) 再点确定 → 确认「是」→ 窗口关闭
  await click(545, 332);
  await sleep(200);
  const yesBtn = JSON.parse(
    await ev(`(() => {
      const b = document.querySelector('#svd-panel .svd-yes');
      const r = b.getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    })()`)
  );
  await c.ptr('mousePressed', yesBtn.x, yesBtn.y);
  await sleep(40);
  await c.ptr('mouseReleased', yesBtn.x, yesBtn.y);
  await sleep(500);
  const s5 = await snap();
  check(!s5.open, '确认「是」→ 窗口关闭并发出关闭包');

  // 6) 重新打开 → 状态复位（accepted 回到 false）
  const s6 = JSON.parse(await ev(`JSON.stringify(__MU_APP__.serverDivision(true))`));
  await sleep(600);
  check(s6.open && !s6.accepted, '重新打开时勾选状态复位');

  const shot2 = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shots/server-division.png', Buffer.from(shot2.data, 'base64'));

  // 7) ESC 关闭
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(400);
  const s7 = await snap();
  check(!s7.open, 'ESC 关闭窗口（不会顺手打开游戏内主菜单）');
  const escState = JSON.parse(await ev(`JSON.stringify(__MU_APP__.esc())`));
  check(!escState.open, 'ESC 没有把游戏内主菜单一起弹出来');

  console.log(pass ? 'PASS' : 'FAIL');
} finally {
  await c.close();
}
