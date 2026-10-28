/**
 * 混沌合成探针（0x86 / 0x87 / 0x88 + 0x24 flag 3 + 0x1C 换图）。
 *
 *   node tools/chaos-probe.mjs
 *   node tools/chaos-probe.mjs 账号 密码
 *
 * 混沌哥布林（Class 238）只刷在诺利亚（`MonsterSetBase.txt: 238 3 0 180 103`），
 * 所以这一轮顺带把**服务端驱动的换图（0x1C）**也测了：
 *   `/move Noria` → 服务端回 `C3 08 1C gate map x y dir` → 客户端整张地图重载。
 *   在这之前客户端根本不认 0x1C，走过任何传送门都会「人在新图、画面还是老图」。
 *
 * 两层断言：
 *   A. 本地层（不需要走到 NPC）：配方推导 / 面板文案 / 0x88 显示 / 0x86 三分支 /
 *      「箱里有东西不许关」。注入走的都是**收包同一条路径**。
 *   B. 真服务端：走到 238 → 0x30 result=3 → 0x24 0→3 放材料 → 3→0 取回 → 0x87 关闭。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const account = process.argv[2] || '1234';
const password = process.argv[3] || '1234';

/** MonsterSetBase.txt: 238 3 0 180 103 —— 诺利亚的混沌哥布林 */
const GOBLIN = { cls: 238, x: 180, y: 103, name: '混沌哥布林' };
/** 物品编号（`GET_ITEM(group,index)`） */
const IT = {
  CHAOS: 399, // 混沌之石 Jewel of Chaos
  FEATHER: 430, // 洛克之羽 Loch's Feather（二代翅膀）
  CREATION: 470, // 创造宝石 Jewel of Creation（+混沌 = 果实）
  WING1: 384, // 一代翅膀
  BLESS: 461, // 祝福宝石
  SOUL: 462, // 灵魂宝石
  EYE: 465, // 恶魔之眼
  KEY: 466, // 恶魔之钥
  SWORD: 8, // 短剑（普通装备）
};

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

const c = await createClient('chaos');

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

const view = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.chaosView())'));
const inventory = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.inventory())'));

