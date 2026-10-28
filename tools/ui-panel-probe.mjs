/**
 * 角色属性面板 + 底栏的端到端检查。
 *
 *   node tools/ui-panel-probe.mjs
 *
 * 检查四件事：
 *   1. 底栏三段贴图 + 两个角饰都载入了（OZT 那个最容易静默失败）
 *   2. 三个按钮的逻辑坐标和原版 Player_InputTick.cpp:280-330 的命中框一致
 *   3. C 键能开属性面板，且和背包互斥
 *   4. 面板上每一行的文字都是真实字段（不是占位）
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const c = await createClient('panels');
try {
  await loginAs(c, '1234', '1234');
  await c.waitFor('__MU_APP__.inventory().length > 0', 30000, '背包');
  await sleep(1200);

  /* ---------------- 1. 底栏 ---------------- */
  const bar = JSON.parse(
    await c.ev(`JSON.stringify({
      visible: !document.querySelector('.bottom-bar').classList.contains('hidden'),
      tiles: [...document.querySelectorAll('.bar-tile')].map(el => ({
        w: el.style.width, h: el.style.height, left: el.style.left, top: el.style.top,
        loaded: el.complete && el.naturalWidth > 0, nw: el.naturalWidth, nh: el.naturalHeight,
      })),
      corners: [...document.querySelectorAll('.bar-corner')].map(el => ({
        left: el.style.left, loaded: el.complete && el.naturalWidth > 0,
        nw: el.naturalWidth, nh: el.naturalHeight, flip: el.style.transform,
      })),
    })`)
  );
  console.log('底栏显示:', bar.visible ? 'Y' : 'N');
  console.log('三段贴图:');
  for (const t of bar.tiles) {
    console.log(
      `  @${t.left},${t.top} ${t.w}×${t.h}  ${t.loaded ? '✅ ' + t.nw + '×' + t.nh : '❌ 未载入'}`
    );
  }
  console.log('角饰:');
  for (const t of bar.corners) {
    console.log(`  @${t.left}  ${t.loaded ? '✅ ' + t.nw + '×' + t.nh : '❌ 未载入'} ${t.flip || ''}`);
  }

  /* ---------------- 2. 按钮命中框 ---------------- */
  const btns = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.bottomButtons())'));
  console.log('\n按钮命中框（应为 party 348 / character 379 / inventory 410，y=452，24×24）:');
  for (const b of btns) console.log(`  ${String(b.id).padEnd(10)} (${b.x}, ${b.y}) ${b.w}×${b.h}`);

  /* ---------------- 3. 面板互斥 ---------------- */
  await c.ev('__MU_APP__.toggleInventory(true)');
  await sleep(400);
  const invOpen = await c.ev('__MU_APP__.inventoryOpen()');
  await c.ev('__MU_APP__.toggleCharacter(true)');
  await sleep(700);
  console.log(`\n开背包=${invOpen}，再开属性面板后：`);
  console.log(`  属性面板 = ${await c.ev('__MU_APP__.characterOpen()')}`);
  console.log(`  背包     = ${await c.ev('__MU_APP__.inventoryOpen()')}  ← 应该被互斥关掉`);

  /* ---------------- 4. 文本行 ---------------- */
  const rows = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.characterRows())'));
  console.log('\n属性面板文本:');
  for (const [k, v] of Object.entries(rows)) {
    if (v) console.log(`  ${k.padEnd(10)} ${v}`);
  }
  const empty = Object.entries(rows).filter(([, v]) => !v).map(([k]) => k);
  console.log('  空行:', empty.length ? empty.join(', ') : '无');

  // 底板 / 行底 / 加号按钮的实际几何
  const geo = JSON.parse(
    await c.ev(`(() => {
      const q = s => [...document.querySelectorAll(s)];
      const stage = document.getElementById('stage') || document.body;
      const sb = stage.getBoundingClientRect();
      const s = sb.width / 640;
      const box = el => {
        const b = el.getBoundingClientRect();
        return {
          x: Math.round((b.left - sb.left) / s),
          y: Math.round((b.top - sb.top) / s),
          w: Math.round(b.width / s),
          h: Math.round(b.height / s),
          ok: el.complete && el.naturalWidth > 0,
        };
      };
      return JSON.stringify({
        plates: q('.chr-plate').map(box),
        rowBg: q('.chr-row-bg').map(box),
        plus: q('.chr-plus').map(el => ({ ...box(el), shown: el.style.display !== 'none' })),
      });
    })()`)
  );
  console.log('\n底板:', geo.plates.map(p => `${p.x},${p.y} ${p.w}×${p.h} ${p.ok ? '✅' : '❌'}`).join('  '));
  console.log('属性行底:', geo.rowBg.length, '条', geo.rowBg.map(p => `${p.x},${p.y}`).join(' '));
  console.log('加号按钮:', geo.plus.map(p => `${p.x},${p.y}${p.shown ? '' : '(隐藏)'}`).join(' '));

  const errs = c.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exc]'));
  const warns = c.logs.filter(l => l.startsWith('[warning]'));
  console.log('\n控制台错误', errs.length, '条；告警', warns.length, '条');
  for (const w of warns.slice(-5)) console.log('  ', w);

  /* ---------------- 5. 点底栏按钮 ---------------- */
  // 先全关，再用鼠标点「角色」按钮（真实 CDP 事件，不是直接调函数）
  await c.ev('__MU_APP__.toggleCharacter(false); __MU_APP__.toggleInventory(false);');
  await sleep(300);
  const btn = await c.center('[data-btn="character"]');
  await c.dragTo(btn.x, btn.y, btn.x, btn.y, 2);
  await sleep(700);
  console.log('\n点击底栏「角色」按钮 → 属性面板 =', await c.ev('__MU_APP__.characterOpen()'));

  const invBtn = await c.center('[data-btn="inventory"]');
  await c.dragTo(invBtn.x, invBtn.y, invBtn.x, invBtn.y, 2);
  await sleep(700);
  console.log('点击底栏「背包」按钮 → 背包 =', await c.ev('__MU_APP__.inventoryOpen()'),
              '，属性面板 =', await c.ev('__MU_APP__.characterOpen()'));

  // 回到属性面板截图
  await c.ev('__MU_APP__.toggleInventory(false); __MU_APP__.toggleCharacter(true);');
  await sleep(900);
  await c.shot('ui-character');

  /* ---------------- 6. 装备加成 ---------------- */
  // 服务端拒收「背包→装备槽」，所以注入装备槽数据来验证攻防那三行的算术
  const before = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.characterRows())'));
  await c.ev(
    `__MU_APP__.mockInventory(${JSON.stringify([
      { slot: 0, type: 0, level: 0 }, // Kris 6-11
      { slot: 2, type: 224, level: 0 }, // Bronze Helm 防御 9
      { slot: 3, type: 256, level: 0 }, // Leather Armor 防御 10
      { slot: 13, type: 450, level: 0 }, // 背包里的红药，不该影响面板
    ])})`
  );
  await sleep(900);
  const after = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.characterRows())'));
  console.log('\n装备加成（注入 左手 Kris + Bronze Helm + Leather Armor）:');
  console.log(`  攻击  ${before.damage}  →  ${after.damage}`);
  console.log(`  防御  ${before.defense}  →  ${after.defense}`);
  console.log(`  防御率 ${before.defrate}  →  ${after.defrate}（不吃装备，应不变）`);
  await c.shot('ui-character-geared');
} finally {
  await c.close();
}
