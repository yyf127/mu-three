/**
 * 4:3 视口 + 怪物/NPC 模型 + 攻击链路 的自动化验证。
 *
 * 打开客户端 → 离线演示（洛兰）→ 截一张 4:3 图 → 检查 DOM 里舞台比例
 * → 逐个 Class 生成怪物/NPC 并记录模型文件 → 攻击最近的怪并抓伤害飘字。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeProfile } from './lib/profile.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9700 + Math.floor(Math.random() * 100);
const W = Number(process.env.W || 1600);
const H = Number(process.env.H || 900);
const profile = makeProfile('v43');
mkdirSync(profile, { recursive: true });
mkdirSync('shots', { recursive: true });

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
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
    await sleep(400);
  }
  return false;
};

const shot = async name => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`shots/${name}.png`, Buffer.from(s.data, 'base64'));
  console.log('截图', `shots/${name}.png`);
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
    if (d.method === 'Runtime.exceptionThrown') {
      logs.push('[exc] ' + (d.params.exceptionDetails.exception?.description || ''));
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:5180/' });
  await waitFor('!!window.__MU_APP__', 25000);

  // 舞台比例
  console.log(
    '舞台:',
    await ev(`(() => {
      const r = document.getElementById('stage').getBoundingClientRect();
      const c = document.querySelector('canvas').getBoundingClientRect();
      return JSON.stringify({ stage: [Math.round(r.width), Math.round(r.height)],
        ratio: +(r.width / r.height).toFixed(3),
        canvas: [Math.round(c.width), Math.round(c.height)],
        window: [innerWidth, innerHeight] });
    })()`)
  );

  // 离线演示 → 洛兰
  await ev('__MU_APP__.loadMap(0, 133, 131)');
  if (!(await waitFor(`__MU_APP__.state().screen === 'game'`, 180000))) {
    throw new Error('载入超时');
  }
  await sleep(2500);
  await shot('v43-offline');

  console.log('离线实体:', await ev('JSON.stringify(__MU__?.monsters?.map(m => ({ name: m.name, kind: m.kind, cls: m.cls, meshes: m.meshes.length })))'));

  // 逐个 Class 验证模型映射（用 testMonster 造 0x13 包）
  const classes = [1, 2, 3, 6, 7, 9, 10, 11, 12, 17, 26, 31, 45, 53, 61, 86, 230, 238, 240, 244, 248, 251, 255];
  const rows = [];
  for (let i = 0; i < classes.length; i++) {
    const cls = classes[i];
    const st = await ev(`(() => {
      const before = new Set(__MU_APP__.state().remotes.map(e => e.id));
      __MU_APP__.testMonster(${cls}, 133 + (${i} % 5) * 2, 137 + Math.floor(${i} / 5) * 2, 0x7100 + ${i});
      return JSON.stringify({ before: [...before].length });
    })()`);
    void st;
    await sleep(220);
    const last = await ev(`(() => {
      const list = __MU_APP__.state().remotes;
      const e = list[list.length - 1];
      return e ? JSON.stringify({ cls: e.cls, kind: e.kind, name: e.name, meshes: 0 }) : 'null';
    })()`);
    rows.push({ cls, last });
  }

  // 等模型都加载好（贴图异步）
  await sleep(6000);
  const modelInfo = await ev(`(() => {
    const out = [];
    for (const o of __MU__.scene.children) {
      if (!o.isSkinnedMesh) continue;
      if (o.name.startsWith('player')) continue;
      out.push(o.name.split(':')[0]);
    }
    const uniq = [...new Set(out)];
    return JSON.stringify({ files: uniq.sort(), meshCount: out.length });
  })()`);
  console.log('实体模型文件:', modelInfo);

  console.log('实体清单:', await ev('JSON.stringify(__MU_APP__.state().remotes.slice(0, 30))'));

  await shot('v43-creatures');

  // 攻击：把角色挪到某只怪旁边再打
  console.log(
    '攻击测试:',
    await ev(`(() => {
      const list = __MU_APP__.state().remotes.filter(e => e.kind === 'monster');
      if (!list.length) return '没有怪物';
      const t = list[0];
      // 直接放到怪物旁边 1.5 格
      __MU__.player.x = t.x + 1.2;
      __MU__.player.y = t.y;
      __MU_APP__.attack(t.id);
      return JSON.stringify({ target: t, focus: __MU_APP__.focus() });
    })()`)
  );

  await sleep(1200);
  console.log('飘字节点:', await ev(`document.querySelectorAll('#fx .dmg').length`));
  console.log('HUD 目标:', await ev(`document.getElementById('target').className + ' / ' + document.getElementById('target-name').textContent`));
  await shot('v43-attack');

  console.log('--- 页面控制台 ---');
  console.log(logs.slice(-12).join('\n'));

  await ev('__MU_APP__.close()');
  await sleep(400);
} catch (e) {
  console.error('ERR', e.message);
  if (logs.length) console.log(logs.slice(-15).join('\n'));
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
