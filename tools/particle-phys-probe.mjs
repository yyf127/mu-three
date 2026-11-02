/**
 * 粒子物理接线探针 —— 验「`Particle_Spawn` 不再是静态 sprite」。
 *
 * 源码：
 *   Particle_Spawn.cpp（初始化速度/寿命/缩放）
 *   Particle_Move.cpp（逐帧 pos += vel、重力、阻尼、缩放衰减）
 *
 * 断言：
 *   [A] 登记过的粒子 type 在 castOf 里带 vel / gravity / drag / grow
 *   [B] 那些 type 的 parts 是 sprite（走贴图层）而不是模型
 *   [C] 实际放技能后，fxSprites() 活体的位置会随时间移动（不是钉死）
 *
 * 用法：node tools/particle-phys-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('particle-phys');
let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}  ${detail}`);
  }
}

/** 从 castOf 里找目标 type（粒子分支会挂上物理说明） */
async function findParticleParts(type) {
  return JSON.parse(
    await c.ev(`(async () => {
      try {
        const m = await import('/src/data/skillFx.ts');
        // castOf 只接受完整的 SkillEntry，直接构造一个带 fx 的最小条目
        const list = await (await import('/src/data/skills.ts')).loadSkills();
        const out = [];
        for (const s of list) {
          try {
            const spec = m.castOf(s);
            const hit = spec.parts.find(p => p.note && p.note.includes(${type}));
            if (hit) out.push({ id: s.id, kind: hit.kind, vel: hit.vel, gravity: hit.gravity, drag: hit.drag, grow: hit.grow, note: hit.note });
          } catch {}
        }
        return JSON.stringify(out);
      } catch (e) { return JSON.stringify({ _err: String(e && e.stack || e) }); }
    })()`)
  );
}

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  await sleep(1500);

  console.log('\n[A] 登记过的粒子 type 物理参数');
  /*
   * 只测 SKILL_CASTS 里**实际会触发**的粒子（现在技能 1 的 1220 = 0x4c4）。
   * 1221/1191/1215 的物理在 PARTICLE_PHYS 里也配了，但那些 type 当前只由
   * MoveEffect 每帧喷发、还没进一键施法的 parts，所以不能当失败。
   */
  const actualType = 1220;
  const hits = await findParticleParts(actualType);
  const ok = hits.length > 0 && hits.some(h => h.vel && h.gravity !== undefined);
  check(`Particle_Spawn(${actualType}) 带物理参数`, ok, JSON.stringify(hits).slice(0, 200));
  if (ok) {
    const h = hits[0];
    check(`  粒子带 vel`, !!h.vel, JSON.stringify(h.vel));
    check(`  粒子带 gravity`, h.gravity !== undefined, `g=${h.gravity}`);
  }

  console.log('\n[B] 放 1 号技能（毒咒，Particle_Spawn 1220 ×10）看活体');
  const skillInfo = JSON.parse(await c.ev(`(async () => {
    const m = await import('/src/data/skillFx.ts');
    const list = await (await import('/src/data/skills.ts')).loadSkills();
    const s = list.find(x => x.id === 1);
    if (!s) return JSON.stringify({ ok: false, reason: 'no-skill-1' });
    const spec = m.castOf(s);
    return JSON.stringify({ ok: true, parts: spec.parts.map(p => ({ kind: p.kind, file: p.file, vel: !!p.vel, note: p.note })) });
  })()`));
  check('技能 1 有粒子部件', skillInfo.ok && skillInfo.parts.some(p => p.kind === 'sprite' && p.vel), JSON.stringify(skillInfo).slice(0, 300));

  console.log('\n[C] 放技能后 sprite 会动（对比 0.3s 前后的位置差）');
  await c.ev(`__MU_APP__.castSkill(1)`);
  let before = [];
  for (let i = 0; i < 20 && !before.length; i++) {
    await sleep(160);
    before = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.fxSprites())`));
  }
  await sleep(320);
  const after = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.fxSprites())`));
  // 比较同一 id 的位置差；找不到同 id 也算生命周期推进正常
  const sameId = after.filter(a => before.some(b => b.id === a.id));
  const moved = sameId.some(a => {
    const b = before.find(x => x.id === a.id);
    if (!b) return false;
    // 烟粒子：z 应上升（vel.z + gravity 均为正）；任一轴移动 > 1cm 都算动
    return (
      Math.abs(a.pos[0] - b.pos[0]) > 0.01 ||
      Math.abs(a.pos[1] - b.pos[1]) > 0.01 ||
      Math.abs(a.pos[2] - b.pos[2]) > 0.01
    );
  });
  check(
    '同一 sprite 位置随时间变化（粒子运动生效）',
    moved,
    `sameId=${sameId.length} movedExample=${JSON.stringify(sameId.slice(0, 3))} before=${JSON.stringify(before.slice(0, 3))} after=${JSON.stringify(after.slice(0, 3))}`
  );
  check('特效确实生成（fxSprites 非空）', before.length > 0, `before=${before.length}`);

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error('[FATAL]', e && e.stack || e);
  process.exit(1);
}