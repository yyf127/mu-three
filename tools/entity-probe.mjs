/**
 * 验证实体同步：往客户端喂 0x13 视野包，看实体是否真的被创建并渲染。
 *
 *   node tools/entity-probe.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { makeProfile } from './lib/profile.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9700 + Math.floor(Math.random() * 60);
mkdirSync('shots', { recursive: true });

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${makeProfile('ent')}`,
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
const send = (m, p = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.exceptionDetails ? { error: r.exceptionDetails.exception?.description } : r.result.value;
};
async function waitFor(expr, timeoutMs = 90000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if ((await ev(expr)) === true) return;
    await sleep(400);
  }
  throw new Error(`等待超时: ${label}`);
}

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
  await send('Page.navigate', { url: 'http://127.0.0.1:5180/' });
  await waitFor('!!window.__MU_APP__', 20000, '页面初始化');

  // 离线进洛兰，玩家在 (133,131)
  await ev('__MU_APP__.loadMap(0, 133, 131)');
  await waitFor(`__MU_APP__.state().mapId === 0`, 120000, '洛兰');
  await sleep(800);

  // 在玩家周围喂几种怪物：2=Budge Dragon, 3=Spider, 6=Lich, 7=Giant
  const spots = [
    [2, 136, 131],
    [3, 130, 131],
    [6, 133, 134],
    [7, 133, 128],
  ];
  for (const [type, x, y] of spots) {
    await ev(`__MU_APP__.testMonster(${type}, ${x}, ${y}, ${0x6000 + type})`);
  }
  await sleep(2500);

  const st = await ev('JSON.stringify(__MU_APP__.state())');
  console.log('状态:', st);
  await sleep(500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shots/entities.png', Buffer.from(shot.data, 'base64'));
  console.log('截图 shots/entities.png');

  await sleep(300);
  const shotOn = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shots/entities-on.png', Buffer.from(shotOn.data, 'base64'));

  // 全部移除后再拍一张，做整图差分
  await ev('for (const e of __MU_APP__.state().remotes) __MU_APP__.removeRemote(e.id)');
  await sleep(800);
  const shotOff = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('shots/entities-off.png', Buffer.from(shotOff.data, 'base64'));
  console.log('已保存 entities-on/off');

  // 像素差分：确认怪物真的画出来了（不只是内存里有实体）
  console.log('remotes 类型:', await ev('typeof __MU_APP__.state().remotes + " / " + Array.isArray(__MU_APP__.state().remotes)'));
  const diff = await ev(`(() => {
    const list = __MU_APP__.state().remotes;
    const m = list.find(e => e.kind === 'monster');
    if (!m) return { error: '没有怪物实体' };
    const d = window.__MU_DEBUG__;
    const pt = d.project(m.x, m.y, 1.0);
    const before = d.probePixels([{ x: pt.x, y: pt.y }])[0].rgb;
    __MU_APP__.removeRemote(m.id);
    const after = d.probePixels([{ x: pt.x, y: pt.y }])[0].rgb;
    return { id: m.id, screen: { x: Math.round(pt.x), y: Math.round(pt.y) }, before, after,
             delta: Math.abs(before[0]-after[0]) + Math.abs(before[1]-after[1]) + Math.abs(before[2]-after[2]) };
  })()`);
  console.log('像素差分:', JSON.stringify(diff));
  await sleep(600);
  console.log('删除后:', await ev('JSON.stringify(__MU_APP__.state().remotes)'));
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
