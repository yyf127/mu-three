/**
 * 组队探针（0x40 / 0x41 / 0x42 / 0x43 / 0x44）。
 *
 *   node tools/party-probe.mjs
 *   node tools/party-probe.mjs 账号 密码
 *
 * 说明：单人测试没有办法真的凑出两个人（同一个账号不能双开、服务器只留一个
 * 会话），所以分三层验证：
 *
 *   1. **真上行**：0x40 邀请 / 0x41 应答 / 0x43 踢人 真的发出去，
 *      断言连接没被断开（服务端对非法索引会静默丢弃，这是正常的）；
 *   2. **列表与血量**：用 `injectPartyList` / `injectPartyLife` 注入，
 *      走和 0x42 / 0x44 完全相同的渲染路径；
 *   3. **版式**：面板 (450,0) 190×433、两块底板、行内坐标、
 *      队长行暗红底、踢人按钮的显示规则、以及面板关着时的**紧凑血条**。
 *
 * 报文格式的依据见 `src/net/game.ts` 里 party 段的注释；
 * 版式依据见 `src/ui/partyPanel.ts` 顶部注释（`RenderParty` 0x4EF160）。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const account = process.argv[2] || '1234';
const password = process.argv[3] || '1234';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? `  ${detail}` : ''}`);
  }
};

const c = await createClient('party');

/** 读面板 + 紧凑血条的全部几何量 */
const UI = `(() => {
  const p = document.querySelector('.party-panel');
  if (!p) return { error: 'no panel' };
  const box = el => ({
    txt: (el.textContent || '').trim(),
    l: parseFloat(el.style.left || '0'), t: parseFloat(el.style.top || '0'),
    w: el.offsetWidth, h: el.offsetHeight,
    bg: getComputedStyle(el).backgroundColor,
  });
  const comp = document.querySelector('.party-compact');
  return {
    left: p.style.left, top: p.style.top, w: p.offsetWidth, h: p.offsetHeight,
    hidden: p.classList.contains('hidden'),
    plates: [...p.querySelectorAll('.party-plate')].map(el => el.offsetWidth + 'x' + el.offsetHeight + '@' + parseFloat(el.style.top || '0')),
    names: [...p.querySelectorAll('.party-name')].map(box),
    subs: [...p.querySelectorAll('.party-sub')].map(box),
    bars: [...p.querySelectorAll('.party-hp-bg')].map(box),
    fills: [...p.querySelectorAll('.party-hp-fill')].map(box),
    empty: [...p.querySelectorAll('.party-empty-line')].map(el => ({ txt: el.textContent, t: parseFloat(el.style.top || '0') })),
    close: p.querySelector('.party-close') ? box(p.querySelector('.party-close')) : null,
    kick: p.querySelectorAll('.party-kick').length,
    compact: comp ? {
      hidden: comp.classList.contains('hidden'),
      left: parseFloat(comp.style.left || '0'),
      rows: comp.querySelectorAll('.party-compact-bg').length,
      out: comp.querySelectorAll('.party-compact-bg.out').length,
      segs: comp.querySelectorAll('.party-compact-seg').length,
      caps: comp.querySelectorAll('.party-compact-cap').length,
      lines: comp.querySelectorAll('.party-compact-line').length,
      names: [...comp.querySelectorAll('.party-compact-name')].map(el => el.textContent),
    } : null,
  };
})()`;

