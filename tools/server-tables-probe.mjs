/**
 * 服务端三张辅助表的探针（known-issues C9）。
 *
 *   node tools/server-tables-probe.mjs
 *
 * 以前 `main.ts` 对 `F3/E3`、`F3/E4`、`F3/E5` 只有一句「DUMP 未移植」，
 * 实际上服务端登录成功后就开始推了。现在三条都接上：
 *
 *   F3/E3  CItemStack::GCItemStackListSend   物品最大堆叠数（12B/条）
 *   F3/E4  CItemValue::GCItemValueListSend   固定买卖价（16B/条）
 *   F3/E5  CMove::GCMoveListSend             /move 列表 + 服务端算好的门槛（48B/条）
 *
 * 断言：
 *   1. 三张表都收到了数据
 *   2. F3/E5 的门槛/价格已覆盖到本地 warp 表（`warp[].canMove` 不是 null）
 *   3. 背包 tooltip 里能查到售价（`itemServerValue`）
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('tables');
const ev = e => c.ev(e);

let pass = true;
const check = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) pass = false;
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
  // 服务端是登录后陆续推的，等一会儿再读
  await sleep(3000);

  const t = JSON.parse(await ev(`JSON.stringify(__MU_APP__.serverTables())`));
  console.log('三张表：', JSON.stringify({ stacks: t.stacks, values: t.values, moves: t.moves }));
  check(t.stacks > 0, `F3/E3 堆叠表 ${t.stacks} 条`);
  check(t.values > 0, `F3/E4 价格表 ${t.values} 条`);
  check(t.moves > 0, `F3/E5 移动列表 ${t.moves} 条`);

  console.log('  移动列表样本：');
  for (const m of t.moveSample.slice(0, 6)) {
    console.log(`    ${m.mapNumber} ${m.name.padEnd(14)} lv=${m.lv[0]}..${m.lv[1]} ${m.money} zen ${m.canMove ? '' : '(锁)'}`);
  }
  console.log('  堆叠样本：', JSON.stringify(t.stackSample));
  console.log('  价格样本：', JSON.stringify(t.valueSample));

  // F3/E5 有没有真的覆盖到本地 warp 表
  console.log('  本地 warp 表（前 6 条）：');
  for (const w of t.warp.slice(0, 6)) {
    console.log(`    ${w.key.padEnd(14)} map=${w.mapId} ${w.money} zen lv=${w.lv[0]}..${w.lv[1]} canMove=${w.canMove}`);
  }
  const overlaid = t.warp.filter(w => w.canMove !== null).length;
  check(overlaid > 0, `F3/E5 覆盖到本地表 ${overlaid}/${t.warp.length} 条（canMove 不再是 null）`);

  // 挑一件表里有的物品，验查询
  const probe = JSON.parse(
    await ev(`(() => {
      const s = __MU_APP__.serverTables();
      const v = s.valueSample[0];
      const k = s.stackSample[0];
      return JSON.stringify({
        valueType: v ? v.index : -1,
        value: v ? __MU_APP__.itemServerValue(v.index, v.level) : null,
        stackType: k ? k.itemIndex : -1,
        stack: k ? __MU_APP__.itemServerValue(k.itemIndex, k.level) : null,
      });
    })()`)
  );
  console.log('  查询验证：', JSON.stringify(probe));
  check(
    probe.value && probe.value.value && probe.value.value.buy >= 0,
    `商品 ${probe.valueType} 查得到买卖价`
  );
  check(probe.stack && probe.stack.maxStack > 0, `物品 ${probe.stackType} 查得到堆叠上限`);

  // 背包 tooltip 里那两行（用 mockInventory 塞一件表里有的物品）
  if (probe.valueType >= 0) {
    await ev(`(() => { __MU_APP__.mockInventory([{ slot: 12, type: ${probe.valueType} }]); __MU_APP__.toggleInventory(true); return 1; })()`);
    await sleep(700);
    // 用真实鼠标移到格子上（tooltip 是 pointermove 时按 elementFromPoint 算的，
    // 直接 dispatchEvent 不会命中，因为面板监听在容器上）
    const cell = JSON.parse(
      await ev(`(() => {
        const el = document.querySelector('#mu-ui [data-drag-panel="inventory"] [data-slot="12"]');
        if (!el) return 'null';
        const r = el.getBoundingClientRect();
        return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      })()`)
    );
    let tip = 'no-cell';
    if (cell) {
      await c.ptr('mouseMoved', cell.x, cell.y, { buttons: 0 });
      await sleep(400);
      tip = await ev(`(() => {
        const el = document.querySelector('#mu-ui .ui-tip');
        return el && !el.classList.contains('hidden') ? el.textContent : 'no-tip';
      })()`);
    }
    console.log('  背包 tooltip：', JSON.stringify(tip));
    check(String(tip).includes('zen'), 'tooltip 里出现了服务端价格行（售价或价格）');
    await ev(`__MU_APP__.toggleInventory(false)`);
  }

  console.log(pass ? 'PASS' : 'FAIL');
} finally {
  await c.close();
}
