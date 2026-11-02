/**
 * 持续粒子发射器探针 —— 验「MoveEffect 每帧 Particle_Spawn」的喷发近似。
 *
 * 源码：
 *   MoveEffect.cpp 0xbf（火柱/火焰存活期每帧喷火苗）、0x4ab/0x4ad（烟）
 *   ScrollOfMeteoriteEffect.SpawnImpactFire（3 层火柱持续燃烧）
 *   ScrollOfFlameEffect（火焰粒子持续喷发）
 *
 * 断言：
 *   [A] castOf(2/5/8) 的 parts 里带 emit 的 sprite 件有正确 emit 配置
 *   [B] 放 2 号陨石后，fxEmitters() 里有活体发射器、rate 正确
 *   [C] 发射器存活期喷射粒子：等 0.6s 后 fxSprites() 出现子粒子（smoke01/Fire01）
 *
 * 用法：node tools/emit-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('emit-probe');
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
  await sleep(1500);

  console.log('\n[A] castOf(2/5/8).parts 带 emit 的件');
  const specs = JSON.parse(
    await c.ev(`(async () => {
      try {
        const m = await import('/src/data/skillFx.ts');
        const sk = await import('/src/data/skills.ts');
        const list = await sk.loadSkills();
        const out = {};
        for (const id of [2, 5, 8]) {
          const s = list.find(x => x.id === id);
          if (!s) { out[id] = { ok: false, reason: 'no-skill' }; continue; }
          const spec = m.castOf(s);
          out[id] = {
            ok: true,
            maybeEmit: spec.parts.filter(p => p.kind === 'sprite').map(p => ({
              file: p.file, emit: p.emit ?? null,
            })),
          };
        }
        return JSON.stringify(out);
      } catch (e) { return JSON.stringify({ _err: String(e && e.stack || e) }); }
    })()`)
  );
  if (specs._err) throw new Error(specs._err);

  for (const id of [2, 5, 8]) {
    const s = specs[id];
    const e = s.maybeEmit.find(p => p.emit);
    check(`技能 ${id} 有带 emit 的 sprite 件`, !!e, JSON.stringify(s.maybeEmit).slice(0, 300));
    if (e) check(`  技能 ${id} emit.type 有效`, e.emit.type > 0, `type=${e.emit.type}`);
  }

  console.log('\n[B] 放 2 号陨石 → fxEmitters() 有活体');
  await c.ev(`__MU_APP__.castSkill(2)`);
  let ems = [];
  for (let i = 0; i < 15 && !ems.length; i++) {
    await sleep(150);
    ems = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.fxEmitters())`));
  }
  check('fxEmitters() 有活体发射器', ems.length >= 1, JSON.stringify(ems).slice(0, 300));
  check('发射器 rate > 0', ems.some(e => e.rate > 0), JSON.stringify(ems).slice(0, 300));

  console.log('\n[C] 发射器存活期喷射子粒子（等 0.7s 后 fxSprites 有 Fire01/smoke）');
  await sleep(700);
  const sprites = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.fxSprites())`));
  const childTex = ['smoke01.OZJ', 'smoke02.OZT', 'Fire01.OZJ', 'Flame01.OZJ'];
  const hit = sprites.filter(s => childTex.some(t => s.file.includes(t)));
  check('喷射出子粒子（Flame/smoke/Fire01）', hit.length >= 1, JSON.stringify(hit.slice(0, 5)));

  // 发射器应已耗尽（陨石火柱 3.5s，这里 1s 左右应还在）
  await sleep(500);
  const ems2 = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.fxEmitters())`));
  check('发射器未过早消失（仍在喷）', ems2.length >= 1, JSON.stringify(ems2).slice(0, 200));

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error('[FATAL]', e && e.stack || e);
  process.exit(1);
}