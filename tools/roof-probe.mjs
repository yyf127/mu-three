/**
 * 收屋顶探针（进屋隐藏屋顶）。
 *
 *   node tools/roof-probe.mjs
 *
 * 离线加载洛兰，读 `world.objects.roofs()`，把主角挪进屋/挪出去，断言：
 *
 *   1. 只对**真正能进去**的屋子收顶（酒馆：`HouseWall05/06` 的屋顶板），
 *      实心装饰房（House01/03/04/05 —— `.att` 里全是 `TW_NOMOVE`）不该注册；
 *   2. 屋顶 mesh 真的被隐藏（遍历 three 对象看 `mesh.visible`，不看统计）；
 *   3. 整间屋子一起收（8 块板聚合成一个房间，不会一块块消失）；
 *   4. 出门会恢复；两间屋子互不影响。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? `  ${detail}` : ''}`);
  }
};

/** 场景里真正不可见的「屋顶 mesh」数量（独立于 stats，直接看 three 对象） */
const HIDDEN_MESHES = `(() => {
  let n = 0;
  let total = 0;
  __MU__.scene.traverse(o => {
    if (!o.isMesh) return;
    const p = o.parent;
    if (!p || !p.name || !p.name.startsWith('roof:')) return;
    total++;
    if (!o.visible) n++;
  });
  return JSON.stringify({ total, hidden: n });
})()`;

const c = await createClient('roof');

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!document.getElementById('sandbox').classList.contains('hidden')`, 120000);
  await sleep(1200);

  /* ---------------- A. 识别 ---------------- */
  const r0 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.roofs())'));
  console.log(`\n[A] 收顶识别：${r0.houses} 间 / ${r0.roofMeshes} 块屋顶板`);
  for (const h of r0.list) console.log(`    ${h.name} 足迹 [${h.box.join(', ')}] 板 ${h.meshes}`);
  check('识别出 2 间可进入的屋子（洛兰有两处 HouseWall05/06）', r0.houses === 2, `${r0.houses} 间`);
  check('每间都是多块板拼的（>= 8 块）', r0.list.every(h => h.meshes >= 8), r0.list.map(h => h.meshes).join(','));

  // 酒馆：muonlinejs 的互动区是 120..129 × 120..136，我们拼出来的房间要盖住它
  const pub = r0.list.find(h => h.box[0] >= 119 && h.box[0] <= 122 && h.box[1] >= 119 && h.box[1] <= 122);
  check('其中一间就是酒馆（足迹从 120.5 起）', !!pub, pub ? `[${pub.box.join(', ')}]` : '没找到');
  check(
    '酒馆足迹盖住 muonlinejs 的互动区 (120..129 × 120..136)',
    !!pub && pub.box[0] <= 120.6 && pub.box[2] >= 129 && pub.box[1] <= 120.6 && pub.box[3] >= 136,
    pub ? `[${pub.box.join(', ')}]` : ''
  );

  const mesh0 = JSON.parse(await c.ev(HIDDEN_MESHES));
  check('屋顶板单独挂在场景里（没被合批吞掉）', mesh0.total === r0.roofMeshes, `${mesh0.total} 块`);
  check('初始状态没有屋顶被藏', mesh0.hidden === 0 && r0.hidden === 0, `隐藏 ${mesh0.hidden} 块`);

  // 实心房不该注册：House01/03/04/05 的 mesh 里没有一块板是「可进入」的
  const names = r0.list.map(h => h.name);
  check(
    '不再对 House01/03/04/05 收顶（它们的内部走不进去）',
    !names.some(n => /House0[1345]/.test(n)) && !names.includes('HouseEtc02'),
    names.join(',')
  );

  /* ---------------- B. 进屋 ---------------- */
  const [px0, py0, px1, py1] = pub.box;
  const inX = Math.round((px0 + px1) / 2);
  const inY = Math.round((py0 + py1) / 2);
  console.log(`\n[B] 走进酒馆 (${inX},${inY})`);
  await c.ev(`__MU_APP__.setPos(${inX}, ${inY})`);
  await sleep(600);
  const r1 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.roofs())'));
  const mesh1 = JSON.parse(await c.ev(HIDDEN_MESHES));
  check('这间被判定为「在屋里」', r1.list.some(h => h.inside), JSON.stringify(r1.list.map(h => h.inside)));
  check(
    '整间屋子的屋顶 mesh 全部不可见',
    mesh1.hidden === pub.meshes && r1.hidden === pub.meshes,
    `隐藏 ${mesh1.hidden}/${pub.meshes} 块`
  );
  check('另一间不受影响', r1.list.filter(h => !h.inside).length === r1.list.length - 1, `其它 ${r1.houses - 1} 间`);
  // 屋里的地面格子本来就是可走的（不是靠强行传送才进得去）
  const att = JSON.parse(
    await c.ev(`JSON.stringify((() => {
      const a = __MU_APP__.mapAttrAt(${inX}, ${inY});
      return { attr: a, walkable: (a & 4) === 0 };
    })())`)
  );
  check('酒馆内部的格子本身就可走（不需要强制传送）', att.walkable === true, `attr=${att.attr}`);
  console.log(`  截图：${await c.shot('roof_inside')}`);

  /* ---------------- C. 出门 ---------------- */
  const outX = Math.round(px0) - 3;
  const outY = Math.round((py0 + py1) / 2);
  console.log(`\n[C] 走出酒馆 (${outX},${outY})`);
  await c.ev(`__MU_APP__.setPos(${outX}, ${outY})`);
  await sleep(600);
  const r2 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.roofs())'));
  const mesh2 = JSON.parse(await c.ev(HIDDEN_MESHES));
  check('出门后屋顶恢复', r2.hidden === 0 && mesh2.hidden === 0, `隐藏 ${mesh2.hidden} 块`);

  /* ---------------- D. 逐间验证 ---------------- */
  console.log('\n[D] 每间都能触发（逐间走一遍）');
  let hit = 0;
  for (const h of r2.list) {
    const cx = Math.round((h.box[0] + h.box[2]) / 2);
    const cy = Math.round((h.box[1] + h.box[3]) / 2);
    await c.ev(`__MU_APP__.setPos(${cx}, ${cy})`);
    await sleep(280);
    const m = JSON.parse(await c.ev(HIDDEN_MESHES));
    if (m.hidden === h.meshes) hit++;
    else console.log(`    ! (${cx},${cy}) 期望 ${h.meshes}，实际 ${m.hidden}`);
  }
  check('每一间进去都会整片收顶', hit === r2.list.length, `${hit}/${r2.list.length}`);

  // 门框上站一格（屋子边缘）也要算「进屋」，不然会走进去半个身子才收顶
  await c.ev(`__MU_APP__.setPos(${Math.round(px0) + 1}, ${Math.round((py0 + py1) / 2)})`);
  await sleep(300);
  const edge = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.roofs())'));
  check('贴墙一格也算进屋（足迹是屋顶板范围，不是内缩后的地面）', edge.hidden > 0, `藏 ${edge.hidden} 块`);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
} finally {
  await c.close();
}
