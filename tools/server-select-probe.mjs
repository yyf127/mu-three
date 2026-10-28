/**
 * 「选择线路」界面的探针：核对 ConnectServer 列表 → 选中 → 拿到 GameServer 地址
 * → 切到账号密码界面。
 *
 *   node tools/server-select-probe.mjs
 *
 * 判据（不依赖 console.log，CDP 只转发 error/warn）：
 *   1. `__MU_APP__.serverList()` 里有组、有线路、load 值来自服务端
 *   2. 点组行后 `state().hi` 变成 0、`sv-row.sel` 出现
 *   3. 点线路行后 `state().loginStage === 'account'`，
 *      且 `state().gameServer` 是 ConnectServer 的 F4/03 回给我们的地址
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('serversel');
const ev = e => c.ev(e);
const shot = async f => {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(f, Buffer.from(r.data, 'base64'));
};
/** 真实鼠标单击（走 CDP Input，pointerdown/up 都会触发） */
const click = async (x, y) => {
  await c.ptr('mouseMoved', x, y, { buttons: 0 });
  // 点之前先看一眼命中的是谁（被启动画面 / 自绘光标挡住过一次，加了这行好定位）
  console.log(
    '    [diag] hit =',
    await ev(`(() => { const el = document.elementFromPoint(${x}, ${y});
      return el ? el.tagName + '.' + (el.className || '') + '『' + (el.textContent || '').trim().slice(0, 12) + '』' : 'null'; })()`)
  );
  await c.ptr('mousePressed', x, y);
  await sleep(30);
  await c.ptr('mouseReleased', x, y);
};
const state = async () => JSON.parse(await ev(`JSON.stringify(__MU_APP__.state())`));
const list = async () => JSON.parse(await ev(`JSON.stringify(__MU_APP__.serverList())`));

/** 拿一行（组 / 线路）的屏幕中心点 */
const rowAt = async sel =>
  JSON.parse(
    await ev(`(() => {
      const els = [...document.querySelectorAll('#server-select ${sel}')];
      if (!els.length) return 'null';
      const b = els[0].getBoundingClientRect();
      return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2, n: els.length });
    })()`)
  );

try {
  await c.waitFor(`!!document.getElementById('login-account')`, 20000, '登录界面');
  // 列表是异步拉的（ConnectServer 握手 + F4/02）
  await c.waitFor(`__MU_APP__.serverList().groups.length > 0 && !__MU_APP__.serverList().error`, 15000, '线路列表');
  // 启动画面（`#intro`）盖在最上面，它会吃掉第一次 pointerdown（"点一下跳过"），
  // 等它收掉再点，否则第一次点击只是把 logo 关掉
  await c.waitFor(`document.getElementById('intro').classList.contains('hidden')`, 8000, '启动画面收掉');
  await sleep(300);

  const s0 = await list();
  console.log('阶段：', (await state()).loginStage, '  离线兜底：', s0.offline);
  console.log('线路：', JSON.stringify(s0.groups, null, 0));
  const rows = await rowAt('.sv-row');
  console.log('组行数：', rows?.n, ' 首个中心：', JSON.stringify({ x: rows?.x, y: rows?.y }));
  await shot('shots/server-select.png');

  // 点组 → 出现线路子表
  await click(rows.x, rows.y);
  await sleep(700);
  const s1 = await list();
  const chRow = await rowAt('.sv-row[data-code]');
  console.log('点组后 hi =', s1.hi, ' 线路行数 =', chRow?.n);
  await shot('shots/server-select-channels.png');

  // 点线路 → F4/03 → 账号密码界面
  await click(chRow.x, chRow.y);
  await c.waitFor(`__MU_APP__.state().loginStage === 'account'`, 15000, '账号密码界面');
  await sleep(600);
  const s2 = await state();
  console.log('选中线路 →', JSON.stringify(s2.gameServer), ' 阶段 =', s2.loginStage);
  const picked = (await list()).picked;
  console.log('pick 结果：', JSON.stringify(picked));
  await shot('shots/server-select-account.png');

  // 顺着这条线路真的登录一次，确认 `gameServer` 那对 host/port 真能用
  await ev(`(() => { document.getElementById('login-account').value = '1234';
    document.getElementById('login-password').value = '1234';
    document.getElementById('btn-login').click(); })()`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 90000, '选角（走 F4/03 拿到的地址）');
  console.log('登录成功 → 进入选角，socket 目标 =', JSON.stringify((await state()).gameServer));
} finally {
  await c.close();
}
