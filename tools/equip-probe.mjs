/**
 * 装备链路探针：加点 → 装备 → 校验。
 *
 *   node tools/equip-probe.mjs
 *
 * 背景：0.97k 服务端对 0x24 失败只回 0xFF（`ItemManager.cpp:2531`），
 * 不告诉原因。1 级角色力量 28，而最弱的 Kris 要 40 —— 所以「拖到装备栏弹回来」
 * 十有八九不是占格算错，是需求不够。这个探针就是来区分这两种情况的：
 *
 *   1. 先用 0xF3/06 把力量加到够
 *   2. 再 moveItem 到武器槽，看服务端回什么
 *   3. 中途用一件需求更高的武器验证「本地拦截」有没有生效
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const c = await createClient('equip');
try {
  await loginAs(c, '1234', '1234');
  await sleep(900);
  await c.ev(`__MU_APP__.toggleCharacter(true)`);
  await sleep(500);

  const state = async () =>
    JSON.parse(
      await c.ev(`JSON.stringify({
        rows: [...document.querySelectorAll('.chr-text')].map(e => e.dataset.row + '=' + e.textContent),
        inv: __MU_APP__.inventory().map(i => i.slot + ':' + i.type),
        toast: document.querySelector('.inv-toast')?.textContent,
        lastMove: __MU_APP__.lastMove(),
      })`)
    );

  const str = s => Number((s.rows.find(r => r.startsWith('strength')) || '').replace(/\D+/g, ''));
  const dex = s => Number((s.rows.find(r => r.startsWith('agility')) || '').replace(/\D+/g, ''));
  const pts = s => Number((s.rows.find(r => r.startsWith('points')) || '').replace(/\D+/g, ''));

  let st = await state();
  console.log(`起始：力量 ${str(st)}，可用点数 ${pts(st)}`);

  // 1) 把力量和敏捷都加到 40（Kris: ReqStr 40 / ReqAgi 40）
  let guard = 0;
  while ((str(st) < 40 || dex(st) < 40) && pts(st) > 0 && guard++ < 60) {
    const want = str(st) < 40 ? 0 : 1;
    await c.ev(`document.querySelector('.chr-plus[data-stat="${want}"]').click()`);
    await sleep(420);
    st = await state();
  }
  console.log(`加点后：力量 ${str(st)} 敏捷 ${dex(st)}，可用点数 ${pts(st)}`);

  // 2) 找一件 Kris 并装到武器槽
  const kris = st.inv.find(s => s.endsWith(':0') && Number(s.split(':')[0]) >= 12);
  if (!kris) {
    console.log('背包里没有 Kris，先 /drop 再跑');
  } else {
    const from = Number(kris.split(':')[0]);
    const ret = await c.ev(`JSON.stringify(__MU_APP__.moveItem(${from}, 0))`);
    console.log(`moveItem(${from} → 0):`, ret);
    await sleep(1200);
    st = await state();
    const worn = st.inv.filter(s => Number(s.split(':')[0]) < 12);
    console.log('装备栏:', worn.join(' ') || '(空)');
    console.log('toast:', st.toast);
  }

  // 3) 本地拦截：把一把需要 80 力量的武器拖到副手（力道不够就不是 0 号槽的菜）
  const other = st.inv.find(s => {
    const slot = Number(s.split(':')[0]);
    return slot >= 12 && s.split(':')[1] !== '0';
  });
  if (other) {
    const from = Number(other.split(':')[0]);
    const r = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.moveItem(${from}, 2))`));
    console.log(`非头盔拖到头盔槽 →`, r.ok ? '放行（说明它是头盔）' : r.lastMove.reason);
  }

  console.log('控制台错误:', c.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exc]')).length);
} finally {
  await c.close();
}
