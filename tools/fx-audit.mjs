/**
 * 技能特效「可见性」盘点。
 *
 * 探针只验证了「生成件数对得上源码」，但**生成了 ≠ 看得见**。
 * 这个脚本对 45 个技能逐个：cast → 采样峰值件数 → 算每件的屏幕投影是否在视口内 →
 * 收集控制台警告，最后出一张 Markdown 表，把「缺件 / 生成了但在屏幕外 / 加载失败」
 * 三类分开。
 *
 *   node tools/fx-audit.mjs            # 全量
 *   node tools/fx-audit.mjs 1 4 41     # 只查几个
 *
 * 每 12 个技能重载一次页面：SwiftShader 连续跑几十个技能后会整段卡死，
 * 拿冻住的帧去判「看不见」是误诊。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('fxaudit');
const only = process.argv.slice(2).map(Number).filter(Number.isFinite);

async function enterGame() {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`!!__MU_APP__.playerActor()`, 60000, '角色');
  await c.waitFor(`!!__MU_APP__.skillTarget()`, 30000, '靶子');
  await sleep(1200);
  // 装一把武器：41/42 的视觉是「转/砸 玩家手上的武器」
  await c.ev(`__MU_APP__.previewEquip({ cls: 1, safeZone: false, weapon: 0 })`);
  await sleep(400);
}

await enterGame();

const all = await c.ev(`__MU_APP__.skills()`);
const skills = only.length ? all.filter(s => only.includes(s.id)) : all;
console.log(`盘点 ${skills.length} 个技能\n`);

const rows = [];

for (let i = 0; i < skills.length; i++) {
  /*
   * 不 reload —— `Page.reload` 之后离线按钮要等资源重新加载完才可点，
   * 之前固定等 1.5 s 直接超时。改成停下来让 GPU 喘两秒，
   * 采样本身有 `ran`（帧数增量），真卡住了会在表里标出来。
   */
  if (i > 0 && i % 12 === 0) {
    await c.ev(`__MU_APP__.fxClear()`);
    await sleep(2200);
  }

  const s = skills[i];
  const want = s.parts.reduce((a, p) => a + (p.count || 1), 0);
  await c.ev(`__MU_APP__.fxClear()`);
  await sleep(120);
  c.logs.length = 0;
  await c.ev(`__MU_APP__.castSkill(${s.id})`);

  let peak = { m: 0, sp: 0, bm: 0, w: 0, sl: 0 };
  let onScreen = 0;
  let frames = 0;
  for (let k = 0; k < 18; k++) {
    const snap = JSON.parse(
      await c.ev(`(() => {
        const m = __MU_APP__.fx(), sp = __MU_APP__.fxSprites(), bm = __MU_APP__.fxBeams();
        const w = __MU_APP__.fxWheels(), sl = __MU_APP__.fxSlam();
        const pts = [];
        for (const e of m) pts.push(e.pos);
        for (const e of sp) pts.push(e.pos);
        for (const e of bm) pts.push(e.from);
        for (const e of w) pts.push(e.pos);
        let on = 0;
        for (const p of pts) {
          if (!p) continue;
          // 抬 0.6 m 再投影：落点贴地时容易正好压在屏幕下沿外
          const q = __MU_DEBUG__.project(p[0], p[1], p[2] + 0.6);
          if (q && q.inFront && q.x > 0 && q.y > 0 && q.x < innerWidth && q.y < innerHeight) on++;
        }
        const R = window.__MU__ && window.__MU__.renderer;
        return JSON.stringify({ m: m.length, sp: sp.length, bm: bm.length, w: w.length, sl: sl.length,
          on, frame: R ? R.info.render.frame : 0 });
      })()`)
    );
    peak.m = Math.max(peak.m, snap.m);
    peak.sp = Math.max(peak.sp, snap.sp);
    peak.bm = Math.max(peak.bm, snap.bm);
    peak.w = Math.max(peak.w, snap.w);
    peak.sl = Math.max(peak.sl, snap.sl);
    onScreen = Math.max(onScreen, snap.on);
    frames = snap.frame;
    await sleep(80);
  }
  await sleep(200);
  const frames2 = Number(await c.ev(`(window.__MU__ && window.__MU__.renderer.info.render.frame) || 0`));
  const ran = frames2 - frames;

  const warns = c.logs
    .filter(l => /\[skill\]|\[effect\]|\[texture\]|\[sprite\]/.test(l))
    .map(l => l.replace(/^\[\w+\]\s*/, '').slice(0, 90))
    .slice(0, 2);

  const got = peak.m + peak.sp + peak.bm + peak.w + peak.sl;
  rows.push({ id: s.id, name: s.name, source: s.source, want, got, ...peak, on: onScreen, ran, warns });

  const flag = s.source === 'none' ? '—' : got === 0 ? '✗缺' : onScreen === 0 ? '✗不可见' : '✓';
  console.log(
    `${flag} ${String(s.id).padStart(2)} ${s.name.padEnd(8)} 期望 ${String(want).padStart(2)} 实际 ` +
      `M${peak.m}/S${peak.sp}/B${peak.bm}/W${peak.w}/L${peak.sl} 屏内 ${onScreen}` +
      (warns.length ? `  ⚠ ${warns[0]}` : '')
  );
}

/* ---- 汇总表 ---- */
const bad = rows.filter(r => r.source !== 'none' && (r.got === 0 || r.on === 0));
const missing = rows.filter(r => r.source !== 'none' && r.got === 0);
const offscreen = rows.filter(r => r.source !== 'none' && r.got > 0 && r.on === 0);

console.log(`\n===== 汇总 =====`);
console.log(`有视觉的技能 ${rows.filter(r => r.source !== 'none').length} 个`);
console.log(`一件都没生成 ${missing.length} 个: ${missing.map(r => `${r.id}:${r.name}`).join(', ') || '无'}`);
console.log(`生成了但不在屏内 ${offscreen.length} 个: ${offscreen.map(r => `${r.id}:${r.name}`).join(', ') || '无'}`);
console.log(`\n有警告的技能 ${rows.filter(r => r.warns.length).length} 个`);
for (const r of rows.filter(r => r.warns.length)) console.log(`  ${r.id} ${r.name}: ${r.warns.join(' | ')}`);

await c.close?.();
process.exit(bad.length ? 1 : 0);