try {
  const who = await loginAs(c, account, password);
  console.log(`进图：${who.name} selfId=${await c.ev('__MU_APP__.state().selfId')}`);
  await sleep(2000);

  /* ---------------- 1. 打开面板 → 请求列表 ---------------- */
  const opened = await c.ev('__MU_APP__.openParty()');
  check('P 面板打开', opened === true);
  check('打开时发 0x42 请求', c.logs.some(l => l.includes('[party] 0x42 请求队伍列表')));

  const v0 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.partyView())'));
  check('未组队时成员为空', v0.members.length === 0, `${v0.members.length} 人`);
  check('附近玩家列表存在（单人时为空）', Array.isArray(v0.nearby), JSON.stringify(v0.nearby));

  const emptyUi = await c.ev(UI);
  check(
    '空队伍 → 7 行提示（GlobalText[191..197]）',
    emptyUi.empty.length === 7,
    emptyUi.empty.map(l => `${l.t}:${l.txt.slice(0, 6)}`).join(' ')
  );
  check(
    '提示行 y = 50/65/80/100/115/130/145',
    JSON.stringify(emptyUi.empty.map(l => l.t)) === JSON.stringify([49, 64, 79, 99, 114, 129, 144]),
    emptyUi.empty.map(l => l.t).join(',')
  );

  /* ---------------- 2. 面板版式（RenderParty(450, 0)） ---------------- */
  const v1 = JSON.parse(
    await c.ev(
      `JSON.stringify(__MU_APP__.injectPartyList([
        { name: 'Leader', number: 0, life: 100, maxLife: 200, map: 0, x: 133, y: 131 },
        { name: 'Mate', number: 1, life: 200, maxLife: 200, map: 3, x: 210, y: 40 },
      ]))`
    )
  );
  check('成员 2 人', v1.members.length === 2, v1.members.map(m => m.name).join(','));
  check('0 号是队长（行 0）', v1.members[0].name === 'Leader' && v1.members[0].number === 0);
  check('血条按比例折成 10 格', v1.members[0].tenths === 5 && v1.members[1].tenths === 10, '5/10');
  check('成员行带坐标（map-x,y）', /^0-133,131$/.test(v1.members[0].pos), v1.members[0].pos);
  check('地图号翻成中文名', v1.members[0].mapName === '洛兰' && v1.members[1].mapName === '诺利亚', `${v1.members[0].mapName}/${v1.members[1].mapName}`);

  const ui = await c.ev(UI);
  check('面板在 (450,0) 190×433', ui.left === '450px' && ui.top === '0px' && ui.w === 190 && ui.h === 433, `${ui.left},${ui.top} ${ui.w}×${ui.h}`);
  check(
    '底板 = Item_Back01 190×256 @0 + Item_Back02 190×177 @256',
    JSON.stringify(ui.plates) === JSON.stringify(['190x256@0', '190x177@256']),
    ui.plates.join(' + ')
  );
  check('名字在 (20, 52)', ui.names[0].l === 20 && ui.names[0].t === 51, `${ui.names[0].l},${ui.names[0].t}`);
  check(
    '地图在 (40, 60) / 坐标在 (90, 60)',
    ui.subs[0].l === 40 && ui.subs[0].t === 59 && ui.subs[1].l === 90 && ui.subs[1].t === 59,
    `${ui.subs[0].l},${ui.subs[0].t} / ${ui.subs[1].l},${ui.subs[1].t}`
  );
  check(
    '血条底 (39,69) 92×5 / 填充 (40,69) 45×3（100/200）',
    ui.bars[0].l === 39 && ui.bars[0].t === 69 && ui.bars[0].w === 92 && ui.bars[0].h === 5 &&
      ui.fills[0].l === 40 && ui.fills[0].t === 69 && ui.fills[0].w === 45 && ui.fills[0].h === 3,
    `${ui.bars[0].l},${ui.bars[0].t} ${ui.bars[0].w}×${ui.bars[0].h} → ${ui.fills[0].w}×${ui.fills[0].h}`
  );
  check(
    '( cur / max ) 在 (65, 77)',
    ui.subs[2] && ui.subs[2].l === 65 && ui.subs[2].t === 76 && ui.subs[2].txt === '( 100 / 200 )',
    ui.subs[2] ? `${ui.subs[2].l},${ui.subs[2].t} ${ui.subs[2].txt}` : '（缺失）'
  );
  check('第 2 行 y = 87（pitch 35）', ui.names[1].t === 86, `${ui.names[1].t}`);
  check(
    '队长行文字有暗红底 #962828',
    ui.names[0].bg === 'rgb(150, 40, 40)' && ui.names[1].bg !== 'rgb(150, 40, 40)',
    `${ui.names[0].bg} / ${ui.names[1].bg}`
  );
  check('关闭按钮在 (25, 395) 24×24', ui.close.l === 25 && ui.close.t === 395 && ui.close.w === 24, `${ui.close.l},${ui.close.t}`);

  /* ---------------- 3. 踢人按钮的显示规则 ---------------- */
  check(
    '队员看别人的队伍 → 没有踢人按钮',
    ui.kick === 0,
    `kick=${ui.kick}（自己不在这个队里）`
  );

  const vSelf = JSON.parse(
    await c.ev(
      `JSON.stringify(__MU_APP__.injectPartyList([
        { name: '${who.name}', number: 0, life: 200, maxLife: 200, map: 0, x: 133, y: 131 },
        { name: 'Mate', number: 1, life: 100, maxLife: 200, map: 0, x: 130, y: 130 },
      ]))`
    )
  );
  const uiSelf = await c.ev(UI);
  check('自己是队长 → 每行都有踢人按钮', uiSelf.kick === 2, `kick=${uiSelf.kick}`);
  check('自己当队长 → 行 0 仍是高亮行', uiSelf.names[0].bg === 'rgb(150, 40, 40)', uiSelf.names[0].bg);

  const uiMate = await c.ev(UI);
  await c.ev(
    `__MU_APP__.injectPartyList([
      { name: 'Leader', number: 0, life: 200, maxLife: 200 },
      { name: '${who.name}', number: 1, life: 100, maxLife: 200 },
    ])`
  );
  const uiMine = await c.ev(UI);
  check(
    '自己是队员 → 只有自己那一行有按钮（= 退队）',
    uiMine.kick === 1,
    `kick=${uiMine.kick}`
  );
  void uiMate;
  void vSelf;

  /* ---------------- 4. 注入 0x44 血量 ---------------- */
  const v2 = JSON.parse(
    await c.ev(
      `JSON.stringify(__MU_APP__.injectPartyLife([{ number: 0, tenths: 9 }, { number: 1, tenths: 3 }]))`
    )
  );
  check('0x44 血量更新（9 / 3 格）', v2.members[0].tenths === 9 && v2.members[1].tenths === 3, `${v2.members[0].tenths}/${v2.members[1].tenths}`);

  /* ---------------- 5. 紧凑血条（!PartyOpened） ---------------- */
  await c.ev(
    `__MU_APP__.injectPartyList([
      { name: 'Leader', number: 0, life: 200, maxLife: 200 },
      { name: 'Mate', number: 1, life: 100, maxLife: 200 },
    ], false)`
  );
  await sleep(700);
  const cpt = (await c.ev(UI)).compact;
  check('面板关着 + 有队伍 → 紧凑血条出现', cpt && cpt.hidden === false, JSON.stringify(cpt && cpt.hidden));
  check('紧凑血条贴右缘：x = 640 - 50 = 590', cpt.left === 590, `${cpt.left}`);
  check('两行成员 + 上下两条盖片 + 左右两条竖线', cpt.rows === 2 && cpt.caps === 2 && cpt.lines === 2, `rows=${cpt.rows} caps=${cpt.caps} lines=${cpt.lines}`);
  check('血量 10 + 5 = 15 格', cpt.segs === 15, `${cpt.segs}`);
  check('名字按行排列', cpt.names.join(',') === 'Leader,Mate', cpt.names.join(','));

  await c.ev('__MU_APP__.toggleInventory(true)');
  await sleep(700);
  const cpt2 = (await c.ev(UI)).compact;
  check('开背包 → 紧凑血条左移到 450-50=400', cpt2.left === 400, `${cpt2.left}`);
  await c.ev('__MU_APP__.toggleInventory(false)');
  await sleep(400);

  const cpt3 = (await c.ev(UI)).compact;
  check('关背包 → 回到 590', cpt3.left === 590, `${cpt3.left}`);

  /* ---------------- 6. 收到邀请 → 拒绝 ---------------- */
  await c.ev('__MU_APP__.openParty()');
  await sleep(400);
  const v3 = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.injectPartyRequest(9001, 'Tester'))`));
  check('邀请条出现', !!v3.invite && v3.invite.index === 9001, JSON.stringify(v3.invite));

  await c.ev('__MU_APP__.partyRespond(9001, false)');
  await sleep(600);
  check('拒绝会发 0x41', c.logs.some(l => l.includes('[party] 0x41 拒绝')));
  const inviteAfter = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.party())')).invite;
  check('拒绝后邀请条清空', inviteAfter === null, JSON.stringify(inviteAfter));

  /* ---------------- 7. 真发 0x40 / 0x43，连接保持 ---------------- */
  await c.ev('__MU_APP__.partyInvite(9001)');
  await sleep(800);
  check('邀请包 0x40 已发出', c.logs.some(l => l.includes('[party] 0x40 邀请 index=9001')));

  await c.ev('__MU_APP__.partyKick(1)');
  await sleep(800);
  check('踢人包 0x43 已发出', c.logs.some(l => l.includes('[party] 0x43 踢/退 number=1')));

  const alive = await c.ev(`__MU_APP__.state().screen === 'game'`);
  check('发完 0x40/0x43 连接没被断开', alive === true);

  /* ---------------- 8. /party 聊天命令 ---------------- */
  const before = c.logs.length;
  await c.ev(`__MU_APP__.chat('/party')`);
  await sleep(700);
  check(
    '/party 附近没人 → 给出提示（不是静默）',
    c.logs.slice(before).some(l => l.includes('[party] 0x40 邀请')) ||
      (await c.ev(`__MU_APP__.chatLines().lines.slice(-3).map(l => l.text)`)).some(t => /3 格内没有玩家/.test(t)),
    (await c.ev(`JSON.stringify(__MU_APP__.chatLines().lines.slice(-2).map(l => l.text))`))
  );

  /* ---------------- 9. P 键关闭 ---------------- */
  await c.ev('__MU_APP__.injectPartyList([])');
  await sleep(300);
  await c.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', bubbles: true }))`);
  await sleep(300);
  const closed = await c.ev('__MU_APP__.party().open');
  check('P 键关闭队伍窗口', closed === false);

  await c.shot('party-final');

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error('ERR', e.message);
  console.log(c.logs.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  await c.close();
}
