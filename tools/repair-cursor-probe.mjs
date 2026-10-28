/**
 * 修理光标（`Cursorrepair.ozt`）的探针。
 *
 *   node tools/repair-cursor-probe.mjs
 *
 * 原版 `Cursor_Render.cpp:111`：`RepairEnable == 1|2` → 画位图 7（钻头）。
 * 我们把修理入口放在「商店开着 + 右键背包物品」，所以断言是：
 *   - 商店开着、指向**有损耗的装备** → 光标 = repair
 *   - 商店开着、指向**满耐久装备** → 光标 = arrow
 *   - 商店没开、指向同一格 → 光标不变（交给 canvas 那套）
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('repair');
const ev = e => c.ev(e);
const cursor = async () => JSON.parse(await ev(`JSON.stringify(__MU_APP__.cursor())`)).current;
const cellAt = async slot =>
  JSON.parse(
    await ev(`(() => {
      const el = document.querySelector('#mu-ui [data-drag-panel="inventory"] [data-slot="${slot}"]');
      if (!el) return 'null';
      const b = el.getBoundingClientRect();
      return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
    })()`)
  );

try {
  await c.waitFor(`!!document.getElementById('login-account')`, 20000, '登录');
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 60000, '选角');
  await sleep(2500);
  await ev(`(() => { const b = document.querySelectorAll('.char-card')[3]; b && b.click(); })()`);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);
  await c.waitFor(`__MU_APP__.state().mapId !== null`, 120000, '地图');
  await sleep(1500);

  // 武器槽(0) 放一件低耐久剑，1 号槽放满耐久剑
  const dura = await ev(`(async () => {
    __MU_APP__.mockInventory([{slot:0,type:8,durability:3},{slot:1,type:8,durability:100}]);
    __MU_APP__.toggleInventory(true);
    __MU_APP__.npcPanelOpen('shop');
    return JSON.stringify(__MU_APP__.inventory().map(i => i.slot + ':' + i.type + '@' + i.durability));
  })()`);
  console.log('背包：', dura);
  await sleep(1200);

  const damaged = await cellAt(0);
  const good = await cellAt(1);
  console.log('格位：', JSON.stringify({ damaged, good }));

  await c.ptr('mouseMoved', damaged.x, damaged.y, { buttons: 0 });
  await sleep(200);
  const c1 = await cursor();
  console.log(`指向低耐久装备 → 光标 ${c1}（期望 repair）`);

  await c.ptr('mouseMoved', good.x, good.y, { buttons: 0 });
  await sleep(200);
  const c2 = await cursor();
  console.log(`指向满耐久装备 → 光标 ${c2}（期望 arrow）`);

  // 关掉商店再指同一格：不应该再是 repair
  await ev(`__MU_APP__.npcPanelHide()`);
  await c.ptr('mouseMoved', 5, 5, { buttons: 0 });
  await sleep(100);
  await c.ptr('mouseMoved', damaged.x, damaged.y, { buttons: 0 });
  await sleep(200);
  const c3 = await cursor();
  console.log(`商店关闭后指向同一格 → 光标 ${c3}（期望不是 repair）`);

  console.log(c1 === 'repair' && c2 === 'arrow' && c3 !== 'repair' ? '✓ 修理光标条件正确' : '✗ 修理光标条件不对');
} finally {
  await c.close();
}
