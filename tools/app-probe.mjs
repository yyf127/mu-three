/**
 * 驱动真实客户端页面（/index.html）走完 登录 → 选角 → 进图，并切换地图截图。
 *
 *   node tools/app-probe.mjs                 # 登录 1234/1234，进角色 1234 的地图
 *   node tools/app-probe.mjs 1111 1111       # 换账号
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { makeProfile } from './lib/profile.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9950 + Math.floor(Math.random() * 40);
const account = process.argv[2] || '1234';
const password = process.argv[3] || '1234';
const charName = process.argv[4] || account;

mkdirSync('shots', { recursive: true });

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${makeProfile('app')}`,
    '--window-size=1280,760',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--no-first-run',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let ws;
let id = 0;
const pend = new Map();
/** 页面控制台 + 未捕获异常，失败时打出来，不然只看到一句「等待超时」 */
const consoleLines = [];

const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });

const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description } : r.result.value;
};

async function waitFor(expr, timeoutMs = 60000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await ev(expr);
    if (v === true) return true;
    await sleep(400);
  }
  throw new Error(`等待超时: ${label}`);
}

const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`shots/${name}.png`, Buffer.from(r.data, 'base64'));
  console.log(`  截图 shots/${name}.png`);
};

try {
  let targets = null;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await r.json();
      if (targets && targets.length) break;
    } catch {}
    await sleep(300);
  }

  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r);
    ws.addEventListener('error', j);
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
      const text = (d.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
      consoleLines.push(`[${d.params.type}] ${text}`);
    }
    if (d.method === 'Runtime.exceptionThrown') {
      consoleLines.push('[exc] ' + (d.params.exceptionDetails.exception?.description || ''));
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:5180/' });

  await waitFor('!!window.__MU_APP__', 20000, '页面初始化');
  console.log('页面已加载，登录中…');
  await shot('app-01-login');

  await ev(`__MU_APP__.login(${JSON.stringify(account)}, ${JSON.stringify(password)})`);
  await waitFor(`__MU_APP__.state().screen === 'charselect'`, 30000, '角色列表');
  console.log('角色数:', await ev('__MU_APP__.characters()'));
  await shot('app-02-charselect');

  await ev(`__MU_APP__.select(${JSON.stringify(charName)})`);
  await waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进入地图');
  await sleep(1500);

  let st = await ev('JSON.stringify(__MU_APP__.state())');
  console.log('进入游戏:', st);
  const firstMap = JSON.parse(st).mapId;
  await shot(`app-03-char-${account}-map${firstMap}`);

  // 逐张地图切换（用离线加载走同一套渲染路径，避免每次都要新角色）
  for (const [mapId, name] of [[1, 'dungeon'], [2, 'devias'], [3, 'noria'], [7, 'atlans']]) {
    await ev(`__MU_APP__.loadMap(${mapId}, 128, 128)`);
    await waitFor(`__MU_APP__.state().mapId === ${mapId}`, 120000, `地图 ${mapId}`);
    await sleep(1200);
    st = await ev('JSON.stringify(__MU_APP__.state())');
    console.log(`地图 ${mapId} (${name}):`, st);
    await shot(`app-map${mapId}-${name}`);
  }

  console.log('--- 页面控制台 ---');
  console.log(consoleLines.slice(-14).join('\n'));

  // 按协议退出，释放账号
  await ev('__MU_APP__.close()');
  await sleep(600);
  console.log('完成');
} catch (e) {
  console.error('ERR', e.message);
  try {
    console.log('登录面板提示:', await ev(`(document.querySelector('#login-msg')||{}).textContent`));
  } catch {}
  console.log('--- 页面控制台 ---');
  console.log(consoleLines.slice(-20).join('\n') || '（空）');
} finally {
  try {
    ws?.close();
  } catch {}
  edge.kill();
  await sleep(200);
  process.exit(0);
}
