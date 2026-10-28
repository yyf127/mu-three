/**
 * 背包 UI 探针：验证原版素材是否真的画上去了。
 *
 *   node tools/ui-inventory-probe.mjs
 *
 * 做四件事：
 *   1) 登录进图，等服务端 0xF3/0x10 背包包到达
 *   2) 按 I 打开背包，核对 DOM（底板/格子/装备槽/金币条）是不是都挂上了
 *   3) 用 /drop 造一件真物品再捡起来，确认格子里的物品图标出来了
 *   4) 截图
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const client = await createClient('inv-ui');
const js = async code => JSON.parse(await client.ev(`JSON.stringify(${code})`));

try {
  console.log('登录中…');
  const who = await loginAs(client, '1234', '1234');
  console.log(`进图 ${who.name} @ (${Math.floor(who.player.x)},${Math.floor(who.player.y)})`);

  await sleep(1200);

  /* ---- 1) 背包数据 ---- */
  console.log('\n=== 服务端背包快照（0xF3/0x10） ===');
  const inv = await js('__MU_APP__.inventory()');
  console.log(`共 ${inv.length} 件`);
  for (const it of inv.slice(0, 12)) {
    const where = it.slot >= 64 ? `装备槽${it.slot - 64}` : `背包格${it.slot}`;
    console.log(`  ${where}: ${it.type} ${it.name} ${it.wh[0]}x${it.wh[1]} 等级${it.level}`);
  }

  /* ---- 2) 打开背包 ---- */
  console.log('\n=== 打开背包 ===');
  const opened = await client.ev('__MU_APP__.toggleInventory(true)');
  console.log('inventoryOpen =', opened);
  await sleep(900);

  const dom = await js(`(() => {
    const root = document.getElementById('mu-ui');
    const panel = document.querySelector('.inv-panel');
    const plates = [...document.querySelectorAll('.inv-plate')];
    const cells = [...document.querySelectorAll('.inv-cell')];
    const equips = [...document.querySelectorAll('.inv-equip-slot')];
    const icons = [...document.querySelectorAll('.inv-item-icon')];
    const equipIcons = [...document.querySelectorAll('.equip-icon:not(.hidden)')];
    const money = document.querySelector('.inv-money-value');
    return {
      layerScale: getComputedStyle(root).transform,
      layerVisible: !root.classList.contains('hidden'),
      panelRect: panel ? panel.getBoundingClientRect().toJSON() : null,
      plates: plates.map(p => ({
        src: p.src.slice(-28),
        w: Math.round(p.getBoundingClientRect().width),
        h: Math.round(p.getBoundingClientRect().height),
        loaded: p.complete && p.naturalWidth > 0,
        nat: [p.naturalWidth, p.naturalHeight],
      })),
      cells: cells.length,
      cellsWithBg: cells.filter(c => c.querySelector('.cell-bg')?.src).length,
      takenCells: cells.filter(c => c.classList.contains('taken')).length,
      equips: equips.length,
      equipGhostLoaded: equips.filter(e => e.querySelector('.equip-ghost')?.complete).length,
      icons: icons.length,
      iconsLoaded: icons.filter(i => i.complete && i.naturalWidth > 0).length,
      equipIcons: equipIcons.length,
      money: money?.textContent,
    };
  })()`);

  console.log('UI 层可见:', dom.layerVisible, ' scale:', dom.layerScale);
  console.log('面板尺寸:', dom.panelRect && `${Math.round(dom.panelRect.width)}x${Math.round(dom.panelRect.height)}`);
  console.log('底板:', dom.plates.map(p => `${p.src} ${p.w}x${p.h} ${p.loaded ? 'OK' : '未加载'} (原图 ${p.nat.join('x')})`).join(' | '));
  console.log(`格子 ${dom.cells}（带底图 ${dom.cellsWithBg}，占用 ${dom.takenCells}）`);
  console.log(`装备槽 ${dom.equips}（占位图已加载 ${dom.equipGhostLoaded}）`);
  console.log(`物品图标 ${dom.icons}（已渲染 ${dom.iconsLoaded}），装备图标 ${dom.equipIcons}`);
  console.log('金币:', dom.money);

  await client.shot('inv-open');

  /* ---- 3) 掉一件真物品再捡 ---- */
  console.log('\n=== 扔一件 Kris 再捡起来 ===');
  await client.ev(`__MU_APP__.chat('/drop 0 0 0 0 0 0 0')`);
  await sleep(2500);

  const ground = await js('__MU_APP__.items()');
  console.log('地面物品:', ground.map(i => `${i.id}:type${i.type}@(${i.x},${i.y})`).join(', ') || '（无）');

  if (ground.length) {
    const target = ground[0];
    // 直接走过去捡（pickupItem 会自己算距离/走路）
    await client.ev(`__MU_APP__.pickupItem(${target.id})`);
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      const left = await js('__MU_APP__.items()');
      if (!left.some(x => x.id === target.id)) break;
    }
    await sleep(1200);
    const inv2 = await js('__MU_APP__.inventory()');
    console.log(`捡完后背包 ${inv2.length} 件`);
    for (const it of inv2) {
      if (it.slot < 64) console.log(`  格${it.slot}: ${it.name} ${it.wh.join('x')}`);
    }
    const icons2 = await js(`document.querySelectorAll('.inv-item-icon').length`);
    console.log('格内图标数:', icons2);
    await client.shot('inv-after-pickup');
  }

  /* ---- 4) 报错检查 ---- */
  const errs = client.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exc]'));
  const warns = client.logs.filter(l => l.includes('[ui]') || l.includes('[items]'));
  console.log(`\n控制台错误 ${errs.length} 条，资源告警 ${warns.length} 条`);
  for (const e of errs.slice(0, 8)) console.log('  ' + e.slice(0, 200));
  for (const w of warns.slice(0, 8)) console.log('  ' + w.slice(0, 200));
} finally {
  await client.close();
}
