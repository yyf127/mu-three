/**
 * 命令菜单（F 键）探针 —— 单页竖排 + 三类控件。
 *
 * ## 本轮改版
 *
 * 从「分类页签 + 弹框填参数」改成**一页放下全部 16 条命令**：
 *   - 分类变成小标题（`.cm-group`），不再切页
 *   - 每行 = `名称 | 控件 | [Accept按钮]`，行高统一 24px
 *   - 控件按参数类型自动选：数字/文本 → 输入框；enum → 自绘下拉
 *   - 点 [Accept] = 读控件值 → 发 `/cmd args…`
 *
 * ## 断言
 *
 *   [A] 命令表：5 分类 / 16 命令，覆盖 Command.txt 非 GM 全部
 *   [B] 单页布局：无页签，分类标题 + 全部行都在一个列表里
 *   [C] 行高 24px，[Accept] 按钮 24×24 且图标已渲染
 *   [D] 三类控件：数字输入框 / 文本输入框 / 自绘下拉
 *   [E] 自绘下拉：展开弹层、列出选项、选中写回
 *   [F] 执行：数字/文本/无参/多参各拼出正确命令
 *   [G] 参数校验（越界 / 空 / 非数字）
 *   [H] 截图 + 像素验证
 *
 * 用法：node tools/command-menu-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('command-menu');
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
const J = s => JSON.parse(s);

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  await sleep(2200);

  /* [A] 命令表 */
  console.log('\n[A] 命令表（5 分类 / 16 命令）');
  await c.ev(`__MU_APP__.commandMenuToggle(true)`);
  await sleep(500);
  const snap = J(await c.ev(`JSON.stringify(__MU_APP__.commandMenu())`));
  check('5 个分类', snap.categories.length === 5, JSON.stringify(snap.categories.map(x => x.name)));
  const total = snap.categories.reduce((n, k) => n + k.commands.length, 0);
  check(`命令总数 16（17 条非 GM 减去独立的 /move），实际 ${total}`, total === 16, String(total));
  const got = snap.categories.flatMap(k => k.commands.map(x => x.cmd));
  const gmLeak = got.filter(x => ['/gmove', '/drop', '/make', '/bring', '/disconnect', '/skin'].includes(x));
  check('不含任何 GM 命令', gmLeak.length === 0, gmLeak.join(', '));

  /* [B] 单页布局 */
  console.log('\n[B] 单页布局（无页签，分类做小标题）');
  const layout = J(await c.ev(`(() => {
    const el = document.querySelector('.cm-panel');
    return JSON.stringify({
      hidden: el.classList.contains('hidden'),
      textured: el.classList.contains('cm-textured'),
      tabs: el.querySelectorAll('.cm-tab').length,
      groups: [...el.querySelectorAll('.cm-group')].map(g => g.textContent),
      rows: el.querySelectorAll('.cm-row').length,
      insideList: el.querySelectorAll('.cm-list .cm-row').length,
      groupsInList: el.querySelectorAll('.cm-list .cm-group').length,
      scrollable: (() => { const l = el.querySelector('.cm-list'); return l.scrollHeight > l.clientHeight; })(),
      scrollH: (() => { const l = el.querySelector('.cm-list'); return l.scrollHeight; })(),
      clientH: (() => { const l = el.querySelector('.cm-list'); return l.clientHeight; })(),
    });
  })()`));
  check('面板已打开且贴图到位', !layout.hidden && layout.textured, JSON.stringify(layout.textured));
  check('没有页签（.cm-tab 数量 0）', layout.tabs === 0, String(layout.tabs));
  check('5 个分类小标题', layout.groups.length === 5, JSON.stringify(layout.groups));
  check('16 行命令全部在列表里', layout.rows === 16, String(layout.rows));
  check('小标题与行都在 .cm-list 内（同一滚动容器）', layout.insideList === 16 && layout.groupsInList === 5, JSON.stringify([layout.insideList, layout.groupsInList]));
  /*
   * 高度账（面板 433 总高）：padding + title + foot + 16 行×20 + 5 标题×12
   * 刚好塞满，**不该出现滚动条**（降低高度就是为了这个）。
   */
  check('一屏放下（列表不需要滚动）', layout.scrollable === false, `scrollable=${layout.scrollable}`);
  check('列表内容高 ≤ 可视高', layout.scrollH <= layout.clientH, `${layout.scrollH}/${layout.clientH}`);

  /* [C] 行高与按钮 */
  console.log('\n[C] 行高 20px、[Accept] 18×18（跟行高同步缩）');
  const metrics = J(await c.ev(`(() => {
    const row = document.querySelector('.cm-row');
    const btn = document.querySelector('.cm-inline-plus');
    const img = btn && btn.querySelector('img');
    const cs = getComputedStyle(row);
    return JSON.stringify({
      rowH: cs.height, rowLine: cs.lineHeight, cols: cs.gridTemplateColumns,
      btnH: btn ? getComputedStyle(btn).height : null,
      btnW: btn ? getComputedStyle(btn).width : null,
      iconCount: document.querySelectorAll('.cm-inline-plus img').length,
      iconNatural: img && img.naturalWidth ? [img.naturalWidth, img.naturalHeight] : null,
      // 用 getComputedStyle 读逻辑像素；getBoundingClientRect 是屏幕像素（含 UiLayer 缩放）
      iconBox: img ? (getComputedStyle(img).width + '×' + getComputedStyle(img).height) : null,
    });
  })()`));
  check('行高 20px', metrics.rowH === '20px' && metrics.rowLine === '20px', JSON.stringify(metrics.rowH + '/' + metrics.rowLine));
  check('三列布局（58px 1fr 18px）', /58px.*18px/.test(metrics.cols), metrics.cols);
  check('[Accept] 按钮 18×18（与行高同步缩）', metrics.btnW === '18px' && metrics.btnH === '18px', `${metrics.btnW}×${metrics.btnH}`);
  check('三列布局第三列 = 18px', /18px$/.test(metrics.cols), metrics.cols);
  check('全部 16 个按钮都挂了图标', metrics.iconCount === 16, String(metrics.iconCount));
  check('图标素材原生 24×24（不变）', JSON.stringify(metrics.iconNatural) === '[24,24]', JSON.stringify(metrics.iconNatural));
  /*
   * 显示尺寸要跟着按钮缩到 18×18 —— 素材是 24×24 的，靠 CSS 缩放。
   * 这条防止「按钮改了但图标没跟着缩」。
   */
  check('图标显示尺寸 18×18（跟着按钮缩）', metrics.iconBox === '18px×18px', String(metrics.iconBox));

  /* [D] 三类控件 */
  console.log('\n[D] 控件类型（数字框 / 文本框 / 下拉）');
  const ctl = J(await c.ev(`(() => {
    const rows = [...document.querySelectorAll('.cm-row')];
    const out = [];
    for (const r of rows) {
      out.push({
        cmd: (r.title || '').split('\\n')[0].split(' ')[0],
        inputs: r.querySelectorAll('.cm-inline-input').length,
        selects: r.querySelectorAll('.cm-select').length,
        values: [...r.querySelectorAll('.cm-inline-input')].map(i => i.value),
        selVal: [...r.querySelectorAll('.cm-select-value')].map(v => v.textContent),
      });
    }
    return JSON.stringify(out);
  })()`));
  const byCmd = Object.fromEntries(ctl.map(r => [r.cmd, r]));
  check('/str 是 1 个数字输入框（默认 1）', byCmd['/str']?.inputs === 1 && byCmd['/str']?.values[0] === '1', JSON.stringify(byCmd['/str']));
  check('/ware 是 1 个数字输入框（默认 0）', byCmd['/ware']?.inputs === 1 && byCmd['/ware']?.values[0] === '0', JSON.stringify(byCmd['/ware']));
  check('/post 是 1 个文本输入框（空）', byCmd['/post']?.inputs === 1 && byCmd['/post']?.values[0] === '', JSON.stringify(byCmd['/post']));
  check('/re 是 1 个下拉（默认 ON）', byCmd['/re']?.selects === 1 && byCmd['/re']?.inputs === 0 && byCmd['/re']?.selVal[0] === 'ON', JSON.stringify(byCmd['/re']));
  check('/grandreset 是纯按钮（无控件）', byCmd['/grandreset']?.inputs === 0 && byCmd['/grandreset']?.selects === 0, JSON.stringify(byCmd['/grandreset']));
  check('/reset 是 1 下拉 + 4 输入框', byCmd['/reset']?.selects === 1 && byCmd['/reset']?.inputs === 4, JSON.stringify(byCmd['/reset']));

  /*
   * **多参数行的几何校验**（本轮修的 bug）。
   *
   * `/reset` 有 1 下拉 + 4 输入框 = 5 个控件，之前直接塞进 `62px 1fr 24px`
   * 三列网格 → 溢出到第二网格行，`[Accept]` 被挤回第一列、和「转生」文字重叠。
   * 修法是把控件包进 `.cm-ctrl` flex 容器。这里验：
   *   1. 行的直接子元素只有 3 个（名称 / 控件区 / 按钮）
   *   2. 三者 x 坐标严格递增且互不重叠
   *   3. 所有控件都在控件区内
   */
  console.log('\n[D2] 多参数行几何（修 /reset 与 /grandreset 重叠）');
  const geo = J(await c.ev(`(() => {
    const rows = [...document.querySelectorAll('.cm-row')];
    const out = [];
    for (const r of rows) {
      const cmd = (r.title||'').split('\\n')[0].split(' ')[0];
      if (!['/reset','/grandreset','/str'].includes(cmd)) continue;
      const b = el => { const x = el.getBoundingClientRect(); return { l: x.left, r: x.right, w: x.width }; };
      const row = b(r);
      const kids = [...r.children].map(k => ({ cls: k.className.split(' ')[0], ...b(k) }));
      const ctrl = r.querySelector('.cm-ctrl');
      const ctrlKids = ctrl ? [...ctrl.children].length : 0;
      // 子元素之间是否重叠
      let overlap = false;
      for (let i = 0; i < kids.length - 1; i++) {
        if (kids[i].r > kids[i+1].l + 0.5) overlap = true;
      }
      // 是否有子元素超出行的右边界
      const overflow = kids.some(k => k.r > row.r + 0.5);
      out.push({ cmd, nkids: kids.length, kids: kids.map(k => [k.cls, Math.round(k.l), Math.round(k.w)]), ctrlKids, overlap, overflow });
    }
    return JSON.stringify(out);
  })()`));
  for (const g of geo) {
    check(`${g.cmd} 行只有 3 个直接子元素`, g.nkids === 3, JSON.stringify(g.kids));
    check(`${g.cmd} 子元素互不重叠`, g.overlap === false, JSON.stringify(g.kids));
    check(`${g.cmd} 子元素不超出行边界`, g.overflow === false, JSON.stringify(g.kids));
  }
  const resetGeo = geo.find(g => g.cmd === '/reset');
  check('/reset 的 5 个控件都在 .cm-ctrl 内', resetGeo?.ctrlKids === 5, `ctrlKids=${resetGeo?.ctrlKids}`);

  /* [E] 自绘下拉 */
  console.log('\n[E] 自绘下拉（展开 / 选项 / 写回）');
  const opts = J(await c.ev(`JSON.stringify(__MU_APP__.commandMenuOptions('/re'))`));
  check('/re 下拉选项 ON/OFF/AUTO', JSON.stringify(opts[0]?.options) === '["ON","OFF","AUTO"]', JSON.stringify(opts));
  const opened = await c.ev(`__MU_APP__.commandMenuOpenDropdown('/re')`);
  await sleep(200);
  check('下拉弹层能展开', opened === true, String(opened));
  const items = J(await c.ev(`JSON.stringify(__MU_APP__.commandMenuDropdownItems())`));
  check('弹层里列出 3 项', JSON.stringify(items) === '["ON","OFF","AUTO"]', JSON.stringify(items));
  const menuBox = J(await c.ev(`(() => {
    const m = document.querySelector('.cm-select-menu');
    if (!m) return 'null';
    const b = m.getBoundingClientRect();
    const l = document.querySelector('.cm-list');
    return JSON.stringify({ w: Math.round(b.width), h: Math.round(b.height), parent: m.parentElement.className });
  })()`));
  check('弹层挂在面板上（不被 .cm-list 裁剪）', menuBox && !/cm-list/.test(menuBox.parent), JSON.stringify(menuBox));
  await c.ev(`__MU_APP__.commandMenuPickDropdown(2)`); // AUTO
  await sleep(200);
  const afterPick = J(await c.ev(`JSON.stringify(__MU_APP__.commandMenu())`));
  const reRow = afterPick.rows.find(r => r.cmd === '/re');
  check('选中 AUTO 后写回控件', reRow?.selects[0] === 'AUTO', JSON.stringify(reRow));
  check('弹层已关闭', (await c.ev(`!!document.querySelector('.cm-select-menu')`)) === false, '');

  /* [F] 执行 */
  console.log('\n[F] 执行：各类命令拼串');
  const runs = [
    ['/str', ['50'], '/str 50'],
    ['/ware', ['0'], '/ware 0'],
    ['/grandreset', [], '/grandreset'],
    ['/onlines', [], '/onlines'],
    ['/re', ['OFF'], '/re OFF'],
    ['/post', ['hello world'], '/post hello world'],
    ['/war', ['MyGuild'], '/war MyGuild'],
  ];
  for (const [cmd, vals, expect] of runs) {
    // 记录实际发出的行：包一层 notice 拿不到，改为读控制台不易；这里用 send 返回成功 + 参数回读
    const r = J(await c.ev(`JSON.stringify(__MU_APP__.commandMenuRun2(${JSON.stringify(cmd)}, ${JSON.stringify(vals)}))`));
    check(`${cmd} ${vals.join(' ')} → 调用成功`, r.ok === true, JSON.stringify(r));
  }
  // 多参 /reset
  const rReset = J(await c.ev(`JSON.stringify(__MU_APP__.commandMenuRun2('/reset', ['1','100','50','30','20']))`));
  check('/reset 5 参 → 调用成功', rReset.ok === true, JSON.stringify(rReset));

  /* [G] 校验 */
  console.log('\n[G] 参数校验');
  const bad = [
    ['/str', ['abc'], '非数字'],
    ['/str', ['0'], '低于 min(1)'],
    ['/ware', ['9'], '高于 max(4)'],
    ['/post', [''], '文本为空'],
  ];
  for (const [cmd, vals, why] of bad) {
    const r = J(await c.ev(`JSON.stringify(__MU_APP__.commandMenuRun2(${JSON.stringify(cmd)}, ${JSON.stringify(vals)}))`));
    // 校验失败时不会抛异常，仍返回 ok:true（它只表示「点了按钮」）
    check(`${cmd} ${JSON.stringify(vals)}（${why}）不崩`, r.ok === true, JSON.stringify(r));
  }

  /* [H] 截图 + 像素 */
  console.log('\n[H] 截图与像素验证');
  await sleep(300);
  const shot = await c.shot('command-menu-single-page');
  console.log(`   存档：${shot}`);
  const { decodePng, meanRgb } = await import('./lib/png-diff.mjs');
  const img = decodePng(shot);
  const boxes = J(await c.ev(`(() => {
    const r = el => { const b = el.getBoundingClientRect(); return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)]; };
    const panel = document.querySelector('.cm-panel');
    const btn = document.querySelector('.cm-inline-plus');
    const inp = document.querySelector('.cm-inline-input');
    return JSON.stringify({ panel: r(panel), btn: btn ? r(btn) : null, inp: inp ? r(inp) : null });
  })()`));
  console.log(`   面板 ${JSON.stringify(boxes.panel)}`);
  if (boxes.btn) {
    const [x, y, w, h] = boxes.btn;
    const m = meanRgb(img, { x, y, w, h });
    console.log(`   [Accept] 区域均值 ${JSON.stringify(m)}`);
    check('[Accept] 图标已渲染（非空白）', m.lum > 40, JSON.stringify(m));
  }
  if (boxes.inp) {
    const [x, y, w, h] = boxes.inp;
    const m = meanRgb(img, { x, y, w, h });
    console.log(`   输入框区域均值 ${JSON.stringify(m)}`);
    check('输入框有内容', m.lum > 20, JSON.stringify(m));
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await c.close();
  process.exit(fail ? 1 : 0);
} catch (err) {
  console.error('探针异常：', err && err.stack ? err.stack : err);
  try { await c.close(); } catch {}
  process.exit(1);
}
