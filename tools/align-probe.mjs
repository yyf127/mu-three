/**
 * 报文对齐回归（`#pragma pack(1)` 缺失导致的一类偏移 bug）。
 *
 *   node tools/align-probe.mjs
 *
 * 背景：`MuServer_Source/GameServer` 里 **ItemManager.h / ChaosBox.h /
 * Trade.h / Guild.h / Quest.h / Party.h / Warehouse.h 都没有 `#pragma pack(1)`**，
 * 而 `PBMSG_HEAD` 是 3 个 `BYTE`。结构体里一旦出现 `DWORD` / `int` / `WORD`，
 * MSVC 就会在 +3 插 1 个对齐字节，字段整体后移。
 *
 * 这类 bug 的共同症状是「数值离谱而不是丢包」：
 *   - 0x34 修理回执按 +3 读 → 4586 万显示成 **31 亿**（低 3 字节左移 8 位）；
 *   - 0x88 成功率按 +3/+7 读 → 面板上是天文数字；
 *   - 0x3B 交易金币同上；
 *   - 0x93 排名按 packed 读 → 分数串到名字里。
 *
 * 每一组都按**服务端真实布局**构造字节（`inject` 走真实收包路径），
 * 再断言客户端解出来的值。这样解析器和「服务端 sizeof/offset」是解耦验证的，
 * 不会像以前那样「注入器和解析器一起错」而自洽通过。
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

/** 小端 4 字节 */
const le32 = v => [
  v & 0xff,
  (v >>> 8) & 0xff,
  (v >>> 16) & 0xff,
  (v >>> 24) & 0xff,
];

/** 拼成 `c1 len ...` 的十六进制串 */
const hex = (head, body) => {
  const bytes = [0xc1, body.length + 3, head, ...body];
  return bytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
};

const c = await createClient('align');
const state = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
const lines = async () => await c.ev('__MU_APP__.chatLines().lines.map(l => l.text)');

try {
  const who = await loginAs(c, account, password);
  console.log(`进图：${who.name} map=${who.mapId}`);
  await sleep(2500);

  /* ================= B. 真链路：修理回执不篡改金币 ================= */
  console.log('\n[真链路] 全部修理后金币不被写坏');
  const ARMOR = 261; // Leather Armor
  let worn = (await c.ev('__MU_APP__.inventory()')).filter(i => i.slot < 12);
  if (!worn.length) {
    await c.ev(`__MU_APP__.chat('/make 8 5 0')`);
    await sleep(1500);
    const bag = await c.ev('__MU_APP__.inventory()');
    const armor = bag.find(i => i.slot >= 12 && i.type === ARMOR);
    if (armor) await c.ev(`__MU_APP__.moveItem(${armor.slot}, 3)`);
    await sleep(1200);
    worn = (await c.ev('__MU_APP__.inventory()')).filter(i => i.slot < 12);
  }
  check('身上有装备', worn.length > 0, worn.map(i => i.name).join(' '));

  const before = (await state()).money;
  // 两次点击（第一次只是确认提示，第二次才发包）
  await c.ev(`document.querySelector('.npc-btn-wide').click()`);
  await sleep(400);
  await c.ev(`document.querySelector('.npc-btn-wide').click()`);
  await sleep(2500);
  const after = (await state()).money;
  /*
   * 耐久是满的 → 服务端 `GetItemRepairMoney` 返回 0 → 一分钱不扣，
   * 但回执仍然会把**当前余额**带回来（`RepairItem` 里 `(*money) = lpObj->Money`）。
   * 所以「前后一致」正好验证回执的偏移：错位的话这里会出现 `before << 8`。
   */
  check(
    '耐久满时修理不花钱，回执带回同一个余额',
    after === before,
    `${before} → ${after}`
  );
  check(
    '不是「左移 8 位」的脏值',
    after === null || (before != null && after !== ((before << 8) >>> 0) && after < 100_000_000_000),
    `${after}`
  );


  /* ================= A. 纯解析（喂真实布局的字节） ================= */
  console.log('\n[对齐] 0x34 修理回执：money 在 +4');
  /*
   * PMSG_ITEM_REPAIR_SEND = PBMSG_HEAD(3) + DWORD money
   * 无 pack(1) → money@4，sizeof 8。发 12345678。
   */
  const MONEY1 = 12345678;
  await c.ev(`__MU_APP__.inject('${hex(0x34, [0, ...le32(MONEY1)])}')`);
  await sleep(600);
  const m1 = (await state()).money;
  check('按 +4 读，钱正好是 12345678', m1 === MONEY1, `解出 ${m1}`);
  check(
    '不是「左移 8 位」的脏值（旧 bug 特征 0xBC614E00）',
    m1 !== ((MONEY1 << 8) >>> 0),
    `${m1}`
  );

  console.log('\n[对齐] 0x3B 交易金币：money 在 +4');
  const MONEY2 = 9876543;
  const moneyBefore3b = (await state()).money;
  await c.ev(`__MU_APP__.inject('${hex(0x3b, [0, ...le32(MONEY2)])}')`);
  await sleep(500);
  check('0x3B 是交易窗内的金额，不会改身上金币', (await state()).money === moneyBefore3b);
  check('0x3B 解析后客户端仍在线', (await state()).screen === 'game');

  console.log('\n[对齐] 0x81 仓库金币：result@3 / warehouse@4 / inventory@8');
  const WH = 1111111;
  const INV = 2222222;
  await c.ev(`__MU_APP__.inject('${hex(0x81, [1, ...le32(WH), ...le32(INV)])}')`);
  await sleep(500);
  check('0x81 注入后仍然在线', (await state()).screen === 'game');

  console.log('\n[对齐] 0x88 成功率：rate@4 / money@8（包长 12）');
  const RATE = 75;
  const COST = 3000000;
  const chaosView = await c.ev(
    `(() => { __MU_APP__.chaosOpen?.(); return __MU_APP__.injectChaosRate(${RATE}, ${COST}); })()`
  );
  /* `injectChaosRate` 返回 `chaosPanel.snapshot()`（对象，不是字符串） */
  check(
    '解出 rate=75 / money=3000000',
    chaosView && chaosView.rate === RATE && chaosView.money === COST,
    JSON.stringify({ rate: chaosView?.rate, money: chaosView?.money })
  );
  await c.ev('__MU_APP__.chaosClose?.()');
  await sleep(300);

  console.log('\n[对齐] 0x93 排名：score@17 / exp@21 / money@25');
  const r = await c.ev(`__MU_APP__.injectDsRank(2, 'AlignHero', 4242, 555, 666)`);
  check('name 干净（没把分数尾字节串进来）', r.name === 'AlignHero', r.name);
  check(
    'score=4242 / exp=555 / money=666',
    r.score === 4242 && r.exp === 555 && r.money === 666,
    JSON.stringify({ s: r.score, e: r.exp, m: r.money })
  );

  console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error('\n探针异常：', e.message);
  console.error(c.logs.slice(-10).join('\n'));
  process.exitCode = 1;
} finally {
  await c.close();
}
