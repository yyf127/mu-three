/**
 * 登录界面「对齐」探针：把 DOM 元素的实际位置换算回 640×480 逻辑坐标，
 * 跟 `Scene_Login.cpp` 的原版坐标逐条对比，差多少一眼就能看出来。
 *
 *   node tools/login-align-probe.mjs              # 打印 + 截图 shots/login-align.png
 *   node tools/login-align-probe.mjs --shot=xx    # 换截图名
 *
 * 期望值怎么来的（`dialogY` 取 132 垂直居中）：
 *   面板   195,132 250×216
 *   账号   文字 RenderText(227, y+50) → 输入框凹槽 x99..220 y48..63（相对面板）
 *   密码   文字 RenderText(227, y+72) → 输入框凹槽 y70..85
 *   OK     323,227 70×19      取消 285,312 70×20
 * 所以元素盒 = 面板左上 + 相对坐标，文字再往里偏 1~2px（左内边距 1、行高居中 2）。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const shotArg = process.argv.find(a => a.startsWith('--shot='));
const shotName = shotArg ? shotArg.split('=')[1] : 'login-align';

const DIALOG_Y = 132;
const PANEL = { x: 195, y: DIALOG_Y };

/** [名字, 选择器, 期望元素盒, 原版文字落点(可选)] */
const CASES = [
  ['面板', '#mu-account-panel', { x: 195, y: DIALOG_Y, w: 250, h: 216 }],
  ['账号 label', '#login .mu-acc-label', { x: 227, y: 180 }, { x: 227, y: 182 }],
  ['账号 input', '#login-account', { x: 294, y: 180, w: 122, h: 16 }, { x: 295, y: 182 }],
  ['密码 label', '#login .mu-pw-label', { x: 227, y: 202 }, { x: 227, y: 204 }],
  ['密码 input', '#login-password', { x: 294, y: 202, w: 122, h: 16 }, { x: 295, y: 204 }],
  ['OK 按钮', '#btn-login', { x: 323, y: 227, w: 70, h: 19 }],
  ['结束游戏按钮', '#btn-quit', { x: 285, y: 312, w: 70, h: 20 }],
];

const c = await createClient('login-align', {
  width: Number(process.env.MU_W || 1280),
  height: Number(process.env.MU_H || 760),
});
let fails = 0;
try {
  await c.waitFor(`!!document.getElementById('mu-account-panel')`, 20000, '登录面板');
  /*
   * 登录现在是两步（先选线路再账号密码），面板在第 2 步才显示。
   * 这一步直接切到 account —— 量的是「账号面板本身的对齐」，
   * 和走不走网络无关（`__MU_APP__.loginStage()` 就是 `showLoginStage`）。
   */
  await c.ev(`__MU_APP__.loginStage('account')`);
  // 启动画面（`#intro`）是盖在最上面的一层，还在淡出时 `elementFromPoint`
  // 命中的是它 —— 量对齐跟它无关，直接收掉
  await c.ev(`(() => { const el = document.getElementById('intro'); if (el) el.classList.add('hidden'); })()`);
  await sleep(1200); // 等 Logo 贴图注入 + 逻辑层 scale

  const raw = await c.ev(`(() => {
    const st = document.getElementById('stage').getBoundingClientRect();
    const k = st.width / 640;
    const layer = document.getElementById('login-layer');
    const g = sel => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        x: +((b.left - st.left) / k).toFixed(1),
        y: +((b.top - st.top) / k).toFixed(1),
        w: +(b.width / k).toFixed(1),
        h: +(b.height / k).toFixed(1),
        bg: cs.backgroundSize,
        img: cs.backgroundImage === 'none' ? '' : 'has',
        fs: cs.fontSize,
        padL: cs.paddingLeft,
      };
    };
    const out = { stage: { w: st.width, h: st.height }, layer: layer ? layer.style.transform : '', items: {} };
    for (const s of ${JSON.stringify(CASES.map(c => c[1]))}) {
      const g0 = g(s);
      if (g0) {
        const el = document.querySelector(s);
        const b = el.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        g0.hit = hit === el || el.contains(hit) ? 'ok' : (hit?.id || hit?.className || 'other');
      }
      out.items[s] = g0;
    }
    return JSON.stringify(out);
  })()`);

  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data || !data.stage) {
    console.log('读取失败：', raw);
  } else {
    console.log(`舞台 ${data.stage.w.toFixed(0)}×${data.stage.h.toFixed(0)}  逻辑层 ${data.layer}\n`);
    for (const [name, sel, want, text] of CASES) {
      const a = data.items[sel];
      if (!a) {
        console.log(`${name.padEnd(10)} 缺失`);
        fails++;
        continue;
      }
      const dx = a.x - want.x;
      const dy = a.y - want.y;
      const dw = want.w === undefined ? 0 : a.w - want.w;
      const dh = want.h === undefined ? 0 : a.h - want.h;
      const bad = Math.abs(dx) > 1 || Math.abs(dy) > 1 || Math.abs(dw) > 1 || Math.abs(dh) > 1;
      if (bad) fails++;
      const size = want.w === undefined ? '' : ` ${want.w}×${want.h}`;
      const hitBad = name !== '面板' && a.hit !== 'ok';
      if (hitBad) fails++;
      console.log(
        `${bad || hitBad ? '✗' : '✓'} ${name.padEnd(10)} 期望 ${want.x},${want.y}${size}  实际 ${a.x},${a.y} ${a.w}×${a.h}` +
          `  d=(${dx},${dy})${a.fs ? `  font=${a.fs}` : ''}` +
          (name === '面板' ? '' : `  命中=${a.hit}`) +
          (text ? `  文字落点 ${a.x + (a.padL === '1px' ? 1 : 0)},${a.y + 2} ≈ ${text.x},${text.y}` : '')
      );
    }
    console.log(fails ? `\n${fails} 处对不齐` : '\n全部对齐');
  }

  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`shots/${shotName}.png`, Buffer.from(shot.data, 'base64'));
  console.log(`已保存 shots/${shotName}.png`);
} finally {
  await c.close();
}
if (fails) process.exitCode = 1;
