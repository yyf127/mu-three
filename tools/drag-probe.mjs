/**
 * 跨面板拖拽的探针：仓库 / 商店 / 丢弃。
 *
 *   node tools/drag-probe.mjs
 *
 * 用调试口把面板直接摆出来（`npcPanelOpen` + `npcPanelFill` + `mockInventory`），
 * 然后用真实鼠标拖拽（CDP 注入 pointer 事件），核对这四条链路：
 *
 *   背包格 → 仓库面板   应发 `0x24` flag 0→2（日志 `[warehouse] 存入槽位 …`）
 *   仓库格 → 背包面板   应发 `0x24` flag 2→0（日志 `[warehouse] 取出仓库格 …`）
 *   货架格 → 背包面板   应发 `0x32`        （日志 `[shop] 购买货架格 …`）
 *   背包格 → 商店面板   应发 `0x33`        （日志 `[shop] 出售槽位 …`）
 *   背包格 → 3D 画面    应发 `0x23`        （日志 `[items] 丢弃槽位 …`）
 *
 * 不依赖走到 NPC：服务端会因为这些是「假物品」而拒绝执行，但**请求确实发出去了**，
 * 日志和面板提示就是判据。真正的端到端（东西真的换了位置）需要站在 NPC 旁边。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('drag');
const ev = e => c.ev(e);
const shot = async f => {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(f, Buffer.from(r.data, 'base64'));
};
/**
 * 判据：拖拽落点记录（`__MU_APP__.dragLog()`，`ui/itemDrag.ts` 每松手写一条）
 * + 面板 toast（发包被服务端拒绝时各面板会提示）。
 * 页面里的 `console.log` 抓不到（CDP 只转发了 error/warn），所以不用它断言。
 */
const dropLog = async () => JSON.parse(await ev(`JSON.stringify(__MU_APP__.dragLog())`));
const toasts = async () =>
  JSON.parse(await ev(`JSON.stringify([
    document.querySelector('#mu-ui .inv-toast')?.textContent ?? '',
    document.querySelector('#mu-ui .npc-toast')?.textContent ?? '',
  ])`));

const cellAt = async (panel, slot) =>
  JSON.parse(
    await ev(`(() => {
      const el = document.querySelector('#mu-ui [data-drag-panel="${panel}"] [data-slot="${slot}"]');
      if (!el) return 'null';
      const b = el.getBoundingClientRect();
      return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
    })()`)
  );

/**
 * 面板上「空白处」的一个落点（不命中格子，但命中面板本身）。
 *
 * 面板高度会随内容变（商店/仓库的底板按行数拉伸），所以不能只量一次
 * `bottom-6` —— 量完到真正松手之间面板缩一点，那一点就跑到面板外面，
 * 落点会判成「地面」。这里直接从几个候选点里挑第一个 elementFromPoint
 * 真的命中面板的，避免探针自己抖动。
 */
const panelEdge = async panel =>
  JSON.parse(
    await ev(`(() => {
      const el = document.querySelector('#mu-ui [data-drag-panel="${panel}"]');
      if (!el) return 'null';
      const b = el.getBoundingClientRect();
      // 优先用**面板顶部那条标题带**：面板高度会随内容变（底板按行数拉伸），
      // 顶部是固定的；底部那几px 量完到松手之间可能已经缩到面板外了。
      const cands = [
        [b.left + 8, b.top + 8],
        [b.left + b.width / 2, b.top + 10],
        [b.left + 8, b.bottom - 14],
        [b.left + 8, b.bottom - 6],
        [b.left + b.width / 2, b.bottom - 8],
      ];
      for (const [x, y] of cands) {
        const hit = document.elementFromPoint(x, y);
        if (hit && hit.closest('[data-drag-panel="${panel}"]')) return JSON.stringify({ x, y });
      }
      return JSON.stringify({ x: b.left + 8, y: b.bottom - 6 });
    })()`)
  );

