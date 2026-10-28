/**
 * 物品交互三件事的探针（2026-10-27 那轮改动的回归）。
 *
 *   node tools/item-ui-probe.mjs
 *
 * 1. **跨格拖动**：多格物品压在哪个格子上按下都能拖（不是只有左上角那一格）。
 *    做法：背包放一件 2×2，从它的四个格子分别按下、拖到旁边，看
 *    `__MU_DRAG_LOG__` 里 `from.slot` 是不是**同一个槽位**。
 * 2. **tooltip 不挡物品**：词条框的矩形和物品矩形不能相交。
 * 3. **职业限制行**：tooltip 里有「XX 可以使用」（`GlobalText[61]`）。
 * 4. **旋转速度**：原版 0.45°/ms，用户要求降到一半 → 0.225°/ms。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('itemui');
const ev = e => c.ev(e);

const rectOf = async sel =>
  JSON.parse(
    await ev(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return 'null';
      const b = el.getBoundingClientRect();
      return JSON.stringify({ l: b.left, t: b.top, r: b.right, b: b.bottom, x: b.left + b.width/2, y: b.top + b.height/2 });
    })()`)
  );

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

  /* ---------------- 1) 跨格拖动 ---------------- */
  console.log('\n[1] 跨格拖动（2×2 物品）');
  await ev(`__MU_APP__.mockInventory([{slot:12,type:192}])`); // 圆盾 2×2，锚点 slot 12
  await ev(`__MU_APP__.toggleInventory(true)`);
  await sleep(2000);

  for (const slot of [12, 13, 20, 21]) {
    const a = await rectOf(`#mu-ui [data-drag-panel="inventory"] [data-slot="${slot}"]`);
    const b = await rectOf(`#mu-ui [data-drag-panel="inventory"] [data-slot="60"]`);
    await c.dragTo(a.x, a.y, b.x, b.y, 6);
    await sleep(200);
    const log = JSON.parse(await ev(`JSON.stringify(__MU_APP__.dragLog())`));
    const last = log[log.length - 1];
    check(
      !!last && last.from === 'inventory' && last.slot === 12,
      `从格 ${slot} 按下 → 拖起的是 slot ${last?.slot}（${last?.type}）`
    );
  }

  /* ---------------- 2/3) tooltip ---------------- */
  console.log('\n[2] tooltip 不挡物品 + 职业限制');
  await ev(`__MU_APP__.mockInventory([{slot:12,type:8},{slot:16,type:192}])`); // 1×3 剑 + 2×2 盾
  await sleep(2000);
  for (const [slot, w, h, label] of [
    [12, 1, 3, '巨蛇魔剑 1×3'],
    [16, 2, 2, '圆盾 2×2'],
  ]) {
    const cell = await rectOf(`#mu-ui [data-drag-panel="inventory"] [data-slot="${slot}"]`);
    // 先移开再移回来，保证 pointermove 真的触发
    await c.ptr('mouseMoved', cell.x + 60, cell.y + 60, { buttons: 0 });
    await sleep(60);
    await c.ptr('mouseMoved', cell.x, cell.y, { buttons: 0 });
    await sleep(450);

    const item = JSON.parse(
      await ev(`(() => {
        const el = document.querySelector('#mu-ui [data-drag-panel="inventory"] [data-slot="${slot}"]');
        const b = el.getBoundingClientRect();
        return JSON.stringify({ l: b.left, t: b.top, r: b.left + b.width*${w}, b: b.top + b.height*${h} });
      })()`)
    );
    const tip = await rectOf('#mu-ui .ui-tip');
    const overlap = tip && !(tip.r <= item.l || tip.l >= item.r || tip.b <= item.t || tip.t >= item.b);
    check(tip && !overlap, `${label}：词条框 ${overlap ? '压住了物品' : '在物品外面'}（${Math.round(tip?.l ?? 0)},${Math.round(tip?.t ?? 0)}）`);

    const text = await ev(`document.querySelector('#mu-ui .ui-tip').innerText.replace(/\\n/g,' | ')`);
    console.log('     内容：', text);
    check(/可以使用/.test(text), `${label}：带「XX 可以使用」职业行`);
    check(!/undefined|NaN|%d|%s/.test(text), `${label}：模板占位符都被替换了`);
  }
  if (await rectOf('#mu-ui .ui-tip')) {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('shots/item-tooltip-beside.png', Buffer.from(r.data, 'base64'));
  }

  /* ---------------- 4) 旋转速度 ---------------- */
  console.log('\n[4] 悬停旋转速度（原版 450°/秒 → 225°/秒）');
  const cell = await rectOf('#mu-ui [data-drag-panel="inventory"] [data-slot="12"]');
  await c.ptr('mouseMoved', cell.x + 60, cell.y + 60, { buttons: 0 });
  await sleep(60);
  await c.ptr('mouseMoved', cell.x, cell.y, { buttons: 0 });
  await sleep(700);
  const t0 = Date.now();
  const a = JSON.parse(await ev(`JSON.stringify(__MU_APP__.itemSpin())`));
  await sleep(700);
  const t1 = Date.now();
  const b = JSON.parse(await ev(`JSON.stringify(__MU_APP__.itemSpin())`));
  // yaw 会绕圈，取模差值
  let d = (b.yaw - a.yaw + 360) % 360;
  const dt = t1 - t0;
  const dps = (d / dt) * 1000;
  console.log(`     yaw ${a.yaw}° → ${b.yaw}°（${dt}ms）≈ ${dps.toFixed(0)}°/秒`);
  check(a.active && b.active, '悬停中一直转');
  check(dps > 120 && dps < 380, `转速落在 225°/秒 附近（${dps.toFixed(0)}）`);

  /* ---------------- 5) tooltip 触发区域 ---------------- */
  console.log('\n[5] tooltip 触发区域：物品盖住的每一格都要弹（背包 = 仓库）');

  /**
   * 把鼠标移到 (x,y) 并等一会儿，返回目标面板 tooltip 的文本（隐藏时返回空串）。
   * 先挪到舞台左上角再挪回来 —— 不挪的话同格重复 mouseMoved 不会触发 mouseenter。
   */
  const hoverTipText = async (x, y, panel) => {
    await c.ptr('mouseMoved', 5, 5, { buttons: 0 });
    await sleep(80);
    await c.ptr('mouseMoved', x, y, { buttons: 0 });
    await sleep(320);
    return ev(`(() => {
      const t = document.querySelector('#mu-ui [data-drag-panel="${panel}"] .ui-tip');
      return t && !t.classList.contains('hidden') ? t.innerText.replace(/\\n/g, ' | ') : '';
    })()`);
  };

  // 背包：1×3 剑（slot 12 → 覆盖格 12 / 20 / 28）
  await ev(`__MU_APP__.mockInventory([{slot:12,type:8}])`);
  await ev(`__MU_APP__.toggleInventory(true)`);
  await sleep(1600);
  const invCells = [];
  for (const slot of [12, 20, 28]) {
    const cell = await rectOf(`#mu-ui [data-drag-panel="inventory"] [data-slot="${slot}"]`);
    const text = await hoverTipText(cell.x, cell.y, 'inventory');
    console.log(`     背包格 ${slot}：${text ? text.slice(0, 28) : '(无词条)'}`);
    invCells.push(!!text);
  }
  check(invCells.every(Boolean), `背包 1×3 剑：3/3 格都弹词条（${invCells.filter(Boolean).length}/3）`);
  // 此刻鼠标停在第 3 段（最下面那一格）：截图留证 —— 词条锚在整件物品上，不是这一小格
  writeFileSync(
    'shots/item-tooltip-cover-cell.png',
    Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')
  );

  // 仓库：同一件 1×3 剑（slot 0 → 覆盖格 0 / 8 / 16），当对照组
  await ev(`__MU_APP__.npcPanelOpen('warehouse')`);
  await ev(`__MU_APP__.npcPanelFill([8])`);
  await sleep(1200);
  const whCells = [];
  for (const slot of [0, 8, 16]) {
    const cell = await rectOf(`#mu-ui [data-drag-panel="warehouse"] [data-slot="${slot}"]`);
    const text = await hoverTipText(cell.x, cell.y, 'warehouse');
    console.log(`     仓库格 ${slot}：${text ? text.slice(0, 28) : '(无词条)'}`);
    whCells.push(!!text);
  }
  check(whCells.every(Boolean), `仓库 1×3 剑：3/3 格都弹词条（${whCells.filter(Boolean).length}/3）`);
  check(
    invCells.join() === whCells.join(),
    `背包与仓库行为一致（背包 ${invCells.join('/')} vs 仓库 ${whCells.join('/')}）`
  );

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
