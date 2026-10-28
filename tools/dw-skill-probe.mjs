/**
 * 法师（Dark Wizard）技能表现探针 —— 阶段 AI 的回归工具。
 *
 *   node tools/dw-skill-probe.mjs
 *
 * 这一套断言对应「这个 port 曾经把弹道画成原地一团」的五个技能：
 *
 *   3  掌心雷    源码 case 3 没有 CreateEffect（只有音效 + 打断目标动作）
 *                → 兜底成「施法者→目标的一道雷 + 命中雷光」
 *   6  瞬间移动  源码走 `CreateTeleportBegin/End`（没有特效模型）
 *                → 兜底成「脚下法阵 + 升腾的光」
 *   15 小挪移    同上，范围更大
 *   11 真空波    `CreateEffect(203, o+16, Angle, …)` 在**施法者身上**生成，
 *                位移由 `MoveEffect` 按 Angle 推进 → 必须飞出去
 *   17 能量球    `CreateEffect(1180, o+16, Angle, …)` 同理 → 必须飞出去
 *
 * 判据都用「结构」而不是像素：模型/贴图/光束三层的存活 + 实时位置。
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

/** 三层一次取走（分三次取会漏掉寿命只有 0.3 s 的件） */
const SNAP = `JSON.stringify({ m: __MU_APP__.fx(), s: __MU_APP__.fxSprites(), b: __MU_APP__.fxBeams() })`;

