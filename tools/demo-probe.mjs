/**
 * 离线演示页（`/demo`）的全流程探针。
 *
 *   node tools/demo-probe.mjs
 *
 * 走的是和用户手点一样的一条路：
 *
 *   选线路（假列表） → 账号密码 → 角色选择 → 进入游戏
 *
 * 全程**不连任何服务端**（ConnectServer 44405 / GameServer 55901 都不碰），
 * 所以这个探针在没起 MuServer 的机器上也能跑 —— 正是后面挂 GitHub Pages
 * 要做的事。
 *
 * 断言：
 *   1. `/demo` 能打开，`__MU_APP__.isDemo()` 为 true
 *   2. 选线路：出现「MU 演示服」两列，点组 → 点线路 → 进账号面板
 *   3. 账号密码：随便填 → 进选角，列表里 4 个「演示·XX」
 *   4. 选角：点第一只 → 点 OK → 进图（`mapId === 0`）
 *   5. 游戏内 ESC：5 项菜单（文案 = Text.bmd[381..385]）→ 再按 ESC 关 →
 *      「回到选择角色画面」→ 选角
 *   6. 选角 ESC：3 项（返回线路选择 / 选项 / 取消）→ 回选线路
 *   7. 再进一次游戏：ESC「结束游戏」、账号面板「结束游戏」都回选线路
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

/**
 * 地址可传：`node tools/demo-probe.mjs http://127.0.0.1:5180/mu-three/demo`
 * （不带参数就是 dev server 根路径下的 `/demo`）。
 */
const TARGET = process.argv[2] || 'http://127.0.0.1:5180/demo';
const c = await createClient('demo', { url: TARGET });
const ev = e => c.ev(e);
const shot = async f => {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(r.data, 'base64');
  if (f) writeFileSync(f, buf);
  return buf;
};
const click = async (x, y) => {
  await c.ptr('mouseMoved', x, y, { buttons: 0 });
  console.log(
    '    [diag] 命中',
    await ev(`(() => { const el = document.elementFromPoint(${x}, ${y});
      return el ? el.tagName + '.' + (el.className || '') + '『' + (el.textContent || '').trim().slice(0, 10) + '』' : 'null'; })()`)
  );
  await c.ptr('mousePressed', x, y);
  await sleep(40);
  await c.ptr('mouseReleased', x, y);
};

let pass = 0;
let fail = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  ok ? pass++ : fail++;
};

