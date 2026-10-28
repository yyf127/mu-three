/**
 * 箭矢探针（离线沙盘）—— 精灵的 `CreateArrows` 到底有没有在飞。
 *
 *   node tools/arrow-probe.mjs
 *
 * 源码依据（`Combat/Combat_Projectiles.cpp`）：
 *
 *   `CreateArrow`   按**武器模型号**选箭矢模型（528/529→ArrowSteel、530→ArrowSaw、
 *                   531→ArrowLaser、532→ArrowThunder、533→ArrowWing、534→ArrowBomb、
 *                   536/538→ArrowDouble、其余弓→Arrow01），不是按技能选。
 *   `CreateArrows`  `Skill == 1` → 三连（中心 + ±8°）；`Skill == 2` → 五连；
 *                   其余（含 51/52）→ 单箭。
 *
 * 断言：
 *   ① 多重箭（24）一次放 3 支，冰封箭（51）/穿透箭（52）各 1 支
 *   ② 箭矢确实是**实体在飞**：连续采样，位置随时间单调靠近目标
 *   ③ 箭矢朝向 = 从施法者指向目标（yaw ≈ atan2(dy,dx)）
 *   ④ 飞到目标后自行销毁，不留在场景里
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

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

const c = await createClient('arrow');

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 120000, '离线沙盘');
  await c.waitFor(`!!__MU_APP__.skillTarget()`, 40000, '技能靶子');
  await sleep(1500);

  // 先施法一次让相机/角色贴到靶子面前
  await c.ev(`(async () => await __MU_APP__.castSkill(4))()`);
  await sleep(2200);
  await c.ev('__MU_APP__.fxClear()');

  /* ---------------- ① 支数 ---------------- */
  for (const [id, want, name] of [
    [24, 3, '多重箭'],
    [51, 1, '冰封箭'],
    [52, 1, '穿透箭'],
  ]) {
    await c.ev('__MU_APP__.fxClear()');
    await sleep(200);
    await c.ev(`(async () => await __MU_APP__.castSkill(${id}))()`);
    /*
     * 轮询取峰值，别固定等 600 ms —— 箭飞到 2 m 外的靶子只要 0.1 s，
     * 寿命 `flyTime + 0.12` 也只有 0.22 s，固定采样经常已经飞完销毁了。
     */
    let peak = 0;
    let files = [];
    for (let i = 0; i < 14; i++) {
      await sleep(80);
      const a = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.fxArrows())'));
      if (a.length > peak) {
        peak = a.length;
        files = a.map(x => x.file);
      }
    }
    const dbg = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.arrows())'));
    check(`${name}（${id}）放 ${want} 支箭`, peak === want, `实际 ${peak} 支 ${files.join(',')}`);
    check(`${name} 记录到放箭（箭头模型/距离）`, !!dbg.last, JSON.stringify(dbg.last));
  }

  /* ---------------- ② 飞行（位置随时间变化） ---------------- */
  await c.ev('__MU_APP__.fxClear()');
  await sleep(200);
  const dist0 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.arrows())')).last;
  // 放一支飞向 30 m 外的箭：靶子只离 2.6 m，0.1 s 就到了，抓不到中间过程
  await c.ev('__MU_APP__.testArrows(1, 30)');
  await sleep(90);

  const track = [];
  const axes = [];
  for (let i = 0; i < 14; i++) {
    const a = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.fxArrows())'));
    // `pos` 是落点（生成时算好就不动），`at` 才是实时的 root 位置 —— 追踪弹靠后者
    if (a.length) {
      track.push({ d: +Math.hypot(a[0].at[0], a[0].at[1]).toFixed(2), pos: a[0].at });
      // `axis` = 模型本地 +Z 经蒙皮后在世界上指向哪，箭矢的长轴就是它
      axes.push(a[0].axis);
    }
    await sleep(80);
  }
  console.log('  飞行轨迹样本:', track.map(t => `(${t.pos[0].toFixed(1)},${t.pos[1].toFixed(1)})`).join(' → '));
  const moved = track.length >= 2 && Math.hypot(
    track[track.length - 1].pos[0] - track[0].pos[0],
    track[track.length - 1].pos[1] - track[0].pos[1]
  );
  check('箭矢在飞（>0.5 m 位移）', moved > 0.5, `位移 ${moved?.toFixed(2)} m，采样 ${track.length} 次`);

  /* ---------------- ③ 朝向：箭身长轴必须和飞行方向同向 ---------------- */
  /*
   * 这一条是**回归「↓↓ 而不是 →→」** 的断言。
   *
   * `Arrow01.bmd` 的顶点长轴在模型空间是 +Z，但骨骼绑定把它转到了世界 -Y，
   * 所以 `yaw = atan2(dy, dx)` 会让箭身整体歪 90°。修法是在 `shootArrows`
   * 里补 `+π/2`。这里用「模型实际指向（axis）」点乘「实际位移方向」来验，
   * 点乘 ≈ 1 = 同向；≈ 0 = 歪 90°；≈ -1 = 箭尾朝前。
   */
  let dot = null;
  if (track.length >= 2 && axes.length >= 2) {
    const a0 = track[0].pos;
    const a1 = track[track.length - 1].pos;
    const vx = a1[0] - a0[0];
    const vy = a1[1] - a0[1];
    const len = Math.hypot(vx, vy);
    const ax = axes[axes.length - 1];
    if (len > 0.01) dot = (ax[0] * (vx / len) + ax[1] * (vy / len));
    console.log(
      `  箭头指向 ${JSON.stringify(ax)}，飞行方向 (${(vx / len).toFixed(3)}, ${(vy / len).toFixed(3)})，点乘 ${dot?.toFixed(3)}`
    );
  }
  check('箭身长轴与飞行方向一致（不是歪 90°/反向）', dot !== null && dot > 0.98, `点乘 ${dot?.toFixed(3)}`);

  /* ---------------- ③b 粗细 ---------------- */
  const dbgNow = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.arrows())')).last;
  const thickOk =
    Array.isArray(dbgNow?.scale3) && dbgNow.scale3[0] >= 1.8 && dbgNow.scale3[2] >= 1.8 && dbgNow.scale3[1] <= 1.3;
  const liveScale = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.fxArrows())')).map(a => a.scale);
  check(
    '箭矢已加粗（横截面 ×2、长度仅 +15%）',
    thickOk,
    `scale3=${JSON.stringify(dbgNow?.scale3)} 实例 scale=${liveScale.join(',') || '已飞完'}`
  );
  void dist0;

  /* ---------------- ④ 飞完销毁 ---------------- */
  await sleep(1400);
  const left = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.fxArrows())'));
  check('箭矢命中后自动销毁', left.length === 0, `还剩 ${left.length} 支`);

  await c.ev('__MU_APP__.fxClear()');
  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error('ERR', e.message);
  console.log(c.logs.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  await c.close();
}
