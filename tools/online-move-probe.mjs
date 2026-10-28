/**
 * 在线移动诊断：真实登录服务端，点地面走位，采样「本地格 / 上报状态 / 服务端回显 / 纠偏」。
 *
 *   node tools/online-move-probe.mjs
 *
 * 关键要看的三列：
 *   cell  = floor(本地坐标) —— 角色实际在的格
 *   sent  = 服务端认为我们所在的格（下一包的起点）
 *   out   = 已走但没上报的步数（应该一直是 0 或 1）
 * 三者同步、selfMoveLog 里没有「纠偏」，就说明上报链路是对的。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { makeProfile } from './lib/profile.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9700 + Math.floor(Math.random() * 100);
const account = process.argv[2] || '1234';
const password = process.argv[3] || '1234';
const charName = process.argv[4] || account;

mkdirSync('shots', { recursive: true });

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${makeProfile('omove')}`,
    '--window-size=1280,960',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let ws;
let id = 0;
const pend = new Map();
const logs = [];
const send = (m, p = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description } : r.result.value;
};
const waitFor = async (expr, ms = 120000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if ((await ev(expr)) === true) return true;
    await sleep(300);
  }
  return false;
};

/** 一次采样：本地坐标、所在格、上报状态、该格地形属性 */
const sample = async () => {
  const raw = await ev(`JSON.stringify((() => {
    const p = __MU__.player;
    const mi = __MU_APP__.moveInfo();
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    const attr = __MU__.terrain ? __MU__.terrain.data.attribute[cy * 256 + cx] : -1;
    return { x: p.x, y: p.y, cx, cy, attr, mi, moves: __MU_APP__.state().remoteDebug.selfMoves };
  })())`);
  return JSON.parse(raw);
};

