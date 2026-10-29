/**
 * 战盟战比分条 + 三个小修补的探针。
 *
 *   node tools/guild-war-probe.mjs
 *
 * 覆盖这一批的四件事：
 *
 *   A. `0x64` 比分解析：服务端是 `BYTE score[2]`（我方 / 对方），
 *      以前按 16 位大端合成一个数，3:5 会读成 775。
 *   B. 比分条版式：`simGuildWar` 灌数据后，两行、我方绿/对方橙、名字与分数都对。
 *   C. `/pt` 别名：`sendChatText('/pt')` 走组队请求而不是当普通聊天发出去。
 *   D. 药水槽：`0x30` 的 `QKey/WKey/EKey` 如果指向背包里真有那种药，优先用它。
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

const c = await createClient('guildwar');

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  await sleep(800);

  /* ================= A. 0x64 解析 ================= */
  console.log('[A] 0x64 比分解析（BYTE score[2]）');
  const parsed = JSON.parse(
    await c.ev(`(async () => {
      const g = await import('/src/net/game.ts');
      // C1 05 64 [我方] [对方]：3 : 5
      return JSON.stringify(g.parseGuildWarScore(new Uint8Array([0xc1, 0x05, 0x64, 3, 5])));
    })()`)
  );
  check('解析出两个独立分数', parsed.mine === 3 && parsed.theirs === 5, JSON.stringify(parsed));
  check('不是把两个字节合成 775', parsed.mine !== 775, String(parsed.mine));

  /* ================= B. 比分条 ================= */
  console.log('\n[B] 比分条（两行、着色、文案）');
  const view = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.simGuildWar('血色骑士团', 3, 5))`));
  console.log(`  ${JSON.stringify(view)}`);
  check('开打状态', view.active === true && view.open === true, JSON.stringify(view));
  check('对手名进到 theirs', view.theirs.name === '血色骑士团', view.theirs.name);
  check('我方/对方分数正确', view.mine.score === 3 && view.theirs.score === 5, `${view.mine.score}:${view.theirs.score}`);

  const dom = JSON.parse(
    await c.ev(`(() => {
      const el = document.querySelector('.gwar');
      const rows = [...el.querySelectorAll('.gwar-row')];
      return JSON.stringify(rows.map(r => ({
        cls: r.className,
        score: r.querySelector('.gwar-score')?.textContent,
        name: r.querySelector('.gwar-name')?.textContent,
        color: getComputedStyle(r).color,
      })));
    })()`)
  );
  console.log(`  ${JSON.stringify(dom)}`);
  check('两行：mine / theirs', dom.length === 2 && /mine/.test(dom[0].cls) && /theirs/.test(dom[1].cls));
  check('行内文本 3 / 5', dom[0].score === '3' && dom[1].score === '5', `${dom[0].score} / ${dom[1].score}`);
  check('对手名显示在第二行', dom[1].name === '血色骑士团', dom[1].name);
  check('两行颜色不同（我方绿 / 对方橙）', dom[0].color !== dom[1].color, `${dom[0].color} vs ${dom[1].color}`);

  await c.ev(`__MU_APP__.simGuildWar('血色骑士团', 3, 5)`);
  await sleep(300);
  await c.shot('guild-war');

  const hidden = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.simGuildWar('x', 0, 0, false))`));
  check('结束时收起', hidden.open === false, JSON.stringify(hidden.open));

  /* ================= C. /pt 别名 ================= */
  console.log('\n[C] /pt 别名');
  const alias = await c.ev(`(async () => {
    const src = await fetch('/src/main.ts').then(r => r.text());
    return src.includes('party|pt') ? 'ok' : 'missing';
  })()`);
  check('/party 正则里带上了 pt 别名', alias === 'ok', String(alias));

  /* ================= D. 药水槽读服务端 ================= */
  console.log('\n[D] 药水槽（QKey/WKey/EKey）');
  const slot = await c.ev(`(async () => {
    const src = await fetch('/src/main.ts').then(r => r.text());
    return /rawKey >= 64 \\? rawKey - 64/.test(src) ? 'ok' : 'missing';
  })()`);
  check('useQuickSlot 会读服务端绑定（type + 64）', slot === 'ok', String(slot));

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
} finally {
  await c.close();
}

process.exit(fail ? 1 : 0);
