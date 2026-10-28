/**
 * 城内经济补全探针 —— 拆堆叠 / 单件修理 / 仓库密码（真实服务端）。
 *
 *   node tools/econ-probe.mjs           # 默认 1234/1234
 *   node tools/econ-probe.mjs 账号 密码
 *
 * 覆盖阶段 AJ 新接的三条服务端入口：
 *
 *   0x2B 拆堆叠   `CItemManager::CGItemStackUnstackRecv`
 *                C1 06 2B 00 slot count；成功后服务端重发整张背包表（0xF3/0x10）
 *   0x34 单件修理 `CGItemRepairRecv` 的 type=0（type=1 是「全部修理」）
 *   0x83 仓库密码 `CGWarehousePasswordRecv`：type 0 解锁 / 1 设置 / 2 取消
 *
 * 断言都落在「服务端回了什么」上：背包条数、堆叠数、0x83 的状态码。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const account = process.argv[2] || '1234';
const password = process.argv[3] || '1234';

const SHOP = { cls: 255, x: 124, y: 134, name: '商人 Lumen' };
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

const c = await createClient('econ');

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

/** 对话前先站到 ±5 格内（服务端只认它自己记的坐标） */
const standNear = async cls => {
  await until(
    `(() => { const n = __MU_APP__.npcs().find(e => e.cls === ${cls});
              const p = __MU_APP__.state().player;
              return !!n && !!p && Math.hypot(n.x - p.x, n.y - p.y) < 4; })()`,
    25000,
    `站到 Class ${cls} 旁`
  ).catch(() => console.log('  （还没站到位，仍然尝试开口）'));
};

/** 操作通用输入框：填值 → 点按钮 */
const fillDialog = async values => {
  await c.ev(`(() => {
    const inputs = [...document.querySelectorAll('.dlg-input')];
    const vals = ${JSON.stringify(values)};
    inputs.forEach((el, i) => {
      el.value = vals[i] ?? '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return inputs.map(el => el.value);
  })()`);
};
const clickDialog = async which => c.ev(`document.querySelector('.dlg-${which}').click()`);
const dialogTitle = () => c.ev(`document.querySelector('.dlg-title')?.textContent ?? ''`);
const dialogOpen = () => c.ev(`__MU_APP__.dialogOpen()`);

