/**
 * 选角 / 新建角色界面截图（走真实登录，停在角色列表）。
 *
 *   node tools/charselect-shot.mjs [前缀]
 *
 * 出三张：`<前缀>.png`（刚进来，谁都没选）、`<前缀>-sel.png`（点了第一个角色，
 * 左右两块銘牌伸进来 + 人物打亮）、`<前缀>-create.png`（新建角色面板打开）。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const name = process.argv[2] || 'charselect-v3';
const c = await createClient('cs');
try {
  await c.waitFor(`!!document.getElementById('login-account')`, 20000, '登录页');
  await c.ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 40000, '选角');
  // 等 3D 背景 + 场上角色模型加载完
  await sleep(4500);

  const full = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`shots/${name}.png`, Buffer.from(full.data, 'base64'));
  console.log(`已保存 shots/${name}.png`);

  // 点第一个角色：銘牌从两边伸进来 + 人物高亮
  const hit = await c.ev(`(() => {
    const card = document.querySelector('.char-card');
    if (!card) return null;
    card.click();
    return card.dataset.name;
  })()`);
  if (hit) {
    await sleep(900);
    const full2 = await c.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`shots/${name}-sel.png`, Buffer.from(full2.data, 'base64'));
    console.log(`已保存 shots/${name}-sel.png（选中 ${hit}）`);
  }

  // 打开新建角色面板
  const opened = await c.ev(`(() => {
    const btn = document.getElementById('btn-char-create');
    if (!btn || btn.disabled) return 'disabled';
    btn.click();
    return !document.getElementById('create-panel').classList.contains('hidden');
  })()`);
  console.log('新建角色面板：', opened);
  if (opened === true) {
    // 等职业预览渲完（createPlayer 要读 player.bmd + 整套装备，首次一两秒）
    await sleep(2600);
    const clip = JSON.parse(
      await c.ev(`(() => { const b = document.getElementById('char-layer').getBoundingClientRect();
        return JSON.stringify({ x: b.left, y: b.top, width: b.width, height: b.height }); })()`)
    );
    const shot = await c.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1.4 } });
    writeFileSync(`shots/${name}-create.png`, Buffer.from(shot.data, 'base64'));
    console.log(`已保存 shots/${name}-create.png`);
  }
} finally {
  await c.close();
}
