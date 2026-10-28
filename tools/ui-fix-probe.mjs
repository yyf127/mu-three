/**
 * 一轮「和 Win 端对齐」的回归探针 —— 底栏 / 快捷键 / NPC 模型 / 修理 / M 键。
 *
 *   node tools/ui-fix-probe.mjs
 *
 * 覆盖这五件事（都是这一轮被指出来的）：
 *
 *   1. **底栏图标只在面板打开时显示**（`HUD_Pass5.cpp:308-338`）。
 *      以前四个图标常亮，看起来像「多了一排按钮」。
 *   2. **战盟是 `Guild.jpg` 52×18 图标**，位置 (582,459)，不是文字按钮；
 *      快捷键是 **`G`**（`Player_InputTick.cpp:478` `PressKey(0x47)`），不是 `O`。
 *   3. **勇者大陆的 NPC 不缺了**：236 Golden Archer / 247 / 249 Berdysh Guard
 *      之前被 `NO_MODEL_CLASSES` 直接跳过，现在有替身模型。
 *   4. **「全部修理」不再把钱扣光**：`slot` 必须是 `0xFF`，`type` 必须是 0
 *      （`type=1` 是 auto-repair，2.5 倍价 + 要 50 级）。而且加了二次确认。
 *   5. **M 键移动能用**：在线模式点条目 = 发 `/move <Move.txt 的 key>`，
 *      由服务端 `CMove::Move` 校验并扣钱换图。
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

const c = await createClient('uifix');
const state = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
const lines = async () => await c.ev('__MU_APP__.chatLines().lines.map(l => l.text)');

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

/** 按一次键（走真实 keydown，和玩家一样） */
const key = async code => {
  await c.ev(
    `document.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', key: '', bubbles: true }))`
  );
  await sleep(350);
};

const barState = async () =>
  await c.ev(`[...document.querySelectorAll('.bar-btn')].map(b => {
    const img = b.querySelector('img');
    return {
      id: b.dataset.btn,
      left: b.style.left, top: b.style.top,
      w: b.offsetWidth, h: b.offsetHeight,
      hasImg: !!img,
      opacity: img ? getComputedStyle(img).opacity : 'n/a',
      active: b.classList.contains('active'),
    };
  })`);