let seen = 0;
const report = async tag => {
  const all = await dropLog();
  const added = all.slice(seen);
  seen = all.length;
  const t = (await toasts()).filter(Boolean).join(' / ');
  console.log(
    `  ${tag} → 落点 ${JSON.stringify(added.map(d => d.target))}` +
      `  at=${JSON.stringify(added.map(d => d.at))} hit=${JSON.stringify(added.map(d => d.hit))}  提示「${t}」`
  );
  return added.length > 0;
};

try {
  await c.waitFor(`!!document.getElementById('login-account')`, 20000, '登录');
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 60000, '选角');
  await sleep(2500);
  await ev(`(() => { const b = document.querySelector('.char-card'); b && b.click(); })()`);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);
  await c.waitFor(`__MU_APP__.state().mapId !== null`, 120000, '地图');
  await sleep(2000);

  // 背包：放两瓶药 + 一件甲（12/13/14 三个格）
  await ev(`__MU_APP__.mockInventory([{slot:12,type:14},{slot:13,type:14},{slot:14,type:8}])`);
  await ev(`__MU_APP__.toggleInventory(true)`);
  await sleep(1200);

  /* ---------------- 仓库 ---------------- */
  await ev(`__MU_APP__.npcPanelOpen('warehouse')`);
  await sleep(600);
  await ev(`__MU_APP__.npcPanelFill([${[8, 0, 14].join(',')}])`);
  await sleep(1200);
  console.log('仓库面板：', await ev(`JSON.stringify(__MU_APP__.npcPanel().items.map(i => i.slot + ':' + i.name))`));

  let from = await cellAt('inventory', 12);
  let to = await panelEdge('warehouse');
  console.log(`[存入] 背包 12 → 仓库面板  ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
  await c.dragTo(from.x, from.y, to.x, to.y, 14);
  await sleep(900);
  await report('存入');

  from = await cellAt('warehouse', 0);
  to = await panelEdge('inventory');
  console.log(`[取回] 仓库 0 → 背包面板  ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
  await c.dragTo(from.x, from.y, to.x, to.y, 14);
  await sleep(900);
  await report('取回');
  await shot('shots/drag-warehouse.png');

  /* ---------------- 商店 ---------------- */
  await ev(`__MU_APP__.npcPanelOpen('shop')`);
  await sleep(500);
  await ev(`__MU_APP__.npcPanelFill([${[14, 15, 22].join(',')}])`);
  await sleep(1000);
  console.log('商店面板：', await ev(`JSON.stringify(__MU_APP__.npcPanel().items.map(i => i.slot + ':' + i.name))`));

  from = await cellAt('shop', 0);
  to = await panelEdge('inventory');
  console.log(`[购买] 货架 0 → 背包面板  ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
  await c.dragTo(from.x, from.y, to.x, to.y, 14);
  await sleep(900);
  await report('购买');

  from = await cellAt('inventory', 13);
  to = await panelEdge('shop');
  console.log(`[出售] 背包 13 → 商店面板  ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
  await c.dragTo(from.x, from.y, to.x, to.y, 14);
  await sleep(900);
  await report('出售');
  await shot('shots/drag-shop.png');

  /* ---------------- 丢在地上 ---------------- */
  await ev(`__MU_APP__.npcPanelHide()`);
  await sleep(400);
  from = await cellAt('inventory', 14);
  const canvas = JSON.parse(
    await ev(`(() => { const b = document.querySelector('#app canvas').getBoundingClientRect();
      return JSON.stringify({ x: b.left + b.width * 0.42, y: b.top + b.height * 0.66 }); })()`)
  );
  console.log(`[丢弃] 背包 14 → 地面  ${JSON.stringify(from)} → ${JSON.stringify(canvas)}`);
  await c.dragTo(from.x, from.y, canvas.x, canvas.y, 16);
  await sleep(1200);
  await report('丢弃');
  await shot('shots/drag-floor.png');
} finally {
  await c.close();
}
