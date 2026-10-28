/**
 * 像素级验证「名字在不在头顶」（背景动画去噪版）。
 *
 *   node tools/head-pixel.mjs
 *
 * 拍三张：正常、藏起自己、再藏起自己（隔 0.4s）。
 *   diff1 = |正常 - 藏|    → 角色 + 背景动画
 *   diff2 = |藏 - 藏(第二次)| → 纯背景动画
 * 剪影 = diff1 明显而 diff2 几乎没有的像素（动画噪点被扣掉）。
 *
 * 输出：剪影的每一行最左/最右，以及名牌的上下边界，用来判断名字压在头上还是飘在上面。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('headpx');
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
  await sleep(3000);

  const rect = JSON.parse(
    await ev(`(() => { const b = document.getElementById('stage').getBoundingClientRect();
      return JSON.stringify({ x: b.left, y: b.top, width: b.width, height: b.height }); })()`)
  );
  const clip = { ...rect, scale: 1 };
  const grab = async f => {
    const r = await c.send('Page.captureScreenshot', { format: 'png', clip });
    writeFileSync(f, Buffer.from(r.data, 'base64'));
  };

  await ev(`__MU_APP__.selfShow(true)`);
  await sleep(300);
  await grab('shots/_px_on.png');
  await ev(`__MU_APP__.selfShow(false)`);
  await sleep(400);
  await grab('shots/_px_off.png');
  await sleep(400);
  await grab('shots/_px_off2.png');
  await ev(`__MU_APP__.selfShow(true)`);

  const tag = JSON.parse(
    await ev(`(() => {
      const t = [...document.querySelectorAll('.wtag')].find(e => e.dataset.id === '-1');
      if (!t) return 'null';
      const r = t.getBoundingClientRect();
      const s = document.getElementById('stage').getBoundingClientRect();
      return JSON.stringify({ text: t.textContent, top: r.top - s.top, bottom: r.bottom - s.top,
        cx: r.left - s.left + r.width / 2, w: r.width, h: r.height });
    })()`)
  );
  const hp = JSON.parse(await ev(`JSON.stringify(__MU_APP__.headProbe())`))[0];
  const st = JSON.parse(await ev(`JSON.stringify(__MU_APP__.state())`));

  const head = JSON.parse(
    await ev(`JSON.stringify(__MU_APP__.project(${st.player.x + 0.5}, ${st.player.y + 0.5}, ${st.player.z} + ${hp.used}))`)
  );

  console.log('headProbe:', JSON.stringify(hp));
  console.log('名牌（舞台坐标）:', JSON.stringify(tag));
  console.log('名牌投影点 y =', head.y.toFixed(1), '（CSS 以底边中点为锚 → 应等于 bottom）');
} finally {
  await c.close();
}
