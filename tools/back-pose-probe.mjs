/**
 * 背武器姿态的候选对比（一次性出图，肉眼挑）。
 *
 *   node tools/back-pose-probe.mjs
 *
 * 做完就不用留着了：定下来的数值写回 `actor.ts` 的 BACK_POSE。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('backpose');

const CANDIDATES = [
  { label: 'A t0', tilt: 0, out: 0.14, up: -0.12 },
  { label: 'B t.42', tilt: 0.42, out: 0.14, up: -0.12 },
  { label: 'C t-.42', tilt: -0.42, out: 0.14, up: -0.12 },
  { label: 'D t.8', tilt: 0.8, out: 0.14, up: -0.12 },
  { label: 'E t.42 far', tilt: 0.42, out: 0.24, up: -0.12 },
  { label: 'F t.42 high', tilt: 0.42, out: 0.14, up: -0.02 },
];

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, 'offline');
  await c.waitFor(`!!__MU_APP__.playerActor()`, 60000, 'player');
  await sleep(1500);

  const rect = JSON.parse(
    await c.ev(`(() => { const r = document.querySelector('#stage').getBoundingClientRect();
      return JSON.stringify({ x: r.left, y: r.top, width: r.width, height: r.height }); })()`)
  );
  const k = rect.width / 640;
  // 主角固定在屏幕中心，取一块窄一点的方框放大看
  const clip = { x: rect.x + 250 * k, y: rect.y + 130 * k, width: 140 * k, height: 190 * k, scale: 3 };

  const shots = [];
  for (const cand of CANDIDATES) {
    console.log('cand', cand.label);
    await c.ev(`__MU_APP__.backPose(${JSON.stringify(cand)})`);
    await c.ev(`__MU_APP__.previewEquip({ cls: 1, safeZone: true, weapon: 0, shield: 192 })`);
    await sleep(1100);
    const r = await c.send('Page.captureScreenshot', { format: 'png', clip });
    const file = 'shots/back-' + cand.label.slice(0,1) + '.png';
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    shots.push({ label: cand.label, file });
  }

  console.log('saved', shots.map(x => x.file).join(' '));
  console.log('errors:', c.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exc]')).slice(0, 3));
} finally {
  await c.close();
}
