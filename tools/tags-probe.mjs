/**
 * 头顶名牌 / 地面物品名 探针。
 *
 *   node tools/tags-probe.mjs [截图名]
 *
 * 走离线模式：`loadMap` 进洛兰 → `testMonster` 放几只怪 → `testItem` 丢几件装备，
 * 然后把 `worldTags()` / `itemLabels()` 的快照打出来，并存一张截图。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const name = process.argv[2] || 'tags';
const c = await createClient('tags');
const ev = expr => c.ev(expr);
try {
  await c.waitFor(`!!window.__MU_APP__`, 20000, '页面');
  await ev('__MU_APP__.loadMap(0, 133, 131)');
  await c.waitFor(`__MU_APP__.state().mapId === 0`, 120000, '洛兰');
  await sleep(1200);

  // 2 = Budge Dragon(60HP) 3 = Spider(30) 6 = Lich(255) 7 = Giant(400)
  const spots = [
    [2, 136, 131],
    [3, 130, 131],
    [6, 133, 134],
    [7, 133, 128],
  ];
  for (const [type, x, y] of spots) await ev(`__MU_APP__.testMonster(${type}, ${x}, ${y}, ${0x6000 + type})`);
  // 地上丢三件：0 = 短剑？用几件常见 type；level 3 看颜色档
  await ev(`__MU_APP__.testItem(0, 134, 132, 0x11, 0)`);
  await ev(`__MU_APP__.testItem(1, 132, 132, 0x12, 3)`);
  await ev(`__MU_APP__.testItem(8, 131, 130, 0x13, 7)`);
  await sleep(2500);

  const tags = JSON.parse(await ev(`JSON.stringify(__MU_APP__.worldTags())`));
  console.log(`头顶名牌 ${tags.length} 条：`);
  for (const t of tags) {
    console.log(`   #${t.id} "${t.name}" mode=${t.mode} ratio=${t.ratio ?? '-'} tenths=${t.tenths} vis=${t.visible}`);
  }
  const items = JSON.parse(await ev(`JSON.stringify(__MU_APP__.itemLabels())`));
  console.log(`地面物品名 ${items.length} 条：`);
  for (const it of items) console.log(`   #${it.id} "${it.text}" ${it.color}`);

  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`shots/${name}.png`, Buffer.from(r.data, 'base64'));
  console.log(`已保存 shots/${name}.png`);
} finally {
  await c.close();
}
