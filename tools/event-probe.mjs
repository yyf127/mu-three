/**
 * 事件入场探针（恶魔广场 0x90 / 血色城堡 0x9A / 剩余时间 0x91 / 赛事状态 0x9B）。
 *
 *   node tools/event-probe.mjs
 *   node tools/event-probe.mjs 账号 密码
 *
 * 分三层：
 *
 *   A. **注入层**：`injectDsLevels` / `injectBcLevels` 造 0x8E / 0x8F（**带
 *      服务端那 1 字节对齐填充**，int 从 +4 起），走 `parseEventRequiredLevels`
 *      同一条路径；再验行文字、血堡灰行、魔剑士第二组表。
 *   B. **真服务端**：`/gmove` 到诺利亚的 Charon 237（171,105）和
 *      Messenger of Archangel 233（208,30），看 0x30 result=4 / 6 能不能
 *      真的把窗口弹出来；再用 `/make` 造票，验证 0x90 / 0x9A 真的发出去、
 *      服务端真的回了结果码；右键票验证 0x91 真回执。
 *   C. **HUD**：注入 0x9B 赛事状态，验证左上角那一行的文字和本地倒数。
 *
 * 为什么探针不追求「真的进图」：服务端只在 `DevilSquare.dat` 里配置的
 * 整点/半点前 5 分钟开放入场（`* * * * 0/4/8/12/16/20 30 0`），跑探针时
 * 大概率不在窗口内，`GetEnterEnabled` 为 0 → result=2。**能拿到 result=2
 * 本身就证明整条链路通了**（服务端读到了票、认了档位、走到了时间检查）。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const account = process.argv[2] || '1234';
const password = process.argv[3] || '1234';

/** 两个入口 NPC 的刷新点（`MonsterSetBase.txt`） */
const CHARON = { cls: 237, map: 3, x: 171, y: 105, name: 'Charon' };
const MESSENGER = { cls: 233, map: 3, x: 208, y: 30, name: 'Messenger of Archangel' };

/** 票的物品号（`GET_ITEM(14,19)` / `GET_ITEM(13,18)`） */
const TICKET = { DS: 467, BC: 434 };

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

const c = await createClient('event');
const ev = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.event())'));
const view = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.eventView())'));
const hud = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.eventHud())'));
const state = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
const inventory = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.inventory())'));
const lines = async () =>
  JSON.parse(await c.ev('JSON.stringify(__MU_APP__.chatLines().lines)')).map(l => l.text);

const until = async (expr, timeoutMs, tag) => {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await c.ev(expr);
    if (last) return last;
    await sleep(300);
  }
  throw new Error(`等待超时: ${tag}（最后值 ${JSON.stringify(last)}）`);
};

/** 走到某个 NPC 身边（服务端只认它自己记的坐标，必须真走过去 /gmove） */
async function goToNpc(who, npc) {
  await c.ev(`__MU_APP__.chat('/gmove ${who.name} ${npc.map} ${npc.x - 1} ${npc.y + 1}')`);
  const ok = await until(
    `(() => { const s = __MU_APP__.state(); return s.mapId === ${npc.map} && s.player && Math.hypot(s.player.x - ${npc.x}, s.player.y - ${npc.y}) < 6; })()`,
    40000,
    `走到 ${npc.name}`
  ).catch(() => false);
  return ok === true;
}

const realRange = [
  { min: 15, max: 79 },
  { min: 80, max: 129 },
  { min: 130, max: 179 },
  { min: 180, max: 229 },
];
/** 血堡 12 行：前 6 普通、后 6 魔剑士（魔剑士的值故意写成不同，用来验偏移） */
const bcNormal = realRange.concat([
  { min: 230, max: 269 },
  { min: 270, max: 9999 },
]);
const bcMg = [
  { min: 20, max: 60 },
  { min: 61, max: 100 },
  { min: 101, max: 140 },
  { min: 141, max: 180 },
  { min: 181, max: 220 },
  { min: 221, max: 9999 },
];

