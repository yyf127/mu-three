/**
 * 装备槽渲染验证（只走 UI，不依赖服务端穿戴）。
 * 这台 0.97k 服务端会拒绝一切「背包→装备槽」的 0x24，所以用注入数据看渲染。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const c = await createClient('equip');
try {
  await loginAs(c, '1234', '1234');
  await c.waitFor('__MU_APP__.inventory().length > 0', 30000, '背包');
  await c.ev('__MU_APP__.toggleInventory(true)');
  await sleep(700);

  // 一套示例装备：0 武器 Kris(0) / 1 副手(箭 143) / 2 头盔(7?) / 3 铠甲 / 4 护腿 / 5 护手 / 6 战靴
  // type 用真实存在的物品，确保 itemIcon 能渲出模型
  const worn = [
    { slot: 0, type: 1 },    // Short Sword
    { slot: 1, type: 143 },  // Arrows
    { slot: 2, type: 32 },   // 头盔（group1 index0 = helm?）
    { slot: 3, type: 64 },   // 铠甲（group2 index0）
    { slot: 4, type: 96 },   // 护腿（group3）
    { slot: 5, type: 128 },  // 护手（group4? 实际可能是别的）
    { slot: 6, type: 160 },  // 战靴
    { slot: 9, type: 428 },  // Pendant of Lightning
    { slot: 10, type: 426 }, // Transformation Ring
    { slot: 11, type: 426 },
    { slot: 13, type: 450 }, // 一枚红药，验证背包格不受影响
  ];
  const n = await c.ev(`__MU_APP__.mockInventory(${JSON.stringify(worn)})`);
  console.log('注入物品数:', n);
  await sleep(2500); // 等图标离屏渲染

  const report = await c.ev(`(() => {
    const slots = [...document.querySelectorAll('.inv-equip-slot')].map(el => ({
      slot: el.dataset.slot,
      equipped: el.classList.contains('equipped'),
      iconLen: (el.querySelector('.equip-icon')?.getAttribute('src') || '').length,
      ghostOpacity: getComputedStyle(el.querySelector('.equip-ghost')).opacity,
    }));
    const gridIcons = document.querySelectorAll('.inv-item-icon').length;
    return JSON.stringify({ slots, gridIcons });
  })()`);
  const r = JSON.parse(report);
  console.log('装备槽:');
  for (const s of r.slots) {
    console.log(`  slot ${String(s.slot).padStart(2)}: equipped=${s.equipped ? 'Y' : 'n'} icon=${s.iconLen > 500 ? '✅ ' + s.iconLen + 'B' : '❌ ' + s.iconLen} ghostOpacity=${s.ghostOpacity}`);
  }
  console.log('背包格图标数:', r.gridIcons);

  // 裁出面板区域（640×480 逻辑层右侧）截图
  const box = await c.center('.inv-panel');
  const scale = await c.ev('__MU_APP__.uiScale ? __MU_APP__.uiScale() : null');
  console.log('面板中心:', box, 'scale:', scale);
  await c.shot('ui-equip-mock');
} finally { await c.close(); }
