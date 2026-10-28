/**
 * 点地面「能不能走」网格探针。
 *
 *   node tools/click-grid.mjs
 *
 * 在角色周围 5×5 的格子中心逐个真实点击，用 `__MU_APP__.clickLog()`
 * 读出每一次点击的判定结果，分类成：
 *   ground-ok   点到了地面并生成了路径（正常）
 *   ground-self 点中的格就是脚下（原版也没反应）
 *   ground-fail 点到了地面但走不了（目标不可站 / 不连通）
 *   npc/monster 点被实体吃掉了（以前 60~70px 半径的老毛病）
 *   ui          点落到了面板上（canvas 收不到事件）
 *
 * 修复前 Lorencia 喷泉广场一圈会因为 NPC 拾取半径过大而大量算成 npc。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const c = await createClient('clickgrid');

const PROJ = (x, y) => `(() => {
  const cam = __MU__.muCamera.camera;
  const V = cam.position.constructor;
  const h = __MU__.terrain.getHeight(${x}, ${y});
  const v = new V(${x}, ${y}, h).project(cam);
  const cv = document.querySelector('#app canvas');
  const r = cv.getBoundingClientRect();
  return JSON.stringify([r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height]);
})()`;

const POS = `JSON.stringify((() => { const s = __MU_APP__.state(); return { x: +s.player.x.toFixed(2), y: +s.player.y.toFixed(2) }; })())`;

const count = { 'ground-ok': 0, 'ground-self': 0, 'ground-fail': 0, entity: 0, ui: 0, miss: 0 };

function classify(entry, lines) {
  const down = lines.find(l => l.startsWith('down'));
  const ground = lines.find(l => l.trim().startsWith('ground'));
  const npc = lines.find(l => l.includes('→ npc'));
  const mon = lines.find(l => l.includes('→ monster'));
  const item = lines.find(l => l.includes('→ item'));
  const miss = lines.find(l => l.includes('ray-miss'));
  if (npc || mon || item) return ['entity', npc || mon || item];
  if (miss) return ['miss', miss];
  if (!ground) return ['ui', down || '(没有事件)'];
  if (/ok=true/.test(ground)) return ['ground-ok', ground];
  if (/why=self/.test(ground)) return ['ground-self', ground];
  return ['ground-fail', ground];
}

try {
  const who = await loginAs(c, '1234', '1234');
  await sleep(2500);
  const p0 = JSON.parse(await c.ev(POS));
  const bx = Math.round(p0.x);
  const by = Math.round(p0.y);
  console.log(`\n角色 ${who.name} 起点 (${bx},${by})`);

  // 只统计「点下去」的判定，不要求真的走到（无头浏览器帧率太低）
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const tx = bx + dx;
      const ty = by + dy;
      await c.ev('__MU_APP__.clearClickLog?.()');
      const scr = JSON.parse(await c.ev(PROJ(tx + 0.5, ty + 0.5)));
      // 目标落在视口外就跳过（无头窗口 1280×760）
      if (scr[0] < 20 || scr[1] < 20 || scr[0] > 1260 || scr[1] > 740) {
        console.log(`  (${dx},${dy}) 屏幕外=${scr.map(n => n.toFixed(0)).join(',')}`);
        continue;
      }
      await c.dragTo(scr[0], scr[1], scr[0], scr[1], 2);
      await sleep(350);
      const lines = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.clickLog())'));
      const [kind, detail] = classify('', lines);
      count[kind] = (count[kind] || 0) + 1;
      console.log(`  (${dx},${dy}) ${kind.padEnd(11)} ${detail.trim()}`);
    }
  }

  console.log('\n汇总:', count);
  const errs = c.logs.filter(l => /\[exc\]/.test(l));
  console.log('异常:', errs.length ? errs.slice(-5).join('\n') : '（无）');
} finally {
  await c.close();
}
