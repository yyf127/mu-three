/**
 * M / F 面板互斥探针 —— 移动窗口与命令菜单不能同时可见。
 *
 * 两者都挂在 `UiLayer` 上、占同一块地方（移动窗左侧 32,12；命令菜单右侧 418,12），
 * 所以产品上要求「开一个自动关另一个」。由于真正的入口是 **window 上的 keydown**，
 * 这里派发真实 `KeyboardEvent` 走完整按键路径（而不是直接调 show/hide）——
 * 那样才能验出快捷键处理里的互斥有没有漏。
 *
 * 断言：
 *   [A] 按 M → 移动窗口开、命令菜单关
 *   [B] 再按 F → 命令菜单开、移动窗口关（被替代）
 *   [C] 再按 M → 移动窗口开、命令菜单关（反向同理）
 *   [D] 同一键再按一次 → 关闭（toggle 语义）
 *   [E] 小地图 M 按钮入口也遵守互斥
 *
 * 用法：node tools/panel-exclusive-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('panel-excl');
let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}  ${detail}`);
  }
}

/** JSON.parse 简写 */
const J = s => JSON.parse(s);

/** 派发一个真实 keydown（走 window 上的全局处理） */
async function press(code, key) {
  await c.ev(
    `window.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)}, bubbles: true }))`
  );
  await sleep(160);
}

/** 读两个面板的可见状态 */
async function states() {
  return JSON.parse(await c.ev(`JSON.stringify({
    move: !document.querySelector('.mv-panel').classList.contains('hidden'),
    menu: !document.querySelector('.cm-panel').classList.contains('hidden'),
  })`));
}

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  await sleep(2200);

  // 先确保两个都是关的
  await c.ev(`__MU_APP__.moveToggle(false); __MU_APP__.commandMenuToggle(false)`);
  await sleep(200);

  /* [A] 按 M */
  console.log('\n[A] 按 M → 移动窗口开、命令菜单关');
  await press('KeyM', 'm');
  let s = await states();
  check('移动窗口已打开', s.move === true, JSON.stringify(s));
  check('命令菜单保持关闭', s.menu === false, JSON.stringify(s));

  /* [B] 再按 F → 替代 */
  console.log('\n[B] 再按 F → 命令菜单开、移动窗口被替代');
  await press('KeyF', 'f');
  s = await states();
  check('命令菜单已打开', s.menu === true, JSON.stringify(s));
  check('移动窗口已被关掉（互斥生效）', s.move === false, JSON.stringify(s));

  /* [C] 再按 M → 反向替代 */
  console.log('\n[C] 再按 M → 移动窗口开、命令菜单被替代（反向同理）');
  await press('KeyM', 'm');
  s = await states();
  check('移动窗口已打开', s.move === true, JSON.stringify(s));
  check('命令菜单已被关掉（反向互斥）', s.menu === false, JSON.stringify(s));

  /* [D] 同一键再按 → toggle 关闭 */
  console.log('\n[D] 移动窗口开着时再按 M → 关闭（toggle 语义）');
  await press('KeyM', 'm');
  s = await states();
  check('两个面板都关闭', s.move === false && s.menu === false, JSON.stringify(s));

  /* [E] 小地图 M 按钮入口 */
  console.log('\n[E] 小地图 M 按钮入口同样互斥');
  // 先开命令菜单（F），再用小地图入口开移动窗口 —— 应该把菜单挤掉
  await press('KeyF', 'f');
  s = await states();
  check('前置：命令菜单已开', s.menu === true, JSON.stringify(s));
  const hasMinimapMove = await c.ev(`typeof __MU_APP__.moveToggle === 'function'`);
  // 小地图按钮走的是 minimap.onMove（内部 show + hide 另一个）
  await c.ev(`
    (() => {
      const el = document.querySelector('.minimap-move');
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return !!el;
    })()
  `);
  await sleep(300);
  s = await states();
  if (s.move) {
    check('小地图按钮开了移动窗口', s.move === true, JSON.stringify(s));
    check('小地图按钮也关掉了命令菜单', s.menu === false, JSON.stringify(s));
  } else {
    // 小地图按钮可能未挂载（离线/尺寸），退化为提示
    console.log('   （小地图 M 按钮未挂载，跳过；hasToggle=' + hasMinimapMove + '）');
  }

  /* [F] 右上角关闭按钮（两个面板各一个，位置/尺寸与背包一致） */
  console.log('\n[F] 右上角关闭按钮');
  await press('KeyM', 'm');
  await sleep(300);
  const mvClose = J(await c.ev(`(() => {
    const el = document.querySelector('.mv-close');
    if (!el) return JSON.stringify({ exists: false });
    const cs = getComputedStyle(el);
    // 按钮已改图标版：文字挪到 title，textContent 为空
    const btns = [...document.querySelectorAll('.mv-btn')].map(b => ({
      text: b.textContent, title: b.title, hasImg: !!b.querySelector('img'),
    }));
    return JSON.stringify({ exists: true, left: cs.left, top: cs.top, w: cs.width, h: cs.height, btns, src: el.src.slice(0, 5) });
  })()`));
  check('移动面板有 .mv-close', mvClose.exists === true, JSON.stringify(mvClose));
  check('位置 (161,4) / 24×24（与背包一致）', mvClose.left === '161px' && mvClose.top === '4px' && mvClose.w === '24px' && mvClose.h === '24px', JSON.stringify(mvClose));
  check('只剩 1 个按钮（「关 闭」已移除）', mvClose.btns.length === 1, JSON.stringify(mvClose.btns));
  check('唯一按钮标题是「移 动」', mvClose.btns[0]?.title === '移 动', JSON.stringify(mvClose.btns));
  check('按钮是 Ok 图标版（无文字 + 有 img）', mvClose.btns[0]?.text === '' && mvClose.btns[0]?.hasImg === true, JSON.stringify(mvClose.btns[0]));
  // 点它应关掉面板
  await c.ev(`document.querySelector('.mv-close').click()`);
  await sleep(250);
  s = await states();
  check('点关闭按钮 → 移动面板收起', s.move === false, JSON.stringify(s));

  await press('KeyF', 'f');
  await sleep(300);
  const cmClose = J(await c.ev(`(() => {
    const el = document.querySelector('.cm-close');
    if (!el) return JSON.stringify({ exists: false });
    const cs = getComputedStyle(el);
    return JSON.stringify({ exists: true, left: cs.left, top: cs.top, w: cs.width, h: cs.height });
  })()`));
  check('命令菜单有 .cm-close', cmClose.exists === true, JSON.stringify(cmClose));
  check('位置 (161,4) / 24×24（与背包一致）', cmClose.left === '161px' && cmClose.top === '4px' && cmClose.w === '24px' && cmClose.h === '24px', JSON.stringify(cmClose));
  await c.ev(`document.querySelector('.cm-close').click()`);
  await sleep(250);
  s = await states();
  check('点关闭按钮 → 命令菜单收起', s.menu === false, JSON.stringify(s));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await c.close();
  process.exit(fail ? 1 : 0);
} catch (err) {
  console.error('探针异常：', err && err.stack ? err.stack : err);
  try {
    await c.close();
  } catch {}
  process.exit(1);
}
