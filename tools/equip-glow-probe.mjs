/**
 * 装备**强化**光效（+N）探针 —— 和 `item-glow-probe.mjs`（地面上物品的发光底斑）
 * 不是一回事：这里验的是穿在身上的装备按 `ItemLevel` 叠的那层光。
 *
 * 走离线进图 → 用 `previewEquip` 直接套带强化等级的装备 → 逐档截图，
 * 并断言「光效副本数」符合档位（+0..+2 为 0，+3 起才有，+9 起翻倍）。
 *
 *   node tools/equip-glow-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
import { decodePng, diffPng, meanRgb } from './lib/png-diff.mjs';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  ok ? (pass++, console.log(`  ✓ ${label}${detail ? '  ' + detail : ''}`)) : (fail++, console.log(`  ✗ ${label}${detail ? '  ' + detail : ''}`));
};

/** Legendary Sword（武器槽）+ Dark Phoenix Armor（铠甲槽），两件都够大，光效看得清 */
const WEAPON = 11;
const ARMOR = 273;

const c = await createClient('equipglow');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 120000, '进图');
  // screen 早就是 'game' 了（登录/选角两层都 hidden），真正能换装得等角色模型建好
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  await sleep(1500);

  const cases = [
    { lv: 0, passes: 0, tag: '+0' },
    { lv: 2, passes: 0, tag: '+2' },
    { lv: 3, passes: 1, tag: '+3' },
    { lv: 5, passes: 1, tag: '+5' },
    { lv: 7, passes: 1, tag: '+7' },
    { lv: 9, passes: 2, tag: '+9' },
    { lv: 11, passes: 2, tag: '+11' },
  ];

  /** +3 档的副本数 = 每件装备的网格数 × 1 遍，后面的档位都按它的倍数算 */
  let unit = 0;

  /*
   * 冻结场景再截图：不冻的话怪物走位 + 雨 + 相机平滑跟随会让整屏都在变，
   * 光效那点亮光完全淹没在噪声里，像素差统计就失去意义了。
   */
  await c.ev(`__MU_APP__.timeScale(0)`);
  await sleep(500);

  /*
   * 冻结也要等它真的静止：进图后的光照/雨/相机过渡有自己的计时，
   * 不等稳就截图，像素差会被整屏亮度漂移带跑（实测能到 20%）。
   * 这里连续截图直到两张完全一致，最多试 6 次。
   */
  let prev = null;
  let stable = false;
  for (let i = 0; i < 6 && !stable; i++) {
    await c.shot('equip-glow-freeze');
    const cur = decodePng('shots/equip-glow-freeze.png');
    if (prev && diffPng(prev, cur).changed === 0) stable = true;
    prev = cur;
    if (!stable) await sleep(700);
  }
  if (!stable) console.log('  ! 场景没完全静止，下面的像素统计仅供参考');

  for (const cs of cases) {
    const equip = {
      cls: 0,
      weapon: WEAPON,
      armor: ARMOR,
      safeZone: false,
      levels: { weapon: cs.lv, armor: cs.lv },
    };
    const out = await c.ev(`__MU_APP__.previewEquip(${JSON.stringify(equip)})`);
    if (!out || out.error) {
      check(`${cs.tag} 换装`, false, JSON.stringify(out));
      continue;
    }
    if (cs.lv === 3) unit = out.glows;
    const want = cs.passes === 0 ? 0 : unit * cs.passes;
    check(`${cs.tag} 光效副本`, out.glows === want, `glows=${out.glows}（期望 ${want}，单位 ${unit}）`);
    await sleep(500);
    await c.shot(`equip-glow-${cs.tag.replace('+', 'p')}`);
  }

  await c.ev(`__MU_APP__.previewEquip({ cls: 0, weapon: ${WEAPON}, armor: ${ARMOR}, levels: {} })`);
  await sleep(400);
  await c.shot('equip-glow-noise');

  /*
   * 量化「确实变亮了」：拿 +0 的截图当基准，逐档比像素差。
   * 上面几张都是在 timeScale(0) 冻结状态下拍的，背景不该有一丝变化，
   * 所以差异全部来自装备光效 —— bbox 也应该正好框住角色。
   */
  const base = decodePng('shots/equip-glow-p0.png');
  const noise = diffPng(base, decodePng('shots/equip-glow-noise.png'));
  console.log(`\n噪声基线（冻结状态连拍两张）：变化 ${(noise.ratio * 100).toFixed(3)}%`);

  for (const tag of ['p3', 'p5', 'p7', 'p9', 'p11']) {
    const img = decodePng(`shots/equip-glow-${tag}.png`);
    const d = diffPng(base, img);
    const bbox = d.bbox;
    const a = bbox ? meanRgb(base, bbox) : null;
    const b = bbox ? meanRgb(img, bbox) : null;
    console.log(
      `  ${tag.padEnd(4)} 变化 ${(d.ratio * 100).toFixed(2)}%  平均Δ ${d.meanDelta}` +
        `  变化区 ${bbox ? `${bbox.w}×${bbox.h}@${bbox.x},${bbox.y}` : '无'}` +
        `  亮度 ${a && b ? `${a.lum} → ${b.lum}` : '-'}`
    );
    check(`${tag} 比 +0 更亮`, !!(a && b && b.lum > a.lum), a && b ? `${a.lum} → ${b.lum}` : '');
  }

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  await c.ev(`__MU_APP__.timeScale(1)`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