try {
  const who = await loginAs(c, account, password);
  console.log(`进图：${who.name} map=${who.mapId}`);
  await sleep(2500);

  /* ================= 1. 底栏 ================= */
  console.log('\n[底栏] 图标只在面板打开时显示');
  const bar0 = await barState();
  check('底栏 4 个按钮都在', bar0.length === 4, bar0.map(b => b.id).join(' '));
  check(
    '默认状态下四个图标都不显示（opacity 0）',
    bar0.every(b => b.opacity === '0'),
    bar0.map(b => `${b.id}=${b.opacity}`).join(' ')
  );

  const guildBtn = bar0.find(b => b.id === 'guild');
  check(
    '战盟是 Guild.jpg 52×18 图标 @ (582,459)',
    guildBtn && guildBtn.w === 52 && guildBtn.h === 18 && guildBtn.left === '582px' && guildBtn.top === '459px',
    guildBtn ? `${guildBtn.w}×${guildBtn.h} @${guildBtn.left},${guildBtn.top}` : '（没有这个按钮）'
  );
  const partyBtn = bar0.find(b => b.id === 'party');
  check(
    '队伍是 24×24 @ (348,452)',
    partyBtn && partyBtn.w === 24 && partyBtn.left === '348px' && partyBtn.top === '452px',
    partyBtn ? `${partyBtn.w}×${partyBtn.h} @${partyBtn.left},${partyBtn.top}` : ''
  );

  await c.ev('__MU_APP__.toggleInventory(true)');
  await until(
    `getComputedStyle(document.querySelector('.bar-btn[data-btn="inventory"] img')).opacity === '1'`,
    4000,
    '背包图标点亮'
  ).catch(() => false);
  const barInv = await barState();
  const inv = barInv.find(b => b.id === 'inventory');
  check('开背包 → 只有背包图标亮起', inv && inv.active && inv.opacity === '1', `active=${inv?.active} op=${inv?.opacity}`);
  check(
    '其它三个仍然不显示',
    barInv.filter(b => b.id !== 'inventory').every(b => b.opacity === '0'),
    barInv.filter(b => b.id !== 'inventory').map(b => `${b.id}=${b.opacity}`).join(' ')
  );
  await c.ev('__MU_APP__.toggleInventory(false)');
  const darkAgain = await until(
    `[...document.querySelectorAll('.bar-btn img')].every(i => getComputedStyle(i).opacity === '0')`,
    4000,
    '图标全部熄灭'
  ).catch(() => false);
  check('关背包 → 图标跟着灭', darkAgain === true);

  /* ================= 2. 快捷键 ================= */
  console.log('\n[快捷键] 战盟 = G');
  await key('KeyO');
  check('按 O 不再开战盟（O 是自造的旧键）', (await c.ev('__MU_APP__.guild().open')) === false);
  await key('KeyG');
  await sleep(600);
  check('按 G 打开战盟窗口', (await c.ev('__MU_APP__.guild().open')) === true);
  const barG = await barState();
  const g = barG.find(b => b.id === 'guild');
  check('打开后战盟图标亮起', g && g.active && g.opacity === '1', `active=${g?.active} op=${g?.opacity}`);
  await key('KeyG');
  await sleep(400);
  check('再按 G 关闭', (await c.ev('__MU_APP__.guild().open')) === false);

  /* ================= 3. 洛兰 NPC ================= */
  console.log('\n[NPC] 勇者大陆的模型补齐');
  const sMap = await state();
  if (sMap.mapId !== 0) {
    // 登录落在诺利亚（上一个探针的收尾可能没跑完），先回洛兰
    await c.ev(`__MU_APP__.chat('/gmove ${who.name} 0 133 131')`);
  }
  const landed = await until(
    `(() => { const s = __MU_APP__.state(); return s.mapId === 0 && s.remotes.some(r => r.kind === 'npc'); })()`,
    40000,
    '落在洛兰且视野有 NPC'
  ).catch(() => false);
  check('落在洛兰城中心', landed === true, `mapId=${(await state()).mapId}`);
  await sleep(1200);

  /*
   * 视野半径只有十几格，站在城中心看不到全城 NPC，所以**逐个走近去看**。
   * 坐标来自 `MonsterSetBase.txt`（map 0）。
   */
  const visit = async (cls, x, y, label) => {
    await c.ev(`__MU_APP__.chat('/gmove ${who.name} 0 ${x} ${y}')`);
    /*
     * **必须等位置真的变了再看视野**。
     * 只判 `mapId === 0 && 有 NPC` 的话，传送前就成立，`until` 立刻返回，
     * 读到的是上一站的视野（表现为「走到哪儿看到的都是同一批 NPC」）。
     */
    await until(
      `(() => { const s = __MU_APP__.state(); return s.mapId === 0 && s.player && Math.hypot(s.player.x - ${x}, s.player.y - ${y}) < 3; })()`,
      25000,
      `落地到 (${x},${y})`
    ).catch(() => false);
    const seen = await until(
      `__MU_APP__.state().remotes.some(r => r.cls === ${cls})`,
      12000,
      `看到 ${label}`
    ).catch(() => false);
    const cur = (await state()).remotes.filter(r => r.kind === 'npc').map(r => r.cls);
    check(`${label}（Class ${cls}）可见`, seen === true, `( ${x},${y} ) 视野里：${[...new Set(cur)].join(' ')}`);
    await sleep(600);
  };

  await visit(255, 130, 136, 'Lumen the Barmaid');
  await visit(251, 118, 142, 'Hanzo the Blacksmith');
  await visit(236, 131, 128, 'Golden Archer');
  await visit(249, 132, 149, 'Berdysh Guard');
  await visit(240, 146, 145, 'Safety Guardian');

  /* ================= 4. 全部修理 ================= */
  console.log('\n[修理] 0x34 的 slot / type 语义');
  /*
   * 身上要先有装备，否则 `onRepairAll` 会在本地就挡掉（「身上没有可修的装备」），
   * 测不到发包。GM 造一件再双击穿上（0x26 = 使用/装备）。
   */
  const ARMOR = 261; // GET_ITEM(8,5) Leather Armor，铠甲槽 3
  const inv0 = await c.ev('__MU_APP__.inventory()');
  if (!inv0.some(i => i.slot < 12)) {
    await c.ev(`__MU_APP__.chat('/make 8 5 0')`);
    await until(
      `__MU_APP__.inventory().some(i => i.slot >= 12 && i.type === ${ARMOR})`,
      8000,
      'GM 造出 Leather Armor'
    ).catch(() => false);
    const bag = await c.ev('__MU_APP__.inventory()');
    const armor = bag.find(i => i.slot >= 12 && i.type === ARMOR);
    if (!armor) {
      console.log('  · /make 失败，背包现有：', bag.map(i => `${i.slot}:${i.type}`).join(' '));
      console.log('  · 聊天尾部：', (await lines()).slice(-3).join(' | '));
    }
    if (armor) {
      /*
       * 穿装备是**拖到装备槽**（0x24 flag 0→0），不是 0x26「使用」——
       * 0x26 只给药水/卷轴用，服务端对装备的 use 分支不会换槽。
       */
      await c.ev(`__MU_APP__.moveItem(${armor.slot}, 3)`);
      await until(
        `__MU_APP__.inventory().some(i => i.slot === 3 && i.type === ${ARMOR})`,
        8000,
        '铠甲穿到槽位 3'
      ).catch(() => false);
    }
  }
  const worn = (await c.ev('__MU_APP__.inventory()')).filter(i => i.slot < 12);
  check('身上有装备（全修才有东西可修）', worn.length > 0, worn.map(i => `slot${i.slot}:${i.name}`).join(' '));

  const moneyBefore = (await state()).money ?? null;
  const beforeLogs = c.logs.length;

  // 第一次点击：只提示，不发包
  await c.ev(`document.querySelector('.npc-btn-wide').click()`);
  await sleep(500);
  const firstTouch = c.logs.slice(beforeLogs).some(l => l.includes('0x34 全部修理'));
  check('第一次点「全部修理」不发包（先提示会花光）', firstTouch === false);
  const toast = await c.ev(`document.querySelector('.npc-panel .npc-toast')?.textContent ?? ''`);
  check('提示里说明了「可能花光余额」', /花光/.test(toast), toast.slice(0, 40));

  // 第二次点击：真的发 slot=0xFF / type=0
  await c.ev(`document.querySelector('.npc-btn-wide').click()`);
  await sleep(600);
  const repairLog = c.logs.slice(beforeLogs).filter(l => l.includes('0x34 全部修理')).slice(-1)[0] ?? '';
  check('第二次点才发包', !!repairLog, repairLog);
  check(
    '参数是 slot=0xFF / type=0（不是 slot=0 / type=1）',
    /slot=0xFF, type=0/.test(repairLog),
    repairLog
  );

  await sleep(1200);
  const moneyAfter = (await state()).money ?? null;
  console.log(
    `  · 金币 ${moneyBefore ?? '?'} → ${moneyAfter ?? '?'}` +
      (moneyBefore != null && moneyAfter != null ? `（变化 ${moneyAfter - moneyBefore}）` : '')
  );
  check(
    '没有把金币扣成 0（装备栏为空时本来就不该扣钱）',
    moneyAfter !== 0 || moneyBefore === 0,
    `${moneyBefore} → ${moneyAfter}`
  );

  /* ================= 5. M 键移动 ================= */
  console.log('\n[M 键] 移动命令 → /move');
  // 先确保在洛兰（Noria 是第 2 条，好找）
  const s0 = await state();
  if (s0.mapId !== 0) {
    await c.ev(`__MU_APP__.chat('/gmove ${who.name} 0 133 131')`);
    await until('__MU_APP__.state().mapId === 0', 30000, '回洛兰');
    await sleep(1500);
  }

  await key('KeyM');
  await sleep(500);
  check('按 M 打开移动窗口', (await state()).moveCommand.open === true);
  const count = (await state()).moveCommand.entries.length;
  check('条目来自服务端 Move.txt（23 条）', count === 23, `${count} 条`);

  // 选中 Noria（窗口里的 key 字段就是 Move.txt 的英文名）
  const noriaIdx = await c.ev(
    `__MU_APP__.state().moveCommand.entries.findIndex(e => e.key === 'Noria')`
  );
  check('表里有 Noria 这一条', noriaIdx >= 0, `index ${noriaIdx}`);

  const beforeWarp = c.logs.length;
  await c.ev(`__MU_APP__.moveSelect(${noriaIdx})`).catch(async () => {
    // 没有 select 调试口就用键盘：Home 回第一条再 Down 到目标
    await key('Home');
    for (let i = 0; i < noriaIdx; i++) await key('ArrowDown');
  });
  await sleep(300);
  await key('Enter');
  await sleep(800);
  const warpLog = c.logs.slice(beforeWarp).filter(l => l.includes('[warp] /move')).slice(-1)[0] ?? '';
  check('点条目 → 发的是 `/move <key>`', /\/move Noria/.test(warpLog), warpLog);

  /*
   * 服务端对命令有 `Delay` 冷却（`CommandManager.cpp:296`），而且它**静默丢弃**
   * 而不是回一句「太快了」—— 连着跑几个探针时很容易撞上。
   * 玩家碰到这种情况就是再点一次，所以探针也重试一次。
   */
  let warped = await until('__MU_APP__.state().mapId === 3', 20000, '真的换图到诺利亚').catch(
    () => false
  );
  if (!warped) {
    console.log('  · 第一次没走（服务端命令冷却？），再点一次');
    await c.ev(`__MU_APP__.moveConfirm()`);
    warped = await until('__MU_APP__.state().mapId === 3', 20000, '重试换图').catch(() => false);
  }
  if (!warped) console.log('  · 聊天尾部：', (await lines()).slice(-4).join(' | '));
  check('服务端真的把角色传过去了（mapId 0 → 3）', warped === true, `mapId=${(await state()).mapId}`);
  check('聊天框有「已进入 诺利亚」', (await lines()).some(t => /已进入\s*诺利亚/.test(t)));

  await c.shot('uifix-bar');
  await c.ev('__MU_APP__.toggleInventory(true)');
  await sleep(600);
  await c.shot('uifix-bar-inv');
  await c.ev('__MU_APP__.toggleInventory(false)');

  /* ================= 收尾 ================= */
  await c.ev(`__MU_APP__.chat('/gmove ${who.name} 0 133 131')`);
  await until('__MU_APP__.state().mapId === 0', 30000, '回洛兰').catch(() => {});

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error('\n探针异常：', e.message);
  console.error(c.logs.slice(-10).join('\n'));
  process.exitCode = 1;
} finally {
  await c.close();
}
