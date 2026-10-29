/**
 * 装备强化数值探针：背包里放几件 +N 装备，悬停读 tooltip，核对
 * 「攻击/防御/需求」是否按服务端 `CItem::Convert` 的公式放大。
 *
 *   node tools/equip-power-probe.mjs
 *
 * 期望值手算（数值随 Item.txt 变化，改表后要同步改这里的断言）：
 *   Legendary Sword +0   攻击 56~72    所需力量 178
 *   Legendary Sword +9   攻击 83~99    所需力量 275
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  ok ? (pass++, console.log(`  ✓ ${label}${detail ? '  ' + detail : ''}`)) : (fail++, console.log(`  ✗ ${label}${detail ? '  ' + detail : ''}`));
};

const c = await createClient('equippower');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 120000, '进图');
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  await sleep(800);

  // 12 号格起依次摆放：+0 剑、+9 剑、+11 铠甲、追加剑、卓越剑、追加铠甲、卓越铠甲、卓越剑(全位)
  await c.ev(
    `__MU_APP__.inventoryFill([
       {type: 11, level: 0},
       {type: 11, level: 9},
       {type: 273, level: 11},
       {type: 11, level: 0, option: 4},
       {type: 11, level: 9, option: 4, excellent: 63},
       {type: 273, level: 11, option: 4},
       {type: 273, level: 0, excellent: 63},
       {type: 11, level: 0, excellent: 63},
       {type: 11, level: 0, luck: true},
       {type: 169, level: 0}
     ])`
  );
  await sleep(500);

  const tipOf = async slot => {
    const p = await c.center(`[data-slot="${slot}"]`);
    if (!p) return '';
    await c.ptr('mouseMoved', p.x, p.y, { buttons: 0 });
    await sleep(260);
    return (await c.ev(`(() => {
      const els = [...document.querySelectorAll('.ui-tip')].filter(e => !e.classList.contains('hidden'));
      return els.length ? els[els.length - 1].innerText : '';
    })()`)) || '';
  };

  const plus0 = await tipOf(12);
  console.log('\n+0 剑 tooltip:\n' + plus0.split('\n').map(l => '   ' + l).join('\n'));
  check('+0 剑 攻击 56 ~ 72', /56\s*~\s*72/.test(plus0));
  check('+0 剑 所需力量 178', /178/.test(plus0));

  const plus9 = await tipOf(13);
  console.log('\n+9 剑 tooltip:\n' + plus9.split('\n').map(l => '   ' + l).join('\n'));
  check('+9 剑 攻击 83 ~ 99', /83\s*~\s*99/.test(plus9));
  check('+9 剑 所需力量 275', /275/.test(plus9));

  const plus11 = await tipOf(14);
  console.log('\n+11 铠甲 tooltip:\n' + plus11.split('\n').map(l => '   ' + l).join('\n'));
  check('+11 铠甲 防御 99', /99/.test(plus11));
  check('+11 铠甲 所需力量 873', /873/.test(plus11));

  // ── 追加（AddOption=4 → +16 攻击，主行不变）──
  const add4 = await tipOf(15);
  console.log('\n+0 追加+4 剑 tooltip:\n' + add4.split('\n').map(l => '   ' + l).join('\n'));
  check('追加 主行仍 56 ~ 72（追加单独一行）', /56\s*~\s*72/.test(add4));
  check('追加伤害 +16', /16/.test(add4) && /追加/.test(add4));
  check('追加 需求力量 198（+5×4）', /198/.test(add4));

  // ── 卓越（主行含卓越加成，名字带前缀）──
  const excel = await tipOf(16);
  console.log('\n+9 追加+4 卓越 剑 tooltip:\n' + excel.split('\n').map(l => '   ' + l).join('\n'));
  check('卓越 名字带前缀', /卓越|Excellent/i.test(excel));
  check('卓越 攻击 119 ~ 144', /119\s*~\s*144/.test(excel));
  check('卓越 追加伤害 +16', /16/.test(excel));

  const addArmor = await tipOf(17);
  console.log('\n+11 追加+4 铠甲 tooltip:\n' + addArmor.split('\n').map(l => '   ' + l).join('\n'));
  check('追加铠甲 防御 99', /99/.test(addArmor));
  check('追加防御力 +16', /追加/.test(addArmor) && /16/.test(addArmor));

  // ── 卓越逐位词条（防具 6 位全开）──
  const excArmor = await tipOf(18);
  console.log('\n卓越铠甲 tooltip:\n' + excArmor.split('\n').map(l => '   ' + l).join('\n'));
  check('防具卓越 最大生命值 +4%', /最大生命值.*\+4%/.test(excArmor));
  check('防具卓越 伤害减少 +4%', /伤害减少.*\+4%/.test(excArmor));
  check('防具卓越 防御成功率 +10%', /防御成功率.*\+10%/.test(excArmor));
  check('百分号已折叠（不出现 %%）', !/%%/.test(excArmor));

  // ── 卓越逐位词条（武器 6 位全开）──
  const excWeapon = await tipOf(19);
  console.log('\n卓越武器 tooltip:\n' + excWeapon.split('\n').map(l => '   ' + l).join('\n'));
  check('武器卓越 卓越攻击几率 +10%', /卓越攻击几率.*\+10%/.test(excWeapon));
  check('武器卓越 攻击(魔法)速度 +7', /速度增加.*\+7/.test(excWeapon));
  check('武器卓越 杀怪回血', /生命值增加/.test(excWeapon));

  // ── 幸运（Luck）：服务端映射成暴击率 +5%（选项码 64）──
  const lucky = await tipOf(20);
  console.log('\n幸运剑 tooltip:\n' + lucky.split('\n').map(l => '   ' + l).join('\n'));
  check('幸运 词条出现', /幸运/.test(lucky));
  check('幸运 百分号已折叠', /\+25%/.test(lucky) && !/%%/.test(lucky));

  // ── 法杖：物攻要除以 2 显示（RenderItemInfo.cpp:1710）──
  const staff = await tipOf(21);
  console.log('\n法杖 tooltip:\n' + staff.split('\n').map(l => '   ' + l).join('\n'));
  check('法杖 攻击力 23 ~ 24（表值 46~48 的一半）', /23\s*~\s*24/.test(staff));
  check('法杖 不显示魔法攻击力（原版也不显示）', !/魔法攻击力/.test(staff));

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
