/**
 * 无头浏览器验证脚本（CDP，不依赖第三方包）。
 * 用法: node tools/probe.mjs [url] [waitMs]
 * 输出: 控制台/异常、渲染统计、截图 shot.png
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { makeProfile } from './lib/profile.mjs';

const URL_TO_OPEN = process.argv[2] || 'http://127.0.0.1:5180/';
const WAIT_MS = Number(process.argv[3] || 20000);

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;

const profile = makeProfile('edge-probe');
mkdirSync(profile, { recursive: true });

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1600,900',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-gpu-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let ws;
let msgId = 0;
const pending = new Map();
const logs = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  // 等待调试端口
  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await res.json();
      if (targets.length) break;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  if (!targets) throw new Error('无法连接调试端口');

  const page = targets.find(t => t.type === 'page') || targets[0];
  console.log('targets:', targets.map(t => `${t.type}:${t.url}`).join(' | '));
  ws = new WebSocket(page.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  ws.addEventListener('message', ev => {
    const data = JSON.parse(ev.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else resolve(data.result);
      return;
    }

    if (data.method === 'Runtime.consoleAPICalled') {
      const text = (data.params.args || [])
        .map(a => a.value ?? a.description ?? a.unserializableValue ?? '')
        .join(' ');
      logs.push(`[${data.params.type}] ${text}`);
    }
    if (data.method === 'Runtime.exceptionThrown') {
      const d = data.params.exceptionDetails;
      logs.push(`[exception] ${d.exception?.description || d.text}`);
    }
    if (data.method === 'Log.entryAdded') {
      logs.push(`[log:${data.params.entry.level}] ${data.params.entry.text}`);
    }
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_TO_OPEN });

  await sleep(WAIT_MS);

  const evaluate = async expression => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      return { error: res.exceptionDetails.exception?.description };
    }
    return res.result.value;
  };

  console.log(
    'page:',
    await evaluate(
      `JSON.stringify({href: location.href, ready: document.readyState, title: document.title, body: document.body.innerText.slice(0,120)})`
    )
  );

  const stats = await evaluate(`(() => {
    const mu = window.__MU__;
    const d = window.__MU_DEBUG__;
    if (!mu || !d) return { ready: false, loadingText: document.getElementById('loading-msg')?.textContent };
    const info = mu.renderer.info;
    const p = mu.player;
    const torso = d.project(p.x, p.y, p.z + 1.0);
    const feet = d.project(p.x, p.y, p.z);
    const W = window.innerWidth, H = window.innerHeight;
    const samples = d.probePixels([
      { x: W / 2, y: 30, tag: 'sky' },
      { x: W * 0.12, y: H * 0.2, tag: 'far' },
      { x: torso.x, y: torso.y, tag: 'torso' },
      { x: feet.x, y: feet.y + 26, tag: 'ground-under-player' },
      { x: W / 2, y: H - 40, tag: 'ground-near' },
      { x: W * 0.85, y: H * 0.75, tag: 'ground-right' },
    ]);
    return {
      ready: true,
      fps: document.getElementById('stat-fps')?.textContent,
      stats: d.stats(),
      bounds: d.skinnedBounds(),
      ray: d.terrainRaycast(p.x, p.y),
      torso,
      feet,
      samples,
      size: [W, H],
    };
  })()`);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('probe.png', Buffer.from(shot.data, 'base64'));

  console.log('=== console ===');
  console.log(logs.slice(0, 80).join('\n') || '(无输出)');
  console.log('=== stats ===');
  console.log(JSON.stringify(stats, null, 2));
  console.log('screenshot -> probe.png');

  await send('Browser.close').catch(() => {});
}

main()
  .catch(err => {
    console.error('PROBE ERROR:', err.message);
    console.log('=== console ===');
    console.log(logs.join('\n'));
  })
  .finally(async () => {
    try {
      ws?.close();
    } catch {}
    edge.kill();
    await sleep(200);
    process.exit(0);
  });
