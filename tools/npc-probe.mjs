/**
 * NPC 对话 / 商店 / 仓库 / 丢弃 / 聊天命令 —— 全链路探针（真实服务端）。
 *
 *   node tools/npc-probe.mjs             # 默认 1234/1234
 *   node tools/npc-probe.mjs 账号 密码
 *
 * 链路：
 *   登录 → 选角进图（洛兰）
 *   → 走到商人 Lumen(Class 255) → 0x30 → 0x31 商品列表 → 买(0x32) → 卖(0x33)
 *   → 走到仓库守卫(Class 240) → 0x30 → 0x31 仓库列表 → 存(0x24 0→2) → 取(2→0)
 *   → 丢一件(0x23)
 *   → 发一条 /post（验证聊天命令直通 CommandManager）
 *
 * 断言的依据全部是**服务端回了什么**：面板开没开、列表条数、背包变化、金币变化。
 * 任何一步被服务端拒绝（result=0xFF / 面板不开）都会让这一轮失败。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const account = process.argv[2] || '1234';
const password = process.argv[3] || '1234';

/** ShopManager.txt：Lumen the Barmaid = Class 255，是唯一有货的商人（20 行货） */
const SHOP = { cls: 255, x: 124, y: 134, name: '商人 Lumen' };
/** NpcTalk.cpp `case 240: NpcWarehouse`；洛兰的守卫站在 (147,145) */
const STORE = { cls: 240, x: 146, y: 144, name: '仓库守卫' };

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

const c = await createClient('npc');

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

const npcs = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.npcs())'));
const inv = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.inventory())'));
const panel = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.npcPanel())'));
const money = () => c.ev('__MU_APP__.money()');

/**
 * 找一个指定 Class 的 NPC：不在视野就先走过去。
 *
 * 必须真走路 —— 服务端只认它自己记的玩家坐标，本地瞬移不改服务端状态，
 * 距离 > 5 格时 0x30 会被 `CGNpcTalkRecv` 静默丢弃（一个字节都不回）。
 */
const findNpc = async def => {
  let hit = (await npcs()).find(n => n.cls === def.cls);
  if (hit) return hit;
  console.log(`  ${def.name}不在视野，走向 (${def.x},${def.y})…`);
  await c.ev(`__MU_APP__.walkToNpc(${def.x}, ${def.y})`);
  for (let i = 0; i < 45 && !hit; i++) {
    await sleep(800);
    hit = (await npcs()).find(n => n.cls === def.cls);
  }
  return hit;
};

