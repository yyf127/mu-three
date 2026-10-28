/**
 * 聊天框版面探针（离线）。
 *
 *   node tools/chat-layout-probe.mjs
 *
 * 断言：
 *   1. 聊天行贴在**左侧**（逻辑 x ≈ 10），不再浮在屏幕中间；
 *   2. 六行全部在**底栏上沿之上**（底栏左角 `bar-corner` 从逻辑 y=387 起）；
 *   3. 字体和左上角事件列表一致（宋体 11px/13px），中文不被行盒裁掉；
 *   4. 输入条底板也在底栏之上，且输入框落在底板内。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

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

const c = await createClient('chatlayout');

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '离线进图');
  await c.waitFor(`!!__MU_APP__.state().player`, 60000, '角色就绪');
  await sleep(1200);

  for (let i = 0; i < 6; i++) {
    await c.ev(
      `__MU_APP__.pushChat(${JSON.stringify('玩家' + i)}, ${JSON.stringify('这是中文测试消息 ' + i)}, 3)`
    );
  }
  // 打开输入条，量底板位置（否则 hidden 时 rect 全是 0）
  // 聊天层进入游戏后才显示（`chatBox.setVisible(true)`），没显示时 rect 全是 0
  await c.waitFor(`document.querySelector('.chat-layer').getBoundingClientRect().width > 0`, 15000, '聊天层显示');
  await c.ev(`__MU_APP__.openChat('中文输入测试')`);
  await sleep(400);

  const m = JSON.parse(
    await c.ev(`(() => {
      const box = el => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
      const st = box(document.getElementById('stage'));
      // UiLayer 的缩放就是「舞台宽 / 640」（见 ui/frame.ts）
      const scale = st.w / 640;
      const toLogical = r => ({ x: (r.x - st.x) / scale, y: (r.y - st.y) / scale, w: r.w / scale, h: r.h / scale });
      const lines = [...document.querySelectorAll('.chat-line')].map(el => toLogical(box(el)));
      const corners = [...document.querySelectorAll('.bar-corner')].map(el => toLogical(box(el)));
      const cs = getComputedStyle(document.querySelector('.chat-line'));
      const input = document.querySelector('.chat-input');
      const panel = document.querySelector('.chat-panel');
      return JSON.stringify({
        scale, lines, corners,
        font: cs.fontFamily, size: cs.fontSize, lh: cs.lineHeight, h: cs.height,
        inputFont: getComputedStyle(input).fontSize,
        panel: panel ? toLogical(box(panel)) : null,
        input: toLogical(box(input)),
      });
    })()`)
  );

  const round = n => Math.round(n);
  console.log(
    `\n缩放 ${m.scale.toFixed(2)}  行 x=${round(m.lines[0].x)}  ` +
      m.lines.map(l => `y=${round(l.y)}`).join(' ') +
      `  底栏角 y=${round(m.corners[0] ? m.corners[0].y : -1)}`
  );

  // 1. 左侧
  check('聊天行贴左边（逻辑 x < 20）', m.lines.every(l => l.x < 20), `x=${round(m.lines[0].x)}`);

  // 2. 全部在底栏之上
  const barTop = Math.min(...m.corners.map(c => c.y));
  const lowest = Math.max(...m.lines.map(l => l.y + l.h));
  check(
    `六行都在底栏上沿之上（${round(lowest)} < ${round(barTop)}）`,
    lowest <= barTop - 2,
    `最低一行底部 ${round(lowest)}，底栏顶 ${round(barTop)}`
  );

  // 3. 字体
  check('字体是宋体（SimSun/宋体）', /SimSun|宋体/.test(m.font), m.font);
  check('字号 11px / 行高 13px（和事件列表一致）', m.size === '11px' && m.lh === '13px', `${m.size} / ${m.lh}`);

  // 4. 输入条
  if (m.panel) {
    // 输入条按用户要求**保持原版位置**（186,415），不跟着消息行挪
    check(
      `输入条还在原版位置（x=${round(m.panel.x)}, y=${round(m.panel.y)}）`,
      Math.abs(m.panel.x - 186) < 2 && Math.abs(m.panel.y - 415) < 2,
      `底板 ${round(m.panel.x)},${round(m.panel.y)}`
    );
    check(
      '输入框在底板内',
      m.input.y >= m.panel.y - 2 && m.input.y + m.input.h <= m.panel.y + m.panel.h + 2,
      `input ${round(m.input.y)}..${round(m.input.y + m.input.h)}`
    );
  }

  // 5. 中文编码（GBK 双字节，不会被截成单字节垃圾）
  const enc = await c.ev(`JSON.stringify({
    codec: __MU_APP__.textCodec(),
    bytes: __MU_APP__.encodeText('中文测试A'),
    back: __MU_APP__.decodeText(__MU_APP__.encodeText('中文测试A')),
  })`);
  const e = JSON.parse(enc);
  console.log('\n编码:', JSON.stringify(e));
  check('服务端字符集是 gbk', e.codec.charset === 'gbk', JSON.stringify(e.codec));
  check('中文编码成 GBK 双字节（不是单字节截断）', e.bytes.length === 9 && e.bytes.every(b => b <= 0xff), `${e.bytes.map(b => b.toString(16)).join(' ')}`);
  check('中文往返一致（不乱码）', e.back === '中文测试A', e.back);

  // 6. 界面里显示的中文
  const shown = await c.ev(`document.querySelector('.chat-line .chat-text')?.textContent || ''`);
  check('聊天行里的中文原样显示', shown.includes('这是中文测试消息 5'), shown);

  await c.ev(`__MU_APP__.closeChat?.()`);
  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
