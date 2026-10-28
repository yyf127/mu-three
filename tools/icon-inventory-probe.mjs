/**
 * 背包 / 商店 / 仓库里的物品图标：朝向前后对比的截图。
 *
 *   node tools/icon-inventory-probe.mjs
 *
 * 塞一批典型物品（剑/斧/弓/杖/盾/盔/铠/护腿/战靴/药水）进背包，
 * 截三张图：背包、商店、仓库。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('iconinv');
const ev = e => c.ev(e);
const shot = async f => {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(f, Buffer.from(r.data, 'base64'));
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
  await sleep(1500);

  // 12 件典型装备铺满背包上面几行
  const types = [0, 8, 32, 64, 128, 160, 192, 224, 256, 288, 352, 452];
  await ev(`(() => {
    __MU_APP__.mockInventory(${JSON.stringify(types)}.map((t, i) => ({ slot: 12 + i, type: t })));
    __MU_APP__.toggleInventory(true);
    return 1;
  })()`);
  await sleep(4000); // 等 BMD 解完 + 图标渲染
  await shot('shots/icons/inventory.png');
  console.log('背包 → shots/icons/inventory.png');

  await ev(`__MU_APP__.npcPanelOpen('shop')`);
  await sleep(3500);
  await shot('shots/icons/shop.png');
  console.log('商店 → shots/icons/shop.png');

  await ev(`__MU_APP__.npcPanelOpen('warehouse')`);
  await sleep(3500);
  await shot('shots/icons/warehouse.png');
  console.log('仓库 → shots/icons/warehouse.png');
} finally {
  await c.close();
}
