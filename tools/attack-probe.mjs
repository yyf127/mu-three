/**
 * 攻击链路实测：登录真实服务端 → 走到洛兰城外的刷怪点 → 点击/空格攻击
 * → 检查服务端回来的 0x18（动作）、0x15（伤害）、0x9C（死亡/经验）。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeProfile } from './lib/profile.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9600 + Math.floor(Math.random() * 100);
const ACCOUNT = process.env.MU_ACCOUNT || '1234';
const PASSWORD = process.env.MU_PASSWORD || '1234';
const CHAR = process.env.MU_CHAR || '';
// 洛兰城外刷怪点（MonsterSetBase：Lich/Skeleton 131,171）
const HUNT = { x: Number(process.env.HUNT_X || 131), y: Number(process.env.HUNT_Y || 168) };

mkdirSync('shots', { recursive: true });
const profile = makeProfile('atk');
mkdirSync(profile, { recursive: true });

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

  await ev(`__MU_APP__.login(${JSON.stringify(ACCOUNT)}, ${JSON.stringify(PASSWORD)})`);
  if (!(await waitFor(`__MU_APP__.state().screen === 'charselect'`, 60000))) throw new Error('登录失败');
  console.log('登录成功，角色数:', await ev('__MU_APP__.characters()'));

  const name = CHAR || (await ev('__MU_APP__.characters() ? document.querySelector(".char-card .cname").textContent : ""'));
  await ev(`__MU_APP__.select(${JSON.stringify(name)})`);
  if (!(await waitFor(`__MU_APP__.state().screen === 'game'`, 180000))) throw new Error('进图超时');
  await sleep(2500);

  console.log('进图:', await ev('JSON.stringify({ map: __MU_APP__.state().mapId, player: __MU_APP__.state().player, selfId: __MU_APP__.state().selfId })'));
  console.log('初始怪物:', await ev('JSON.stringify(__MU_APP__.monsters())'));

  // 只用一次 A*：目标固定，让客户端自己绕墙绕 NPC
  console.log('目标刷怪点', HUNT.x, HUNT.y, '直线距离', Math.hypot(HUNT.x - 0, HUNT.y - 0).toFixed(1));
  console.log('pathTo:', await ev(`__MU_APP__.pathTo(${HUNT.x}, ${HUNT.y})`));
  await ev(`__MU_APP__.walkTo(${HUNT.x}, ${HUNT.y})`);

  await sleep(500);
  console.log('占位格:', await ev('JSON.stringify(__MU_APP__.blockedList())'));
  console.log('NPC:', await ev(`JSON.stringify(__MU_APP__.state().remotes.filter(e => e.kind === 'npc').map(e => ({ n: e.name, x: e.x, y: e.y })))`));
  console.log('canStand(139,125)=', await ev('__MU_APP__.canStand(139,125)'));

  let lastPos = null;
  for (let i = 0; i < 60; i++) {
    const st = JSON.parse(await ev('JSON.stringify(__MU_APP__.state().player)'));
    const d = Math.hypot(st.x - HUNT.x, st.y - HUNT.y);
    if (i === 12) console.log('selfMoveLog:', await ev('JSON.stringify(__MU_APP__.selfMoveLog())'));
    if (i % 4 === 0) {
      const info = await ev('JSON.stringify(__MU_APP__.moveInfo())');
      console.log(`  走位 ${i}: (${st.x.toFixed(1)},${st.y.toFixed(1)}) 距目标 ${d.toFixed(1)} ${info}`);
    }
    if (d < 5) break;
    // 卡住（位置 2 秒没变）就重新下一次指令
    if (lastPos && Math.hypot(st.x - lastPos.x, st.y - lastPos.y) < 0.05 && i % 5 === 4) {
      await ev(`__MU_APP__.walkTo(${HUNT.x}, ${HUNT.y})`);
    }
    lastPos = st;
    await sleep(300);
  }

  console.log('走到:', await ev('JSON.stringify(__MU_APP__.state().player)'), 'dead=', await ev('__MU_APP__.state().dead'));
  console.log('报文头:', await ev('JSON.stringify(__MU_APP__.state().heads)'));
  await sleep(1500);
  console.log('视野怪物:', await ev('JSON.stringify(__MU_APP__.monsters())'));

  // 攻击最近的怪（距离不够时 attack() 会自动追击）
  let killed = false;
  for (let round = 0; round < 30; round++) {
    const list = JSON.parse(await ev('JSON.stringify(__MU_APP__.monsters())'));
    const alive = list.filter(m => !m.dying).sort((a, b) => a.dist - b.dist);
    if (!alive.length) {
      await sleep(900);
      continue;
    }
    const t = alive[0];

    const before = JSON.parse(await ev('JSON.stringify(__MU_APP__.state().remoteDebug)'));
    await ev(`__MU_APP__.attack(${t.id})`);
    await sleep(t.dist > 2.6 ? 900 : 750);
    const after = JSON.parse(await ev('JSON.stringify(__MU_APP__.state().remoteDebug)'));
    const dmgNodes = await ev(`document.querySelectorAll('#fx .dmg').length`);
    const hp = JSON.parse(await ev(`JSON.stringify({
      pos: __MU_APP__.state().player,
      target: __MU_APP__.state().target
    })`));

    console.log(
      `#${round} ${t.name}(${t.id}) d=${t.dist.toFixed(1)} pos=${hp.pos.x.toFixed(1)},${hp.pos.y.toFixed(1)} ` +
        `→ +伤害包 ${after.damages - before.damages}（累计 ${after.damages}），飘字 ${dmgNodes}，` +
        `目标HP ${hp.target ? hp.target.hp + '/' + hp.target.maxHp : '-'}`
    );

    if (after.dies > before.dies) {
      killed = true;
      console.log('  → 收到死亡包，经验飘字:', await ev(`document.querySelectorAll('#fx .dmg.exp').length`));
      await sleep(300);
      break;
    }
    if (!hp.target && t.dist < 2.6) console.log('  （目标丢失，可能已死）');
  }

  console.log('最终统计:', await ev('JSON.stringify(__MU_APP__.state().remoteDebug)'));
  console.log('HUD:', await ev(`JSON.stringify({
    target: document.getElementById('target').className,
    name: document.getElementById('target-name').textContent,
    bar: document.getElementById('target-fill').style.width,
    dmgNodes: document.querySelectorAll('#fx .dmg').length,
    dmgTexts: [...document.querySelectorAll('#fx .dmg')].slice(0, 6).map(e => e.className + ':' + e.textContent)
  })`));
  console.log('实体:', await ev('JSON.stringify(__MU_APP__.monsters().slice(0, 6))'));
  await shot(killed ? 'attack-kill' : 'attack-hit');

  console.log('--- 页面日志 ---');
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
