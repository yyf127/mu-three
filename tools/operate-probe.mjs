/**
 * 可交互世界物件（坐下 / 倚靠）的探针。
 *
 *   node tools/operate-probe.mjs
 *
 * 原版链路：`SpecialObject_HoverTest`（Mouse_Hover.cpp:586）→ `SelectedOperate`
 * → `Player_InputTick.cpp:1133`（MOVEMENT_OPERATE）→ `Combat.cpp:2360` 按
 * World+Type 选动作（坐 133/135、倚靠 139/140、诺利亚浮空 137/138）并发
 * `0x18 action=108/109/110`。
 *
 * 断言：
 *   1. 当前地图有 operable 物件（洛兰应含 type 6/145/146/133）
 *   2. 物件投影到屏幕后，picker 能命中它，光标切成 sit/lean
 *   3. `operate(i)` 后角色动作变成 133/135（坐）
 *   4. `0x18` 包字节符合服务端 `PMSG_ACTION_RECV`（dir@3, action@4）
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('operate');
const ev = e => c.ev(e);

try {
  await c.waitFor(`!!document.getElementById('login-account')`, 20000, '登录');
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 60000, '选角');
  await sleep(2500);
  await ev(`(() => { const b = document.querySelectorAll('.char-card')[3]; b && b.click(); })()`);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);
  await c.waitFor(`__MU_APP__.state().mapId !== null`, 120000, '地图');
  await sleep(1500);

  const list = JSON.parse(await ev(`JSON.stringify(__MU_APP__.operables())`));
  console.log(`可交互物件 ${list.length} 个：`, JSON.stringify(list.slice(0, 8)));
  const ids = [...new Set(list.map(o => o.id))];
  console.log('类型：', JSON.stringify(ids));
  if (!list.length) {
    console.log('✗ 这张图没有 operable（检查 OPERABLE_BY_MAP）');
  } else {

  // 挑一个投影落在画面中央区域、离玩家最近的物件
  // （右上角是调试 HUD，落在那里指针事件被 HUD 吃掉，测不到光标）
  const near = JSON.parse(await ev(`(() => {
    const me = __MU_APP__.state().player;
    const cr = document.querySelector('#app canvas').getBoundingClientRect();
    const fr = document.getElementById('fx').getBoundingClientRect();
    let best = null, bd = 1e9;
    for (const o of __MU_APP__.operables()) {
      const p = __MU_APP__.project(o.x, o.y, o.z + 0.35);
      const sx = cr.left + p.x * (cr.width / fr.width);
      const sy = cr.top + p.y * (cr.height / fr.height);
      if (p.z > 0.99) continue; // 在相机背后 / 远平面外，投影不可信
      const inSafe = sx > cr.left + cr.width * 0.18 && sx < cr.left + cr.width * 0.72 &&
                     sy > cr.top + cr.height * 0.22 && sy < cr.top + cr.height * 0.82;
      if (!inSafe) continue;
      const d = Math.hypot(o.x - me.x, o.y - me.y);
      if (d < bd) { bd = d; best = { ...o, d: +d.toFixed(1), sx, sy }; }
    }
    return JSON.stringify(best);
  })()`));
  console.log('最近的物件：', JSON.stringify(near));
  if (!near) throw new Error('画面中央没有可交互物件（换个位置再看）');

  const hit = JSON.parse(await ev(`JSON.stringify(__MU_APP__.operableAt(${near.sx}, ${near.sy}))`));
  console.log(`屏幕 (${near.sx.toFixed(0)},${near.sy.toFixed(0)}) 命中：`, JSON.stringify(hit));

  // 真鼠标移过去，看光标
  await c.ptr('mouseMoved', near.sx, near.sy, { buttons: 0 });
  await sleep(250);
  const cur = JSON.parse(await ev(`JSON.stringify(__MU_APP__.cursor())`)).current;
  console.log('光标 =', cur, hit && cur === hit.cursor ? '✓' : '✗');

  // 直接坐（不走路），看动作号
  const idx = list.findIndex(o => o.x === near.x && o.y === near.y);
  const res = await ev(`(async () => JSON.stringify(__MU_APP__.operate(${idx})))()`);
  await sleep(700);
  const st = JSON.parse(await ev(`JSON.stringify(__MU_APP__.operateState())`));
  console.log('operate →', res, ' 0.7s 后 action =', st.action, '（应仍是 133/135/139/140，没被待机顶掉）');
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shots/operate-sit.png', Buffer.from(shot.data, 'base64'));

  // 走位版本：点一下 → 走过去 → 坐下（原版 MOVEMENT_OPERATE 全链路）
  await ev(`__MU_APP__.dialogClose && 0`);
  const go = await ev(`(() => { const r = __MU_APP__.operateGo(${idx}); return r; })()`);
  let reached = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const st = JSON.parse(await ev(`JSON.stringify(__MU_APP__.operateState())`));
    if (st.pending === null && [133, 135, 137, 139, 140].includes(st.action)) { reached = st; break; }
    if (st.pending === null && st.path === 0 && i > 3) break;
  }
  console.log('operateGo →', go, ' 结果 =', JSON.stringify(reached));

  // 0x18 包字节
  const pkt = await ev(`__MU_APP__.actionPacket(4, 108)`);
  console.log('0x18 包 =', pkt, '（期望 "c1 06 18 04 6c 00"：dir@3=4, action@4=0x6c=108）');
  }
} finally {
  await c.close();
}
