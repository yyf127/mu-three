/**
 * 玩家骨架 NPC 外观探针（236 黄金弓箭手 / 247 Archer Guard / 249 Berdysh Guard）。
 *
 * 原版这三个是 `CreateChar5(Key, 390, …)` —— 390 = player.bmd 的模型槽，
 * 然后往 `c+504..c+648` 的 7 个装备槽里写模型号。本 port 把它们翻译成
 * `EquipSet` 走 `applyEquipment`，所以这里要验的就是：
 *
 *   1. `modelForClass()` 走的是 player 分支（不是老的 Sevina/Man01 替身）；
 *   2. 装备件数对得上（Plate 五件 + 武器 [+ 盾]）；
 *   3. 截图里真的穿着甲、拿着武器（不是一具空骨架）。
 *
 * 用法：node tools/npc-skin-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
import { decodePng, diffPng } from './lib/png-diff.mjs';

const c = await createClient('npc-skin');
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

const CASES = [
  { cls: 236, tag: 'golden-archer', label: '黄金弓箭手', armor: 5, weapon: 1, shield: 0 },
  { cls: 247, tag: 'archer-guard', label: 'Archer Guard', armor: 5, weapon: 1, shield: 1 },
  { cls: 249, tag: 'berdysh-guard', label: 'Berdysh Guard', armor: 5, weapon: 1, shield: 0 },
];

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  // 相机是跟随插值的，太早截图会截到初始机位（一片草地）
  await sleep(2500);

  /* ================= A. 模型分支 ================= */
  console.log('\n[A] modelForClass 走玩家骨架分支');
  const branches = JSON.parse(
    await c.ev(`(async () => {
      const m = await import('/src/world/monsterModels.ts');
      const out = {};
      for (const cls of [236, 247, 249]) {
        const r = m.modelForClass(cls);
        out[cls] = r ? { base: r.base, player: !!r.player, equip: r.player?.equip ?? null, skinTex: r.player?.skinTex ?? null, tint: r.player?.tint } : null;
      }
      return JSON.stringify(out);
    })()`)
  );
  for (const cs of CASES) {
    const b = branches[cs.cls];
    check(`Class ${cs.cls} 走 player 分支`, !!b?.player, JSON.stringify(b));
    check(`Class ${cs.cls} 骨架是 player.bmd`, b?.base === 'player.bmd', String(b?.base));
  }
  // 资源包里没有黄金守卫的专用金甲，236 用材质染色近似（见 PlayerSkin.tint）
  check('236 有金色染色', branches[236]?.tint === 0xf0b24a, String(branches[236]?.tint));
  check('247 / 249 不染色（原色板甲）', branches[247]?.tint === undefined && branches[249]?.tint === undefined, '');
  check('236 武器是 CrossBow04(139)', branches[236]?.equip?.weapon === 139, String(branches[236]?.equip?.weapon));
  check('249 武器是 Spear09(103)', branches[249]?.equip?.weapon === 103, String(branches[249]?.equip?.weapon));
  check('247 左手有箭袋(135)', branches[247]?.equip?.shield === 135, String(branches[247]?.equip?.shield));

  /* ================= B. 实际加载 ================= */
  console.log('\n[B] 生成到场上并检查网格');
  for (const cs of CASES) {
    // 必须包一层 async IIFE：CDP 的 Runtime.evaluate 不认裸 `await`，
    // 直接写 `JSON.stringify(await …)` 会 stringify 一个 Promise → "[object Object]"
    const out = await c.ev(
      `(async () => JSON.stringify(await __MU_APP__.npcSkin(${cs.cls}, 1.5, 0.6)))()`
    );
    const r = JSON.parse(out);
    if (!r || r.error) {
      check(`${cs.label} 加载`, false, out);
      continue;
    }
    // 5 件防具至少各 1 个网格，武器 1 个
    check(`${cs.label} 防具网格 ${cs.armor}+`, r.meshes >= cs.armor + cs.weapon, `meshes=${r.meshes}`);
    check(`${cs.label} 手持模型 ${cs.weapon + cs.shield}`, r.held === cs.weapon + cs.shield, `held=${r.held}`);
    console.log(`     meshes=${r.meshes} held=${r.held}`);
    for (const p of r.parts.slice(0, 8)) console.log(`       ${p}`);
  }

  /* ================= C. 截图（逐个） ================= */
  console.log('\n[C] 截图');
  // 把主角挪开一点，避免挡住 NPC；相机跟着主角，所以用偏移把 NPC 放到画面右侧
  for (const cs of CASES) {
    await c.ev(`(async () => { await __MU_APP__.npcSkin(${cs.cls}, 0.35, 0, true); return 1; })()`);
    await sleep(700);
    await c.shot(`npc-skin-${cs.tag}`);
    check(`${cs.label} 截图生成`, true, '');
  }

  /* ================= D. 与空场景的像素差 =================
   * 「看得到」不能只靠截图人眼判断，量一下变化区域。 */
  console.log('\n[D] 可见性（戴/不戴的像素差）');
  const marked = decodePng(`shots/npc-skin-${CASES[1].tag}.png`);
  // 把 NPC 挪到地图另一头（相机看不到的地方），再拍一张
  await c.ev(`(async () => { await __MU_APP__.npcSkin(247, 0.35, 0, true); return 1; })()`);
  await sleep(700);
  await c.shot('npc-skin-away');
  const away = decodePng('shots/npc-skin-away.png');
  const d = diffPng(marked, away);
  console.log(`   变化 ${(d.ratio * 100).toFixed(3)}%（${d.changed} px）`);
  check('NPC 在画面里占足量像素', d.changed > 2000, `changed=${d.changed}`);

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
} finally {
  await c.close();
}
process.exit(fail ? 1 : 0);
