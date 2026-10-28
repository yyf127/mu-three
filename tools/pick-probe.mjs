/**
 * 点怪 / 点怪旁边地面的拾取精度探针。
 *
 *   node tools/pick-probe.mjs
 *
 * 背景：以前 `pickMonsterAt` / `pickNpcAt` 是「投影点 60~70px 以内就算点中」，
 * 1600×900 下 ≈ 1.5 格，怪身边两格的地面全被吃掉，点过去变成攻击 ——
 * 实机表现为「地面点不动」。现在改成对模型做真射线求交，这里固化两条：
 *
 *   1. 点怪身上 → 锁定/攻击该怪；
 *   2. 点它**旁边一格的地面** → 走路，不是攻击。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? `  ${detail}` : ''}`);
  }
};

const c = await createClient('pick');

const PROJ = (x, y, z) => `(() => {
  const cam = __MU__.muCamera.camera; const V = cam.position.constructor;
  const v = new V(${x}, ${y}, ${z}).project(cam);
  const cv = document.querySelector('#app canvas'); const r = cv.getBoundingClientRect();
  return JSON.stringify([r.left + (v.x*0.5+0.5)*r.width, r.top + (-v.y*0.5+0.5)*r.height]);
})()`;

const ST = `JSON.stringify((() => { const s = __MU_APP__.state(); const m = __MU_APP__.moveInfo();
  return { x: +s.player.x.toFixed(2), y: +s.player.y.toFixed(2), focus: s.focus ?? -1,
           goal: m.goal, len: m.len, dead: s.dead }; })())`;

try {
  await loginAs(c, '1234', '1234');
  await sleep(3000);
  const st = JSON.parse(await c.ev(ST));
  const all = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.remotesInfo().entities)'));
  /*
   * 优先用怪物（洛兰城外才有），城里就退而用 NPC —— 两者原来是同一套
   * 「投影点距离」判定，都会把身边一大片地面吃掉。
   */
  const pick = kind =>
    all
      .filter(e => e.kind === kind && !e.dying)
      .map(m => ({ ...m, d: Math.hypot(m.x - st.x, m.y - st.y) }))
      .filter(m => m.d > 1.5 && m.d < 7)
      .sort((a, b) => a.d - b.d)[0];
  const near = pick('monster') || pick('npc');

  if (!near) {
    console.log('附近没有合适的怪/NPC，跳过（换个位置再跑）');
  } else {
    console.log(`\n目标 ${near.kind} #${near.id} ${near.name} (${near.x},${near.y}) 距离 ${near.d.toFixed(1)}`);

    // [A] 点实体身上（脚上 0.9 米 ≈ 腰部）
    const bodyZ = await c.ev(`__MU__.terrain.getHeight(${near.x}, ${near.y})`);
    await c.ev('__MU_APP__.clearClickLog()');
    const body = JSON.parse(await c.ev(PROJ(near.x, near.y, bodyZ + 0.9)));
    await c.dragTo(body[0], body[1], body[0], body[1], 2);
    await sleep(400);
    const logA = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.clickLog())'));
    const hitA = logA.some(l => l.includes(`→ ${near.kind === 'monster' ? 'monster' : 'npc'}#${near.id}`));
    check(`点${near.kind === 'monster' ? '怪' : 'NPC'}身上 → 命中这只`, hitA, logA.join(' | '));

    // [B] 点它旁边一格的地面（朝外那一侧）
    const gx = near.x + 1;
    const gy = near.y + 1;
    const gh = await c.ev(`__MU__.terrain.getHeight(${gx + 0.5}, ${gy + 0.5})`);
    await c.ev('__MU_APP__.clearClickLog()');
    const gp = JSON.parse(await c.ev(PROJ(gx + 0.5, gy + 0.5, gh)));
    await c.dragTo(gp[0], gp[1], gp[0], gp[1], 2);
    await sleep(400);
    const logB = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.clickLog())'));
    const groundB = logB.some(l => l.trim().startsWith('ground') && /ok=true/.test(l));
    const takeB = logB.some(l => l.includes('→ monster') || l.includes('→ npc'));
    check('点它旁边一格地面 → 走地面（不是攻击/对话）', groundB && !takeB, logB.join(' | '));

    const after = JSON.parse(await c.ev(ST));
    check('旁边地面点击后确实生成了路径', after.len > 0 || after.goal !== null, JSON.stringify(after));
  }

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
