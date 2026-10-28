/** 亚特兰蒂斯：水里浮空待机 + 游动（离线） */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
let pass = 0, fail = 0;
const check = (l, ok, d='') => { ok ? (pass++, console.log(`  ✓ ${l}${d?'  '+d:''}`)) : (fail++, console.log(`  ✗ ${l}${d?'  '+d:''}`)); };
const c = await createClient('swim');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`__MU_APP__.state().objects > 0`, 90000, '物件');

  await c.ev(`__MU_APP__.loadMap(7, 40, 200)`);
  await c.waitFor(`__MU_APP__.state().mapId === 7`, 120000, '亚特兰蒂斯');
  await c.waitFor(`__MU_APP__.state().objects > 0`, 90000, '物件7');
  await sleep(800);

  // 走到安全区外的一格（亚特兰蒂斯整张图都在水下）
  const spot = JSON.parse(await c.ev(`(() => {
    const p = __MU_APP__.state().player;
    for (let r = 5; r < 60; r++) {
      for (const [dx, dy] of [[r,0],[0,r],[-r,0],[0,-r]]) {
        const x = Math.round(p.x) + dx, y = Math.round(p.y) + dy;
        if (__MU_APP__.canStand(x, y) && !__MU_APP__.safeZone(x, y)) return JSON.stringify({ x, y });
      }
    }
    return JSON.stringify(null);
  })()`));
  console.log('\n非安全区格子:', JSON.stringify(spot));
  check('找到非安全区的格子', !!spot, JSON.stringify(spot));

  if (spot) {
    await c.ev(`__MU_APP__.setPos(${spot.x}, ${spot.y})`);
    await sleep(900);
    const idle = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
    console.log(`  站水里 (${spot.x},${spot.y}) 动作=${idle.player.action}`);
    check('水里待机 = 浮空（9/10）', idle.player.action === 9 || idle.player.action === 10, String(idle.player.action));

    // 走一格 → 游泳动作 21
    await c.ev(`__MU_APP__.walkTo(${spot.x + 1}, ${spot.y})`);
    let swim = 0;
    for (let i = 0; i < 12; i++) {
      await sleep(180);
      const a = (await c.ev(`__MU_APP__.state().player.action`)) | 0;
      if (a === 21 || a === 29) { swim = a; break; }
    }
    check('水里走动 = 游动（21/29）', swim === 21 || swim === 29, String(swim));
  }

  // 耐力：>=40 时游泳用力竭动作 29
  if (spot) {
    await c.ev(`__MU_APP__.setPos(${spot.x}, ${spot.y})`);
    await sleep(500);
    await c.ev(`__MU_APP__.setStamina(40)`);
    await c.ev(`__MU_APP__.walkTo(${spot.x + 1}, ${spot.y})`);
    let tired = 0;
    for (let i = 0; i < 10; i++) {
      await sleep(160);
      const a = (await c.ev(`__MU_APP__.state().player.action`)) | 0;
      if (a === 21 || a === 29) { tired = a; break; }
    }
    check('耐力满时游泳 = 力竭动作 29', tired === 29, String(tired));

    /*
     * 停下后耐力清零。
     * 软件渲染只有几帧每秒，走完这一格实际要 1 秒多（dt 被钳到 0.1），
     * 600ms 时人还在路上，耐力自然还没清 —— 给到 2.5 秒再取样。
     */
    await sleep(2500);
    const st = (await c.ev(`__MU_APP__.stamina()`)) | 0;
    check('站住后耐力清零（原版 SetPlayerStop）', st === 0, String(st));
  }

  // 安全区里不该游泳/浮空
  const safeSpot = JSON.parse(await c.ev(`(() => {
    for (let y = 0; y < 256; y += 2) for (let x = 0; x < 256; x += 2)
      if (__MU_APP__.canStand(x, y) && __MU_APP__.safeZone(x, y)) return JSON.stringify({ x, y });
    return JSON.stringify(null);
  })()`));
  if (safeSpot) {
    await c.ev(`__MU_APP__.setPos(${safeSpot.x}, ${safeSpot.y})`);
    await sleep(800);
    const a = (await c.ev(`__MU_APP__.state().player.action`)) | 0;
    console.log(`  安全区 (${safeSpot.x},${safeSpot.y}) 动作=${a}`);
    check('安全区里照常站着（不是浮空 9/10）', a !== 9 && a !== 10, String(a));
  }

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally { await c.close(); }
