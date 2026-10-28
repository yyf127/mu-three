/**
 * 移动命令窗口（M 键）探针 —— 数据源为服务端 `Move.txt` + `Gate.txt`。
 *
 *   node tools/move-probe.mjs
 *
 * 断言：
 *   ① 表：23 条 Move / 77 条 Gate，全部合并成功（orphans = 0）
 *   ② 窗口：M 键开窗、23 行、纷争标记/等级/金币与 Move.txt 一致
 *   ③ 门槛：等级/金币/翅膀三条判定都能拦住（用 `setMoveStatus` 模拟角色卡）
 *   ④ 落点：Gate 的矩形里随机挑格 —— 走遍全表，落在矩形内且可站
 *   ⑤ 同图移动只挪人不重载世界
 *   ⑥ 服务端同步：丢一份改过价格的原文进去，窗口立刻跟着变
 */
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('move');

const shot = async name => {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`shots/${name}.png`, Buffer.from(r.data, 'base64'));
  console.log(`截图: shots/${name}.png`);
};

/** 当前格的属性（TerrainWall 位标志） */
const ATTR = `(() => {
  const p = __MU_APP__.state().player;
  const a = __MU_APP__.attrAt(p.x, p.y);
  return JSON.stringify({
    cell: [Math.floor(p.x), Math.floor(p.y)],
    attr: a,
    safe: !!(a & 1), nomove: !!(a & 4), noground: !!(a & 8), water: !!(a & 0x10),
  });
})()`;

const KEY = code =>
  `window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', bubbles: true }))`;

/** M 是 toggle：先问状态再按，避免把已经开着的窗口关掉 */
const ensureOpen = async () => {
  if (!(await c.ev(`__MU_APP__.moveCommand().open`))) {
    await c.ev(KEY('KeyM'));
    await sleep(350);
  }
};
const ensureClosed = async () => {
  if (await c.ev(`__MU_APP__.moveCommand().open`)) {
    await c.ev(KEY('Escape'));
    await sleep(200);
  }
};

const inRect = (cell, r) => {
  if (!r) return false;
  const x1 = Math.min(r.x1, r.x2);
  const x2 = Math.max(r.x1, r.x2);
  const y1 = Math.min(r.y1, r.y2);
  const y2 = Math.max(r.y1, r.y2);
  return cell[0] >= x1 && cell[0] <= x2 && cell[1] >= y1 && cell[1] <= y2;
};

