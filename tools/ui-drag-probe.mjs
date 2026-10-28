/**
 * 背包拖拽换位端到端探针。
 *
 * 用真实 CDP 鼠标事件（Input.dispatchMouseEvent）在页面上按住一个物品格子
 * 拖到目标格，验证整条链路：
 *   pointerdown → pointermove(>4px 生成影子) → pointerup → onMove
 *   → 0x24(item move) → 服务端回执 → 面板重绘
 *
 * 槽位是**服务端编号**：0..11 装备、12..75 背包（cell = slot - 12）。
 *
 * 跑法：node tools/ui-drag-probe.mjs   （需要 vite:5180 + MuServer:55901）
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const WEAR = 12;
const client = await createClient('drag', { width: 1280, height: 760 });

const inv = async () => JSON.parse(await client.ev('JSON.stringify(__MU_APP__.inventory())'));

/** 算出被占用的背包格（cell 序号 0..63） */
function occupiedCells(items) {
  const set = new Set();
  for (const it of items) {
    if (it.slot < WEAR) continue;
    const [w, h] = it.wh;
    const cell = it.slot - WEAR;
    const col = cell % 8;
    const row = Math.floor(cell / 8);
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++) {
        const c = col + dx;
        const r = row + dy;
        if (c < 8 && r < 8) set.add(r * 8 + c);
      }
  }
  return set;
}

try {
  const who = await loginAs(client, '1234', '1234');
  console.log('进入游戏:', who.name, 'map', who.mapId);

  await client.waitFor('__MU_APP__.inventory().length > 0', 30000, '背包快照');
  await client.ev('__MU_APP__.toggleInventory(true)');
  await sleep(900);

  const items = await inv();
  console.log(`背包共 ${items.length} 件，装备栏 ${items.filter(i => i.slot < WEAR).length} 件`);

  /* ---------------- 第一段：背包内换位 ---------------- */
  const src = items.find(it => it.slot >= WEAR && it.wh[0] === 1 && it.wh[1] === 1);
  if (!src) throw new Error('没有 1×1 的可搬物品');

  const occupied = occupiedCells(items);
  let dst = -1;
  for (let cell = 56; cell < 64; cell++) {
    if (!occupied.has(cell)) { dst = WEAR + cell; break; }
  }
  if (dst < 0) throw new Error('背包底部找不到空格');

  console.log(`\n[1] 换位：slot ${src.slot}（${src.name}）→ slot ${dst}（cell ${dst - WEAR}）`);
  await client.drag(`[data-slot="${src.slot}"]`, `[data-slot="${dst}"]`, 12);
  await sleep(900);

  let after = await inv();
  const atDst = after.find(i => i.type === src.type && i.slot === dst);
  const atSrc = after.find(i => i.slot === src.slot);
  console.log(`  目标格: ${atDst ? atDst.name + ' ✅' : '空 ❌'}`);
  console.log(`  原格  : ${atSrc ? atSrc.name + ' ❌ 没挪走' : '空 ✅'}`);

  /* ---------------- 第二段：拖到装备槽 ---------------- */
  // 这台服务端会拒绝一切「背包→装备槽」（二进制里装备分支走反了），
  // 所以这里验证的是**客户端如实回滚 + 给出可见提示**，不是穿上。
  const ring = after.find(it => it.slot >= WEAR && it.type === 426);
  if (!ring) {
    console.log('\n[2] 跳过：背包里没有 Transformation Ring');
  } else {
    console.log(`\n[2] 穿戴尝试：slot ${ring.slot}（${ring.name}）→ 装备槽 10（戒指 1）`);
    await client.drag(`[data-slot="${ring.slot}"]`, '[data-slot="10"]', 14);
    await sleep(700);

    const toast = await client.ev(`(() => {
      const el = document.querySelector('.inv-toast');
      return el && !el.classList.contains('hidden') ? el.textContent : null;
    })()`);
    console.log(`  提示条: ${toast ? '「' + toast + '」✅' : '无 ❌'}`);

    await client.shot('ui-drag-reject');

    after = await inv();
    const worn = after.find(i => i.slot === 10);
    const back = after.find(i => i.slot === ring.slot);
    console.log(`  装备槽 10: ${worn ? worn.name + ' ❌ 不该有' : '空 ✅'}`);
    console.log(`  原背包格: ${back ? back.name + ' ✅ 已回滚' : '空 ❌ 物品丢了'}`);
  }

  /* ---------------- 收尾检查 ---------------- */
  const ghosts = await client.ev('document.querySelectorAll(".inv-drag-ghost").length');
  const hover = await client.ev('document.querySelectorAll(".drop-hover").length');
  console.log('\n残留拖拽影子:', ghosts, '/ 残留落点高亮:', hover);

  // 挪完之后还能不能走动（确认没被 HackPacketCheck 踢）
  const walk = await client.ev('__MU_APP__.walkTo(135, 131)');
  await sleep(1200);
  console.log('移动后仍能走动:', walk);

  await client.shot('ui-drag-after');

  const errs = client.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exc]'));
  const warns = client.logs.filter(l => l.startsWith('[warning]'));
  console.log('控制台错误', errs.length, '条:', errs.slice(-4));
  console.log('控制台告警', warns.length, '条:', warns.slice(-4));
  console.log('报文头:', await client.ev('JSON.stringify(__MU_APP__.heads().filter(h => h.startsWith("0x24")||h.startsWith("0x2a")))'));
} finally {
  await client.close();
}
