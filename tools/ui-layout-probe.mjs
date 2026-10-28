/**
 * 商店 / 仓库面板版式自检：确认每个元素都落在原版坐标上。
 *
 *   node tools/ui-layout-probe.mjs
 *
 * 对照的源码数字（Win 端 0.97）：
 *   RenderInventoryInterface  HUD_Pass6.cpp:216   底板 Item_Back01/02
 *   RenderWarehouse           HUD_Pass6.cpp:1654  标题 / zen 条 / 税费 / 3 按钮
 *   RenderItemsBoxes          HUD_Pass6.cpp:232   (dword+15, dword+50) 8×15
 *
 * 改了 `.npc-*` 的坐标或贴图之后跑一下，比对着截图量像素快。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

/** 面板内所有关键元素的逻辑坐标与贴图（src 只取 blob 前缀，够判断是否加载） */
const READ_PANEL = `(() => {
  const p = document.querySelector('.npc-panel');
  if (!p) return JSON.stringify({ error: 'no panel' });
  const box = el => ({
    left: el.style.left,
    top: el.style.top,
    w: el.offsetWidth,
    h: el.offsetHeight,
    text: (el.textContent || '').trim().slice(0, 24),
    src: el.tagName === 'IMG' ? (el.src || '').slice(0, 12) : undefined,
  });
  const pick = sel => [...document.querySelectorAll(sel)].map(box);
  return JSON.stringify({
    panel: { left: p.style.left, top: p.style.top, w: p.offsetWidth, h: p.offsetHeight },
    plates: pick('.npc-panel > .npc-sprite'),
    title: pick('.npc-title'),
    grid: pick('.npc-grid'),
    cells: document.querySelectorAll('.npc-cell').length,
    zenBar: pick('.npc-zen-bar'),
    zenLabel: pick('.npc-zen-label'),
    zenValue: pick('.npc-zen-value'),
    taxLabel: pick('.npc-tax-label'),
    taxValue: pick('.npc-tax-value'),
    buttons: pick('.npc-btn'),
    close: pick('.npc-close'),
    toast: pick('.npc-toast'),
  });
})()`;

const c = await createClient('layout');

const listNpc = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.npcs())'));

/** 走到某个 Class 的 NPC 旁边并开口，直到面板打开 */
const openWith = async (cls, x, y) => {
  let n = (await listNpc()).find(e => e.cls === cls);
  if (!n) {
    await c.ev(`__MU_APP__.walkToNpc(${x}, ${y})`);
    for (let i = 0; i < 45 && !n; i++) {
      await sleep(800);
      n = (await listNpc()).find(e => e.cls === cls);
    }
  }
  if (!n) throw new Error(`看不到 Class ${cls} 的 NPC`);
  await c.ev(`__MU_APP__.talk(${n.id})`);
  for (let i = 0; i < 50; i++) {
    if (await c.ev('__MU_APP__.npcPanel().open')) break;
    await sleep(400);
  }
  await sleep(500);
};

try {
  await loginAs(c, '1234', '1234');
  await sleep(2500);

  // ---- 商店：底板 + 标题 + 网格 + 修理按钮 ----
  await openWith(255, 124, 134);
  const shop = JSON.parse(await c.ev(READ_PANEL));
  console.log('=== 商店 ===');
  console.log(JSON.stringify(shop, null, 1));
  await c.shot('npc-layout-shop');

  await c.ev('__MU_APP__.closeNpc()');
  await sleep(700);

  // ---- 仓库：再加上 zen 条 / 税费 / 3 个 24×24 按钮 ----
  await openWith(240, 146, 144);
  const wh = JSON.parse(await c.ev(READ_PANEL));
  console.log('=== 仓库 ===');
  console.log(JSON.stringify(wh, null, 1));
  await c.shot('npc-layout-warehouse');

  await c.ev('__MU_APP__.closeNpc()');
  console.log(
    '\n完成（对照值：面板 260,0 190×433；底板 190×256 + 190×177；网格 15,50 160×300；' +
      'zen 条 50,352.7 113×18；按钮 26/76/126 @390 24×24）'
  );
} catch (e) {
  console.error('ERR', e.message);
  console.log(c.logs.slice(-12).join('\n'));
} finally {
  await c.close();
}