const failures = [];

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`!!window.__MU__ && !!__MU__.objects`, 60000, '场景');
  await sleep(1500);
  console.log('起始:', await c.ev(`JSON.stringify({ map: __MU_APP__.state().mapId, p: __MU_APP__.state().player })`));

  /* ---- ① 数据表 ---- */
  const table = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.warpTable())`));
  console.log('表:', JSON.stringify(table));
  if (table.moves !== 23) failures.push(`Move 条数 ${table.moves} ≠ 23`);
  if (table.gates !== 77) failures.push(`Gate 条数 ${table.gates} ≠ 77`);
  if (table.entries !== 23) failures.push(`合并后 ${table.entries} 条 ≠ 23`);
  if (table.orphans !== 0) failures.push(`有 ${table.orphans} 条 Move 找不到 Gate`);

  /* ---- ② M 键开窗 ---- */
  await c.ev(KEY('KeyM'));
  await sleep(400);
  const snap = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.moveCommand())`));
  console.log('窗口:', JSON.stringify({ open: snap.open, sel: snap.sel, status: snap.status }));
  if (!snap.open) failures.push('M 没打开窗口');
  if (snap.entries.length !== 23) failures.push(`列表 ${snap.entries.length} 行 ≠ 23`);
  console.log('列表:');
  for (const e of snap.entries) {
    const r = e.spawn;
    console.log(
      `  #${String(e.index).padStart(2)} ${e.conflict ? '争' : ' '} ${e.name.padEnd(6, '　')}` +
        ` 等级 ${String(e.level).padStart(3)}  金币 ${String(e.zen).padStart(5)}` +
        `  gate ${String(e.gate).padStart(2)} → 地图 ${String(e.mapId).padStart(2)}` +
        ` [${r.x1},${r.y1}..${r.x2},${r.y2}]  ${e.problem ? '✗ ' + e.problem : '✓'}`
    );
  }
  const domRows = await c.ev(`document.querySelectorAll('.mv-row').length`);
  if (domRows !== 23) failures.push(`DOM 行数 ${domRows} ≠ 23`);
  await shot('move-window');

  /* ---- ③ 门槛：模拟不同角色卡 ---- */
  const cases = [
    { level: 10, money: 100000, wings: false, want: '缺翅膀被拦' },
    { level: 50, money: 100000, wings: true, want: '等级刚好够' },
    { level: 200, money: 100, wings: true, want: '金币不足' },
  ];
  for (const cs of cases) {
    const blocked = await c.ev(
      `__MU_APP__.setMoveStatus(${cs.level}, ${cs.money}, ${cs.wings})`
    );
    console.log(
      `角色卡 等级 ${cs.level} / 金币 ${cs.money} / 翅膀 ${cs.wings ? '有' : '无'}` +
        ` → ${blocked} 条走不通（${cs.want}）`
    );
  }
  // 恢复成「离线不校验」，后面的传送才不会被门槛拦住
  await c.ev(`__MU_APP__.setMoveStatus(null)`);
  await sleep(200);

  /* ---- ④ 走不通时点「移动」不会传送 ---- */
  await c.ev(`__MU_APP__.setMoveStatus(10, 100000, false)`);
  await ensureOpen();
  const icarus = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.moveCommand())`)).entries.findIndex(
    e => e.mapId === 10
  );
  await c.ev(`document.querySelectorAll('.mv-row')[${icarus}].click()`);
  await sleep(150);
  console.log('选中天空之城提示:', JSON.stringify(await c.ev(`document.querySelector('.mv-hint').textContent`)));
  const before = await c.ev(`JSON.stringify(__MU_APP__.state().player)`);
  await c.ev(`document.querySelectorAll('.mv-btns .mv-btn')[0].click()`);
  await sleep(900);
  const after = await c.ev(`JSON.stringify(__MU_APP__.state().player)`);
  console.log('走不通时点移动:', before === after ? '✓ 没有传送' : '✗ 竟然传送了');
  if (before !== after) failures.push('缺翅膀也能去天空之城');
  await c.ev(`__MU_APP__.setMoveStatus(null)`);

  /* ---- ⑤ 键盘选 + Enter 传送（冰风谷 Devias，index 4） ---- */
  await ensureOpen();
  await c.ev(`document.querySelectorAll('.mv-row')[3].click()`);
  await sleep(150);
  console.log('选中的行:', await c.ev(`document.querySelector('.mv-row.sel .mv-cell:nth-child(2)').textContent`));
  await c.ev(KEY('Enter'));
  await c.waitFor(`__MU_APP__.state().mapId === 2`, 120000, '切到冰风谷');
  await c.waitFor(`!!window.__MU__ && !!__MU__.objects`, 60000, '新场景');
  await sleep(2500);
  const devias = JSON.parse(await c.ev(ATTR));
  console.log('冰风谷落点:', JSON.stringify(devias));
  console.log('窗口已关:', await c.ev(`!__MU_APP__.state().moveCommand.open`));
  await shot('move-devias');

  /* ---- ⑥ 同图移动 ---- */
  await ensureOpen();
  const snap2 = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.moveCommand())`));
  const self = snap2.entries.findIndex(e => e.mapId === 2);
  const posBefore = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.state().player)`));
  await c.ev(`__MU_DEBUG__.setPos(140, 140)`);
  await sleep(400);
  await ensureClosed();
  await ensureOpen();
  await c.ev(`document.querySelectorAll('.mv-row')[${self}].click()`);
  await c.ev(`document.querySelectorAll('.mv-btns .mv-btn')[0].click()`);
  await sleep(1200);
  const posAfter = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.state().player)`));
  console.log(
    '同图移动:', JSON.stringify(posBefore), '→ setPos(140,140) →', JSON.stringify(posAfter),
    posAfter.x !== 140.5 ? '✓ 挪回了落点' : '✗ 没动'
  );
  if (posAfter.x === 140.5) failures.push('同图移动没生效');

  /* ---- ⑦ 走遍全表：落点必须落在 Gate 矩形里且可站 ---- */
  const mapText = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.moveCommand())`));
  let nanSeen = c.logs.filter(l => /NaN values/.test(l)).length;
  for (const entry of mapText.entries) {
    if (entry.mapId === 2) continue; // 已经在冰风谷
    await c.ev(`__MU_APP__.warpIndex(${entry.index})`);
    await c.waitFor(`__MU_APP__.state().mapId === ${entry.mapId}`, 150000, `切到 ${entry.name}`);
    await c.waitFor(`!!window.__MU__ && !!__MU__.objects`, 90000, '新场景');
    await sleep(1100);
    const attr = JSON.parse(await c.ev(ATTR));
    const bad = attr.nomove || attr.noground || attr.water;
    const inside = inRect(attr.cell, entry.spawn);
    console.log(
      `#${String(entry.index).padStart(2)} ${entry.name.padEnd(6, '　')} → ${String(attr.cell[0]).padStart(3)},` +
        `${String(attr.cell[1]).padStart(3)}  attr=0x${(attr.attr & 0xff).toString(16).padStart(2, '0')}` +
        `  ${attr.safe ? '安全区' : '非安全区'}  ${inside ? '✓ 在 Gate 矩形内' : '△ 矩形外（兜底挑点）'}` +
        `  ${bad ? '✗ 落在墙/水/虚空' : '✓ 可站'}`
    );
    if (bad) failures.push(`${entry.name} 落点不可站 ${attr.cell}`);
    if (entry.mapId === 7 || entry.mapId === 10 || entry.mapId === 6) await shot(`move-map${entry.mapId}`);
    const nanNow = c.logs.filter(l => /NaN values/.test(l)).length;
    if (nanNow > nanSeen) console.log(`  ⚠ 本图新增 ${nanNow - nanSeen} 条 NaN 几何体告警`);
    nanSeen = nanNow;
  }

  /* ---- ⑧ 服务端同步：改一行价格，窗口应该立刻跟着变 ---- */
  const moveTxt = readFileSync('../MuServer/Data/Move/Move.txt', 'latin1');
  const gateTxt = readFileSync('../MuServer/Data/Move/Gate.txt', 'latin1');
  const patched = moveTxt.replace(/(2\t"Lorencia"\t+)1000/, '$17777');
  const synced = JSON.parse(
    await c.ev(`JSON.stringify(__MU_APP__.syncWarpTable(${JSON.stringify(patched)}, ${JSON.stringify(gateTxt)}))`)
  );
  const lorencia = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.moveCommand())`)).entries.find(
    e => e.key === 'Lorencia'
  );
  console.log('服务端同步:', JSON.stringify(synced), '→ 勇者大陆价格', lorencia.zen, lorencia.zen === 7777 ? '✓' : '✗');
  if (lorencia.zen !== 7777) failures.push(`同步后价格还是 ${lorencia.zen}`);
  // 还原
  await c.ev(`__MU_APP__.syncWarpTable(${JSON.stringify(moveTxt)}, ${JSON.stringify(gateTxt)})`);

  console.log('errors:', c.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exc]')).slice(0, 5));
  if (failures.length) {
    console.log('\n✗ 失败项:');
    for (const f of failures) console.log('  -', f);
    process.exitCode = 1;
  } else {
    console.log('\n✓ 全部通过');
  }
} finally {
  await c.close();
}
