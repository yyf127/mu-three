/**
 * 战盟探针（0x50–0x64）。
 *
 *   node tools/guild-probe.mjs
 *   node tools/guild-probe.mjs 账号 密码
 *
 * 单人环境做不了「会长 + 申请人」两方对话，所以分两层：
 *
 *   A. **注入层**：`injectGuildList` 造一条**带对齐填充**的 C2 0x52 长包
 *      （成员表在 +16，这个偏移错了名字就整体错 5 字节），走 `parseGuildList`
 *      同一条路径；再验创建框、入盟申请条、0x5C 盟名。
 *   B. **真服务端**：0x52 拉表（没盟时 result=0）、0x54 开创建框（服务端按
 *      等级/转身放行 → 回 3 字节 0x55）、0x55 用**非法名字**触发 0x56 的
 *      服务端校验（不会往数据库写东西，探针可以反复跑）、0x53 带错个人码。
 *
 * 为什么要用非法名字而不是真建一个盟：建了就要解散，解散要账号个人码，
 * 探针拿不到；留一个垃圾战盟在库里更糟。
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

const c = await createClient('guild');
const g = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.guild())'));
const view = async () => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.guildView())'));
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

try {
  const who = await loginAs(c, account, password);
  console.log(`进图：${who.name} map=${who.mapId}`);
  await sleep(2000);

  /* ================= A. 面板与注入层 ================= */
  console.log('\n[面板] 打开 / 关闭 / 互斥');
  const opened = await c.ev('__MU_APP__.toggleGuild()');
  check('战盟窗口打开', opened === true);
  const pos = JSON.parse(
    await c.ev(`JSON.stringify((() => { const el = document.querySelector('.guild-panel'); return { l: el.style.left, t: el.style.top }; })())`)
  );
  check('面板在 (450,0)（原版 RenderGuildList(450,0)）', pos.l === '450px' && pos.t === '0px', `${pos.l},${pos.t}`);

  const noGuild = await g();
  check('初始没有战盟', noGuild.count === 0 && noGuild.myGuild === null);

  // 背包和战盟抢同一个位置 → 必须互斥
  await c.ev('__MU_APP__.toggleInventory()');
  await sleep(400);
  check('开背包会关掉战盟窗口', (await c.ev('__MU_APP__.guild().open')) === false);
  await c.ev('__MU_APP__.toggleGuild()');
  await sleep(400);

  console.log('\n[0x52] 成员表（+16 对齐填充）');
  const v1 = JSON.parse(
    await c.ev(
      `JSON.stringify(__MU_APP__.injectGuildList([
        { name: 'GuildMaster', master: true },
        { name: '${who.name}', connected: true },
        { name: 'OfflineGuy', connected: false }
      ], 1234, 56))`
    )
  );
  check('成员 3 人', v1.count === 3, JSON.stringify(v1.members));
  const st1 = await g();
  check('会长标记（名字带 *）', st1.members.some(m => m.startsWith('*')));
  check('离线成员标记 (off)', st1.members.some(m => m.endsWith('(off)')));
  check('总分 1234 / 贡献 56', st1.totalScore === 1234 && st1.playScore === 56, `${st1.totalScore}/${st1.playScore}`);

  console.log('\n[0x5C] 自己的盟名 → 标题');
  const vp = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.injectGuildViewport(__MU_APP__.state().selfId, 'TestGuild'))`));
  check('0x5C 命中自己', vp.self === true);
  const v2 = await view();
  check('标题变成「TestGuild (Score:1234)」', /TestGuild \(Score:1234\)/.test(v2.title), v2.title);

  console.log('\n[0x50 / 0x51] 入盟申请与应答');
  const v3 = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.injectGuildRequest('Applicant01', 0x7e01))`));
  check('申请条显示申请人', v3.request && v3.request.name === 'Applicant01', JSON.stringify(v3.request));
  const answered = await c.ev('__MU_APP__.guildAnswer(true)');
  await sleep(600);
  check('接受申请 → 发 0x51', answered === true && c.logs.some(l => l.includes('[guild] 0x51 接受')));
  check('应答后申请条清掉', (await g()).request === null);

  console.log('\n[0x54/0x55/0x56] 创建框');
  const v4 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.injectGuildCreateOpen())'));
  check('创建框打开', v4.creating === true);
  const marks = new Array(64).fill(0);
  marks[0] = 12;
  marks[9] = 4;
  marks[63] = 15;
  await c.ev(`__MU_APP__.guildCreate('ProbeGuild', ${JSON.stringify(marks)})`);
  await sleep(600);
  check('点确定 → 发 0x55（名字 + 32 字节标志）', c.logs.some(l => l.includes('[guild] 0x55 创建战盟 name=ProbeGuild')));
  await c.ev('__MU_APP__.guildCancelCreate()');
  await sleep(400);
  check('取消 → 发 0x57', c.logs.some(l => l.includes('[guild] 0x57')));
  const v5 = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.injectGuildCreateResult(1, 'ProbeGuild'))`));
  check('0x56 成功 → 创建框关闭 + 提示', v5.creating === false && /创建成功/.test(v5.toast ?? ''), v5.toast);

  /* ================= B. 真服务端 ================= */
  console.log('\n[真链路] 0x52 / 0x54 / 0x55 / 0x56');
  // 先把注入的状态清掉，回到「无战盟」
  await c.ev('__MU_APP__.injectGuildList([])');
  await c.ev(`__MU_APP__.injectGuildViewport(__MU_APP__.state().selfId, '')`);
  await c.ev('__MU_APP__.guildRefresh()');
  await sleep(1200);
  const real = await g();
  check(
    '0x52 真回执到达',
    c.logs.some(l => l.includes('[guild] 0x52 成员')),
    `成员 ${real.count} 人：${real.members.join(' ')}`
  );

  if (real.count === 0) {
    check('无战盟 → 0x52 result=0 / 0 人', real.count === 0, `总分 ${real.totalScore}（无盟时这个字段是脏值，界面不显示）`);
  } else {
    /*
     * 测试号如果本来就在战盟里，成员表 / master 位 / 盟名（0x5C）都能用真数据验。
     */
    check('自己就是会长（成员名带 *）', real.members.some(m => m === `*${who.name}`), real.members[0] ?? '');
    // 0x5C 一定会在登录后到一次（自己的盟名 + 标志）。盟名可能为空串
    // （服务端 `Guild->Name` 为空），所以判「收到过」而不是「名字非空」。
    check('0x5C 收到过自己的战盟信息', real.sawSelfViewport === true, `盟名「${real.myGuild ?? ''}」`);
    const title = (await view()).title;
    check('标题显示「盟名 (Score:N)」', title.includes('(Score:'), title);
  }

  // 0x54：服务端按 m_GuildCreateMinLevel / MinReset 决定放不放行
  await c.ev('__MU_APP__.guildOpenCreate()');
  const allowed = await until('__MU_APP__.guild().creating === true', 8000, '0x55 允许创建').catch(
    () => false
  );
  if (real.count > 0) {
    console.log(
      `  · 0x54 跳过：角色已在战盟「${real.myGuild}」里（服务端只对无盟角色放行创建）`
    );
  } else {
    check(
      '0x54 → 服务端回 0x55 允许创建',
      allowed === true,
      allowed ? '' : '（等级/转身不够，服务端不回包，属正常）'
    );
  }

  if (allowed) {
    // 用 1 个字符的名字：服务端在本地就判掉（result=2），不会写数据库
    await c.ev(`__MU_APP__.guildCreate('X', ${JSON.stringify(new Array(64).fill(0))})`);
    const got = await until(
      `__MU_APP__.guildView().toast.includes('2~8') || JSON.stringify(__MU_APP__.guildView()).includes('创建失败')`,
      8000,
      '0x56 建盟失败回执'
    ).catch(() => false);
    check('0x55 非法名字（1 字符）→ 0x56 服务端拒绝', got === true, (await view()).toast ?? '');
    await c.ev('__MU_APP__.guildCancelCreate()').catch(() => {});
  }

  // 0x53：带错误的个人码，服务端应回 result≠1 而不是静默丢弃
  await c.ev(`__MU_APP__.guildDelete('${who.name}', '0000000')`);
  const replied = await until(
    `JSON.stringify(__MU_APP__.chatLines().lines).includes('战盟操作')`,
    6000,
    '0x53 回执'
  ).catch(() => false);
  check('0x53 错误个人码 → 服务端回执（不静默）', replied === true);

  // /guild：附近没人时应给出提示
  await c.ev(`__MU_APP__.chat('/guild')`);
  await sleep(800);
  const tail = (await lines()).slice(-1)[0] ?? '';
  check('/guild 附近没人 → 提示走到会长面前', /附近 3 格内没有玩家/.test(tail), tail);

  const alive = await c.ev(`__MU_APP__.state().screen === 'game'`);
  check('全程连接未断', alive === true);

  /* ================= C. 截图 ================= */
  await c.ev('__MU_APP__.injectGuildList([{name:"GuildMaster",master:true},{name:"' + who.name + '"},{name:"OfflineGuy",connected:false}], 1234, 56)');
  await c.ev(`__MU_APP__.injectGuildViewport(__MU_APP__.state().selfId, '${(await g()).myGuild || 'TestGuild'}')`);
  await sleep(800);
  await c.shot('guild-panel');
  await c.ev('__MU_APP__.injectGuildCreateOpen()');
  await sleep(600);
  await c.shot('guild-create');
  check('截图已保存 shots/guild-panel.png / guild-create.png', true);

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error('ERR', e.message);
  console.log(c.logs.slice(-20).join('\n'));
  process.exitCode = 1;
} finally {
  await c.close();
}