try {
  let targets = null;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await r.json();
      if (targets?.length) break;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  ws.addEventListener('message', e => {
    const d = JSON.parse(e.data);
    if (d.id && pend.has(d.id)) {
      const { res, rej } = pend.get(d.id);
      pend.delete(d.id);
      d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result);
      return;
    }
    if (d.method === 'Runtime.consoleAPICalled') {
      logs.push((d.params.args || []).map(a => a.value ?? a.description ?? '').join(' '));
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:5180/' });
  await waitFor('!!window.__MU_APP__', 25000);

  console.log(`登录 ${account}/${password} …`);
  await ev(`__MU_APP__.login(${JSON.stringify(account)}, ${JSON.stringify(password)})`);
  if (!(await waitFor(`__MU_APP__.state().screen === 'charselect'`, 40000))) {
    throw new Error('角色列表超时：' + JSON.stringify(await ev('JSON.stringify(__MU_APP__.state?.() ?? {})')));
  }
  console.log('角色数:', await ev('__MU_APP__.characters()'));

  await ev(`__MU_APP__.select(${JSON.stringify(charName)})`);
  if (!(await waitFor(`__MU_APP__.state().screen === 'game'`, 120000))) throw new Error('进图超时');
  await sleep(2500);

  const st0 = JSON.parse(await ev('JSON.stringify(__MU_APP__.state())'));
  console.log(
    '进图:',
    JSON.stringify({ map: st0.mapName, player: st0.player, selfId: st0.selfId, ent: st0.remotes.length })
  );
  console.log('实体:', JSON.stringify(st0.remotes.map(r => `${r.kind}:${r.name}@${r.x},${r.y}`)));
  console.log('初始 moveInfo:', JSON.stringify(await ev('JSON.stringify(__MU_APP__.moveInfo())')));

  const runWalk = async (label, tx0, ty0, frames = 70) => {
    let tx = tx0;
    let ty = ty0;
    console.log(`\n=== ${label}：走到 (${tx},${ty}) ===`);
    let len = await ev(`__MU_APP__.pathTo(${tx}, ${ty})`);
    if (len < 0) {
      // 目标是建筑/墙里：打印原因，再退到最近的可站格继续测（原版也是「能走到哪算哪」）
      const info = JSON.parse(
        await ev(
          `JSON.stringify({attr: __MU__.terrain.data.attribute[${ty} * 256 + ${tx}], ok: __MU_APP__.canStand(${tx}, ${ty})})`
        )
      );
      console.log(`  目标不可达：attr=${info.attr}（含 4/8 即墙）canStand=${info.ok}`);
      const alt = JSON.parse(
        await ev(`(() => {
          for (let r = 1; r <= 6; r++)
            for (let dy = -r; dy <= r; dy++)
              for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                if (__MU_APP__.canStand(${tx} + dx, ${ty} + dy)) return JSON.stringify({x: ${tx} + dx, y: ${ty} + dy});
              }
          return 'null';
        })()`)
      );
      if (!alt) {
        console.log('  半径 6 内无可站格，跳过该段');
        return null;
      }
      tx = alt.x;
      ty = alt.y;
      console.log(`  → 改用最近的站得住的格 (${tx},${ty}) 继续测`);
      len = await ev(`__MU_APP__.pathTo(${tx}, ${ty})`);
    }
    console.log('A* 路径长度:', len);
    const ok = await ev(`__MU_APP__.walkTo(${tx}, ${ty})`);
    if (!ok) console.log('  !! walkTo 返回 false —— 没有任何可走的路径');
    console.log('出发时 moveInfo:', JSON.stringify(await ev('JSON.stringify(__MU_APP__.moveInfo())')));

    const trail = [];
    let corrections = 0;
    for (let i = 0; i < frames; i++) {
      await sleep(150);
      const s = await sample();
      const cell = `${s.cx},${s.cy}`;
      if (trail[trail.length - 1]?.cell !== cell) {
        trail.push({ cell, sent: `${s.mi.sentCell.x},${s.mi.sentCell.y}`, out: s.mi.outSteps, moves: s.moves });
      }
      if (s.mi.len === 0 && s.mi.outSteps === 0 && Math.hypot(s.x - tx, s.y - ty) > 1.2) {
        // 停住了
        break;
      }
    }
    const s = await sample();
    const ml = JSON.parse(await ev('JSON.stringify(__MU_APP__.selfMoveLog())'));
    corrections = ml.length;
    console.log('轨迹(格|sent|out):', trail.map(t => `${t.cell}|${t.sent}|${t.out}`).join(' → '));
    console.log(
      `终点 ${s.x.toFixed(2)},${s.y.toFixed(2)} 格(${s.cx},${s.cy}) attr=${s.attr}  ` +
        `距目标 ${Math.hypot(s.x - tx, s.y - ty).toFixed(2)}  selfMoves=${s.moves}  纠偏次数=${corrections}`
    );
    console.log('selfMoveLog:', JSON.stringify(ml));
    console.log('netLog:', JSON.stringify(await ev('JSON.stringify(__MU_APP__.netLog())')));
    console.log('报文头:', JSON.stringify(await ev('JSON.stringify(__MU_APP__.state().heads)')));
    console.log('末态 moveInfo:', JSON.stringify(s.mi));
    return s;
  };

  const p0 = st0.player;
  // 先离开出生点，避免被 NPC 的占位干扰
  const a = await runWalk('东移 6 格', Math.round(p0.x) + 6, Math.round(p0.y), 50);
  await sleep(500);
  const base1 = a ? { x: a.x, y: a.y } : { x: p0.x, y: p0.y };
  const b = await runWalk('再往南 6 格', Math.round(base1.x), Math.round(base1.y) + 6, 60);
  await sleep(500);
  const base2 = b ? { x: b.x, y: b.y } : base1;
  await runWalk('斜向 5 格', Math.round(base2.x) + 5, Math.round(base2.y) - 5, 70);
  await sleep(500);

  // 走向 NPC（应该停在相邻格）
  const npcs = (await ev('JSON.stringify(__MU_APP__.state().remotes.filter(r => r.kind === "npc"))')) || '[]';
  const npcList = JSON.parse(npcs);
  console.log('\n视野内 NPC:', JSON.stringify(npcList.map(n => `${n.name}@${n.x},${n.y}`)));
  if (npcList[0]) {
    const n = npcList[0];
    await runWalk('走向 NPC', n.x, n.y, 60);
    const after = await sample();
    // 用格心（+0.5）算距离，格号直接相减会偏半格
    console.log(
      `NPC 脚下 canStand=${await ev(`__MU_APP__.canStand(${n.x}, ${n.y})`)}（应为 false）` +
        `，最终距 NPC ${Math.hypot(after.x - (n.x + 0.5), after.y - (n.y + 0.5)).toFixed(2)} 格` +
        `（≥1 才没穿模）`
    );
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shots/online-move.png', Buffer.from(shot.data, 'base64'));

  console.log('\n--- 页面日志 ---');
  console.log(logs.slice(-10).join('\n'));

  await ev('__MU_APP__.close()');
  await sleep(500);
} catch (e) {
  console.error('ERR', e.message);
  if (logs.length) console.log(logs.slice(-12).join('\n'));
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  edge.kill();
  await sleep(200);
  process.exit(0);
}