try {
  const who = await loginAs(c, account, password);
  console.log(`进图：${who.name} map=${who.mapId}`);
  await sleep(2000);

  /* ================= A. 注入层 ================= */
  console.log('\n[注入] 0x8E 恶魔广场等级表');
  const ds = JSON.parse(
    await c.ev(`JSON.stringify(__MU_APP__.injectDsLevels(${JSON.stringify(realRange)}))`)
  );
  check('4 档全部解析出来', ds.length === 4, ds.map(r => `${r.min}-${r.max}`).join(' '));
  check('第 1 档 15-79', ds[0].min === 15 && ds[0].max === 79, `${ds[0].min}-${ds[0].max}`);
  check(
    '对齐填充被正确跳过（不是 3846 这类脏值）',
    ds.every(r => r.min < 1000 && r.max < 10000),
    JSON.stringify(ds)
  );

  const dsView = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.eventOpen('ds'))`));
  check('恶魔广场窗口打开', dsView.open === true && dsView.kind === 'ds');
  check('标题 = Devil Square', dsView.title === 'Devil Square', dsView.title);
  check('4 行档位', dsView.rows.length === 4, `${dsView.rows.length}`);
  check(
    '行文字 = `Square 1 (15 - 79 level)`',
    dsView.rows[0] && dsView.rows[0].min === 15,
    JSON.stringify(dsView.rows[0])
  );
  check(
    '恶魔广场不灰行（原版四行永远可点）',
    dsView.rows.every(r => r.allowed === true)
  );
  check('说明文字 6 行', dsView.bodyLines.length === 6, dsView.bodyLines[0] ?? '');

  const domRows = JSON.parse(
    await c.ev(`JSON.stringify([...document.querySelectorAll('.event-row')].map(el => ({
      left: el.style.left, top: el.style.top, w: el.offsetWidth, h: el.offsetHeight,
      text: (el.textContent||'').trim(), off: el.classList.contains('event-row-off'),
    })))`)
  );
  check('渲染出 4 个档位行', domRows.length === 4, `${domRows.length}`);
  check(
    '行几何照原版：x=25 宽 140 高 35 起点 y=210 stride 45',
    domRows[0]?.left === '25px' && domRows[0]?.h === 35 && domRows[0]?.top === '210px' &&
      domRows[1]?.top === '255px',
    `${domRows[0]?.left} ${domRows[0]?.top} ${domRows[0]?.h} → ${domRows[1]?.top}`
  );
  check(
    '中文/英文文案：Square 1 (15 - 79 level)',
    /^Square 1 \(15 - 79 level\)$/.test(domRows[0]?.text ?? ''),
    domRows[0]?.text ?? ''
  );

  console.log('\n[注入] 0x8F 血色城堡等级表');
  const bc = JSON.parse(
    await c.ev(
      `JSON.stringify(__MU_APP__.injectBcLevels(${JSON.stringify(bcNormal.concat(bcMg))}))`
    )
  );
  check('12 行（6 普通 + 6 魔剑士）', bc.length === 12, bc.map(r => `${r.min}-${r.max}`).join(' '));
  check(
    '后 6 行是魔剑士那一组',
    bc[6].min === 20 && bc[6].max === 60,
    `${bc[6].min}-${bc[6].max}`
  );

  const me = await ev();
  const bcView = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.eventOpen('bc'))`));
  check('血色城堡窗口打开', bcView.open === true && bcView.kind === 'bc');
  check('标题 = Messenger of Archangel', bcView.title === 'Messenger of Archangel', bcView.title);
  check('6 行档位', bcView.rows.length === 6, `${bcView.rows.length}`);
  check('level 是 1-based（血堡）', bcView.rows[0].level === 1, `${bcView.rows[0].level}`);
  check(
    '行文字 = `Castle 1 (level 15-79)`',
    bcView.rows[0].min === 15 && bcView.rows[0].max === 79,
    JSON.stringify(bcView.rows[0])
  );
  check('说明文字已按 26 字/行切行', bcView.bodyLines.length >= 3, bcView.bodyLines[0] ?? '');

  const offRows = bcView.rows.filter(r => !r.allowed).length;
  const inRange = bcView.rows.filter(
    r => me.charLevel >= r.min && me.charLevel <= r.max
  ).length;
  check(
    '血堡灰行 = 6 - 等级命中档数（原版只有血堡灰行）',
    offRows === 6 - inRange,
    `等级 ${me.charLevel}，可点 ${inRange} 行、灰 ${offRows} 行`
  );

  const bcDom = JSON.parse(
    await c.ev(`JSON.stringify([...document.querySelectorAll('.event-row')].map(el => ({
      top: el.style.top, h: el.offsetHeight, off: el.classList.contains('event-row-off'),
      text: (el.textContent||'').trim(),
    })))`)
  );
  check(
    '血堡行几何：高 33 起点 y=170 stride 40',
    bcDom[0]?.h === 33 && bcDom[0]?.top === '170px' && bcDom[1]?.top === '210px',
    `${bcDom[0]?.top} ${bcDom[0]?.h} → ${bcDom[1]?.top}`
  );
  check(
    '灰行带 event-row-off 类',
    bcDom.filter(r => r.off).length === offRows,
    `${bcDom.filter(r => r.off).length} / ${offRows}`
  );

  // 点一个灰行：应该被本地挡掉，不发包
  const offLevel = bcView.rows.find(r => !r.allowed)?.level;
  if (offLevel != null) {
    const before = c.logs.length;
    const picked = await c.ev(`__MU_APP__.eventPick(${offLevel})`);
    const toast = await c.ev(`document.querySelector('.event-panel .npc-toast')?.textContent`);
    check('点灰行 → EventPanel.pick 返回 false', picked === false, `返回 ${picked}`);
    check('点灰行 → 弹「等级不在这一档」', /等级/.test(toast ?? ''), toast ?? '（无提示）');
    check(
      '点灰行 → 一个 0x9A 都没发',
      !c.logs.slice(before).some(l => l.includes('0x9A 进血色城堡'))
    );
  } else {
    check('点灰行 → 本地拒绝', true, '（6 档全能进，跳过）');
  }

  console.log('\n[交互] 没有票时点档位');
  await c.ev('__MU_APP__.eventOpen("ds")');
  await c.ev('__MU_APP__.eventPick(0)');
  await sleep(400);
  const noTicketToast = await c.ev(`document.querySelector('.event-panel .npc-toast')?.textContent`);
  const hasTicket = (await ev()).tickets.length > 0;
  check(
    '无票点档位 → 提示「需要恶魔广场邀请函」',
    hasTicket || /邀请函/.test(noTicketToast ?? ''),
    hasTicket ? '（背包里已有票，跳过）' : (noTicketToast ?? '（无提示）')
  );

  await c.ev('__MU_APP__.eventClose()');
  check('关闭后窗口消失', (await ev()).open === false);

  /* ================= B. 真服务端链路 ================= */
  console.log('\n[真链路] 造票 → 恶魔广场 Charon 237');
  /*
   * `CommandGMMake(section, type, level, skill, luck, option, exc)` ——
   * **第三个参数就是等级**。票的等级不能省：服务端拿它跟档位比对
   * （`m_Level != level + 1 → result=1`），而且 0x91 会拿它去 `-1` 索引，
   * 传 0 会越界、服务端把 `EventType` 改回 0。
   *
   *   467 (14,19) level 1 → 恶魔广场第 1 档（服务端 level 0）
   *   434 (13,18) level 1 → 血色城堡第 1 档
   */
  if (!(await inventory()).some(i => i.type === TICKET.DS && i.level > 0)) {
    await c.ev(`__MU_APP__.chat('/make 14 19 1')`);
    await sleep(1500);
  }
  if (!(await inventory()).some(i => i.type === TICKET.BC && i.level > 0)) {
    await c.ev(`__MU_APP__.chat('/make 13 18 1')`);
    await sleep(1500);
  }
  const bag = await inventory();
  const dsTicket = bag.find(i => i.type === TICKET.DS && i.level > 0) ?? bag.find(i => i.type === TICKET.DS);
  const bcTicket = bag.find(i => i.type === TICKET.BC && i.level > 0) ?? bag.find(i => i.type === TICKET.BC);
  check('GM 造出恶魔广场邀请函 467（level 1）', !!dsTicket, dsTicket ? `slot ${dsTicket.slot} lv${dsTicket.level}` : '');
  check('GM 造出隐身斗篷 434（level 1）', !!bcTicket, bcTicket ? `slot ${bcTicket.slot} lv${bcTicket.level}` : '');

  const atCharon = await goToNpc(who, CHARON);
  check(`走到 ${CHARON.name}（${CHARON.x},${CHARON.y}）`, atCharon);

  const before8e = c.logs.length;
  await c.ev(`__MU_APP__.talkClass(${CHARON.cls})`);

  /*
   * `NpcCharon`（DevilSquare.cpp:1205）有三条提前返回，全都走 **F3/40**
   * `GCServerCommandSend(1, cmd1)`，而不是 0x30：
   *   cmd1=2 没票、cmd1=3 不在入场时间、cmd1=5 等级不在任何一档。
   * 只有三条都过才发 0x8E + 0x30 result=4。
   *
   * 这台服务端只在场次开始前 5 分钟放人（`DevilSquare.dat` 里
   * `* * * * 0/4/8/12/16/20 30 0`），跑探针时基本不在窗口内 ——
   * 所以**收到 F3/40 也是通过**：它证明 0x30 到达了服务端、服务端认出了
   * 这个 NPC、并且走进了事件分支。
   */
  const outcome = await until(
    `(() => {
      if (__MU_APP__.event().open === true) return 'open';
      if (__MU_APP__.chatLines().lines.some(l => /来早了|邀请函|不能进|等级/.test(l.text))) return 'refused';
      return false;
    })()`,
    12000,
    '0x30 → 窗口 / 拒绝提示'
  ).catch(() => false);

  const openedDs = outcome === 'open';
  check(
    '0x30 到达服务端并得到明确响应（开窗 或 F3/40 拒绝文案）',
    outcome === 'open' || outcome === 'refused',
    openedDs ? '（当前在入场窗口内，直接开窗）' : '（当前不在入场窗口，服务端回拒绝）'
  );
  check(
    'F3/40 ServerCommand 被识别（不再静默）',
    c.logs.slice(before8e).some(l => l.includes('[cmd] 0xF3/0x40')),
    c.logs.filter(l => l.includes('[cmd] 0xF3/0x40')).slice(-1)[0] ?? '（没收到）'
  );

  if (openedDs) {
    check(
      '0x8E 等级表真到达',
      c.logs.slice(before8e).some(l => l.includes('[event] 0x8E')),
      c.logs.filter(l => l.includes('[event] 0x8E')).slice(-1)[0] ?? '（没收到）'
    );
    const realDs = await view();
    check(
      '真等级表不是全 0',
      realDs.rows.some(r => r.max > 0),
      realDs.rows.map(r => `${r.min}-${r.max}`).join(' ')
    );
  }

  if (openedDs) {
    // 点第 1 档：服务端要么接受（0），要么回 2（不在入场时间）/ 1（票等级不对）
    const before = c.logs.length;
    const pick = await c.center('.event-row');
    if (pick) {
      await c.ptr('mouseMoved', pick.x, pick.y, { buttons: 0 });
      await c.ptr('mousePressed', pick.x, pick.y);
      await c.ptr('mouseReleased', pick.x, pick.y);
    }
    const replied = await until(
      `__MU_APP__.chatLines().lines.some(l => /恶魔广场/.test(l.text) && /进入|时间|等级|人数/.test(l.text))`,
      12000,
      '0x90 回执'
    ).catch(() => false);
    check('点第 1 档 → 真的发了 0x90', c.logs.slice(before).some(l => l.includes('0x90 进恶魔广场')));
    check('0x90 收到服务端回执', replied === true, c.logs.filter(l => l.includes('[event] 0x90')).slice(-1)[0] ?? '（没回）');
    check(
      '回执后窗口自动关闭',
      (await ev()).open === false
    );
  }

  console.log('\n[真链路] 右键票 → 0x91 查开场时间');
  if (dsTicket) {
    // 背包面板得是开着的，否则格子是 display:none，点不到
    await c.ev('__MU_APP__.toggleInventory(true)');
    await sleep(600);
    const before = c.logs.length;
    // 背包格是 `.inv-panel [data-slot]`，右键走的是 pointerdown(button===2)
    const cell = await c.center(`.inv-panel [data-slot="${dsTicket.slot}"]`);
    if (cell) {
      await c.ptr('mouseMoved', cell.x, cell.y, { buttons: 0 });
      await c.ptr('mousePressed', cell.x, cell.y, { button: 'right', buttons: 2 });
      await c.ptr('mouseReleased', cell.x, cell.y, { button: 'right', buttons: 0 });
    }
    const got = await until(
      `__MU_APP__.chatLines().lines.some(l => /恶魔广场.*(分钟|就可以)/.test(l.text))`,
      12000,
      '0x91 回执'
    ).catch(() => false);
    check('右键票发出 0x91', c.logs.slice(before).some(l => l.includes('0x91 查询')));
    check('0x91 收到服务端回执（分钟数）', got === true, (await lines()).slice(-1)[0] ?? '');
  } else {
    check('右键票 → 0x91', false, '背包里没有票');
  }

  console.log(`\n[真链路] 血色城堡 ${MESSENGER.name} 233`);
  await c.ev('__MU_APP__.closeNpc()').catch(() => {});
  const atMessenger = await goToNpc(who, MESSENGER);
  check(`走到 ${MESSENGER.name}（${MESSENGER.x},${MESSENGER.y}）`, atMessenger);
  if (atMessenger) {
    const before8f = c.logs.length;
    await c.ev(`__MU_APP__.talkClass(${MESSENGER.cls})`);
    const outcomeBc = await until(
      `(() => {
        if (__MU_APP__.event().open === true) return 'open';
        if (__MU_APP__.chatLines().lines.some(l => /斗篷|大门|来早|血色城堡/.test(l.text))) return 'refused';
        return false;
      })()`,
      12000,
      '0x30 result=6 / F3/40'
    ).catch(() => false);
    check(
      '0x30 到达服务端（开窗 或 F3/40 拒绝）',
      outcomeBc === 'open' || outcomeBc === 'refused',
      outcomeBc === 'open' ? '（在入场窗口内）' : '（不在入场窗口）'
    );
    if (outcomeBc === 'open') {
      check(
        '0x8F 等级表真到达',
        c.logs.slice(before8f).some(l => l.includes('[event] 0x8F')),
        c.logs.filter(l => l.includes('[event] 0x8F')).slice(-1)[0] ?? '（没收到）'
      );
      await c.shot('event-bc');
      await c.ev('__MU_APP__.eventClose()');
    }
  }

  /* ================= C. 赛事状态 HUD ================= */
  console.log('\n[HUD] 0x9B 赛事状态');
  const ms = JSON.parse(
    await c.ev(
      `JSON.stringify(__MU_APP__.injectMatchState({ state: 1, time: 300, maxMonster: 40, curMonster: 12, itemOwner: -1, itemLevel: 3 }))`
    )
  );
  check('0x9B 解析：state/time/怪物', ms.state === 1 && ms.time === 300 && ms.maxMonster === 40, JSON.stringify(ms));
  check('itemOwner -1 是合法值（不是 0xFFFF 溢出）', ms.itemOwner === -1, `${ms.itemOwner}`);
  const h1 = await hud();
  check('HUD 出现赛事行', h1 !== null && h1.hidden === false);
  check(
    'HUD 文字含剩余时间与怪物进度',
    /血色城堡/.test(h1?.text ?? '') && /5:00/.test(h1?.text ?? '') && /怪物 12\/40/.test(h1?.text ?? ''),
    h1?.text ?? ''
  );

  await sleep(2200);
  const h2 = await hud();
  check(
    '本地按秒递减（不依赖服务端逐秒推）',
    h2 !== null && h2.remain < h1.remain,
    `${h1.remain}s → ${h2.remain}s`
  );

  const clean = JSON.parse(
    await c.ev(
      `JSON.stringify(__MU_APP__.injectMatchState({ state: 4, time: 5, itemLevel: 0xff }))`
    )
  );
  const h3 = await hud();
  check('state=4 是收尾（CLEAN）', clean.state === 4, `${clean.state}`);
  check('itemLevel 0xFF 不显示圣物等级', !/圣物/.test(h3?.text ?? ''), h3?.text ?? '');

  console.log('\n[注入] 0x92 倒计时 / 0x93 排名');
  const cd = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.injectMatchCountDown(0))'));
  check('0x92 type 0 → 1（恶魔广场）', cd.type === 1, `${cd.type}`);
  const cd2 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.injectMatchCountDown(1))'));
  check('0x92 type 1 → 2（血色城堡）', cd2.type === 2, `${cd2.type}`);

  const rank = JSON.parse(
    await c.ev(`JSON.stringify(__MU_APP__.injectDsRank(3, 'TestHero', 1234, 5000, 20000))`)
  );
  check('0x93 排名解析', rank.rank === 3 && rank.name === 'TestHero' && rank.score === 1234, JSON.stringify(rank));
  check(
    '0x93 文案进了聊天框',
    (await lines()).some(l => l.includes('TestHero') && l.includes('1234'))
  );

  /* ================= 收尾 ================= */
  await c.ev('__MU_APP__.eventClose()');
  await c.ev(`__MU_APP__.chat('/gmove ${who.name} 0 133 131')`).catch(() => {});
  await until('__MU_APP__.state().mapId === 0', 30000, '回洛兰').catch(() => {});

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error('\n探针异常：', e.message);
  console.error(c.logs.slice(-12).join('\n'));
  process.exitCode = 1;
} finally {
  await c.close();
}
