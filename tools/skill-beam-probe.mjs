/**
 * 光束分段链探针 —— 验「55 玄月斩的 1168 = 8 段 JointThunder01 闪电链」。
 *
 * 源码依据：
 *   Effect_Create.cpp case 0x490（1168）→ MoveEffect 里寿命==30 帧时
 *   Joint_Create(0x4EE)（MoveJoint.cpp：8 段链，每段 2× Joint_Create(1254)
 *   + 概率 Particle_Spawn(1195)，灰白 0.8 渲染）。
 *
 * 本探针断言：
 *   [A] castOf(55).parts 里那条 beam 是 JointThunder01 且 segments === 8
 *   [B] 实际放出去后 fxBeams() 里有 1 条 name=JointThunder01、segments=8
 *   [C] 释放瞬间材质的 opacity 淡出工作（age 增长、opacity 下降）
 *
 * 用法：node tools/skill-beam-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('skill-beam');
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

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  await sleep(2000);

  console.log('\n[A] castOf(55).parts 配置');
  const spec = JSON.parse(
    await c.ev(`(async () => {
      try {
        const m = await import('/src/data/skillFx.ts');
        const sk = await import('/src/data/skills.ts');
        const list = await sk.loadSkills();
        const s = m.castOf(list.find(x => x.id === 55));
        return JSON.stringify({
          parts: s.parts.map(p => ({ kind: p.kind, file: p.file, segments: p.segments ?? 1, aim: !!p.aim, life: p.life })),
        });
      } catch (e) { return JSON.stringify({ _err: String(e && e.stack || e) }); }
    })()`)
  );
  if (spec._err) throw new Error(spec._err);
  const beams = spec.parts.filter(p => p.kind === 'beam');
  check('55 有 beam 件', beams.length >= 1, JSON.stringify(spec.parts));
  const jt = beams.find(p => p.file === 'Effect/JointThunder01.OZJ');
  check('55 的 beam 用 JointThunder01（源码每段 1254）', !!jt, JSON.stringify(beams));
  check('55 的 beam segments === 8（源码 0x4EE 八段链）', !!jt && jt.segments === 8, `segments=${jt?.segments}`);

  console.log('\n[B] 放 55 后实际存活的光束');
  await c.ev(`__MU_APP__.castSkill(55)`);
  let beamsLive = [];
  for (let i = 0; i < 20 && !beamsLive.length; i++) {
    await sleep(180);
    beamsLive = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.fxBeams())`));
  }
  check('fxBeams() 有活体', beamsLive.length >= 1, JSON.stringify(beamsLive));
  const b = beamsLive.find(x => x.file === 'Effect/JointThunder01.OZJ');
  check('活体里含 JointThunder01', !!b, JSON.stringify(beamsLive));
  check('活体 segments === 8', !!b && b.segments === 8, `segments=${b?.segments}`);

  console.log('\n[C] 淡出时序（opacity 随 age 下降）');
  await sleep(150);
  const mid = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.fxBeams())`));
  const midB = mid.find(x => x.file === 'Effect/JointThunder01.OZJ');
  check(
    'opacity < 0.95（正在淡出）',
    !midB || midB.opacity < 0.95,
    `opacity=${midB?.opacity}`
  );
  await sleep(700);
  const late = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.fxBeams())`));
  const lateB = late.find(x => x.file === 'Effect/JointThunder01.OZJ');
  check('1s 后光束已销毁', !lateB, JSON.stringify(late));

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error('[FATAL]', e && e.stack || e);
  process.exit(1);
}