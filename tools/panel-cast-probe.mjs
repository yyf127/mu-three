/**
 * 「面板真实点击」探针：模拟用户在下拉里选技能、点 Cast，而且**快速连点**。
 *
 * 为什么单独测这个：`castSkill` 以前有 0.85 s 的静默节流，
 * 连续点几个技能时大部分点击被吞掉、面板毫无反馈 —— 看起来就像「这些技能没特效」。
 * 这个脚本专门按用户的点法来点（间隔 150 ms），验证每次都真的有东西出来。
 *
 *   node tools/panel-cast-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('panelcast');

await c.ev(`__MU_APP__.offline()`);
await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
await c.waitFor(`!!__MU_APP__.playerActor()`, 60000, '角色');
await c.waitFor(`!!__MU_APP__.skillTarget()`, 30000, '靶子');
await sleep(1800);
await c.ev(`__MU_APP__.previewEquip({ cls: 1, safeZone: false, weapon: 0 })`);
await c.ev(`__MU_APP__.sandboxShow(true)`);
await sleep(600);

const skills = await c.ev(`__MU_APP__.skills()`);
/** 只挑「源码明确有特效」的，用来验证点击链路 */
const list = skills.filter(s => s.source === 'client').slice(0, 14);

const SEL = '#sandbox .sb-card:nth-child(3) select';
const BTN = '#sandbox .sb-cast';

const pick = async id =>
  c.ev(`(() => {
    const sel = document.querySelector('${SEL}');
    if (!sel) return false;
    sel.value = '${id}';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return sel.value === '${id}';
  })()`);

const click = async () =>
  c.ev(`(() => { const b = document.querySelector('${BTN}'); if (!b || b.disabled) return false; b.click(); return true; })()`);

async function countFx() {
  return JSON.parse(
    await c.ev(`(() => {
      const m = __MU_APP__.fx(), s = __MU_APP__.fxSprites(), b = __MU_APP__.fxBeams();
      const w = __MU_APP__.fxWheels(), l = __MU_APP__.fxSlam();
      return JSON.stringify({ n: m.length + s.length + b.length + w.length + l.length,
        m: m.length, s: s.length, b: b.length, w: w.length, l: l.length });
    })()`)
  );
}

let pass = 0;
let fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}  ${extra}`); }
};

console.log(`按「用户点法」测 ${list.length} 个技能（每个只点一次，间隔 150 ms 连点下一个）\n`);

for (const s of list) {
  await c.ev(`__MU_APP__.fxClear()`);
  await sleep(120);

  await pick(s.id);
  const clicked = await click();
  let peak = { n: 0 };
  for (let i = 0; i < 10; i++) {
    const cur = await countFx();
    if (cur.n > peak.n) peak = cur;
    if (peak.n > 0) break;
    await sleep(70);
  }
  check(`${s.id} ${s.name} 点 Cast 后出特效`, clicked && peak.n > 0, JSON.stringify(peak));
  await sleep(150); // 用户连点下一个的节奏
}

/* ---- 连点同一个技能：第二次也必须出 ---- */
await sleep(500); // 等上一次点击的冷却彻底过去，再测「连点」
await c.ev(`__MU_APP__.fxClear()`);
await pick(list[0].id);
let first = 0;
const clicked1 = await click();
for (let i = 0; i < 16; i++) {
  const cur = await countFx();
  if (i < 3 || cur.n > 0) console.log(`  [连点1] #${i} clicked=${clicked1} ${JSON.stringify(cur)}`);
  if (cur.n > 0) { first = 1; break; }
  await sleep(70);
}
await c.ev(`__MU_APP__.fxClear()`);
await sleep(120);
const clicked2 = await click(); // 距上一次不到 0.25 s
console.log(`  [连点2] clicked=${clicked2}`);
let second = 0;
for (let i = 0; i < 10; i++) {
  if ((await countFx()).n > 0) { second = 1; break; }
  await sleep(60);
}
check('0.3 s 内连点同一个技能，第二次也出特效（不再被静默吞掉）', !!first && !!second,
  `first=${first} second=${second}`);

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：✓ ${pass} / ✗ ${fail}`);
await c.close?.();
process.exit(fail ? 1 : 0);