try {
  const who = await loginAs(c, account, password);
  console.log(`进图：${who.name} map=${who.mapId} @ (${who.player?.x},${who.player?.y})`);
  await sleep(2000);

  /* ---------------- 0. 准备一堆可拆的物品 ---------------- */
  // 商店先买几个药水（药水 durability = 堆叠数）
  const merchant = await findNpc(SHOP);
  if (!merchant) throw new Error('看不到商人');
  await standNear(SHOP.cls);
  await c.ev(`__MU_APP__.talk(${merchant.id})`);
  await until(`__MU_APP__.npcPanel().open === true`, 20000, '商店面板');
  const p0 = await panel();
  const potion = p0.items.find(i => i.type >= 448 && i.type <= 456) ?? p0.items[0];
  check('商店里拿到药水', !!potion, potion ? `type=${potion.type}` : '没有可买的');
  await c.ev(`__MU_APP__.buy(${potion.slot})`);
  await sleep(1800);
  await c.ev('__MU_APP__.closeNpc()');
  await sleep(800);

  const stackItem = (await inv())
    .filter(i => i.slot >= 12 && (i.durability || 0) >= 5)
    .sort((a, b) => b.durability - a.durability)[0];
  check('背包里有一堆 ≥5 的可拆物品', !!stackItem, stackItem ? `slot=${stackItem.slot} ×${stackItem.durability}` : '没有');

  /* ---------------- 1. 拆堆叠（0x2B） ---------------- */
  if (stackItem) {
    const before = await inv();
    const opened = await c.ev(`__MU_APP__.openSplit(${stackItem.slot})`);
    check('拆分框打开', opened === true);
    check('拆分框标题正确', (await dialogTitle()).includes('拆分'), await dialogTitle());
    await fillDialog(['4']);
    await clickDialog('ok');
    // 服务端会重发整张背包表，等它到
    await sleep(1800);
    const after = await inv();
    const origin = after.find(i => i.slot === stackItem.slot);
    /*
     * 服务端的实现是**逐个插入**（`for (i = 0; i < Count; i++) InventoryInsertItem`，
     * 每件 `m_Durability = 1`），所以拆 4 个得到的是 **4 件单件**，
     * 不是一堆 4 个 —— 别按「多一堆 4」去断言。
     */
    const fresh = after.filter(i => i.slot !== stackItem.slot && i.durability === 1);
    check(
      '拆堆叠：原堆减少 4',
      !!origin && origin.durability === stackItem.durability - 4,
      `${stackItem.durability} → ${origin?.durability}`
    );
    check(
      '拆堆叠：多出 4 件（服务端逐个插入，每件 1 个）',
      after.length - before.length === 4 && fresh.length >= 4,
      `背包 ${before.length} → ${after.length} 件，单件 ${fresh.length} 个`
    );
  }

  /* ---------------- 2. 单件修理（0x34 type=0） ---------------- */
  {
    /*
     * 只挑**等级最低**的装备修：修理费随等级/追加等级涨得很凶，
     * 早先随便挑一件，几次跑下来把这个测试账号的 9M 金币修光了。
     */
    const list = await inv();
    const target =
      list.filter(i => i.slot >= 12 && i.type < 448).sort((a, b) => a.level - b.level)[0] ?? list[0];
    if (target) {
      const m0 = Number(await c.ev('__MU_APP__.money()'));
      await c.ev(`__MU_APP__.repairOne(${target.slot})`);
      await sleep(1500);
      const alive = await c.ev(`__MU_APP__.state().screen === 'game'`);
      const m1 = Number(await c.ev('__MU_APP__.money()'));
      check('单件修理：连接没被断开', alive === true, `slot=${target.slot} lv=${target.level}`);
      check('单件修理：包已发出', c.logs.some(l => l.includes('修理单件')));
      check('单件修理：扣费合理（≤10 万）', m0 - m1 <= 100000, `${m0} → ${m1}（花 ${m0 - m1}）`);
    } else {
      check('单件修理', false, '背包里没有可修的物品');
    }
  }

  /* ---------------- 3. 仓库密码（0x83） ---------------- */
  const guard = await findNpc(STORE);
  if (!guard) throw new Error('看不到仓库守卫');
  await standNear(STORE.cls);
  await c.ev(`__MU_APP__.talk(${guard.id})`);
  await until(
    `__MU_APP__.npcPanel().open === true && __MU_APP__.npcPanel().mode === "warehouse"`,
    20000,
    '仓库面板'
  );
  await sleep(600);
  const state = Number(await c.ev('__MU_APP__.warehouseState()'));
  check('仓库状态已下发（0x83）', [0, 1, 12].includes(state), `state=${state}`);

  const opened = await c.ev('__MU_APP__.openWarehousePassword()');
  check('密码框打开', opened === true);
  const title = await dialogTitle();
  check('密码框标题随锁状态变化', title.length > 0, `「${title}」`);

  const before = c.logs.length;
  /** 测试用的仓库密码：跑完会取消掉（type=2），不污染账号 */
  const TEST_PW = '2468';
  if (state === 1) {
    // 已上锁：输错密码 → 服务端回 10
    await fillDialog(['9999', '']);
    await clickDialog('ok');
    await sleep(1600);
    const st = Number(await c.ev('__MU_APP__.warehouseState()'));
    check('解锁：错误密码被服务端拒绝', st === 10, `state=${st}`);
  } else {
    /*
     * 未上锁：设置密码（type=1）需要账号个人码。测试账号不一定注册过个人码，
     * 所以两种结果都算「链路通」：
     *   - 服务端接受 → state=1（上锁），接着用 type=2 取消密码收尾；
     *   - 个人码不对 → state=13。
     */
    await fillDialog([TEST_PW, '1111111']);
    await clickDialog('ok');
    await sleep(1800);
    const st = Number(await c.ev('__MU_APP__.warehouseState()'));
    check('设置密码：服务端有明确回应（1=上锁 / 13=个人码错）', st === 1 || st === 13, `state=${st}`);

    if (st === 1) {
      // 收尾：锁着也能取消密码（type=2 只校验个人码）
      await sleep(400);
      const opened2 = await c.ev('__MU_APP__.openWarehousePassword()');
      check('上锁后仍能打开密码框（含「取消密码」）', opened2 === true);
      await fillDialog([TEST_PW, '1111111']);
      await clickDialog('alt');
      await sleep(1800);
      const st2 = Number(await c.ev('__MU_APP__.warehouseState()'));
      check('取消密码：恢复成未设置', st2 === 0, `state=${st2}`);
    }
  }
  const chat = await c.ev('JSON.stringify(__MU_APP__.chatLines().lines)');
  const lines = JSON.parse(chat).map(l => l.text).join(' | ');
  check(
    '密码结果写进聊天框',
    /个人码错误|仓库已解锁|密码错误|已上锁/.test(lines),
    lines.slice(-60)
  );
  void dialogOpen;
  void before;

  await c.ev('__MU_APP__.closeNpc()');
  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error('ERR', e.message);
  console.log(c.logs.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  await c.close();
}
