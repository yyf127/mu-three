/**
 * 黄金弓箭手探针（0x94 / 0x95 / 0x96 / 0x97 / 0x9D）。
 *
 *   node tools/golden-archer-probe.mjs
 *   node tools/golden-archer-probe.mjs 账号 密码
 *
 * 分两层：
 *
 *   1. **注入层**：按服务端真实 `sizeof/offset` 造 0x94/0x95/0x96/0x97/0x9D，
 *      走和真收包完全相同的解析 + 渲染路径。四种形态（Rena / Stone /
 *      幸运号码 / 号码列表）全都过一遍，包括「按钮什么时候可点」。
 *   2. **真链路**：GM `/make 14 21 0` 造一件雷娜 → 走到洛兰的黄金弓箭手
 *      (130,127) → 对话 → 断言服务端真的回了 0x94（**不是 0x30**）。
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

const c = await createClient('ga');

/** 轮询一个表达式直到为真（和别的探针同一个套路） */
const until = async (expr, timeout = 20000, label = '') => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await c.ev(expr);
    if (v) return v;
    await sleep(400);
  }
  if (label) console.log(`  · 等待超时：${label}`);
  return false;
};
const ga = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.goldenArcher())'));
const boxTexts = async () => (await ga()).buttons.map(b => `${b.text}${b.off ? '(灰)' : ''}`);

