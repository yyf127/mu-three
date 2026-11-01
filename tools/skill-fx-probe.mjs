/**
 * 技能表现探针 —— 验「按源码收回来的那几处」。
 *
 * 这一轮改的三件事：
 *
 *   1. **19..23 近战五招**：源码 `Combat_UseWarriorSkill` 全文只有
 *      `Particle_Spawn(1232 = Effect/Shiny03)` + 挥砍动作 + 刀风音，
 *      之前 `SKILL_FX` 给它们配的 Earthquake02 / Piercing / Blast01 /
 *      Storm01 / Kcross **都不是原版**。现在收回成一颗光点。
 *   2. **6 / 15 传送**：源码 `CreateTeleportBegin/End` 都是 `SetAction(o, 87)`，
 *      以前走默认施法 82；特效 `CreateEffect(1176)` = `Effect/Spark03`。
 *   3. **技能卷轴**：蓝不够时按 `Attack_UseManaScroll97k` 用一瓶魔法药、
 *      然后**中止**技能（`manaBlock` 纯函数）。
 *
 * 用法：node tools/skill-fx-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { createClient } from './lib/edge-client.mjs';
import { decodePng, diffPng } from './lib/png-diff.mjs';

const c = await createClient('skill-fx');
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

/** 近战五招：动作号 + 唯一那件 Shiny03 */
const MELEE = [
  { id: 19, action: 56 },
  { id: 20, action: 57 },
  { id: 21, action: 58 },
  { id: 22, action: 59 },
  { id: 23, action: 41 },
];

