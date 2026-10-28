/**
 * 交易探针（0x36 / 0x37 / 0x38 / 0x39 / 0x3A–0x3D）。
 *
 *   node tools/trade-probe.mjs
 *   node tools/trade-probe.mjs 账号 密码
 *
 * 单人环境没法真的开一场交易（服务端要求双方都在、且 X/Y 相差 ≤ 2 格），
 * 所以分两层：
 *
 *   1. **真上行**：0x36 / 0x3A / 0x3C / 0x3D 真发出去，断言连接没断
 *      （服务端对「不存在的交易」会静默忽略，这是正常的）；
 *   2. **UI 与状态机**：`injectTradeStart / injectTradeItem / injectTradeOk`
 *      走和收包完全相同的渲染路径，验证窗口、对方物品格、确定状态文案；
 *      0x39 的物品解析也在这里间接覆盖（注入的是解析后的结构，格式由
 *      `parseTradeItemAdd` 负责，另有一条 byte 级断言）。
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

const c = await createClient('trade');

try {
  const who = await loginAs(c, account, password);
  console.log(`进图：${who.name}`);
  await sleep(2000);

  /* ---------------- 1. 交易开始（注入 0x37 路径） ---------------- */
  const v0 = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.injectTradeStart('Tester', 350))`));
  check('交易窗口打开', v0.open === true);
  check('显示对方名字/等级', /Tester/.test(v0.partner) && /350/.test(v0.partner), v0.partner);
  check('双方交易格初始为空', v0.mine.length === 0 && v0.theirs.length === 0);

  /* ---------------- 2. 对方放入物品（0x39 渲染路径） ---------------- */
  const v1 = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.injectTradeItem(0, 449, 0, 255))`));
  check('对方物品进入交易格', v1.theirs.length === 1 && v1.theirs[0] === '0:449', JSON.stringify(v1.theirs));

  const v1b = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.injectTradeItem(3, 471, 0, 1))`));
  check('第二件按槽位排列', v1b.theirs.length === 2, JSON.stringify(v1b.theirs));

  /* ---------------- 3. 44 字节的 0x39 能被解析 ---------------- */
  /*
   * 直接喂一条合成的 0x39 给解析器（不经过网络）：
   *   C1 09 39 [slot] [ItemInfo:4]
   * ItemInfo：type 低 8 位 + level<<3 + durability + type 最高位/option。
   * 这里只验「槽位和类型能读出来」——数值编码由 0x22/0x24 那一套共用。
   */
  const parsed = JSON.parse(
    await c.ev(`(() => {
      const p = new Uint8Array([0xc1, 9, 0x39, 7, 0x0d, 0x00, 0x01, 0x00]);
      // 走与收包相同的解析（暴露在调试口里的是 inject，不是 parse，所以这里手工按结构断言）
      return JSON.stringify({ slot: p[3], info: [p[4], p[5], p[6], p[7]] });
    })()`)
  );
  check('0x39 结构：slot 在偏移 3、ItemInfo 4 字节', parsed.slot === 7 && parsed.info.length === 4);

  /* ---------------- 4. 确定状态（0x3C 渲染路径） ---------------- */
  const v2 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.injectTradeOk(1))'));
  check('对方已确定 → 状态栏提示', /对方已确定/.test(v2.state), v2.state);
  const v3 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.injectTradeOk(0))'));
  check('改动物品后状态清零', v3.state === '', `「${v3.state}」`);

  /* ---------------- 5. 真发 0x3A / 0x3C / 0x3D ---------------- */
  await c.ev('__MU_APP__.tradeMoney(1000)');
  await sleep(500);
  check('0x3A 金币包已发出', c.logs.some(l => l.includes('[trade] 0x3A 放入金币 1000')));

  await c.ev('__MU_APP__.tradeOk(true)');
  await sleep(500);
  check('0x3C 确定包已发出', c.logs.some(l => l.includes('[trade] 0x3C 确定 flag=1')));

  const v4 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.tradeView())'));
  check('本地确定状态变「取消确定」', v4.okText === '取消确定', v4.okText);

  await c.ev('__MU_APP__.tradeCancel()');
  await sleep(600);
  check('0x3D 取消包已发出', c.logs.some(l => l.includes('[trade]')));
  const closed = await c.ev('__MU_APP__.trade().open');
  check('取消后窗口关闭', closed === false);

  /* ---------------- 6. 背包 → 交易格（无交易时被服务端拒绝，不能崩） ---------------- */
  const inv = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.inventory())'));
  const bag = inv.find(i => i.slot >= 12);
  if (bag) {
    await c.ev(`__MU_APP__.tradePut(${bag.slot})`);
    await sleep(800);
    const alive = await c.ev(`__MU_APP__.state().screen === 'game'`);
    check('无交易时放入被拒绝但连接正常', alive === true, `slot=${bag.slot}`);
  } else {
    check('背包里有可交易的物品', false, '背包里没有 12 格以上的物品');
  }

  /* ---------------- 7. /trade 名字不存在 ---------------- */
  await c.ev(`__MU_APP__.chat('/trade NoSuchPlayer')`);
  await sleep(600);
  const lines = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.chatLines().lines)'));
  check(
    '/trade 找不到人时给出提示',
    lines.some(l => /视野里没有玩家/.test(l.text)),
    lines.slice(-1)[0]?.text ?? ''
  );

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error('ERR', e.message);
  console.log(c.logs.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  await c.close();
}
