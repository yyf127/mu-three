/**
 * demo 召唤技能探针：确认放召唤技能后，画面上真的多了一只跟随的宠物。
 *
 * 正式服里召唤物是服务端建实体 + `0x1F` 下发；离线 demo 没有服务端，
 * 所以这里补了个本地生成。这个探针就是验证那套逻辑。
 *
 *   node tools/summon-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
import { decodePng, diffPng } from './lib/png-diff.mjs';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  ok ? (pass++, console.log(`  ✓ ${label}${detail ? '  ' + detail : ''}`)) : (fail++, console.log(`  ✗ ${label}${detail ? '  ' + detail : ''}`));
};

const c = await createClient('summon');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 120000, '进图');
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  await sleep(1200);

  const pets = async () =>
    JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.demoMonsters().filter(m => m.pet))`));

  const before = await pets();
  check('初始没有宠物', before.length === 0, `${before.length} 只`);

  // 30 = Summon Goblin → Class 26
  await c.ev(`__MU_APP__.cast(30)`);
  await sleep(1500);
  const one = await pets();
  console.log('召唤后:', JSON.stringify(one[0] ?? null));
  check('召唤 哥布林 生成了一只宠物', one.length === 1, `${one.length} 只`);
  check('宠物在玩家身边（距离 < 3 格）', !!one[0] && one[0].dist < 3, `dist=${one[0]?.dist}`);

  // 同一个技能再放一次：应该刷新而不是叠加
  await c.ev(`__MU_APP__.cast(30)`);
  await sleep(800);
  check('重复召唤不叠加', (await pets()).length === 1, `${(await pets()).length} 只`);

  // 换个技能：31 = Stone Golem
  await c.ev(`__MU_APP__.cast(31)`);
  await sleep(1500);
  const two = await pets();
  check('第二个召唤技能再生成一只', two.length === 2, two.map(p => p.name).join(' / '));

  // 跟随：等一会儿看坐标有没有变
  const p1 = (await pets())[0];
  await sleep(900);
  const p2 = (await pets())[0];
  const moved = p1 && p2 && (Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y)) > 0.05;
  check('宠物在跟随移动', moved, `${p1?.x},${p1?.y} → ${p2?.x},${p2?.y}`);

  // 像素差：召唤前后画面应该多出一块
  await c.ev(`__MU_APP__.timeScale(0)`);
  await sleep(600);
  await c.shot('summon-on');
  await c.ev(`__MU_APP__.timeScale(1)`);

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
