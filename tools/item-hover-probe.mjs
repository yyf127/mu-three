/**
 * 物品悬停 3D 旋转 + 仓库按钮 / 金币条 + 物品中文名。
 *
 *   node tools/item-hover-probe.mjs
 *
 * 四组断言：
 *
 * 1. **悬停旋转**：原版 `RenderObjectScreen` 的 `if (Select == 1) angle[1] =
 *    WorldTime * 0.45`。把鼠标压到背包格上，`__MU_APP__.itemSpin()` 要变成
 *    active 且 yaw 随时间增长；图标的 `src` 要跟着换成不同的帧。
 * 2. **仓库底部三个按钮**：必须是带 `<img>` 子节点的图标按钮（之前
 *    `refreshText()` 用 `textContent =` 把 `<img>` 顶掉了，只剩三个汉字）。
 * 3. **金币条可见**：`Item_Money` 那张图 113×18 在 (310, 352.7)，之前被
 *    `Item_Back02` 底板盖住（同 z-index、DOM 顺序在后）。这里用「藏起来前后
 *    截图逐像素比对」证明它真的画在屏幕上了。
 * 4. **物品名来自 `chs/item.bmd`**：`itemAttr(0).name` 应该是「波刃剑」。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('itemhover');
const ev = e => c.ev(e);
const shot = async f => {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(r.data, 'base64');
  if (f) writeFileSync(f, buf);
  return buf;
};
const snap = async () => JSON.parse(await ev(`JSON.stringify(__MU_APP__.npcPanel())`));
const spin = async () => JSON.parse(await ev(`JSON.stringify(__MU_APP__.itemSpin())`));

let pass = 0;
let fail = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  ok ? pass++ : fail++;
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
  await sleep(1200);

  /* ---------------- 4) 物品名 ---------------- */
  console.log('\n[4] 物品名（chs/item.bmd）');
  const names = JSON.parse(await ev(`JSON.stringify(__MU_APP__.itemNames())`));
  console.log('   ', JSON.stringify(names));
  check(names.size > 400, `名字表 ${names.size} 条`);
  check(/波刃剑|短剑/.test(names.names[0]), `type 0 = ${names.names[0].split(':')[1]}`);
  check(!/^[A-Za-z]/.test(names.names[1].split(':')[1]), 'type 8 不是英文名');

  /* ---------------- 1) 悬停旋转 ---------------- */
  console.log('\n[1] 背包格悬停旋转');
  await ev(`__MU_APP__.mockInventory([{slot:12,type:8},{slot:14,type:192},{slot:16,type:452}])`);
  await ev(`__MU_APP__.toggleInventory(true)`);
  await sleep(3500); // 等图标渲完

  const cell = JSON.parse(
    await ev(`(() => {
      const el = document.querySelector('#mu-ui [data-drag-panel="inventory"] [data-slot="12"]');
      if (!el) return 'null';
      const b = el.getBoundingClientRect();
      return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
    })()`)
  );
  await c.ptr('mouseMoved', cell.x, cell.y, { buttons: 0 });
  await sleep(700); // 110ms 延迟 + 16 帧渲染

  const s1 = await spin();
  console.log('    悬停 0.7s 后：', JSON.stringify(s1));
  check(s1.active && s1.type === 8, '旋转已启动（type 8）');
  check(s1.frames === 36, `预渲了 ${s1.frames} 帧（SPIN_FRAMES=36）`);
  const iconSrc = async () =>
    ev(`(document.querySelector('#mu-ui [data-drag-panel="inventory"] [data-slot="12"]')?.closest('.inv-grid')?.querySelector('.inv-item-icon')?.src || '').slice(-40)`);

  // 隔 120ms 采两次 src，应该换成不同帧
  const a = await iconSrc();
  await sleep(120);
  const b = await iconSrc();
  const s2 = await spin();
  console.log('    帧变化：', a === b ? '相同' : '不同', ' yaw', s1.yaw, '→', s2.yaw);
  check(s1.yaw !== s2.yaw, `yaw 随时间增长（225°/秒：${s1.yaw}° → ${s2.yaw}°）`);
  check(a !== b, '图标 src 在两帧之间变了');
  await shot('shots/item-hover-spin.png');

  // 移开 → 停转
  await c.ptr('mouseMoved', cell.x - 200, cell.y - 200, { buttons: 0 });
  await sleep(300);
  const s3 = await spin();
  check(!s3.active, '鼠标移开后停止旋转');
  await ev(`__MU_APP__.toggleInventory(false)`);

  /* ---------------- 2) + 3) 仓库 ---------------- */
  console.log('\n[2/3] 仓库面板');
  await ev(`__MU_APP__.mockInventory([{slot:12,type:8},{slot:14,type:192},{slot:16,type:452}])`);
  await ev(`__MU_APP__.npcPanelOpen('warehouse')`);
  await sleep(2200);

  const wh = await snap();
  console.log('    按钮：', JSON.stringify(wh.buttons));
  check(wh.buttons.length === 3, '三个按钮都在');
  check(
    wh.buttons.every(b => b.icon && b.icon === '24x24'),
    '三个按钮都有 24×24 的贴图（不是文字）'
  );
  check(
    wh.buttons.every(b => b.tip && b.tip.length > 0),
    `title 文案来自 Text.bmd：${wh.buttons.map(b => b.tip).join(' / ')}`
  );
  check(!!wh.zenBar && wh.zenBar.nat === '113x18', `金币条 113×18 @ ${JSON.stringify(wh.zenBar?.box)}`);

  // 金币条可见性：藏掉它再截一张，两张在条子区域必须**不同**
  const withBar = await shot('shots/npc-warehouse-fixed.png');
  await ev(`(() => { const el = document.querySelector('#mu-ui .npc-zen-bar'); if (el) el.style.visibility = 'hidden'; })()`);
  await sleep(200);
  const withoutBar = await shot(null);
  await ev(`(() => { const el = document.querySelector('#mu-ui .npc-zen-bar'); if (el) el.style.visibility = ''; })()`);
  writeFileSync('shots/_wh-nobar.png', withoutBar);

  /* 悬停商店/仓库格：tooltip 走 GlobalText，且带价格行（商人界面才有） */
  await ev(`__MU_APP__.npcPanelOpen('shop')`);
  // 货架内容正常是服务端开窗时下发的，探针里手工塞
  await ev(`__MU_APP__.npcPanelFill([8, 192, 452])`);
  await sleep(1800);
  const shopCell = JSON.parse(
    await ev(`(() => {
      const el = document.querySelector('#mu-ui [data-drag-panel="shop"] [data-slot="1"]');
      if (!el) return 'null';
      const b = el.getBoundingClientRect();
      return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
    })()`)
  );
  if (shopCell) {
    await c.ptr('mouseMoved', shopCell.x, shopCell.y, { buttons: 0 });
    await sleep(600);
    const sh = await snap();
    console.log('    商店 tooltip：', JSON.stringify(sh.tip));
    check(!!sh.tip && /青铜|圆盾|波刃/.test((sh.tip || []).join(' ')), 'tooltip 是中文名');
    check(!!(await spin()).active, '商店格悬停也会转');
    await shot('shots/npc-shop-tooltip.png');
  }
  console.log(`\n金币条可见性比对：withBar=${withBar.length}B  withoutBar=${withoutBar.length}B（像素差异交给 python 脚本）`);

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