try {
  const who = await loginAs(c, account, password);
  console.log(`进图：${who.name} map=${who.mapId} @ (${who.player?.x},${who.player?.y})`);
  await sleep(2000);

  /*
   * 探针假设角色站在洛兰主城（Lumen 124,134 / 仓库守卫 147,145）。
   * 别的探针（chaos-probe 会跑去诺利亚）或上一次跑图的落点都可能让这个前提不成立，
   * 所以开头用 GM 命令 `/gmove` 精确落位到城中心 —— 只靠 `/move Lorencia`
   * 会落在 Lorencia 的 Gate 上（121,232），离商人还有一百多格，走过去要好几分钟。
   */
  const st0 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
  const farFromTown =
    !st0.player || Math.hypot(st0.player.x - 133, st0.player.y - 131) > 20;
  if (st0.mapId !== 0 || farFromTown) {
    console.log(`  角色在 map=${st0.mapId} (${st0.player?.x},${st0.player?.y})，/gmove 回城…`);
    await c.ev(`__MU_APP__.chat('/gmove ${who.name} 0 133 131')`);
    await until(
      '(() => { const s = __MU_APP__.state(); return s.mapId === 0 && s.player && Math.hypot(s.player.x - 133, s.player.y - 131) < 6; })()',
      40000,
      '落位到洛兰城中心'
    );
    await sleep(1500);
  }

  const inv0 = await inv();
  const money0 = await money();
  console.log(`初始：背包 ${inv0.length} 件，金币 ${money0}`);
  await c.shot('npc-01-ingame');

  /* ---------------- 1. 商人：0x30 → 0x31 → 0x32 → 0x33 ---------------- */
  const shopNpc = await findNpc(SHOP);
  check(`找到${SHOP.name}（Class ${SHOP.cls}）`, !!shopNpc, shopNpc ? `id=${shopNpc.id}` : '不在视野');

  if (shopNpc) {
    await c.ev(`__MU_APP__.talk(${shopNpc.id})`);
    const opened = await until('__MU_APP__.npcPanel().open', 15000, '商店面板').catch(() => false);
    const p0 = await panel();
    check(
      '0x30 result=0 → 0x31 商店列表',
      opened === true && p0.mode === 'shop',
      `标题「${p0.title}」${p0.items.length} 件`
    );
    check('商品列表非空', p0.items.length > 0);
    console.log('  货架前 6 件:', p0.items.slice(0, 6).map(i => `${i.slot}:${i.name}`).join(' | '));
    await c.shot('npc-02-shop');

    if (p0.items.length) {
      /*
       * 优先买**非药水**：药水堆到 255 就叠不进去了（`InventoryInsertItemStack`
       * 会失败），测不出「服务端把新物品插进背包格」这条路径。
       */
      const target = p0.items.find(i => i.type < 448 || i.type > 456) ?? p0.items[0];
      const before = await inv();
      const m0 = await money();
      await c.ev(`__MU_APP__.buy(${target.slot})`);
      await sleep(2000);
      const after = await inv();
      const m1 = await money();
      check('买入：金币减少', m1 < m0, `${m0} → ${m1}`);

      /*
       * 「买到了」的判据不能用件数：药水会叠到已有堆叠上，件数不变。
       * 用「同 type 的 durability 总和」——药水的 durability 就是堆叠数。
       */
      const sumOf = (list, type) =>
        list.filter(i => i.type === type).reduce((n, i) => n + (i.durability || 0), 0);
      const grew = sumOf(after, target.type) > sumOf(before, target.type);
      check(
        '买入：物品进背包（新格或叠加）',
        after.length > before.length || grew,
        `${before.length} → ${after.length} 件，type ${target.type} 数量 ${sumOf(before, target.type)} → ${sumOf(after, target.type)}`
      );
      console.log(`  买 ${target.name}（货架格 ${target.slot}）`);

      const bought = after.find(i => i.type === target.type);
      if (bought) {
        const m2 = await money();
        await c.ev(`__MU_APP__.sell(${bought.slot})`);
        await sleep(2000);
        const m3 = await money();
        check('卖出：金币回涨', m3 > m2, `${m2} → ${m3}`);
      } else {
        check('卖出', false, '背包里找不到刚买的东西');
      }
    }

    await c.ev('__MU_APP__.closeNpc()');
    await sleep(600);
    check('0x31 关闭商店界面', !(await panel()).open);
  }

  /* ---------------- 2. 仓库：0x30 → 0x31 → 0x24（存/取） ---------------- */
  const storeNpc = await findNpc(STORE);
  check(`找到${STORE.name}（Class ${STORE.cls}）`, !!storeNpc, storeNpc ? `id=${storeNpc.id}` : '不在视野');

  if (storeNpc) {
    const before = await inv();
    const bagItem = before.find(i => i.slot >= 12);
    check('背包里有可存的东西（12..75 格）', !!bagItem, bagItem ? `${bagItem.name} @${bagItem.slot}` : '无');

    if (bagItem) {
      // 站近了再开口：服务端 `CGNpcTalkRecv` 只看它自己记的坐标
      const near = await until(
        `(() => { const n = __MU_APP__.npcs().find(e => e.cls === ${STORE.cls});
                  const p = __MU_APP__.state().player;
                  return !!n && !!p && Math.hypot(n.x - p.x, n.y - p.y) < 4; })()`,
        20000,
        '站到仓库守卫旁边'
      ).catch(() => false);
      if (!near) console.log('  （还没站到位，重新寻路一次）');

      await c.ev(`__MU_APP__.talk(${storeNpc.id})`);
      let opened = await until(
        '__MU_APP__.npcPanel().open === true && __MU_APP__.npcPanel().mode === "warehouse"',
        15000,
        '仓库面板'
      ).catch(() => false);

      /*
       * 兜底重试一次：从商店走到仓库守卫要穿过整个广场，路上可能被 NPC 占位
       * 卡住（服务端那边位置没更新，0x30 就会被静默丢弃）。
       */
      if (!opened) {
        await c.ev('__MU_APP__.walkToNpc(146, 144)');
        await sleep(5000);
        await c.ev(`__MU_APP__.talk(${storeNpc.id})`);
        opened = await until(
          '__MU_APP__.npcPanel().open === true && __MU_APP__.npcPanel().mode === "warehouse"',
          15000,
          '仓库面板（重试）'
        ).catch(() => false);
      }
      const p1 = await panel();
      check('0x30 result=2 → 仓库面板', opened === true, `mode=${p1.mode} 仓库 ${p1.items.length} 件`);
      await c.shot('npc-03-warehouse');

      if (opened) {
        await c.ev(`__MU_APP__.store(${bagItem.slot})`);
        await sleep(2000);
        const after = await inv();
        const p2 = await panel();
        check('存入：背包 -1', after.length === before.length - 1, `${before.length} → ${after.length}`);
        check('存入：仓库 +1', p2.items.length === p1.items.length + 1, `${p1.items.length} → ${p2.items.length}`);
        console.log(`  存入 ${bagItem.name}（背包槽 ${bagItem.slot}）`);
        await c.shot('npc-04-stored');

        const inWh = p2.items.find(i => i.type === bagItem.type);
        if (inWh) {
          await c.ev(`__MU_APP__.take(${inWh.slot})`);
          await sleep(2000);
          const back = await inv();
          const p3 = await panel();
          check('取出：背包恢复', back.length === after.length + 1, `${after.length} → ${back.length}`);
          check('取出：仓库 -1', p3.items.length === p2.items.length - 1, `${p2.items.length} → ${p3.items.length}`);
          await c.shot('npc-05-taken');
        } else {
          check('取回', false, '仓库里找不到刚存的物品');
        }

        await c.ev('__MU_APP__.closeNpc()');
        await sleep(600);
      }
    }
  }

  /* ---------------- 3. 丢弃 0x23 ---------------- */
  const invNow = await inv();
  /*
   * 服务端 `CGItemDropRecv` 拒绝两种情况：`m_Level > 4` 的装备、卓越物品。
   * 所以优先丢药水，其次丢 +0..+4 的装备。
   */
  const dropMe =
    invNow.find(i => i.slot >= 12 && i.type >= 448 && i.type <= 456) ??
    invNow.find(i => i.slot >= 12 && i.level <= 4);
  if (dropMe) {
    await c.ev(`__MU_APP__.drop(${dropMe.slot})`);
    await sleep(1600);
    const after = await inv();
    check('丢弃：背包 -1', after.length === invNow.length - 1, `${invNow.length} → ${after.length}`);
    console.log(`  丢掉 ${dropMe.name}（槽 ${dropMe.slot}）`);
    await c.shot('npc-06-dropped');
  } else {
    check('丢弃', false, '背包里没有可丢的东西');
  }

  /* ---------------- 4. Q 键喝药（0x26 使用物品） ---------------- */
  const potionSum = list =>
    list.filter(i => i.slot >= 12 && i.type >= 448 && i.type <= 456).reduce((n, i) => n + (i.durability || 0), 0);
  // 前几轮买/卖/丢可能把药水折腾光，先补一瓶（/make 是服务端命令，Apple = 14:0）
  if (potionSum(await inv()) === 0) {
    await c.ev(`__MU_APP__.chat('/make 14 0 0')`);
    await sleep(2000);
  }
  const beforePotion = await inv();
  const p0sum = potionSum(beforePotion);
  if (p0sum > 0) {
    await c.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', bubbles: true }))`);
    await sleep(1800);
    const p1sum = potionSum(await inv());
    check('Q 键喝药（0x26 使用物品）', p1sum < p0sum, `药水总量 ${p0sum} → ${p1sum}`);
  } else {
    check('Q 键喝药', false, '背包里没有药水');
  }

  /* ---------------- 5. 聊天命令直通（/post） ---------------- */
  /*
   * 用纯 ASCII 正文：`sendChat` 是按 `charCodeAt & 0xFF` 逐字节写的（和原版
   * 10+60 定长字段一致），中文会被截成单字节乱码，服务端回显后匹配不上。
   *
   * 判定方式是「聊天框里出现自己发的这行」——服务端 `CGChatRecv` 会先交给
   * CommandManager（写 COMMAND_LOG/CHAT_LOG），再按 CommandPostType 广播回来。
   */
  const chatLines = async () =>
    JSON.parse(await c.ev('JSON.stringify(__MU_APP__.chatLines().lines)'));
  const before = (await chatLines()).length;
  await c.ev(`__MU_APP__.chat('/post MU-H5-PROBE')`);
  await sleep(2500);
  const lines = await chatLines();
  const hit = lines.some(l => /MU-H5-PROBE/.test(l.text) || /MU-H5-PROBE/.test(l.name));
  check('聊天命令 /post 被服务端处理并回显', hit, `聊天框 ${before} → ${lines.length} 行`);

  console.log(`\n结束：金币 ${await money()}`);
  console.log('--- 页面控制台（末尾） ---');
  console.log(c.logs.slice(-14).join('\n') || '（空）');

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error('ERR', e.message);
  console.log('--- 页面控制台 ---');
  console.log(c.logs.slice(-25).join('\n') || '（空）');
  try {
    await c.shot('npc-error');
  } catch {}
  process.exitCode = 1;
} finally {
  await c.close();
}
