/**
 * ESC 菜单 / 自动连续攻击 / 头顶名字 三件事的探针。
 *
 *   node tools/esc-probe.mjs
 *
 * 真机会话：登录 → 进图 → 走到洛兰刷怪点 → 点怪（自动攻击）→ 按 Esc 开菜单。
 * 每一步都把数值打出来，存 3 张图：`shots/esc-menu.png`、`esc-options.png`、
 * `auto-attack.png`。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('esc');
const ev = e => c.ev(e);
const shot = async f => {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(f, Buffer.from(r.data, 'base64'));
  return f;
};

try {
  await c.waitFor(`!!document.getElementById('login-account')`, 20000, '登录');
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 60000, '选角');
  await sleep(2500);
  await ev(`(() => { const b = document.querySelector('.char-card'); b && b.click(); })()`);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);
  await c.waitFor(`__MU_APP__.state().mapId !== null`, 120000, '地图');
  await sleep(2500);

  /* ---------------- 1. 头顶名字 ---------------- */
  console.log('== headProbe ==');
  const heads = JSON.parse(await ev(`JSON.stringify(__MU_APP__.headProbe())`));
  for (const h of heads) console.log('   ', JSON.stringify(h));

  console.log('== self tag ==');
  console.log(
    await ev(`(() => {
      const t = [...document.querySelectorAll('.wtag')].find(e => e.dataset.id === '-1');
      if (!t) return '没有自己的名牌';
      const r = t.getBoundingClientRect();
      return JSON.stringify({ text: t.textContent, top: Math.round(r.top), bottom: Math.round(r.bottom), cx: Math.round(r.left + r.width / 2) });
    })()`)
  );

  /* ---------------- 2. 走到刷怪点，点怪测自动攻击 ---------------- */
  for (let i = 0; i < 8; i++) {
    await ev(`__MU_APP__.walkToNpc(152, 53)`);
    await sleep(6000);
    const list = JSON.parse(await ev(`JSON.stringify(__MU_APP__.state().remotes)`));
    if (list.some(r => r.kind === 'monster')) break;
  }
  const remotes = JSON.parse(await ev(`JSON.stringify(__MU_APP__.state().remotes)`));
  const mob = remotes.find(r => r.kind === 'monster');
  console.log('== 目标 ==', mob ? `#${mob.id} ${mob.name} @${mob.x},${mob.y}` : '视野里没有怪');

  if (mob) {
    // 走到它旁边（原版点远处也是先走过去，这里直接省掉点击那一下）
    await ev(`__MU_APP__.walkToNpc(${mob.x}, ${mob.y})`);
    await sleep(6000);
    const before = JSON.parse(await ev(`JSON.stringify(__MU_APP__.state().remotes)`)).find(r => r.id === mob.id);
    console.log('== 开打前 ==', JSON.stringify(before));
    const combo0 = JSON.parse(await ev(`JSON.stringify(__MU_APP__.autoAttack())`)).combo;
    await ev(`__MU_APP__.setAutoAttack(${mob.id})`);

    let last = null;
    for (let i = 0; i < 16; i++) {
      await sleep(800);
      const st = JSON.parse(await ev(`JSON.stringify(__MU_APP__.autoAttack())`));
      const t = JSON.parse(await ev(`JSON.stringify(__MU_APP__.state().target)`));
      const left = JSON.parse(await ev(`JSON.stringify(__MU_APP__.state().remotes)`)).find(r => r.id === mob.id);
      const line = `cd=${st.cd} atk=${st.attacking ? 1 : 0} 挥砍=${st.combo - combo0} auto=${st.id} hp=${left ? left.hp : 'gone'}`;
      if (line !== last) console.log(`   t+${(i + 1) * 0.8}s ${line}`);
      last = line;
      if (!left && i > 2) break;
    }
    await shot('shots/auto-attack.png');
  }

  /* ---------------- 3. ESC 菜单 ---------------- */
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }))`);
  await sleep(400);
  console.log('== ESC 菜单 ==');
  console.log(JSON.stringify(JSON.parse(await ev(`JSON.stringify(__MU_APP__.esc())`)), null, 1));
  await shot('shots/esc-menu.png');

  // 点「选项」
  await ev(`(() => { const b = [...document.querySelectorAll('#esc-menu .esc-btn')].find(e => e.textContent.includes('选项')); b && b.click(); })()`);
  await sleep(300);
  console.log('== 选项 ==');
  console.log(JSON.stringify(JSON.parse(await ev(`JSON.stringify(__MU_APP__.esc())`)), null, 1));
  await shot('shots/esc-options.png');

  // 点一下「自动攻击」那一行，看能不能切
  const before = JSON.parse(await ev(`JSON.stringify(__MU_APP__.esc())`)).autoAttack;
  await ev(`(() => { const b = [...document.querySelectorAll('#esc-menu .esc-btn')].find(e => e.textContent.includes('自动攻击')); b && b.click(); })()`);
  await sleep(200);
  const after = JSON.parse(await ev(`JSON.stringify(__MU_APP__.esc())`)).autoAttack;
  console.log(`自动攻击开关：${before} → ${after}`);

  // 再按一次 Esc：选项 → 主菜单；再一次 → 关掉
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }))`);
  await sleep(200);
  console.log('Esc 一次后 view =', JSON.parse(await ev(`JSON.stringify(__MU_APP__.esc())`)).view,
    'open =', JSON.parse(await ev(`JSON.stringify(__MU_APP__.esc())`)).open);
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }))`);
  await sleep(200);
  console.log('Esc 两次后 open =', JSON.parse(await ev(`JSON.stringify(__MU_APP__.esc())`)).open);
  console.log('screen =', JSON.parse(await ev(`JSON.stringify(__MU_APP__.state())`)).screen);
} finally {
  await c.close();
}
