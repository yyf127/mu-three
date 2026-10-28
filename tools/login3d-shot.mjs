/**
 * 登录 3D 背景截图（把 UI 层藏掉，只留 640×320 那条 3D 横条）。
 *
 *   node tools/login3d-shot.mjs [名字]
 *
 * 用来跟原版客户端截图（`tools/ref_login_shot.py` 出的 `ref-login-win32.png`）
 * 逐像素比构图：字标大小/位置、海平线高度、船的位置。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const name = process.argv[2] || 'login3d';
const c = await createClient('l3d');
try {
  await c.waitFor(`document.getElementById('login')?.classList.contains('has3d')`, 40000, '3D 就位');
  await c.ev(`document.querySelectorAll('.mu-layer').forEach(el => el.style.display = 'none')`);
  await sleep(1500);

  const box = JSON.parse(
    await c.ev(`(() => { const b = document.getElementById('login-3d').getBoundingClientRect();
      return JSON.stringify({ x: b.left, y: b.top, width: b.width, height: b.height }); })()`)
  );
  const shot = await c.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } });
  writeFileSync(`shots/${name}.png`, Buffer.from(shot.data, 'base64'));
  console.log(`已保存 shots/${name}.png  ${Math.round(box.width)}×${Math.round(box.height)}`);
  console.log('场景：', JSON.stringify(await c.ev(`__MU_APP__.login3d ? __MU_APP__.login3d() : null`)));
} finally {
  await c.close();
}
