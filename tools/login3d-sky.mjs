/** 天空盒缩放扫描：看海平线能不能抬到参考图的高度 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const KS = [1, 4, 8, 15, 30, 60];
const c = await createClient('l3dsky');
const files = [];
try {
  await c.waitFor(`document.getElementById('login')?.classList.contains('has3d')`, 40000, '3D');
  await c.ev(`document.querySelectorAll('.mu-layer').forEach(el => el.style.display = 'none')`);
  await sleep(600);
  const box = JSON.parse(await c.ev(`(() => { const b = document.getElementById('login-3d').getBoundingClientRect();
    return JSON.stringify({ x: b.left, y: b.top, width: b.width, height: b.height }); })()`));
  for (const k of KS) {
    await c.ev(`__MU_APP__.login3dSky(${k})`);
    await sleep(350);
    const shot = await c.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 0.6 } });
    const f = `shots/_sky-${k}.png`;
    writeFileSync(f, Buffer.from(shot.data, 'base64'));
    files.push({ f, label: `sky×${k}` });
  }
  writeFileSync('.tmp/sky.json', JSON.stringify(files));
  console.log('done', KS.join(','));
} finally { await c.close(); }
