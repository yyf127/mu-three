/** 物件过滤 + 各地图收顶探针（离线） */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
let pass = 0, fail = 0;
const check = (l, ok, d='') => { ok ? (pass++, console.log(`  ✓ ${l}${d?'  '+d:''}`)) : (fail++, console.log(`  ✗ ${l}${d?'  '+d:''}`)); };
const c = await createClient('objs');
const st = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '离线进图');
  await c.waitFor(`document.getElementById('mu-ui').getBoundingClientRect().width > 0`, 20000, 'UI 可见');
  await sleep(1200);

  // [A] 洛兰
  const a = await st();
  const ra = a.roofs;
  console.log('\n[A] 洛兰', JSON.stringify({ houses: ra.houses, roofMeshes: ra.roofMeshes, objects: a.objects, hidden: ra.hidden }));
  check('洛兰有收顶房屋（酒馆）', ra.houses > 0, `${ra.houses} 间`);
  if (ra.list.length) {
    const h = ra.list[0];
    console.log('   第一间:', JSON.stringify(h));
    const cx = (h.box[0] + h.box[2]) / 2;
    const cy = (h.box[1] + h.box[3]) / 2;
    await c.ev(`__MU_APP__.setPos(${Math.round(cx)}, ${Math.round(cy)})`);
    await sleep(600);
    const inA = (await st()).roofs;
    check('走进酒馆 → 屋顶收起', inA.hidden > 0, `hidden=${inA.hidden}`);
    await c.ev(`__MU_APP__.setPos(${Math.round(cx) + 20}, ${Math.round(cy)})`);
    await sleep(600);
    const outA = (await st()).roofs;
    check('走出来 → 屋顶恢复', outA.hidden === 0, `hidden=${outA.hidden}`);
  }

  // [B] 冰风谷（map 2）
  await c.ev(`__MU_APP__.loadMap(2, 200, 200)`);
  await c.waitFor(`__MU_APP__.state().mapId === 2`, 120000, '切到冰风谷');
  await setTimeout_(1500);
  const b = await st();
  const rb = b.roofs;
  console.log('\n[B] 冰风谷', JSON.stringify({ houses: rb.houses, roofMeshes: rb.roofMeshes, objects: b.objects, hidden: rb.hidden }));
  check('冰风谷也有收顶房屋（81/82/96/98/99）', rb.houses > 0, `${rb.houses} 间`);
  if (rb.list.length) {
    const h = rb.list[0];
    console.log('   第一间:', JSON.stringify(h));
    const cx = Math.round((h.box[0] + h.box[2]) / 2);
    const cy = Math.round((h.box[1] + h.box[3]) / 2);
    await c.ev(`__MU_APP__.setPos(${cx}, ${cy})`);
    await sleep(700);
    const inB = (await st()).roofs;
    check('走进冰风谷的屋子 → 屋顶收起', inB.hidden > 0, `hidden=${inB.hidden}`);
  }

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  const errs = (c.logs || []).filter(l => /\[exc\]|NaN|Computed min\/max/.test(l));
  if (errs.length) console.log('异常:', errs.slice(-4).join('\n'));
  if (fail) process.exitCode = 1;
} finally { await c.close(); }

function setTimeout_(ms) { return sleep(ms); }
