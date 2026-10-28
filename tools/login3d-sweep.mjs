/**
 * 登录 3D 相机扫描：同一页面里连着改相机参数各截一张，拼成 contact sheet，
 * 用来跟原版客户端截图对海平线高度 / 船的大小。
 *
 *   node tools/login3d-sweep.mjs
 *
 * 输出：shots/login3d-sweep.png（3 列），以及每张 shots/_sweep-N.png
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

/** [z, tilt°, 说明] —— x/y/fov 不动（0,-22,45°） */
const CONFIGS = [
  [10, 8, 'z10 t8'],
  [5, 8, 'z5 t8'],
  [2, 8, 'z2 t8'],
  [2, 4, 'z2 t4'],
  [0.5, 6, 'z0.5 t6'],
  [0.5, 2, 'z0.5 t2'],
];

const c = await createClient('l3dsweep');
try {
  await c.waitFor(`document.getElementById('login')?.classList.contains('has3d')`, 40000, '3D 就位');
  await c.ev(`document.querySelectorAll('.mu-layer').forEach(el => el.style.display = 'none')`);
  await sleep(800);
  const box = JSON.parse(
    await c.ev(`(() => { const b = document.getElementById('login-3d').getBoundingClientRect();
      return JSON.stringify({ x: b.left, y: b.top, width: b.width, height: b.height }); })()`)
  );

  const files = [];
  for (let i = 0; i < CONFIGS.length; i++) {
    const [z, tilt, label] = CONFIGS[i];
    await c.ev(`__MU_APP__.login3dCam({ z: ${z}, tilt: ${tilt} })`);
    await sleep(400);
    const shot = await c.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 0.6 } });
    const f = `shots/_sweep-${i}.png`;
    writeFileSync(f, Buffer.from(shot.data, 'base64'));
    files.push({ f, label });
    console.log(`${i}: ${label} → ${f}`);
  }
  writeFileSync('.tmp/sweep.json', JSON.stringify(files));
} finally {
  await c.close();
}
