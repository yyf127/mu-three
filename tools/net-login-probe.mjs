/**
 * 在无头浏览器里跑 net-test.html 的登录链，输出 window.__NET_LOGIN__ 与页面日志。
 *
 *   node tools/net-login-probe.mjs [account] [password]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { makeProfile } from './lib/profile.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9850 + Math.floor(Math.random() * 100);
const account = process.argv[2] || '1234';
const password = process.argv[3] || '1234';

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${makeProfile('nl')}`,
    '--window-size=1100,900',
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let ws;
let id = 0;
const pend = new Map();

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
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', {
    url: `http://127.0.0.1:5180/net-test.html?account=${account}&password=${password}`,
  });

  // 轮询到完成或超时
  let state = null;
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    state = await ev('JSON.stringify(window.__NET_LOGIN__ || null)');
    if (typeof state === 'string' && /"stage":"(done|error)"/.test(state)) break;
  }

  console.log('结果:', state);
  // 等页面把 F1/02 发出去（正常退避），否则账号会卡在“已连接”
  await sleep(3000);
  console.log('--- 页面日志 ---');
  console.log(await ev('document.getElementById("log").innerText'));
} catch (e) {
  console.error('ERR', e.message);
} finally {
  try {
    ws?.close();
  } catch {}
  edge.kill();
  await sleep(200);
  process.exit(0);
}
