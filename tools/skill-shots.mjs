/**
 * 技能出图：面板一张 + 每个技能各一张（取景靶子）。
 *
 *   node tools/skill-shots.mjs              # 45 个全出（约 2 分钟）
 *   node tools/skill-shots.mjs 1 4 10 41    # 只出指定技能号
 *
 * 只负责出图，断言在 `skill-probe.mjs` 里。截图会等特效推进到动画中段 ——
 * 起始帧模型还没展开，拍下来是"一团小东西"，会误判成特效太小。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('skills');

async function clipAt(w, h, lift, scale) {
  let prev = null, same = 0;
  for (let i = 0; i < 40; i++) {
    const cur = await c.ev(
      `(() => { const t = __MU_APP__.skillTarget(); if (!t || !window.__MU_DEBUG__) return '';
        const p = __MU_DEBUG__.project(t.x, t.y, t.z + ${lift});
        return JSON.stringify({ x: Math.round(p.x), y: Math.round(p.y) }); })()`
    );
    if (cur && cur === prev) { if (++same >= 4) break; } else { same = 0; prev = cur; }
    await sleep(200);
  }
  const p = JSON.parse(prev);
  return { x: Math.max(0, p.x - w / 2), y: Math.max(0, p.y - h * 0.62), width: w, height: h, scale };
}

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`!!__MU_APP__.skillTarget()`, 30000, '靶子');
  await sleep(2500); // 等预热
  // 装一把武器：41 霹雳回旋斩的视觉是「转玩家手上的武器」（源码 238 → 239），空手拍不到
  await c.ev(`__MU_APP__.previewEquip({ cls: 1, safeZone: false, weapon: 0 })`);
  await sleep(500);

  // 先截一张面板全图（三张卡片 + 技能下拉分组）
  await c.ev(`__MU_APP__.sandboxShow(true)`);
  await sleep(900);
  {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync('shots/skill-panel.png', Buffer.from(r.data, 'base64'));
    console.log('shots/skill-panel.png');
  }
  await c.ev(`__MU_APP__.sandboxShow(false)`);
  const all = await c.ev(`__MU_APP__.skills()`);
  // 只出命令行点名的技能号；不传就全出
  const only = process.argv.slice(2).map(Number).filter(n => Number.isFinite(n));
  const skills = only.length ? all.filter(s => only.includes(s.id)) : all;
  // 先放一发：castSkill 会把角色贴身传送到靶子旁边，相机跟着走
  await c.ev(`__MU_APP__.castSkill(${skills[0].id})`);
  await sleep(1500);
  const clip = await clipAt(460, 420, 1.4, 2);
  for (const s of skills) {
    await c.ev(`__MU_APP__.castSkill(${s.id})`);
    // 42 雷霆裂闪：武器在「举到最高点」那一刻最好看（之后砸下去就没了）
    if ((s.parts ?? []).some(p => p.kind === 'weaponSlam')) {
      for (let i = 0; i < 30; i++) {
        const w = await c.ev(`__MU_APP__.fxSlam()`);
        if (w.length && w[0].phase === 'hold') break;
        await sleep(45);
      }
      await sleep(60);
    } else if ((s.parts ?? []).some(p => p.kind === 'weapon')) {
      // 41 霹雳回旋斩没有模型特效，视觉是「转武器」：等 wheel 实例出现即可
      for (let i = 0; i < 20; i++) {
        const w = await c.ev(`__MU_APP__.fxWheels()`);
        if (w.length) break;
        await sleep(80);
      }
      await sleep(160); // 转开一点再拍，别拍在刚要起转的瞬间
    } else {
      // 等特效出现在场景里，并推进到动画中段（起始帧模型还没展开，拍下来是一团小东西）
      for (let i = 0; i < 60; i++) {
        const fx = await c.ev(`__MU_APP__.fx()`);
        const hit = fx.find(f => f.file === s.file);
        if (hit && (hit.keys <= 1 ? hit.age > 0.08 : hit.frame >= hit.keys * 0.45)) break;
        await sleep(40);
      }
    }
    const r = await c.send('Page.captureScreenshot', { format: 'png', clip });
    // 文件名只用 ASCII：技能号 + 模型名，中文名留给 README 的表
    const name = `skill-${String(s.id).padStart(2, '0')}-${(s.file ?? 'none').replace(/\.bmd$/i, '')}`;
    writeFileSync(`shots/${name}.png`, Buffer.from(r.data, 'base64'));
    console.log(`shots/${name}.png  ${s.name}`);
    await sleep(1400);
  }
} finally {
  await c.close?.();
}