try {
  const who = await loginAs(c, account, password);
  console.log(`进图：${who.name} map=${await c.ev('__MU_APP__.state().mapId')}`);
  await sleep(2000);

  /* ================= A. 协议解析 ================= */
  console.log('\n[解析] 0x97/0x00 兑换配置');
  const info = await c.ev(`__MU_APP__.injectGaInfo([10,50,100,500],[100,250,500],[1,2,3],50)`);
  check('renaRequired 4 档', JSON.stringify(info.renaRequired) === '[10,50,100,500]', JSON.stringify(info.renaRequired));
  check('stoneRequired 3 档', JSON.stringify(info.stoneRequired) === '[100,250,500]', JSON.stringify(info.stoneRequired));
  check('vip 时长 3 档', JSON.stringify(info.stoneVipHours) === '[1,2,3]', JSON.stringify(info.stoneVipHours));
  check('幸运号码单价 = stone[3]', info.luckyRequired === 50, `${info.luckyRequired}`);

  /* ================= B. Rena 收集器 ================= */
  console.log('\n[UI] 0x94 type=0（雷娜收集器）');
  const u0 = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.injectGa94(0, 12, ''))`));
  check('面板打开、type=0', u0.type === 0, `${u0.type}`);
  check('副标题「雷娜收集器」', (await ga()).subtitle === '雷娜收集器');
  const geo = await ga();
  check('面板在 (450,0) 190×433', geo.rect.x === 450 && geo.rect.y === 0 && geo.rect.w === 190 && geo.rect.h === 433, JSON.stringify(geo.rect));

  let texts = await boxTexts();
  check('有「已收集/已登记」两块框', texts.some(t => t.includes('已收集雷娜')) && texts.some(t => t.includes('已登记雷娜')), texts.join(' | '));
  /*
   * 登记按钮的可点性 = 「背包里有没有雷娜」，而背包是**跨探针持久化**的
   * （上一个探针会留下没登记的雷娜）。所以断言「两者一致」而不是假定空背包。
   */
  const renaNow = (await ga()).collected.rena;
  check(
    renaNow === 0 ? '背包没雷娜 → 登记按钮灰掉' : '背包有雷娜 → 登记按钮可点',
    renaNow === 0 ? texts.some(t => t === '登记雷娜(灰)') : texts.includes('登记雷娜'),
    `背包 ${renaNow} 件：${texts.join(' | ')}`
  );
  check('兑换 10 可点（已登记 12）', texts.includes('兑换雷娜: 10'), texts.join(' | '));
  check('兑换 50 灰掉（已登记 12 < 50）', texts.some(t => t === '兑换雷娜: 50(灰)'), texts.join(' | '));
  check('4 档按钮都在', texts.filter(t => t.startsWith('兑换雷娜')).length === 4, `${texts.filter(t => t.startsWith('兑换雷娜')).length}`);

  await c.ev('__MU_APP__.injectGa95(13)');
  await sleep(300);
  check('0x95 回执刷新已登记数', (await ga()).count === 13, `${(await ga()).count}`);
  await c.ev('__MU_APP__.injectGa95(-1)');
  await sleep(300);
  check(
    '0x95 count=-1 → 提示「背包里没有」',
    (await c.ev(`document.querySelector('.ga-toast')?.textContent`))?.includes('没有'),
    (await c.ev(`document.querySelector('.ga-toast')?.textContent`)) ?? '（无提示）'
  );
  await c.shot('ga-rena');

  /* ================= C. Stone 收集器（两页） ================= */
  console.log('\n[UI] 0x94 type=1（宝石收集器，两页）');
  const u1 = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.injectGa94(1, 300, ''))`));
  check('type=1 打开', u1.type === 1);
  check('副标题「宝石收集器」', (await ga()).subtitle === '宝石收集器');
  const p1 = await ga();
  check('总页数 = 2（Stone 固定两页）', p1.totalPages === 2, `${p1.totalPages}`);
  texts = await boxTexts();
  check('第 1 页 3 档 VIP 按钮都在', texts.filter(t => t.startsWith('兑换宝石')).length === 3, texts.join(' | '));
  check('100 档可点（已登记 300）', texts.includes('兑换宝石: 100'), texts.join(' | '));
  check('250 档可点', texts.includes('兑换宝石: 250'));
  check('500 档灰掉（300 < 500）', texts.some(t => t === '兑换宝石: 500(灰)'), texts.join(' | '));
  await c.shot('ga-stone');

  // 翻到第 2 页
  await c.ev(`document.querySelectorAll('.ga-arrow')[1].click()`);
  await sleep(400);
  const p2 = await ga();
  check('翻到第 2 页', p2.page === 2, `${p2.page}/${p2.totalPages}`);
  texts = await boxTexts();
  check('第 2 页 = 换幸运号码（无号码时）', texts.includes('兑换宝石: 50'), texts.join(' | '));

  // 有号码 → 变成「登记幸运号码」
  await c.ev(`__MU_APP__.injectGa96('AUS919DKL2J9')`);
  await sleep(400);
  texts = await boxTexts();
  check('有号码后出现「登记幸运号码」', texts.includes('登记幸运号码'), texts.join(' | '));
  check('号码显示成 xxxx - xxxx - xxxx', (await ga()).lucky === 'AUS919DKL2J9');
  await c.shot('ga-stone-lucky');

  /* ================= D. 幸运号码兑换 ================= */
  console.log('\n[UI] 0x94 type=2（输入号码领奖）');
  await c.ev(`__MU_APP__.injectGa94(2, 0, '')`);
  await sleep(400);
  check('type=2 打开、副标题「幸运号码兑换」', (await ga()).subtitle === '幸运号码兑换');
  const inputBox = await c.center('.ga-panel .ga-input');
  check('输入框存在', !!inputBox, inputBox ? `${Math.round(inputBox.x)},${Math.round(inputBox.y)}` : '');
  texts = await boxTexts();
  check('确认按钮初始灰掉', texts.some(t => t.endsWith('(灰)')), texts.join(' | '));

  /*
   * 输入内容 → 按钮要点亮。
   *
   * 直接赋值 + 派发 `input` 事件：面板监听的就是这个事件（真实键盘打字
   * 也是它），而 CDP 逐字符输入要处理 IME / 焦点，反而更容易假失败。
   */
  if (inputBox) {
    await c.ev(`(() => {
      const el = document.querySelector('.ga-panel .ga-input');
      el.focus();
      el.value = 'aus919dkl2j9';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(400);
  }
  texts = await boxTexts();
  check('输入 12 位后确认按钮可点', texts.includes('输入幸运号码'), texts.join(' | '));
  check(
    '输入内容大写化',
    (await c.ev(`document.querySelector('.ga-panel .ga-input')?.value`)) === 'AUS919DKL2J9',
    (await c.ev(`document.querySelector('.ga-panel .ga-input')?.value`)) ?? ''
  );
  await c.shot('ga-lucky');

  const beforeSend = c.logs.length;
  await c.ev(`document.querySelectorAll('.ga-box')[1].click()`);
  await sleep(600);
  check('点确认 → 发 0x9D', c.logs.slice(beforeSend).some(l => l.includes('[ga] 0x9D 用号码领奖')));

  /* ================= E. 号码列表（分页） ================= */
  console.log('\n[UI] 0x97/0x01 号码列表');
  const nums = Array.from({ length: 15 }, (_, i) => `NUM${String(i).padStart(9, '0')}`);
  const list = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.injectGaList(${JSON.stringify(nums)}))`));
  check('解析出 15 个号码', list.numbers.length === 15, `${list.numbers.length}`);
  const lp = await ga();
  check('切到「号码查看」形态', lp.type === 3, `${lp.type}`);
  check('页数 = 15/10+1 = 2', lp.totalPages === 2, `${lp.totalPages}`);
  check(
    '第 1 页 10 行',
    (await c.ev(`document.querySelectorAll('.ga-bingo-row').length`)) === 10,
    `${await c.ev(`document.querySelectorAll('.ga-bingo-row').length`)}`
  );
  check(
    '号码格式化成 4-4-4',
    (await c.ev(`document.querySelector('.ga-bingo-row')?.textContent`)) === 'NUM0 - 0000 - 0000',
    (await c.ev(`document.querySelector('.ga-bingo-row')?.textContent`)) ?? ''
  );
  await c.shot('ga-bingo');

  /* ================= F. 回执文案 ================= */
  console.log('\n[回执] 0x97/0x03 + 0x9D');
  await c.ev('__MU_APP__.injectGaRegisterLucky(0)');
  await sleep(300);
  check('登记成功文案', /成功/.test(await c.ev(`document.querySelector('.ga-toast')?.textContent`) ?? ''));
  await c.ev('__MU_APP__.injectGaRegisterLucky(3)');
  await sleep(300);
  check('号码不正确文案', /不正确/.test(await c.ev(`document.querySelector('.ga-toast')?.textContent`) ?? ''));
  await c.ev('__MU_APP__.injectGaExchangeLucky(0)');
  await sleep(300);
  check('领奖成功文案', /恭喜/.test(await c.ev(`document.querySelector('.ga-toast')?.textContent`) ?? ''));
  await c.ev('__MU_APP__.injectGaExchangeLucky(2)');
  await sleep(300);
  check('没登记过号码文案', /没有登记/.test(await c.ev(`document.querySelector('.ga-toast')?.textContent`) ?? ''));
  check('formatLucky 补齐', (await c.ev(`__MU_APP__.gaFormatLucky('abc123')`)) === 'ABC123');

  /* ================= G. 关闭 ================= */
  console.log('\n[关闭] 发 0x31');
  const beforeClose = c.logs.length;
  await c.ev('__MU_APP__.gaClose()');
  await sleep(500);
  check('关闭发 0x31', c.logs.slice(beforeClose).some(l => l.includes('[ga] 0x31 关闭')));
  check('窗口已关', (await c.ev('__MU_APP__.goldenArcher().open')) === false);

  /* ================= H. 真链路 ================= */
  console.log('\n[真链路] 洛兰黄金弓箭手 236 (130,127)');
  // 先造一件雷娜（14,21 = 469，level 0）
  await c.ev(`__MU_APP__.chat('/make 14 21 0')`);
  await sleep(1500);
  const inv = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.inventory())'));
  const rena = inv.find(i => i.type === 469 && i.level === 0);
  check('GM 造出雷娜 469 (level 0)', !!rena, rena ? `slot ${rena.slot} dur ${rena.durability}` : '背包里没有');
  check('客户端数到了背包里的雷娜', (await ga()).collected.rena > 0, `${(await ga()).collected.rena}`);

  /*
   * `/gmove` 有服务端冷却（`CommandManager` 的 Delay），撞上会被**静默丢弃**。
   * 而且角色可能刚登录在别的地图（Devias），换图本身要一两秒。所以重试几次。
   */
  let landed = false;
  for (let attempt = 0; attempt < 4 && !landed; attempt++) {
    await c.ev(`__MU_APP__.chat('/gmove ${who.name} 0 131 128')`);
    landed = await until(
      `(() => { const s = __MU_APP__.state(); return s.mapId === 0 && s.player && Math.hypot(s.player.x - 130, s.player.y - 127) < 5; })()`,
      20000,
      `第 ${attempt + 1} 次 /gmove`
    );
    if (!landed) await sleep(1500);
  }
  check(
    '落在黄金弓箭手旁边',
    landed === true,
    JSON.stringify(await c.ev('__MU_APP__.state().player')) + ` map=${await c.ev('__MU_APP__.state().mapId')}`
  );

  const before94 = c.logs.length;
  await c.ev('__MU_APP__.talkClass(236)');
  await until('__MU_APP__.goldenArcher().open === true', 12000, '0x94 打开窗口');
  check(
    '对话 236 → 服务端回 0x94（不是 0x30）',
    c.logs.slice(before94).some(l => l.includes('[ga] 0x94 打开')),
    c.logs.filter(l => l.includes('[ga]')).slice(-1)[0] ?? '（没收到）'
  );
  const real = await ga();
  check('真窗口打开', real.open === true, `type=${real.type} count=${real.count}`);
  check('洛兰 → type=0（雷娜收集器）', real.type === 0, `${real.type}`);
  check('真配置包 0x97/0x00 已到达', !!real.info, JSON.stringify(real.info));

  // 真点「登记雷娜」
  const regBtn = real.buttons.findIndex(b => b.text === '登记雷娜');
  if (regBtn >= 0) {
    const before95 = c.logs.length;
    await c.ev(`document.querySelectorAll('.ga-box')[${regBtn}].click()`);
    await sleep(1500);
    check(
      '真点登记 → 发 0x95',
      c.logs.slice(before95).some(l => l.includes('[ga] 0x95 登记'))
    );
    check(
      '服务端回了 0x95 count',
      c.logs.slice(before95).some(l => l.includes('[ga] 0x95 回执')),
      c.logs.filter(l => l.includes('[ga] 0x95')).slice(-1)[0] ?? ''
    );
    const after = await ga();
    check('已登记数 +1', after.count === real.count + 1, `${real.count} → ${after.count}`);
    check('背包里的雷娜 -1', after.collected.rena === real.collected.rena - 1, `${real.collected.rena} → ${after.collected.rena}`);
  } else {
    check('找到「登记雷娜」按钮', false, real.buttons.map(b => b.text).join('|'));
  }
  await c.shot('ga-real');

  // 收尾：关窗口回城中心
  await c.ev('__MU_APP__.gaClose()');
  await sleep(500);
  await c.ev(`__MU_APP__.chat('/gmove ${who.name} 0 133 131')`).catch(() => {});
  await sleep(3000);

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error('ERR', e.message);
  console.log(c.logs.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  await c.close();
}