try {
  await c.waitFor(`!!window.__MU_APP__`, 30000, 'app');
  console.log('\n[1] /demo');
  check(await ev(`__MU_APP__.isDemo()`), 'isDemo() = true');
  const here = await ev(`location.pathname`);
  // dev 是 /demo，preview / GH Pages 是 <base>demo（/mu-three/demo）
  check(/\/demo$/.test(here), `路径 = ${here}`);

  /* ---------------- 选线路 ---------------- */
  console.log('\n[2] 选线路（假列表）');
  // 启动画面会吃掉第一次 pointerdown（"点一下跳过"），等它收掉再点
  await c.waitFor(`document.getElementById('intro').classList.contains('hidden')`, 12000, '启动画面收掉');
  for (let i = 0; i < 20 && !(await ev(`document.querySelectorAll('#sv-list .sv-row').length > 0`)); i++) await sleep(400);
  const rows = JSON.parse(
    await ev(`JSON.stringify([...document.querySelectorAll('#sv-list .sv-row:not([data-code])')].map(el => el.textContent.trim()))`)
  );
  console.log('   线路：', JSON.stringify(rows));
  check(rows.length >= 2, `${rows.length} 个服务器组`);
  check(rows.join(' ').includes('MU 演示服'), '组名来自演示假列表（不再等 ConnectServer）');
  await shot('shots/demo-1-servers.png');

  const g0 = await c.center('#sv-list .sv-row:not([data-code])');
  await click(g0.x, g0.y);
  await sleep(400);
  const chans = JSON.parse(
    await ev(`JSON.stringify([...document.querySelectorAll('#sv-list .sv-row[data-code]')].map(el => el.textContent.trim()))`)
  );
  console.log('   子线路：', JSON.stringify(chans));
  check(chans.length >= 1, `展开 ${chans.length} 条线路`);
  await shot('shots/demo-2-channels.png');

  const ch0 = await c.center('#sv-list .sv-row[data-code]');
  await click(ch0.x, ch0.y);
  await sleep(800);
  check((await ev(`__MU_APP__.state().loginStage`)) === 'account', '选完线路 → 账号密码面板');

  /* ---------------- 账号密码 ---------------- */
  console.log('\n[3] 账号密码');
  const quitLabel = await ev(`document.getElementById('btn-quit').textContent`);
  console.log('   第二个按钮文案：', JSON.stringify(quitLabel));
  check(quitLabel.trim().length > 0 && quitLabel !== '离线演示', '「离线演示」已换成 Text.bmd 的「' + quitLabel + '」');

  await ev(`(() => {
    document.getElementById('login-account').value = 'demo';
    document.getElementById('login-password').value = 'demo';
    document.getElementById('btn-login').click();
  })()`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 60000, '选角');
  await sleep(2500);
  const names = JSON.parse(
    await ev(`JSON.stringify([...document.querySelectorAll('.char-card')].map(el => el.textContent.trim()))`)
  );
  console.log('   角色：', JSON.stringify(names));
  check(names.length === 4, `4 个演示角色`);
  check(names.join(' ').includes('演示·'), '角色名是演示数据');
  await shot('shots/demo-3-charselect.png');

  /* ---------------- 进游戏 ---------------- */
  console.log('\n[4] 进入游戏');
  await ev(`(() => { const b = document.querySelector('.char-card'); b && b.click(); })()`);
  await sleep(500);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);
  const tLoad = Date.now();
  await c.waitFor(`__MU_APP__.state().mapId !== null`, 300000, '进图');
  console.log(`   进图（mapId 就绪）：${((Date.now() - tLoad) / 1000).toFixed(1)}s`);
  // 线上（GH Pages 冷启动）mapId 先到，角色和贴图还在加载：等读条真正收掉
  // （读条期间世界里还会 `showScreens({hud:true})`，那一下会把 ESC 菜单顶掉）
  await c.waitFor(`document.getElementById('loading').classList.contains('hidden')`, 300000, '读条结束');
  console.log(`   读条收完：${((Date.now() - tLoad) / 1000).toFixed(1)}s`);
  await c.waitFor(`!!__MU_APP__.state().player`, 180000, '角色就位');
  await sleep(800);
  const st = JSON.parse(await ev(`JSON.stringify(__MU_APP__.state())`));
  console.log('   进图：', JSON.stringify({ screen: st.screen, map: st.mapName, pos: st.player, level: st.level }));
  check(st.mapId === 0, `地图 = ${st.mapName}`);
  check(st.player && st.player.x > 0, `角色在 (${st.player?.x}, ${st.player?.y})`);
  check(await ev(`__MU_APP__.sandbox().on`), '离线沙盘已开启（装备由沙盘决定）');
  await shot('shots/demo-4-ingame.png');

  /* ---------------- ESC 菜单（演示模式也要同步） ---------------- */
  console.log('\n[5] 演示模式 ESC 菜单（游戏内）');
  const escKey = async () => {
    await c.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    await c.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    });
    await sleep(260);
  };
  const escOf = async () => JSON.parse(await ev(`JSON.stringify(__MU_APP__.esc())`));
  /**
   * 按文案点 ESC 菜单里的某一项。
   * 三个 esc-box（主菜单 / 选角 / 选项）的按钮都在 DOM 里，必须按可见性过滤 ——
   * 而且不能用「第一个可见按钮」猜，线上曾经因为拿错盒子点了没反应。
   */
  /**
   * 按文案点 ESC 菜单里的某一项。
   *
   * 三个 esc-box（主菜单 / 选角 / 选项）的按钮都在 DOM 里，按文案 + 可见性过滤。
   * 可见性用 `getClientRects().length`，不用 `offsetParent` —— 后者在祖先带
   * `transform`/`filter`、或者菜单刚被外部 `hide()` 时会是 null，线上就这样踩过一次。
   * 找不到就补一次 ESC 再找（加载中的读条/世界就绪会把菜单顶掉），最后把诊断打出来。
   */
  const clickEsc = async label => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await ev(`(() => {
        const all = [...document.querySelectorAll('#esc-menu .esc-btn')];
        const vis = all.filter(e => e.getClientRects().length > 0);
        const b = vis.find(e => e.textContent.trim() === ${JSON.stringify(label)});
        if (b) { b.click(); return 'ok'; }
        return JSON.stringify({
          total: all.length,
          vis: vis.map(e => e.textContent.trim()),
          rootHidden: document.getElementById('esc-menu').classList.contains('hidden'),
          open: __MU_APP__.esc().open,
        });
      })()`);
      if (r === 'ok') return true;
      if (attempt === 0) {
        await escKey();
        await sleep(300);
        continue;
      }
      return r;
    }
    return 'no-attempt';
  };

  await escKey();
  let esc = await escOf();
  const labels = esc.items.map(i => i.label);
  console.log('   菜单文案：', JSON.stringify(labels));
  check(esc.open && esc.mode === 'game', '游戏内按 ESC 弹出菜单（mode=game）');
  check(esc.items.length === 5, `5 个按钮（${esc.items.length}）`);
  // 文案必须来自 Text.bmd 的 381..385，而不是硬编码
  const want = [];
  for (const i of [381, 382, 383, 385, 384]) want.push((await ev(`__MU_APP__.text(${i})`)).text);
  console.log('   Text.bmd：', JSON.stringify(want));
  check(want.every(t => labels.includes(t)), '按钮文案与 Text.bmd[381..385] 一致');
  await shot('shots/demo-5-esc.png');

  // ESC 再按一次 = toggle 关掉（原版行为）
  await escKey();
  esc = await escOf();
  check(!esc.open, '再按 ESC 关闭菜单');

  // 点「回到选择角色画面」
  await escKey();
  const clickChar = await clickEsc(want[2]);
  check(clickChar === true, `点「回到选择角色画面」（${clickChar === true ? 'ok' : clickChar}）`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 20000, '回选角');
  check((await escOf()).open === false, '离开游戏后菜单收起');

  /* ---------------- 选角 ESC（演示模式） ---------------- */
  console.log('\n[6] 选角 ESC 菜单（返回线路选择）');
  await escKey();
  esc = await escOf();
  console.log('   菜单文案：', JSON.stringify(esc.items.map(i => i.label)));
  check(esc.open && esc.mode === 'charselect', '选角按 ESC 弹出 3 项菜单');
  check(esc.items.length === 3 && esc.items[0].label === '返回线路选择', '第一项 = 返回线路选择');
  const clickBack = await clickEsc('返回线路选择');
  await sleep(900);
  check(clickBack === true, `点「返回线路选择」（${clickBack === true ? 'ok' : clickBack}）`);
  check((await ev(`__MU_APP__.state().loginStage`)) === 'servers', '返回线路选择 → 选线路');
  check(
    (await ev(`document.querySelectorAll('#sv-list .sv-row:not([data-code])').length`)) >= 2,
    '线路列表重新可点'
  );

  /* ---------------- 回游戏 → ESC「结束游戏」 ---------------- */
  console.log('\n[7] 再进一次游戏 → ESC 结束游戏');
  const g2 = await c.center('#sv-list .sv-row:not([data-code])');
  if (g2) await click(g2.x, g2.y);
  await sleep(400);
  const ch2 = await c.center('#sv-list .sv-row[data-code]');
  if (ch2) await click(ch2.x, ch2.y);
  await sleep(700);
  check((await ev(`__MU_APP__.state().loginStage`)) === 'account', '再次进到账号面板');
  // 账号面板上的「结束游戏」按钮：回线路选择
  const quit = await c.center('#btn-quit');
  if (quit) await click(quit.x, quit.y);
  await sleep(800);
  check((await ev(`__MU_APP__.state().loginStage`)) === 'servers', '点「结束游戏」按钮 → 选线路');

  const g3 = await c.center('#sv-list .sv-row:not([data-code])');
  if (g3) await click(g3.x, g3.y);
  await sleep(400);
  const ch3 = await c.center('#sv-list .sv-row[data-code]');
  if (ch3) await click(ch3.x, ch3.y);
  await sleep(700);
  await ev(`(() => {
    document.getElementById('login-account').value = 'demo';
    document.getElementById('login-password').value = 'demo';
    document.getElementById('btn-login').click();
  })()`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 60000, '选角（第二次）');
  await sleep(1500);
  await ev(`(() => { const b = document.querySelector('.char-card'); b && b.click(); })()`);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);
  await c.waitFor(`__MU_APP__.state().mapId !== null`, 300000, '进图（第二次）');
  await sleep(2000);
  await escKey();
  esc = await escOf();
  check(esc.open && esc.mode === 'game', '第二次进图后 ESC 仍能弹菜单');
  const clickExit = await clickEsc(want[0]);
  await sleep(1200);
  const stageAfter = await ev(`__MU_APP__.state().loginStage`);
  if (clickExit !== true || stageAfter !== 'servers') {
    console.log('   [diag] 点击结果:', clickExit, '| esc:', JSON.stringify(await escOf()));
  }
  check(stageAfter === 'servers', `ESC「结束游戏」→ 选线路（loginStage=${stageAfter}）`);
  check(
    (await ev(`document.querySelectorAll('#sv-list .sv-row:not([data-code])').length`)) >= 2,
    '线路列表重新可见'
  );

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  const errs = c.logs.filter(l => l.includes('[exc]') || l.includes('[error]'));
  if (errs.length) {
    console.log('\n--- 页面错误 ---');
    console.log(errs.slice(0, 10).join('\n'));
  }
  await c.close();
}