const c = await createClient('dwskill');

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 120000, '离线沙盘');
  await c.waitFor(`!!__MU_APP__.skillTarget()`, 40000, '技能靶子');
  await sleep(1200);

  // 先施法一次让角色/相机贴到靶子面前
  await c.ev(`(async () => await __MU_APP__.castSkill(4))()`);
  await sleep(2200);

  const clear = async () => {
    await c.ev('__MU_APP__.fxClear()');
    await sleep(320);
    await c.ev('__MU_APP__.fxClear()');
    await sleep(120);
  };

  /** 放一个技能并采样若干帧：返回各层峰值与首个件的轨迹 */
  const cast = async (id, frames = 16, step = 90) => {
    await clear();
    const geo = JSON.parse(
      await c.ev(`JSON.stringify({
        p: [__MU_APP__.playerActor().x, __MU_APP__.playerActor().y],
        t: (() => { const t = __MU_APP__.skillTarget(); return [t.x, t.y, t.z]; })(),
      })`)
    );
    await c.ev(`(async () => await __MU_APP__.castSkill(${id}))()`);
    const peak = { m: [], s: [], b: [] };
    const path = [];
    for (let i = 0; i < frames; i++) {
      await sleep(step);
      const raw = await c.ev(SNAP);
      if (typeof raw !== 'string') continue;
      const snap = JSON.parse(raw);
      if (snap.m.length > peak.m.length) peak.m = snap.m;
      if (snap.s.length > peak.s.length) peak.s = snap.s;
      if (snap.b.length > peak.b.length) peak.b = snap.b;
      if (snap.m.length) path.push(snap.m[0].at);
    }
    return { peak, path, geo };
  };

  /* ---------------- 3 掌心雷：一道雷，而不是一根光柱 ---------------- */
  {
    const { peak, geo } = await cast(3);
    const beam = peak.b[0];
    const dist = Math.hypot(geo.t[0] - geo.p[0], geo.t[1] - geo.p[1]);
    check(
      '掌心雷：画出了一道雷（beam）',
      !!beam,
      beam ? `${beam.file} len=${beam.len}m` : '没有 beam'
    );
    check(
      '掌心雷：雷从施法者连到目标',
      !!beam && Math.abs(beam.len - dist) < dist * 0.5 + 0.8,
      `雷长 ${beam?.len}m vs 距离 ${dist.toFixed(2)}m`
    );
    check(
      '掌心雷：目标处有雷光/电花',
      peak.s.length >= 5,
      `贴图 ${peak.s.length} 件 ${peak.s.map(s => s.file.split('/').pop()).slice(0, 3).join(',')}…`
    );
    check(
      '掌心雷：不再用 Laser01 光柱兜底',
      !peak.m.some(m => /laser/i.test(m.file)),
      `模型 ${peak.m.map(m => m.file).join(',') || '无'}`
    );
  }

  /* ---------------- 6 / 15 瞬移：法阵 + 升腾光 ---------------- */
  for (const [id, name, minSize] of [
    [6, '瞬间移动', 3.0],
    [15, '小挪移', 3.5],
  ]) {
    const { peak } = await cast(id);
    const ring = peak.s.find(s => /magic_circle/i.test(s.file));
    check(
      `${name}：脚下有地面法阵`,
      !!ring && ring.kind === 'ground',
      ring ? `${ring.file} size=${ring.size} kind=${ring.kind}` : '没有法阵'
    );
    check(
      `${name}：法阵尺寸 ${minSize}m 以上`,
      !!ring && ring.size >= minSize,
      `size=${ring?.size}`
    );
    check(`${name}：有升腾的光`, peak.s.length >= 4, `贴图 ${peak.s.length} 件`);
  }

  /* ---------------- 11 / 17 弹道：必须从施法者飞向目标 ---------------- */
  for (const [id, name, fileRe] of [
    [11, '真空波', /magic02/i],
    [17, '能量球', /ball01/i],
  ]) {
    const { peak, path, geo } = await cast(id, 14, 80);
    const model = peak.m.find(m => fileRe.test(m.file));
    check(
      `${name}：用实体模型飞出去`,
      !!model && model.fly === true,
      model ? `${model.file} fly=${model.fly}` : `模型 ${peak.m.map(m => m.file).join(',') || '无'}`
    );
    const moved = path.length >= 2 ? Math.hypot(path.at(-1)[0] - path[0][0], path.at(-1)[1] - path[0][1]) : 0;
    check(`${name}：位置在推进（>0.5 m）`, moved > 0.5, `位移 ${moved.toFixed(2)} m / ${path.length} 帧`);
    const startDist = path.length ? Math.hypot(path[0][0] - geo.p[0], path[0][1] - geo.p[1]) : 99;
    const endDist = path.length ? Math.hypot(path.at(-1)[0] - geo.t[0], path.at(-1)[1] - geo.t[1]) : 99;
    check(
      `${name}：朝目标靠近（起点近施法者、终点近目标）`,
      startDist < 2.5 && endDist < startDist,
      `起点距施法者 ${startDist.toFixed(2)}m，终点距目标 ${endDist.toFixed(2)}m`
    );
  }

  /* ---------------- 精灵多重箭：三支 + 朝向对齐（阶段 AH/AI 回归） ---------------- */
  {
    await clear();
    await c.ev(`(async () => await __MU_APP__.castSkill(24))()`);
    let peak = 0;
    let axes = [];
    for (let i = 0; i < 12; i++) {
      await sleep(80);
      const a = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.fxArrows())'));
      if (a.length > peak) {
        peak = a.length;
        axes = a.map(x => x.axis);
      }
    }
    const dbg = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.arrows())')).last;
    check('多重箭（24）放 3 支箭', peak === 3, `实际 ${peak} 支`);
    check(
      '箭矢朝向与飞行方向一致（yaw + π/2 修正）',
      !!dbg && Math.abs(dbg.modelYaw - dbg.flyYaw - Math.PI / 2) < 1e-3,
      `flyYaw=${dbg?.flyYaw} modelYaw=${dbg?.modelYaw}`
    );
    const flying = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.fxArrows())'));
    check(
      '箭矢已加粗（scale3 横截面 ×2）',
      Array.isArray(dbg?.scale3) && dbg.scale3[0] === 2 && dbg.scale3[2] === 2,
      `scale3=${JSON.stringify(dbg?.scale3)} 存活 ${flying.length} 支，轴 ${JSON.stringify(axes[0] ?? null)}`
    );
  }

  await c.ev('__MU_APP__.fxClear()');
  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error('ERR', e.message);
  console.log(c.logs.slice(-12).join('\n'));
  process.exitCode = 1;
} finally {
  await c.close();
}
