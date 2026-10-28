/**
 * 双账号联机验证：「绕过其他角色」。
 *
 *   node tools/two-player-probe.mjs
 *
 * 同时开两个独立的 headless 客户端（各自 profile，互不串会话）：
 *   A = 1234/1234   B = 1111/1111
 * 两个角色都进同一张地图后：
 *   1. 检查 A 是否真的看到了 B（服务端 0x12 视野包 → remotes.entities）
 *   2. 检查 B 是否被登记成占位（blockers）
 *   3. 让 A 走到 B 身后，检查 A 的轨迹绕开 B 所在格
 *   4. 让 B 保持不动，A 连续走两段，确认不会贴着 B 蹭过去
 *
 * 每一步都打印可断言的数值，不靠肉眼看图。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { makeProfile } from './lib/profile.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = 'http://127.0.0.1:5180/';

mkdirSync('shots', { recursive: true });

/** 起一个独立客户端并连上 CDP */
async function createClient(label) {
  const port = 9700 + Math.floor(Math.random() * 200);
  const profile = makeProfile(`two-${label}`);
  const edge = spawn(
    EDGE,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--window-size=1280,760',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--no-first-run',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let ws = null;
  let seq = 0;
  const pend = new Map();
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++seq;
      pend.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  const ev = async expr => {
    const r = await send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description } : r.result.value;
  };

  const waitFor = async (expr, timeoutMs = 60000, tag = expr) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if ((await ev(expr)) === true) return true;
      await sleep(400);
    }
    throw new Error(`[${label}] 等待超时: ${tag}`);
  };

  let targets = null;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = await r.json();
      if (targets && targets.length) break;
    } catch {}
    await sleep(300);
  }
  if (!targets) throw new Error(`[${label}] CDP 端口没起来`);

  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r);
    ws.addEventListener('error', j);
  });
  const logs = [];
  ws.addEventListener('message', e => {
    const d = JSON.parse(e.data);
    if (d.id && pend.has(d.id)) {
      const { res, rej } = pend.get(d.id);
      pend.delete(d.id);
      d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result);
      return;
    }
    if (d.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${d.params.type}] ${(d.params.args || []).map(a => a.value ?? a.description ?? '').join(' ')}`);
    }
    if (d.method === 'Runtime.exceptionThrown') {
      logs.push('[exc] ' + (d.params.exceptionDetails.exception?.description || ''));
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await waitFor('!!window.__MU_APP__', 25000, '页面初始化');

  return {
    label,
    ev,
    waitFor,
    logs,
    shot: async name => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`shots/${name}.png`, Buffer.from(r.data, 'base64'));
    },
    close: async () => {
      try {
        await ev('__MU_APP__.close()');
        await sleep(400);
      } catch {}
      try {
        ws?.close();
      } catch {}
      edge.kill();
    },
  };
}

const state = async c => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
const cell = async c => {
  const s = await state(c);
  return { x: Math.floor(s.player.x), y: Math.floor(s.player.y), fx: s.player.x, fy: s.player.y };
};
const info = async c => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.remotesInfo())'));

/** 走一段并采样轨迹；遇到别人占位时记录是否踩上去 */
async function walk(c, label, tx, ty, maxFrames = 90) {
  const start = await cell(c);
  const ok = await c.ev(`__MU_APP__.walkTo(${tx}, ${ty})`);
  const trail = [];
  let stalls = 0;
  let lfx = null;
  let lfy = null;
  for (let i = 0; i < maxFrames; i++) {
    await sleep(120);
    const p = await cell(c);
    const key = `${p.x},${p.y}`;
    if (trail[trail.length - 1] !== key) trail.push(key);
    if (Math.hypot(p.fx - tx, p.fy - ty) < 1.2) break;
    if (lfx !== null && Math.hypot(p.fx - lfx, p.fy - lfy) < 0.02) stalls++;
    else stalls = 0;
    lfx = p.fx;
    lfy = p.fy;
    if (stalls > 14) break;
  }
  const end = await cell(c);
  const mi = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.moveInfo())'));
  console.log(
    `\n[${c.label}][${label}] 起点(${start.x},${start.y}) 目标(${tx},${ty}) walkTo=${ok}\n` +
      `  轨迹: ${trail.join(' → ')}\n` +
      `  终点(${end.x},${end.y}) 离目标 ${Math.hypot(end.fx - tx, end.fy - ty).toFixed(2)}` +
      `  清空原因=${mi.clearReason} 剩余=${mi.len - mi.cursor}` +
      `  next=${JSON.stringify(mi.next)} goal=${JSON.stringify(mi.goal)} 停滞帧=${stalls}`
  );
  return { trail, end, ok };
}

const A = await createClient('a');
const B = await createClient('b');

try {
  // ---- 1. 两个账号分别登录进图 ----
  console.log('登录 A=1234/1234  B=1111/1111');
  await Promise.all([
    A.ev(`__MU_APP__.login('1234','1234')`),
    B.ev(`__MU_APP__.login('1111','1111')`),
  ]);
  await Promise.all([
    A.waitFor(`__MU_APP__.state().screen === 'charselect'`, 40000, 'A 角色列表'),
    B.waitFor(`__MU_APP__.state().screen === 'charselect'`, 40000, 'B 角色列表'),
  ]);
  console.log('角色数 A/B:', await A.ev('__MU_APP__.characters()'), '/', await B.ev('__MU_APP__.characters()'));
  const namesA = JSON.parse(await A.ev('JSON.stringify(__MU_APP__.charNames())'));
  const namesB = JSON.parse(await B.ev('JSON.stringify(__MU_APP__.charNames())'));
  console.log('A 的角色:', JSON.stringify(namesA));
  console.log('B 的角色:', JSON.stringify(namesB));
  const charA = namesA[0];
  const charB = namesB[0];
  if (!charA || !charB) throw new Error('某个账号没有角色，无法双开验证');

  await Promise.all([A.ev(`__MU_APP__.select(${JSON.stringify(charA)})`), B.ev(`__MU_APP__.select(${JSON.stringify(charB)})`)]);
  await Promise.all([
    A.waitFor(`__MU_APP__.state().screen === 'game'`, 120000, 'A 进图'),
    B.waitFor(`__MU_APP__.state().screen === 'game'`, 120000, 'B 进图'),
  ]);
  await sleep(2500);

  const sa = await state(A);
  const sb = await state(B);
  console.log(`\nA 地图=${sa.mapId} 格(${Math.floor(sa.player.x)},${Math.floor(sa.player.y)})`);
  console.log(`B 地图=${sb.mapId} 格(${Math.floor(sb.player.x)},${Math.floor(sb.player.y)})`);

  if (sa.mapId !== sb.mapId) {
    console.log('\n!! 两个角色不在同一张地图，无法验证互相占位');
  }

  // ---- 2. A 能不能看见 B ----
  await sleep(1500);
  const ia = await info(A);
  const playersA = ia.entities.filter(e => e.kind === 'player');
  console.log(`\nA 的实体: ${ia.entities.length} 个，其中玩家 ${playersA.length} 个  selfId=${ia.selfId}`);
  for (const p of playersA) console.log(`  player#${p.id} ${p.name} 目标格(${p.tx},${p.ty}) 插值(${p.x},${p.y})`);
  console.log(`A 的占位集合: ${JSON.stringify(ia.blockers)}`);

  const bInA = playersA.find(p => p.name === charB);
  console.log(`A 看到 B ? ${!!bInA}   B 被登记为占位 ? ${!!bInA && ia.blockers.some(b => b.x === bInA.tx && b.y === bInA.ty)}`);

  if (bInA) {
    // ---- 3. A 走到 B 身后一格：路径必须绕开 B ----
    const bCell = { x: bInA.tx, y: bInA.ty };
    // 取 A→B 的方向，把目标放在 B 的另一侧（穿过 B 才算数）
    const ac = await cell(A);
    const dx = Math.sign(bCell.x - ac.x) || 1;
    const dy = Math.sign(bCell.y - ac.y) || 0;
    const behind = { x: bCell.x + dx, y: bCell.y + dy };

    console.log(`\nA(${ac.x},${ac.y}) → B(${bCell.x},${bCell.y}) → 目标(${behind.x},${behind.y})`);
    // 打印可走网格（'.' 可走 / '#' 墙或单位占位），判断是「没路绕」还是「没绕」
    const grid = JSON.parse(
      await A.ev(
        `JSON.stringify((()=>{const out=[];for(let y=${bCell.y - 3};y<=${bCell.y + 3};y++){let row='';for(let x=${bCell.x - 4};x<=${bCell.x + 3};x++){row+=__MU_APP__.canStand(x,y)?'.':'#';}out.push(String(y).padStart(3)+' '+row);}return out;})())`
      )
    );
    console.log(`\n可走网格（x ${bCell.x - 4}..${bCell.x + 3}）：`);
    for (const line of grid) console.log('  ' + line);
    const r = await walk(A, '穿过 B 的位置', behind.x, behind.y, 100);
    const hitB = r.trail.includes(`${bCell.x},${bCell.y}`);
    console.log(`  轨迹里踩到 B 的格? ${hitB}（应为 false）`);
    console.log(`  B 当前格 canStand=${await A.ev(`__MU_APP__.canStand(${bCell.x}, ${bCell.y})`)}（应为 false）`);
    await A.shot('two-player-a-around-b');
  }

  // ---- 4. 让 B 走一步，A 再追过去：验证移动中的占位也会被绕开 ----
  if (bInA) {
    const bc = await cell(B);
    console.log(`\nB 移动：(${bc.x},${bc.y}) → (${bc.x},${bc.y + 4})`);
    await B.ev(`__MU_APP__.walkTo(${bc.x}, ${bc.y + 4})`);
    await sleep(1500);
    const ib = await info(A);
    const b2 = ib.entities.filter(e => e.kind === 'player' && e.name === charB)[0];
    console.log(`  A 侧看到的 B 目标格现在 = (${b2?.tx},${b2?.ty})`);

    const ac2 = await cell(A);
    console.log(`\nA 走向 B 的新位置附近`);
    const r2 = await walk(A, '追向移动后的 B', b2.tx, b2.ty, 100);
    console.log(`  轨迹里踩到 B 目标格(${b2.tx},${b2.ty})? ${r2.trail.includes(`${b2.tx},${b2.ty}`)}（应为 false）`);
  }

  console.log('\n--- A 页面日志（末 6 条）---');
  console.log(A.logs.slice(-6).join('\n'));
  console.log('--- B 页面日志（末 4 条）---');
  console.log(B.logs.slice(-4).join('\n'));
} catch (e) {
  console.error('ERR', e.message);
  if (A.logs.length) console.log('A:', A.logs.slice(-6).join('\n'));
  if (B.logs.length) console.log('B:', B.logs.slice(-6).join('\n'));
} finally {
  await A.close();
  await B.close();
  await sleep(300);
  process.exit(0);
}
