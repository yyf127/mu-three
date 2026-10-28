/**
 * 底栏数值层探针 —— 不连服务端也能看版式。
 *
 *   node tools/hud-probe.mjs          # 满血/正常数值
 *   node tools/hud-probe.mjs low      # 残血（看球体液面下到哪）
 *   node tools/hud-probe.mjs shot     # 只截图，不断言
 *
 * 做法：点「离线演示」把世界加载出来，再调 `__MU_APP__.hudPreview()`
 * 往 refreshHud 里塞一份假 0xF3 数据，然后按 640×480 逻辑坐标裁图 + 打印几何。
 *
 * 为什么要断言几何：底栏的坐标是从客户端源码一行行抄的（97/489/221/439…），
 * 出问题时「差 3px」在截图里根本看不出来，但看 rect 一眼就知道。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const mode = process.argv[2] || 'normal';
const over =
  mode === 'low'
    ? { life: 44, maxLife: 320, mana: 12, maxMana: 120, bp: 8, maxBp: 100 }
    : {};

const c = await createClient('hudprobe');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 60000, '离线进图');
  await c.waitFor(
    `!document.querySelector('#mu-ui').classList.contains('hidden')`,
    60000,
    'UI 层可见'
  );
  await sleep(1200);

  const snap = JSON.parse(
    await c.ev(`JSON.stringify(__MU_APP__.hudPreview(${JSON.stringify(over)}))`)
  );
  console.log('hud:', JSON.stringify(snap));
  await sleep(400);

  // 元素矩形换算回 640×480 逻辑坐标，直接和源码里的数字对
  const geom = JSON.parse(
    await c.ev(`(() => {
      const stage = document.querySelector('#stage').getBoundingClientRect();
      const k = stage.width / 640;
      const L = e => {
        const b = e.getBoundingClientRect();
        return [ (b.x - stage.x) / k, (b.y - stage.y) / k, b.width / k, b.height / k ]
          .map(v => Math.round(v * 10) / 10);
      };
      const q = s => document.querySelector(s);
      const orbs = [...document.querySelectorAll('.hv-orb')];
      return JSON.stringify({
        hpOrb: orbs[0] ? L(orbs[0]) : null,
        mpOrb: orbs[1] ? L(orbs[1]) : null,
        nums: [...document.querySelectorAll('.bm-num')].map(n => ({
          box: L(n), text: [...n.children].map(d => d.dataset.digit).join(''),
        })),
        exp: q('.hv-exp-fill') ? { box: L(q('.hv-exp-fill')), w: q('.hv-exp-fill').style.width } : null,
        ag: q('.hv-ag') ? { box: L(q('.hv-ag')), img: q('.hv-ag-img') ? L(q('.hv-ag-img')) : null, clip: q('.hv-ag-img') ? getComputedStyle(q('.hv-ag-img')).clipPath : '' } : null,
        name: q('.hv-name') ? { box: L(q('.hv-name')), text: q('.hv-name').textContent } : null,
        place: q('.hv-place') ? { box: L(q('.hv-place')), text: q('.hv-place').textContent } : null,
      });
    })()`)
  );
  console.log('几何（逻辑 640×480）:', JSON.stringify(geom, null, 2));

  if (mode !== 'shot') {
    const rect = JSON.parse(
      await c.ev(`(() => { const r = document.querySelector('#stage').getBoundingClientRect();
        return JSON.stringify({ x: r.left, y: r.top, width: r.width, height: r.height }); })()`)
    );
    const k = rect.width / 640;
    const crop = (x, y, w, h) => ({
      x: rect.x + x * k,
      y: rect.y + y * k,
      width: w * k,
      height: h * k,
      scale: 1,
    });
    for (const [name, clip] of [
      ['hud-bar', crop(0, 400, 640, 80)],
      ['hud-full', { ...rect, scale: 1 }],
    ]) {
      const shot = await c.send('Page.captureScreenshot', { format: 'png', clip });
      writeFileSync(`shots/${name}.png`, Buffer.from(shot.data, 'base64'));
      console.log('saved shots/' + name + '.png');
    }
  }
} finally {
  const errs = c.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exc]'));
  console.log(`\n控制台错误 ${errs.length} 条`);
  for (const e of errs.slice(0, 6)) console.log('  ' + e);
  await c.close();
}
