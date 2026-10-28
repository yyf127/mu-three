/**
 * 头顶名牌 / 地面物品名 的成品截图 + DOM 核对。
 *
 *   node tools/tags-shot.mjs [前缀]
 *
 * 走**真实会话**：登录 → 进洛兰 → 自动走到地图上唯一的刷怪点 (152,53)，
 * 等视野里有怪，然后
 *   · 打印 `worldTags()` 快照（名字 / 血条模式 / 血量比）
 *   · 打印屏幕上真正可见的 `.wtag` 数量、其中带血条的数量、血条填充宽度
 *   · 存一张 `<前缀>.png`
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const name = process.argv[2] || 'tags';
const c = await createClient('tagshot');
const ev = e => c.ev(e);
try {
  await c.waitFor(`!!document.getElementById('login-account')`, 20000, '登录');
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 60000, '选角');
  await sleep(2500);
  await ev(`(() => { const b = document.querySelector('.char-card'); b && b.click(); })()`);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);
  await c.waitFor(`__MU_APP__.state().mapId !== null`, 120000, '地图');
  await sleep(1500);

  // 洛兰只有一个刷怪点：(152,53) 附近的 Bull Fighter
  for (let i = 0; i < 8; i++) {
    await ev(`__MU_APP__.walkToNpc(152, 53)`);
    await sleep(7000);
    const tags = JSON.parse(await ev(`JSON.stringify(__MU_APP__.worldTags())`));
    if (tags.some(t => t.visible)) break;
  }
  await sleep(800);

  const tags = JSON.parse(await ev(`JSON.stringify(__MU_APP__.worldTags())`));
  console.log(`头顶名牌 ${tags.length} 条（可见 ${tags.filter(t => t.visible).length}）：`);
  for (const t of tags) console.log(`   #${t.id} "${t.name}" mode=${t.mode} ratio=${t.ratio ?? '-'} vis=${t.visible}`);

  console.log(
    'DOM：',
    await ev(`(() => {
      const all = [...document.querySelectorAll('.wtag')];
      const vis = all.filter(e => e.style.display !== 'none');
      const bars = vis.filter(e => e.querySelector('.wtag-bar'));
      const f = vis.map(e => e.querySelector('.wtag-fill')).find(Boolean);
      return JSON.stringify({
        total: all.length,
        visible: vis.length,
        withBar: bars.length,
        fillWidth: f ? f.style.width : null,
        fillColor: f ? f.style.background : null,
        sample: vis.slice(0, 4).map(e => e.textContent + ' @' + Math.round(parseFloat(e.style.left)) + ',' + Math.round(parseFloat(e.style.top))),
      });
    })()`)
  );

  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`shots/${name}.png`, Buffer.from(r.data, 'base64'));
  console.log(`已保存 shots/${name}.png`);
} finally {
  await c.close();
}
