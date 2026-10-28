/**
 * 选角界面 ESC 菜单 + 「返回登录/返回线路选择」的探针。
 *
 *   node tools/charselect-esc-probe.mjs
 *
 * 断言：
 *   1. 选角按 ESC → 菜单出来，**只有 3 项**：返回线路选择 / 选项 / 取消
 *   2. 点「选项」→ 进选项视图（4 项，第一行是标题不可点）
 *   3. ESC 从选项回主菜单，再 ESC 关掉（原版 toggle）
 *   4. 点「返回线路选择」→ 回登录界面、阶段 = servers、socket 断开
 *   5. 再登录一次，点「返回登录」按钮（#btn-back）→ 同样回 servers
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('caresc');
const ev = e => c.ev(e);
const snap = async () => JSON.parse(await ev(`JSON.stringify(__MU_APP__.esc())`));
const state = async () => JSON.parse(await ev(`JSON.stringify(__MU_APP__.state())`));
const esc = async () => {
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(220);
};

/** 点菜单里第 i 个按钮（用它在页面里的真实矩形，别猜坐标） */
const clickBtn = async (i, view) => {
  const box = JSON.parse(
    await ev(`(() => {
      const menu = document.getElementById('esc-menu');
      const boxes = [...menu.querySelectorAll('.esc-box')].filter(b => !b.classList.contains('hidden'));
      const box = boxes[0];
      if (!box) return 'null';
      const el = box.querySelectorAll('.esc-btn')[${i}];
      if (!el) return 'null';
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    })()`)
  );
  if (!box) throw new Error(`点不到第 ${i} 个按钮（view=${view}）`);
  await c.ptr('mousePressed', box.x, box.y);
  await sleep(40);
  await c.ptr('mouseReleased', box.x, box.y);
  await sleep(320);
};

let pass = true;
const check = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) pass = false;
};

try {
  await c.waitFor(`!!document.getElementById('login-account')`, 25000, '登录界面');
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 90000, '选角');
  await sleep(2500);

  // 1) ESC 出菜单
  await esc();
  const m = await snap();
  console.log('选角 ESC →', JSON.stringify(m.items.map(i => i.label)));
  check(m.open && m.mode === 'charselect' && m.view === 'main', '菜单打开，模式 = charselect');
  check(m.items.length === 3, `只有 3 项（实际 ${m.items.length}）`);
  const labels = m.items.map(i => i.label.replace(/\s/g, ''));
  check(
    labels[0] === '返回线路选择' && labels[1] === '选项' && labels[2] === '取消',
    `文案 = ${JSON.stringify(m.items.map(i => i.label))}`
  );
  // 按钮几何：x 260 / 宽 120 / 行距 30（和游戏内那套同一份坐标）
  console.log('  几何：', JSON.stringify(m.items.map(i => [i.x, i.y, i.w, i.h])));
  check(
    m.items.every(i => i.x === 260 && i.w === 120 && i.h === 22) &&
      m.items[1].y - m.items[0].y === 30 &&
      m.items[2].y - m.items[1].y === 30,
    '坐标 = 源码那套（x260 w120 h22，行距 30）'
  );

  {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync('shots/charselect-esc.png', Buffer.from(r.data, 'base64'));
  }

  // 2) 选项
  await clickBtn(1, 'main');
  const o = await snap();
  console.log('点「选项」→', JSON.stringify(o.items.map(i => i.label)));
  check(o.view === 'options' && o.items.length === 4, '进选项视图（4 行）');

  // 3) ESC 回主菜单 → 再 ESC 关闭
  await esc();
  const back = await snap();
  check(back.view === 'main' && back.open, 'ESC 从选项回主菜单');
  await esc();
  const closed = await snap();
  check(!closed.open, '再 ESC 关掉菜单');

  // 4) 返回线路选择
  await esc();
  await clickBtn(0, 'main');
  await sleep(1200);
  const s1 = await state();
  console.log('点「返回线路选择」→', JSON.stringify({ screen: s1.screen, loginStage: s1.loginStage, connected: s1.connected }));
  check(s1.screen === 'login', '回到登录界面');
  check(s1.loginStage === 'servers', '阶段 = 线路选择');
  check(s1.connected === false || s1.connected === undefined, 'socket 已断开');

  // 5) 再登一次，用「返回登录」按钮
  await sleep(800);
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 90000, '第二次选角');
  await sleep(2200);
  await ev(`document.getElementById('btn-back').click()`);
  await sleep(1500);
  const s2 = await state();
  console.log('点「返回登录」→', JSON.stringify({ screen: s2.screen, loginStage: s2.loginStage, connected: s2.connected }));
  check(s2.screen === 'login' && s2.loginStage === 'servers', '返回登录 → 同样回到线路选择');

  // 6) 回登录之后还能再登（不是死界面）
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 90000, '第三次选角（验证不是死界面）');
  check(true, '返回后还能重新登录进选角');

  console.log(pass ? 'PASS' : 'FAIL');
} finally {
  await c.close();
}
