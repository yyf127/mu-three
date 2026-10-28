/**
 * 技能表对照探针（对应 `docs/SKILL_AUDIT.md`）。
 *
 * 守三件事：
 *   1. **不要地面圆形光斑** —— 原版是 `AddTerrainLight` 提亮地形顶点，不是贴圆片；
 *   2. 黑龙波（9）= 4 条 `Skill/Laser01.bmd` 贴地游动（源码 205），
 *      不再是「8 个 JointSpirit 静态贴图点」；
 *   3. 48 生命之光 = 1 个法阵 + 36 道竖光（源码 1264×1 + 1253×36），
 *      不再是 36 个法阵叠一起；27 守护之光 = 2 段（不是 10 段）。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

let pass = 0;
let fail = 0;
const check = (l, ok, d = '') => {
  ok ? (pass++, console.log(`  ✓ ${l}${d ? '  ' + d : ''}`))
     : (fail++, console.log(`  ✗ ${l}${d ? '  ' + d : ''}`));
};

const c = await createClient('skillaudit');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`!!__MU_APP__.playerActor()`, 60000, '角色');
  await sleep(1200);

  const list = await c.ev(`__MU_APP__.skills()`);
  const byId = (id) => list.find(s => s.id === id);

  /* ---------- 1. 地面光圈 ---------- */
  await c.ev(`__MU_APP__.fxClear()`);
  await c.ev(`__MU_APP__.cast(9)`);
  await sleep(700);
  const g9 = await c.ev(`__MU_DEBUG__.glowCount()`);
  await c.ev(`__MU_APP__.fxClear()`);
  await c.ev(`__MU_APP__.cast(2)`);
  await sleep(700);
  const g2 = await c.ev(`__MU_DEBUG__.glowCount()`);
  console.log(`地面光斑数量：黑龙波 ${g9} / 陨石 ${g2}`);
  check('黑龙波不再生成地面圆形光斑', g9 === 0, String(g9));
  check('陨石也不再生成地面圆形光斑', g2 === 0, String(g2));
  await c.ev(`__MU_APP__.fxClear()`);

  /* ---------- 2. 黑龙波 ---------- */
  await sleep(300);
  await c.ev(`__MU_APP__.cast(9)`);
  await sleep(600);
  const laser = await c.ev(`__MU_DEBUG__.sceneMaterial('dragon')`);
  const laserMeshes = (laser || []).reduce((a, x) => a + x.meshes, 0);
  console.log('Laser01 材质:', JSON.stringify(laser));
  check('黑龙波 = Laser01（源码 205）进了场景', laserMeshes >= 4, `${laserMeshes} 个 mesh`);
  check('Laser01 是加色 + 半透明 + 不写深度',
        (laser || []).some(h => h.blending === 5 && h.transparent === true && h.depthWrite === false),
        JSON.stringify(laser?.[0] ?? null));

  /*
   * 轨迹（这一版的重点）：
   *   源码 `MoveHumming` 只转角度不动位置，`Joint_SegmentTick` 也不推进位置，
   *   `+0x9bc` 到达标志只写不读 → 4 条 joint **位置整段寿命不变**，
   *   只有角度在抖（±6.4° 偏航 / ±3.2° 俯仰）+ BMD 自身动画。
   *   所以它们应该**贴在施法者身边**（半径 < 2 格、离地 ~1 格），
   *   不是「4 个卫星绕大圈」。
   */
  const dw = await c.ev(`__MU_APP__.dragonWave()`);
  const radii = (dw || []).map(h => +h.r.toFixed(2));
  const terrainZ = await c.ev(`(() => {
    const p = __MU_APP__.state().player;
    return __MU_DEBUG__.terrainInfo ? null : null;
  })()`);
  console.log(`黑龙波轨迹：半径 ${JSON.stringify(radii)} 高度 ${JSON.stringify((dw || []).map(h => +h.z.toFixed(2)))}`);
  check('4 条都在施法者身边（半径 ≤ 2 格）', (dw || []).length === 4 && radii.every(r => r <= 2),
        JSON.stringify(radii));
  check('半径不是 0（真的在飘，不是钉死）', radii.some(r => r > 0.3), JSON.stringify(radii));

  /*
   * 光带：4 条 × (0.28 s / 0.07 s) ≈ 每条 4 段在活，稳态 16 上下。
   * 不能断言「数字一定在变」—— 生成和消亡同速率时正好是稳态。
   */
  const cntA = await c.ev(`__MU_APP__.fxCount()`);
  await sleep(350);
  const cntB = await c.ev(`__MU_APP__.fxCount()`);
  console.log(`光带段：${cntA} → ${cntB}`);
  check('光带段稳态存在（≥ 10 段）', cntA >= 10 && cntB >= 10, `${cntA} / ${cntB}`);
  check('黑龙波不再生成 JointSpirit 静态件', !((byId(9)?.parts ?? []).some(p => p.kind === 'sprite')),
        JSON.stringify((byId(9)?.parts ?? []).map(p => p.kind)));
  await c.ev(`__MU_APP__.fxClear()`);

  /* ---------- 3. 48 / 27 数量 ---------- */
  const p48 = byId(48)?.parts ?? [];
  const ground48 = p48.filter(p => p.file.includes('Magic_Ground2'));
  const spark48 = p48.filter(p => p.file.includes('JointSpirit'));
  console.log('48 生命之光:', JSON.stringify(p48.map(p => `${p.file}×${p.count}`)));
  check('48 法阵只有 1 个', ground48.length === 1 && ground48[0].count === 1, JSON.stringify(ground48.map(p => p.count)));
  check('48 竖光 36 道', spark48.length === 1 && spark48[0].count === 36, JSON.stringify(spark48.map(p => p.count)));

  const p27 = byId(27)?.parts ?? [];
  console.log('27 守护之光:', JSON.stringify(p27.map(p => `${p.file}×${p.count}`)));
  const j27 = p27.find(p => p.file.includes('JointSpirit'));
  check('27 关节 2 段（不是 10）', !!j27 && j27.count === 2, String(j27?.count));

  /* ---------- 4. 极光（12） ---------- */
  const p12 = byId(12)?.parts ?? [];
  console.log('12 极光:', JSON.stringify(p12.map(p => `${p.kind}:${p.file}×${p.count}`)));
  check('12 有弹体（beam）', p12.some(p => p.kind === 'beam'), JSON.stringify(p12.map(p => p.kind)));
  check('12 拖尾 30 段（源码 1176 连发）', p12.some(p => p.kind === 'trail' && p.count === 30),
        JSON.stringify(p12.filter(p => p.kind === 'trail').map(p => p.count)));

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
