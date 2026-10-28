/**
 * 寻路验证：A* 绕墙、绕 NPC 占位、点击 NPC 脚下会自动落到相邻空格。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeProfile } from './lib/profile.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9450 + Math.floor(Math.random() * 100);
const profile = makeProfile('path');
mkdirSync(profile, { recursive: true });
mkdirSync('shots', { recursive: true });

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
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
const waitFor = async (expr, ms = 180000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if ((await ev(expr)) === true) return true;
    await sleep(400);
  }
  return false;
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

  await ev('__MU_APP__.loadMap(0, 133, 131)');
  if (!(await waitFor(`__MU_APP__.state().screen === 'game'`, 180000))) throw new Error('载入超时');
  await sleep(2500);

  const npcs = JSON.parse(
    await ev(
      `JSON.stringify((__MU__.monsters || []).filter(m => m.kind === 'npc')
        .map(m => ({ name: m.name, x: Math.round(m.x), y: Math.round(m.y) })))`
    )
  );
  const mons = JSON.parse(
    await ev(
      `JSON.stringify((__MU__.monsters || []).filter(m => m.kind === 'monster')
        .map(m => ({ name: m.name, x: Math.round(m.x), y: Math.round(m.y) })))`
    )
  );
  console.log('NPC:', JSON.stringify(npcs));
  console.log('怪物:', JSON.stringify(mons));

  const player = JSON.parse(await ev('JSON.stringify(__MU_APP__.state().player)'));
  console.log('玩家:', player);

  // 1) NPC 格本身不可站
  for (const n of npcs) {
    const ok = await ev(`__MU_APP__.canStand(${n.x}, ${n.y})`);
    const free = await ev(`__MU_APP__.canStand(${n.x + 1}, ${n.y})`);
    console.log(`NPC 占位 ${n.name}(${n.x},${n.y}): canStand=${ok}（应为 false），旁边 (${n.x + 1},${n.y})=${free}`);
  }

  // 2) 贴着 NPC 走：路径里不能出现 NPC 的格子
  const npc = npcs[0];
  if (npc) {
    const straight = Math.hypot(npc.x - player.x, npc.y - player.y);
    const pathLen = await ev(`__MU_APP__.pathTo(${npc.x}, ${npc.y})`);
    const dest = await ev(
      `JSON.stringify((() => {
        const r = __MU_APP__.pathToRaw ? null : null;
        return null;
      })())`
    );
    void dest;
    console.log(`走到 NPC 脚下 (${npc.x},${npc.y})：路径长 ${pathLen}（直线 ${straight.toFixed(1)}）`);
  }

  // 3) 真正走一次，采样轨迹，确认没穿过 NPC/怪物格
  const goal = npcs[0] ?? mons[0];
  if (goal) {
    const blocked = new Set([...npcs, ...mons].map(o => `${o.x},${o.y}`));
    await ev(`__MU_APP__.walkTo(${goal.x}, ${goal.y})`);

    const trail = [];
    let through = null;
    for (let i = 0; i < 80; i++) {
      const p = JSON.parse(await ev('JSON.stringify(__MU_APP__.state().player)'));
      const cell = `${Math.round(p.x)},${Math.round(p.y)}`;
      if (trail[trail.length - 1] !== cell) trail.push(cell);
      if (blocked.has(cell)) through = cell;
      const done = Math.hypot(p.x - goal.x, p.y - goal.y) < 1.9;
      if (done) break;
      await sleep(200);
    }
    console.log('轨迹:', trail.join(' → '));
    console.log('是否穿过被占格:', through ?? '否');

    const end = JSON.parse(await ev('JSON.stringify(__MU_APP__.state().player)'));
    console.log(
      `终点 ${end.x.toFixed(1)},${end.y.toFixed(1)}（目标 ${goal.x},${goal.y}，距离 ${Math.hypot(
        end.x - goal.x,
        end.y - goal.y
      ).toFixed(2)}）`
    );
  }

  // 4) 远距离绕墙：从城里走到城外刷怪点
  const far = await ev('__MU_APP__.pathTo(187, 119)');
  console.log('城里 → (187,119) 的 A* 路径长:', far, '（直线', Math.hypot(187 - player.x, 119 - player.y).toFixed(1), '）');

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shots/path-probe.png', Buffer.from(shot.data, 'base64'));

  console.log('--- 页面日志 ---');
  console.log(logs.slice(-6).join('\n'));

  await ev('for (const m of (__MU__.monsters||[])) if (m.kind==="npc") {}');
} catch (e) {
  console.error('ERR', e.message);
  if (logs.length) console.log(logs.slice(-10).join('\n'));
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
