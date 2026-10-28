/**
 * 安全区「不能攻击 / 不能放技能」的探针。
 *
 *   node tools/safezone-probe.mjs
 *
 * 判据（对应原版 `Combat.cpp::Attack()` IDA L1280 / L1314 两道门）：
 *   1. 站在安全区（洛兰城内）→ `safeZoneGate(0).blocked === true`；
 *      调 `attack()` 后角色动作**不变**（被门禁掐在 `player.play()` 之前）
 *   2. 安全区里放技能 → `use(skill)` 返回 false
 *   3. 走出安全区 → `blocked === false`，`attack()` 能正常挥砍（动作号变了）
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('safezone');
const ev = e => c.ev(e);
const state = async () => JSON.parse(await ev(`JSON.stringify(__MU_APP__.state())`));
const gate = async (id = 0) => JSON.parse(await ev(`JSON.stringify(__MU_APP__.safeZoneGate(${id}))`));

try {
  await c.waitFor(`!!document.getElementById('login-account')`, 20000, '登录');
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 60000, '选角');
  await sleep(3000);
  await ev(`(() => { const b = document.querySelectorAll('.char-card')[3]; b && b.click(); })()`);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);
  await c.waitFor(`__MU_APP__.state().mapId !== null`, 120000, '地图');
  await sleep(2500);

  let s = await state();
  console.log('出生', s.mapName, `${s.player.x},${s.player.y}`);

  // 找到离出生点最近的安全区格（用调试口 safeZone(x,y) 扫描）
  const safeCell = JSON.parse(
    await ev(`(() => {
      const st = JSON.parse(JSON.stringify(__MU_APP__.state()));
      const px = Math.round(st.player.x), py = Math.round(st.player.y);
      let best = null;
      for (let r = 0; r <= 60 && !best; r++) {
        for (let dy = -r; dy <= r && !best; dy++) {
          for (let dx = -r; dx <= r && !best; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (__MU_APP__.safeZone(px + dx, py + dy) && __MU_APP__.canStandAt(px + dx, py + dy)) best = { x: px + dx, y: py + dy };
          }
        }
      }
      return JSON.stringify(best);
    })()`)
  );
  console.log('最近的安全区格', JSON.stringify(safeCell));

  // 走过去并等落地
  await ev(`__MU_APP__.walkTo(${safeCell.x}, ${safeCell.y})`);
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    s = await state();
    if (Math.round(s.player.x) === safeCell.x && Math.round(s.player.y) === safeCell.y && s.pathLeft === 0) break;
  }
  s = await state();
  console.log('到达', `${s.player.x},${s.player.y}`, 'safe=', await ev(`__MU_APP__.safeZone()`));

  const g0 = await gate(0);
  console.log('门禁(普攻)=', JSON.stringify(g0));
  const before = (await state()).player.action;
  await ev(`__MU_APP__.attack()`);
  await sleep(400);
  const after = (await state()).player.action;
  console.log(`安全区攻击：动作 ${before} → ${after}（应不变）`);

  const gs = await gate(1);
  const castOk = await ev(`__MU_APP__.skillBar.use(0)`);
  console.log('门禁(技能 1)=', JSON.stringify(gs), ' skill.use() =', JSON.stringify(castOk), '（应为 false）');

  const gBuff = await gate(26);
  console.log('门禁(技能 26 守护之光)=', JSON.stringify(gBuff), '（非事件地图应仍被挡）');

  /*
   * 规则表（不依赖走位）：用固定坐标问门禁。
   *   洛兰(0) 野外 150,200 → 不挡；洛兰城内 133,131 → 挡（含技能 26）
   *   事件地图（11..16）的安全区 → 只放行 16/26/27/28/48 —— 这里只能验当前地图，
   *   所以事件地图那条留 TODO，等能传送到血色城堡再验。
   */
  console.log('野外规则(150,200)=', JSON.stringify(await ev(`JSON.stringify(__MU_APP__.safeZoneGate(0, 150, 200))`)));
  console.log('城内规则(133,131)=', JSON.stringify(await ev(`JSON.stringify(__MU_APP__.safeZoneGate(0, 133, 131))`)));
  console.log('城内技能26(133,131)=', JSON.stringify(await ev(`JSON.stringify(__MU_APP__.safeZoneGate(26, 133, 131))`)));

  // 行为验证：走到最近的野外格，普攻要能出手（动作号变）
  const openCell = JSON.parse(
    await ev(`(() => {
      const st = JSON.parse(JSON.stringify(__MU_APP__.state()));
      const px = Math.round(st.player.x), py = Math.round(st.player.y);
      for (let r = 1; r <= 24; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = px + dx, y = py + dy;
          if (__MU_APP__.safeZone(x, y) || !__MU_APP__.canStandAt(x, y)) continue;
          if (__MU_APP__.pathTo(x, y) > 0) return JSON.stringify({ x, y });
        }
      }
      return 'null';
    })()`)
  );
  if (!openCell) {
    console.log('附近 24 格内没有野外格，跳过行为验证（规则已由上面三行覆盖）');
  } else {
    console.log('最近野外格', JSON.stringify(openCell), 'walkTo →', await ev(`__MU_APP__.walkTo(${openCell.x}, ${openCell.y})`));
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      s = await state();
      if (Math.round(s.player.x) === openCell.x && Math.round(s.player.y) === openCell.y) break;
      if (s.pathLeft === 0) break;
    }
    s = await state();
    console.log('野外位置', `${s.player.x},${s.player.y}`, '门禁=', JSON.stringify(await gate(0)));
    const a0 = (await state()).player.action;
    await ev(`__MU_APP__.attack()`);
    await sleep(250);
    const a1 = (await state()).player.action;
    console.log(`野外攻击：动作 ${a0} → ${a1}（应变）`);
  }
} finally {
  await c.close();
}