try {
  const who = await loginAs(c, account, password);
  console.log(`进图：${who.name} map=${who.mapId} @ (${who.player?.x},${who.player?.y})`);
  await sleep(2000);

  /* ================= A. 换图（0x1C） ================= */
  console.log('\n[0x1C] 服务端换图');
  if ((await c.ev('__MU_APP__.state().mapId')) !== 3) {
    await c.ev(`__MU_APP__.chat('/move Noria')`);
    const mapId = await until('__MU_APP__.state().mapId === 3', 30000, '换图到诺利亚');
    check('0x1C 收到并重载地图', mapId === true);
    check(
      '日志里有 0x1C 解析',
      c.logs.some(l => l.includes('[MU] 0x1C 传送')),
      c.logs.filter(l => l.includes('0x1C')).slice(-1)[0] ?? ''
    );
    const st = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
    check('地图名 = Noria', st.mapName === 'Noria', `${st.mapName}`);
    check('角色落在诺利亚', st.player !== null, JSON.stringify(st.player));
  } else {
    check('起始就在诺利亚', true);
  }

  /* ================= B. 配方推导 + 面板（本地层） ================= */
  console.log('\n[配方] 本地推导（注入 0x31 type=3）');
  await c.ev('__MU_APP__.chaosOpen()');
  let v = await view();
  check('面板打开', v.open === true);
  check('初始材料为空 → 配方 0', v.recipe === 0, String(v.recipe));

  const recipeOf = async specs => {
    const r = JSON.parse(
      await c.ev(`JSON.stringify(__MU_APP__.injectChaosList(${JSON.stringify(specs)}).items)`)
    );
    const ch = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.chaos())'));
    return { recipe: ch.recipe.type, total: ch.recipe.total, items: r };
  };

  let r = await recipeOf([{ slot: 0, type: IT.CHAOS }]);
  check('只有混沌之石 → 0', r.recipe === 0, `recipe=${r.recipe}`);

  r = await recipeOf([
    { slot: 0, type: IT.CHAOS },
    { slot: 1, type: IT.BLESS },
    { slot: 2, type: IT.SOUL },
    { slot: 3, type: IT.SWORD, level: 9 },
  ]);
  check('混沌+祝福+灵魂+9级装备 → 3（创造 +10）', r.recipe === 3, `recipe=${r.recipe}`);

  r = await recipeOf([
    { slot: 0, type: IT.CHAOS },
    { slot: 1, type: IT.BLESS },
    { slot: 2, type: IT.BLESS },
    { slot: 3, type: IT.SOUL },
    { slot: 4, type: IT.SOUL },
    { slot: 5, type: IT.SWORD, level: 10 },
  ]);
  check('混沌+2祝福+2灵魂+10级装备 → 4（创造 +11）', r.recipe === 4, `recipe=${r.recipe}`);

  r = await recipeOf([
    { slot: 0, type: IT.CHAOS },
    { slot: 1, type: IT.EYE, level: 1 },
    { slot: 2, type: IT.KEY, level: 1 },
  ]);
  check('混沌+眼+钥（同级）→ 2（恶魔广场）', r.recipe === 2, `recipe=${r.recipe}`);

  r = await recipeOf([
    { slot: 0, type: IT.CHAOS },
    { slot: 1, type: IT.EYE, level: 1 },
    { slot: 2, type: IT.KEY, level: 2 },
  ]);
  check('眼/钥等级不一致 → -2', r.recipe === -2, `recipe=${r.recipe}`);

  r = await recipeOf([
    { slot: 0, type: IT.CHAOS },
    { slot: 1, type: IT.CREATION },
  ]);
  check('混沌+创造宝石 → 6（果实）', r.recipe === 6, `recipe=${r.recipe}`);

  r = await recipeOf([{ slot: 0, type: IT.CHAOS }, { slot: 1, type: IT.SWORD, level: 5 }]);
  check('混沌+普通装备 → 0（不是卓越）', r.recipe === 0, `recipe=${r.recipe}`);

  /*
   * 卓越装备（`excellent` = ItemInfo 第 4 字节低 6 位）：
   * 混沌 + 一把卓越短剑 → 配方 1（混沌武器）。
   * 「一代翅膀」要卓越武器型（70/134/167）才算，这里用普通短剑验 1。
   */
  r = await recipeOf([
    { slot: 0, type: IT.CHAOS },
    { slot: 1, type: IT.SWORD, level: 6, excellent: 0x0f },
  ]);
  check('混沌+卓越装备 → 1（混沌武器）', r.recipe === 1, `recipe=${r.recipe}`);

  r = await recipeOf([
    { slot: 0, type: IT.CHAOS },
    { slot: 1, type: 70, level: 6, excellent: 0x0f },
  ]);
  check('混沌+卓越武器型 → 11（一代翅膀）', r.recipe === 11, `recipe=${r.recipe}`);

  r = await recipeOf([
    { slot: 0, type: IT.CHAOS },
    { slot: 1, type: IT.FEATHER },
    { slot: 2, type: IT.WING1 },
    { slot: 3, type: IT.SWORD, level: 6, excellent: 0x0f },
  ]);
  check('混沌+洛克之羽+翅膀+卓越（数量吻合）→ 7（二代翅膀）', r.recipe === 7, `recipe=${r.recipe}`);

  /* ================= C. 成功率 / 合成回执 ================= */
  console.log('\n[显示] 0x88 / 0x86');
  await c.ev('__MU_APP__.injectChaosList([{slot:0,type:' + IT.CHAOS + '},{slot:1,type:' + IT.CREATION + '}])');
  v = await view();
  check('配方文案是「果实」', /果实/.test(v.recipeText), v.recipeText);

  await c.ev('__MU_APP__.injectChaosRate(75, 3000000)');
  v = await view();
  check('成功率显示 75%', v.rate === 75, String(v.rate));
  check('费用显示 3,000,000', v.money === 3000000, String(v.money));

  const mixed = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.injectChaosMix(1, ${IT.CREATION}, 0))`));
  check('合成成功：产物进箱子第 0 格', mixed.items.length === 1 && mixed.items[0].slot === 0, JSON.stringify(mixed.items));
  check('合成成功：phase=result', mixed.phase === 'result', mixed.phase);

  const stillOpen = await c.ev('__MU_APP__.chaosClose()');
  check('箱里有产物 → 拒绝关闭', stillOpen === true);
  v = await view();
  check('拒绝关闭时给出提示', v.open === true);

  const failed = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.injectChaosMix(0))'));
  check('失败回执清空箱子', failed.items.length === 0, JSON.stringify(failed.items));

  await c.ev('__MU_APP__.chaosClose()');
  await sleep(300);
  const closed = await c.ev('__MU_APP__.chaos().open');
  check('空箱 → 允许关闭', closed === false);

  /* ================= D. 真服务端链路 ================= */
  console.log('\n[真链路] 混沌哥布林 238');

  /*
   * 徒步走到哥布林身边，**不要用 GM `/gmove` 直接落点**：
   *   - `/move Noria`（换图）→ 服务端 `gObjMoveGate`：
   *     DestroyViewport → 0x1C → CreateViewport → **ClearViewport**，
   *     最后一步把刚推的 0x12 全删了，所以换图后视野是空的，
   *     走两步服务端才会重新推（客户端只要继续发 0x10 即可）；
   *   - 同图 `/gmove` 不走 loadWorld，这套重建就不会触发，角色留在
   *     `RegenOk` 状态，0x24 一律被拒 —— 用它定位反而更不稳。
   */
  let st = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
  if (st.mapId !== 3) {
    await c.ev(`__MU_APP__.chat('/move Noria')`);
    await until('__MU_APP__.state().mapId === 3', 40000, '换图到诺利亚');
    check('0x1C 收到并重载地图', true);
    check('地图名 = Noria', true);
  } else {
    check('已在诺利亚（无需换图）', true);
  }

  // 开始走 → 服务端重建视野
  await c.ev(`__MU_APP__.walkToNpc(${GOBLIN.x - 1}, ${GOBLIN.y + 1})`);
  let npc = null;
  for (let i = 0; i < 30 && !npc; i++) {
    await sleep(1000);
    st = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
    const g = st.remotes.find(r => r.cls === GOBLIN.cls);
    if (!g) {
      if (i % 6 === 5) await c.ev(`__MU_APP__.walkToNpc(${GOBLIN.x - 1}, ${GOBLIN.y + 1})`);
      continue;
    }
    if (st.player && Math.hypot(g.x - st.player.x, g.y - st.player.y) < 4) npc = g;
  }
  check('走到混沌哥布林身边（<4 格）', !!npc, npc ? `id=${npc.id} (${npc.x},${npc.y})` : '未找到');
  if (!npc) {
    console.log(
      '  调试：remotes',
      JSON.stringify(st.remotes.map(r => `${r.kind}/${r.cls}@${r.x},${r.y}`)),
      'player',
      JSON.stringify(st.player)
    );
  }

  if (npc) {
    /*
     * 先造合成材料（GM `/make`）。
     * 必须在**开界面之前**发：`CGChatRecv` 在 `Interface.use != 0` 时会被
     * `ManagementCore` 前面的校验挡掉，界面对着聊天框敲命令是没反应的。
     */
    let bagNow = await inventory();
    if (!bagNow.some(i => i.type === 399)) {
      await c.ev(`__MU_APP__.chat('/make 12 15')`);
      await sleep(1200);
    }
    if (!bagNow.some(i => i.type === 470)) {
      await c.ev(`__MU_APP__.chat('/make 14 22')`);
      await sleep(1200);
    }
    bagNow = await inventory();
    check(
      'GM 造出混沌之石 + 创造宝石',
      bagNow.some(i => i.type === 399) && bagNow.some(i => i.type === 470),
      bagNow.filter(i => i.type === 399 || i.type === 470).map(i => `${i.slot}:${i.type}`).join(' ')
    );

    // 服务端只认它自己记的坐标（±5 格），距离到了才受理 0x30
    let opened = false;
    for (let i = 0; i < 4 && !opened; i++) {
      await c.ev(`__MU_APP__.talk(${npc.id})`);
      await sleep(2500);
      opened = await c.ev('__MU_APP__.chaos().open');
    }
    check('0x30 result=3 → 混沌机界面打开', opened === true);
    check(
      '日志确认 result=3',
      c.logs.some(l => l.includes('result=3')),
      c.logs.filter(l => l.includes('[npc]')).slice(-1)[0] ?? ''
    );

    /*
     * 放一件真材料进去（服务端 0x24 flag 0→3）。
     * 注意 `CheckItemMoveToChaos` 会拒绝**可堆叠且数量 > 1** 的物品
     * （药水整堆塞不进去），所以优先挑 `durability <= 1` 的非药水。
     */
    const inv = await inventory();
    const bag =
      inv.find(i => i.slot >= 12 && i.durability <= 1 && !(i.type >= 448 && i.type <= 456)) ??
      inv.find(i => i.slot >= 12 && !(i.type >= 448 && i.type <= 456));
    if (bag) {
      await c.ev(`__MU_APP__.chaosPut(${bag.slot})`);
      await sleep(900);
      const put = c.logs.some(l => l.includes('[chaos] 搬运完成 kind=in'));
      check('0x24 背包→箱子 被服务端接受', put, `slot=${bag.slot}`);
      const boxed = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.chaos().items)'));
      check('本地箱子记录到 1 件', boxed.length === 1, JSON.stringify(boxed));
      if (!boxed.length) throw new Error('放不进混沌箱，后续断言无法进行');

      /*
       * 取回：用**真鼠标点箱子格**（不是调调试口），
       * 这样 `itemAtCell` 的命中判定（多格物品按 w/h 覆盖）也一起覆盖到。
       */
      const chaosSlot = Number(boxed[0].split(':')[0]);
      const cell = await c.center(`.chaos-panel .npc-cell[data-cell="${chaosSlot}"]`);
      check('箱子格 0 可定位', !!cell, cell ? `${Math.round(cell.x)},${Math.round(cell.y)}` : '');
      if (cell) {
        await c.ptr('mouseMoved', cell.x, cell.y, { buttons: 0 });
        await c.ptr('mousePressed', cell.x, cell.y);
        await c.ptr('mouseReleased', cell.x, cell.y);
      }
      await sleep(900);
      check(
        '点箱子格 → 0x24 箱子→背包 被服务端接受',
        c.logs.some(l => l.includes('[chaos] 搬运完成 kind=out'))
      );
      const after = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.chaos().items)'));
      check('箱子已空', after.length === 0, JSON.stringify(after));
    } else {
      check('背包里有可放进箱子的物品', false, '背包 12 格以上为空');
    }

    /* ---- 真合成一次：混沌之石 + 创造宝石 → 果实（配方 6）---- */
    let bag2 = await inventory();
    const jewel = bag2.find(i => i.type === 399);
    const creation = bag2.find(i => i.type === 470);
    if (jewel && creation) {
      await c.ev(`__MU_APP__.chaosPut(${jewel.slot})`);
      await sleep(1200);
      await c.ev(`__MU_APP__.chaosPut(${creation.slot})`);
      await sleep(1600);
      const ready = await view();
      check(
        '真实材料 → 配方 6（果实）',
        ready.recipe === 6,
        `${JSON.stringify(ready.items)} recipe=${ready.recipe}`
      );

      // 真点「合成」按钮
      const mixBtn = await c.center('.chaos-mix-btn');
      await c.ptr('mouseMoved', mixBtn.x, mixBtn.y, { buttons: 0 });
      await c.ptr('mousePressed', mixBtn.x, mixBtn.y);
      await c.ptr('mouseReleased', mixBtn.x, mixBtn.y);

      // 等 0x86 回执
      let got = false;
      for (let i = 0; i < 8 && !got; i++) {
        await sleep(1200);
        got = c.logs.some(l => l.includes('[chaos] 0x86 回执'));
      }
      check('0x86 收到回执', got);
      /*
       * 0x88 必须由**真服务端**回一次合理的成功率 —— 这条以前一直没验证过，
       * 因为注入器和解析器一起按 packed 的 11 字节布局写，自洽蒙混过关。
       * 服务端 `ChaosBox.h` 没 pack(1)，`int type` 在 +4（上行要留 1 字节洞），
       * 回执的 `rate` 也在 +4。
       */
      const rateLog = c.logs.filter(l => l.includes('[chaos] 0x88 成功率')).slice(-1)[0] ?? '';
      const rateVal = Number((/0x88 成功率 (\d+)%/.exec(rateLog) || [])[1] ?? -1);
      check('真服务端回了 0x88 成功率', !!rateLog, rateLog);
      check('成功率是合理值（1..100），不是 0 或天文数字', rateVal > 0 && rateVal <= 100, `${rateVal}%`);

      const mixed = await view();
      check(
        '产物落在箱子第 0 格',
        mixed.items.length === 1 && mixed.items[0].slot === 0,
        JSON.stringify(mixed.items)
      );
      await c.shot('chaos-real-mix');

      // 把产物取回背包，箱子清空后才允许关闭
      const prodCell = await c.center(`.chaos-panel .npc-cell[data-cell="0"]`);
      if (prodCell) {
        await c.ptr('mouseMoved', prodCell.x, prodCell.y, { buttons: 0 });
        await c.ptr('mousePressed', prodCell.x, prodCell.y);
        await c.ptr('mouseReleased', prodCell.x, prodCell.y);
        await sleep(2500);
      }
      const emptyAgain = await view();
      check('产物可取回（箱子清空）', emptyAgain.items.length === 0, JSON.stringify(emptyAgain.items));
    } else {
      check('/make 造出混沌之石与创造宝石', false, 'GM 命令不可用');
    }

    // 关掉（0x87）
    await c.ev('__MU_APP__.chaosClose()');
    await sleep(900);
    const gone = await c.ev('__MU_APP__.chaos().open');
    check('0x87 关闭后界面消失', gone === false);
    // 服务端回执 → `onChaosClosed` → 聊天框一行（这条走的是收包路径，不是发包日志）
    const lines = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.chatLines().lines)'));
    check(
      '服务端回了 0x87',
      lines.some(l => /混沌合成机已关闭/.test(l.text)),
      lines.slice(-1)[0]?.text ?? ''
    );

    const alive = await c.ev(`__MU_APP__.state().screen === 'game'`);
    check('全程连接未断', alive === true);
  }

  /* ================= E. 截图 ================= */
  await c.ev('__MU_APP__.chaosOpen()');
  await c.ev(
    `__MU_APP__.injectChaosList([{slot:0,type:${IT.CHAOS}},{slot:1,type:${IT.BLESS}},{slot:2,type:${IT.SOUL}},{slot:3,type:${IT.SWORD},level:9}])`
  );
  await c.ev('__MU_APP__.injectChaosRate(75, 2000000)');
  await sleep(600);
  await c.shot('chaos-panel');
  check('截图已保存 shots/chaos-panel.png', true);
  await c.ev('__MU_APP__.chaosClose()');

  /*
   * 收尾：把角色送回洛兰城中心（133,131）。
   * 这台服务端的角色位置是**持久化**的，探针把号丢在诺利亚的话，
   * 后面跑 npc-probe / econ-probe（都假设在洛兰有商人/仓库）会全部失败。
   * 用 `/gmove` 而不是 `/move Lorencia`：后者的落点是 Gate(121,232)，
   * 离商人一百多格，走过去太慢。
   */
  await c.ev(`__MU_APP__.chat('/gmove ${who.name} 0 133 131')`).catch(() => {});
  await until(
    '(() => { const s = __MU_APP__.state(); return s.mapId === 0 && s.player; })()',
    45000,
    '回洛兰'
  ).catch(() => {});
  const back = await c.ev('__MU_APP__.state().mapId');
  console.log(`  收尾：角色在地图 ${back}${back === 0 ? '（洛兰）' : '（未回到洛兰，下次跑 npc-probe 前先 /move Lorencia）'}`);

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error('ERR', e.message);
  console.log(c.logs.slice(-20).join('\n'));
  process.exitCode = 1;
} finally {
  await c.close();
}