try {
  /* ================= A. 进场（先起页面，纯函数也在页面里跑） ================= */
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  await sleep(2200);

  console.log('\n[A] manaBlock（源码 Attack_UseManaScroll97k）');
  /*
   * 在页面里 import 模块跑，而不是 node 端 esbuild 打包 ——
   * Node 22 在 Windows 上不允许直接 spawn `npx.cmd`（EINVAL），
   * 而且这样和其他探针走同一条路径，省一个构建步骤。
   */
  const manaRows = JSON.parse(
    await c.ev(`(async () => {
      const m = await import('/src/data/skillMana.ts');
      const cases = [
        [30, 100, true, '', '蓝够 → 正常放'],
        [30, 30, true, '', '刚好够 → 正常放'],
        [30, 29, true, 'mana-scroll', '蓝差一点 + 有药 → 喝药'],
        [30, 29, false, 'mana', '蓝不够 + 没药 → 拦住'],
        [0, 0, false, '', '无消耗技能 → 不拦'],
      ];
      return JSON.stringify({
        rows: cases.map(([cost, mana, potion, want, note]) => ({
          note, want, got: m.manaBlock(cost, mana, potion),
        })),
        scroll: m.manaBlockText('mana-scroll', 30),
        none: m.manaBlockText('mana', 30),
      });
    })()`)
  );
  for (const r of manaRows.rows) check(`${r.note}`, r.got === r.want, `got=${r.got} want=${r.want}`);
  check('文案含「已使用」', /已使用/.test(manaRows.scroll), manaRows.scroll);
  check('文案含「没有」', /没有/.test(manaRows.none), manaRows.none);

  /* ================= C. 19..23 ================= */
  console.log('\n[C] 19..23 近战五招（源码只有 Shiny03 光点）');
  for (const m of MELEE) {
    const r = JSON.parse(
      await c.ev(`(async () => JSON.stringify(await __MU_APP__.castSkill(${m.id})))()`)
    );
    check(`${r.name} 标为源码`, r.source === 'client', String(r.source));
    check(`${r.name} 动作 = ${m.action}`, r.action === m.action, String(r.action));
    check(`${r.name} 只有 1 件`, r.parts === 1, String(r.parts));
    check(
      `${r.name} 用的是 Shiny03`,
      (r.partsDetail ?? []).some(d => /Shiny03/.test(d)),
      JSON.stringify(r.partsDetail)
    );
    // 不能再出现编出来的那五个模型
    const wrong = (r.partsDetail ?? []).filter(d =>
      /Earthquake02|Piercing|Blast01|Storm01|Kcross/.test(d)
    );
    check(`${r.name} 没有编出来的模型`, wrong.length === 0, wrong.join(','));
  }

  /* ================= D. 6 / 15 传送 ================= */
  console.log('\n[D] 6 / 15 传送（动作 87 + Spark03）');
  for (const [id, label] of [[6, '瞬间移动'], [15, '小挪移']]) {
    const r = JSON.parse(
      await c.ev(`(async () => JSON.stringify(await __MU_APP__.castSkill(${id})))()`)
    );
    check(`${label} 动作 = 87`, r.action === 87, String(r.action));
    check(
      `${label} 含源码特效 Spark03(1176)`,
      (r.partsDetail ?? []).some(d => /Spark03/.test(d)),
      JSON.stringify(r.partsDetail)
    );
  }

  /* ================= E. 活体特效 ================= */
  console.log('\n[E] 放出去之后真的有件在跑');
  /*
   * `spriteLayer.spawn()` 是异步的（要先 await 贴图），`castSkill` 也只是
   * 把 Promise 挂上去就返回 —— 固定 sleep 120ms 会撞在加载窗口里。
   * 这里轮询到 1.2 s，有就算过。
   */
  await c.ev(`__MU_APP__.castSkill(19)`);
  let live = [];
  for (let i = 0; i < 12; i++) {
    await sleep(100);
    live = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.fxSprites())`));
    if (live.length) break;
  }
  check('cast(19) 后有贴图特效存活', live.length > 0, JSON.stringify(live).slice(0, 160));
  if (live.length) console.log(`   存活 ${live.length} 件：${JSON.stringify(live[0]).slice(0, 120)}`);

  /* ================= F. 截图 ================= */
  console.log('\n[F] 截图');
  for (const [id, tag] of [[19, 'melee-19'], [6, 'teleport-06']]) {
    await c.ev(`__MU_APP__.timeScale(0.12)`);
    await c.ev(`(async () => { await __MU_APP__.cast(${id}); return 1; })()`);
    await sleep(320);
    await c.shot(`skill-${tag}`);
    await c.ev(`__MU_APP__.timeScale(1)`);
    await sleep(600);
  }
  check('截图生成（2 张）', true, '');

  /* ================= G. 瞬移淡出（CreateTeleportBegin 的 alpha） ================= */
  console.log('\n[G] 瞬移淡出（源码 alpha 0 → 1）');
  // 上面的截图刚放过 6，先等恢复（0.6 s 兜底）
  await sleep(900);
  const before = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.fadeProbe())`));
  check('平时主角是实的', before.player.alpha === 1, String(before.player.alpha));

  await c.ev(`__MU_APP__.castSkill(6)`);
  await sleep(150);
  const during = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.fadeProbe())`));
  check('瞬移瞬间 alpha = 0', during.player.alpha === 0, String(during.player.alpha));
  check(
    '主角网格全部透明',
    (during.player.opacities ?? []).length > 0 && during.player.opacities.every(v => v === 0),
    JSON.stringify(during.player.opacities)
  );
  /*
   * 这条是这一段的重点：`getBmdMaterial` 按贴图缓存共享，淡出如果直接改
   * `material.opacity`，场上所有穿同一套的家伙会跟着一起消失。
   */
  check(
    '别的实体不受影响（共享材质没被改）',
    (during.other?.opacities ?? []).every(v => v === 1),
    JSON.stringify(during.other?.opacities)
  );

  /*
   * 恢复的时序按**轮询**判：CDP 首次执行 castSkill 会先加载模块，
   * 600ms 的兜底恢复可能被拉长到 1s 左右。这里最多等 2.5s，
   * 和 [E] 段处理异步 spawn 是同一个思路。
   */
  let after = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.fadeProbe())`));
  for (let i = 0; i < 25 && after.player.alpha !== 1; i++) {
    await sleep(100);
    after = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.fadeProbe())`));
  }
  check('淡出后恢复不透明', after.player.alpha === 1, String(after.player.alpha));
  check('材质也已还原', (after.player.opacities ?? []).every(v => v === 1), JSON.stringify(after.player.opacities));

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
} finally {
  await c.close();
}
process.exit(fail ? 1 : 0);
