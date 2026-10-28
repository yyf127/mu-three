/**
 * 寻路 / 占位验证（离线洛兰，不依赖服务端）。
 *
 *   node tools/walk-probe.mjs
 *
 * 覆盖：
 *   1. NPC 格不可站，点击 NPC 会落到相邻空格
 *   2. 在路径正前方放一个「玩家」，A* 必须绕开，实际轨迹不能踩到那一格
 *   3. 点在墙/建筑里面，角色要走到墙边最近的可站格（不能毫无反应）
 *   4. 长距离绕行不卡死
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { makeProfile } from './lib/profile.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9500 + Math.floor(Math.random() * 100);
const profile = makeProfile('walk');
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

const pos = async () => JSON.parse(await ev('JSON.stringify(__MU__.player ? {x:__MU__.player.x,y:__MU__.player.y} : null)'));
const cell = async () => {
  const p = await pos();
  return { x: Math.floor(p.x), y: Math.floor(p.y), fx: p.x, fy: p.y };
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

  /** 走一段，采样轨迹（格坐标） */
  const walk = async (label, tx, ty, maxFrames = 90) => {
    const start = await pos();
    const len = await ev(`__MU_APP__.pathTo(${tx}, ${ty})`);
    const ok = await ev(`__MU_APP__.walkTo(${tx}, ${ty})`);
    const trail = [];
    let stalls = 0;
    let lastFx = null;
    let lastFy = null;
    for (let i = 0; i < maxFrames; i++) {
      await sleep(120);
      const c = await cell();
      const key = `${c.x},${c.y}`;
      if (trail[trail.length - 1] !== key) trail.push(key);
      if (Math.hypot(c.fx - tx, c.fy - ty) < 1.2) break;
      // 用真实位移判定停住（格内挪动 floor 不变，不能按格子算）
      if (lastFx !== null && Math.hypot(c.fx - lastFx, c.fy - lastFy) < 0.02) stalls++;
      else stalls = 0;
      lastFx = c.fx;
      lastFy = c.fy;
      if (stalls > 12) break;
    }
    const end = await cell();
    const mi = JSON.parse(await ev('JSON.stringify(__MU_APP__.moveInfo())'));
    console.log(
      `\n[${label}] 目标(${tx},${ty}) A*=${len} walkTo=${ok}\n` +
        `  轨迹: ${trail.join(' → ')}\n` +
        `  终点 (${end.x},${end.y}) 离目标 ${Math.hypot(end.fx - tx, end.fy - ty).toFixed(2)}` +
        `  清空原因=${mi.clearReason} 剩余路径=${mi.len}`
    );
    if (stalls > 10) {
      const attr = await ev(`__MU__.terrain.data.attribute[${end.y} * 256 + ${end.x}]`);
      const sp = JSON.parse(await ev('JSON.stringify(__MU_APP__.stepProbe())'));
      console.log(
        `  !! 卡住 attr=${attr} remaining=${mi.len - mi.cursor}\n` +
          `     stepProbe=${JSON.stringify(sp)}`
      );
    }
    return { trail, end };
  };

  const npcs = JSON.parse(
    await ev(
      `JSON.stringify((__MU__.monsters||[]).filter(m=>m.kind==='npc').map(m=>({name:m.name,x:Math.floor(m.x),y:Math.floor(m.y)})))`
    )
  );
  console.log('NPC:', JSON.stringify(npcs));

  // 1) NPC 占位 + 点击 NPC 脚下
  for (const n of npcs) {
    const standable = await ev(`__MU_APP__.canStand(${n.x}, ${n.y})`);
    console.log(`NPC ${n.name}(${n.x},${n.y}) canStand=${standable}（应为 false）`);
  }
  if (npcs[0]) {
    const n = npcs[0];
    const r = await walk('点到 NPC 脚下', n.x, n.y, 60);
    console.log(`  → 离 NPC ${Math.hypot(r.end.fx - n.x, r.end.fy - n.y).toFixed(2)} 格，轨迹里有 NPC 格? ${r.trail.includes(`${n.x},${n.y}`)}`);
  }

  // 2) 角色占位：在正东 3 格放一个假玩家，然后走到它东边
  const p = await cell();
  const fakeX = p.x + 3;
  const fakeY = p.y;
  await ev(`__MU_APP__.testPlayer('Blocker', ${fakeX}, ${fakeY})`);
  await sleep(1500);
  console.log(
    `\n注入玩家 Blocker@(${fakeX},${fakeY}) → canStand=${await ev(`__MU_APP__.canStand(${fakeX}, ${fakeY})`)}（应为 false）`
  );
  const r2 = await walk('绕开挡路玩家', fakeX + 3, fakeY, 60);
  console.log(`  轨迹踩到 Blocker 的格子? ${r2.trail.includes(`${fakeX},${fakeY}`)}（应为 false）`);

  // 2b) 走起来之后才有人插到路上 —— 这才是联机里最常遇到的情况：
  //     路径已经算好，对方中途走进来。必须重新规划，不能贴着他蹭过去。
  const p2 = await cell();
  const goX = p2.x + 9;
  const goY = p2.y;
  await ev(`__MU_APP__.walkTo(${goX}, ${goY})`);
  await sleep(320);
  const mid = await cell();
  const cutX = mid.x + 2;
  const cutY = mid.y;
  await ev(`__MU_APP__.testPlayer('Walker', ${cutX}, ${cutY}, 0x7e02)`);
  const trail = [];
  let stalls2 = 0;
  let lfx = null;
  let lfy = null;
  for (let i = 0; i < 90; i++) {
    await sleep(120);
    const c = await cell();
    const key = `${c.x},${c.y}`;
    if (trail[trail.length - 1] !== key) trail.push(key);
    if (Math.hypot(c.fx - goX, c.fy - goY) < 1.2) break;
    if (lfx !== null && Math.hypot(c.fx - lfx, c.fy - lfy) < 0.02) stalls2++;
    else stalls2 = 0;
    lfx = c.fx;
    lfy = c.fy;
    if (stalls2 > 12) break;
  }
  const cutEnd = await cell();
  const cutMi = JSON.parse(await ev('JSON.stringify(__MU_APP__.moveInfo())'));
  console.log(
    `\n[中途插人] Walker@(${cutX},${cutY}) 插进路径\n` +
      `  轨迹: ${trail.join(' → ')}\n` +
      `  踩到 Walker 格? ${trail.includes(`${cutX},${cutY}`)}（应为 false）` +
      `  终点(${cutEnd.x},${cutEnd.y}) 离目标 ${Math.hypot(cutEnd.fx - goX, cutEnd.fy - goY).toFixed(2)}` +
      `  清空原因=${cutMi.clearReason}`
  );

  // 3) 点在墙里：洛兰东侧 x>=154 一带是建筑(attr=5)
  const wallX = r2.end.x + 12;
  const wallY = r2.end.y;
  const wallAttr = await ev(`__MU__.terrain.data.attribute[${wallY} * 256 + ${wallX}]`);
  console.log(`\n点墙里 (${wallX},${wallY}) attr=${wallAttr}（含 4/8 才是墙）`);
  const r3 = await walk('点在墙里', wallX, wallY, 90);
  console.log(
    `  是否走到墙边可站格: ${await ev(`__MU_APP__.canStand(${r3.end.x}, ${r3.end.y})`)}（应为 true）`
  );

  // 4) 长距离（只受采样帧数限制，不追求走完）
  const r4 = await walk('长距离绕行', 187, 119, 140);
  console.log(`  → 采样窗口内推进 ${r4.trail.length} 格，未触发卡死（stalls 阈值 12 帧）`);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shots/walk-probe.png', Buffer.from(shot.data, 'base64'));

  console.log('\n--- 页面日志 ---');
  console.log(logs.slice(-8).join('\n'));
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
