/** 中文文本表（Data/Local/chs）探针：离线 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
let pass = 0, fail = 0;
const check = (l, ok, d='') => { ok ? (pass++, console.log(`  ✓ ${l}${d?'  '+d:''}`)) : (fail++, console.log(`  ✗ ${l}${d?'  '+d:''}`)); };
const c = await createClient('localtext');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '离线进图');
  await sleep(1000);
  const rows = JSON.parse(await c.ev(`(async () => {
    const out = { src: (await __MU_APP__.text(0)).source, rows: [] };
    for (const i of [0, 20, 21, 200, 202, 205, 210, 212, 213, 229, 233]) {
      out.rows.push([i, (await __MU_APP__.text(i)).text]);
    }
    return JSON.stringify(out);
  })()`));
  console.log('\n来源:', rows.src);
  for (const [i, t] of rows.rows) console.log(`  [${i}] ${JSON.stringify(t)}`);
  check('读到的是 chs/Text.bmd', /chs/.test(rows.src), rows.src);
  check('第 0 行是字体名「宋体」', rows.rows[0][1] === '宋体', rows.rows[0][1]);
  check('职业名是中文（魔法师/剑士）', /魔法师/.test(rows.rows[1][1]) && /剑士/.test(rows.rows[2][1]), `${rows.rows[1][1]} / ${rows.rows[2][1]}`);
  check('属性文案是中文（等级/力量/敏捷/体力/智力）',
    /等级/.test(rows.rows[3][1]) && /力/.test(rows.rows[4][1]) && /敏/.test(rows.rows[5][1]) &&
    /体/.test(rows.rows[6][1]) && /智/.test(rows.rows[7][1]),
    rows.rows.slice(3, 8).map(r => r[1]).join(' | '));
  check('按钮文案是中文（取消/修理）', /取消/.test(rows.rows[9][1]) && /修理/.test(rows.rows[10][1]),
    `${rows.rows[9][1]} / ${rows.rows[10][1]}`);
  // 物品名（chs/item.bmd：波刃剑 / 短剑 / 西洋剑 …）
  const items = JSON.parse(await c.ev(`JSON.stringify([0,1,2,3].map(t => __MU_APP__.itemName(t)))`));
  console.log('\n物品名:', JSON.stringify(items));
  check('物品名是中文（波刃剑/短剑/西洋剑）',
    /波刃剑/.test(items[0].fromAttr) && /短剑/.test(items[1].fromAttr) && /西洋剑/.test(items[2].fromAttr),
    items.map(i => i.fromAttr).join(' / '));
  check('拾取/掉落提示同源（itemDisplayName 也走了中文）',
    items.every(i => i.fromCatalog === i.fromAttr), items.map(i => i.fromCatalog).join(' / '));

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally { await c.close(); }
