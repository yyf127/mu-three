/**
 * 报文解析单元验证：直接在页面里 import 解析模块，构造已知字节检查结果。
 * 主要覆盖攻击链路的三个包（0x15 伤害 / 0x18 动作 / 0x9C 死亡）。
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';
import { makeProfile } from './lib/profile.mjs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9500 + Math.floor(Math.random() * 80);
const profile = makeProfile('pt');
mkdirSync(profile, { recursive: true });

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=900,700',
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

try {
  let targets = null;
  for (let i = 0; i < 60; i++) {
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
    }
  });
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:5180/' });
  await sleep(3000);

  const out = await ev(`(async () => {
    const g = await import('/src/net/game.ts');
    const res = {};

    // 0x15 伤害：目标 id=0x00EA(234)、伤害 0x0A3=163? 用 27、剩余 HP 91
    const dmg = new Uint8Array(16);
    dmg[0]=0xc1; dmg[1]=16; dmg[2]=0x15;
    dmg[3]=0x00; dmg[4]=0xea;
    dmg[5]=0x00 | 0x00; dmg[6]=27;      // 伤害 27，类型 0
    dmg[7]=0;                            // 对齐填充
    const life = 91;
    dmg[8]=life & 0xff; dmg[9]=(life>>8)&0xff; dmg[10]=0; dmg[11]=0;
    dmg[12]=27; dmg[13]=0; dmg[14]=0; dmg[15]=0;
    res.damage = g.parseDamage(dmg);

    // 0x15 带暴击类型（damage[0] 高 4 位 = 0x10）
    const crit = dmg.slice(); crit[5] = 0x10; crit[6] = 5;
    res.damageCrit = g.parseDamage(crit);

    // 0x18 动作：id=234 dir=3 action=34
    res.action = g.parseAction(new Uint8Array([0xc1,7,0x18,0x00,0xea,3,34]));

    // 0x9C 死亡：id=234、经验 152、伤害 27
    const die = new Uint8Array(24);
    die[0]=0xc3; die[1]=24; die[2]=0x9c;
    die[3]=0x00; die[4]=0xea;
    die[6]=0; die[7]=0;              // HIWORD(152) = 0
    die[8]=152; die[9]=0;            // LOWORD(152) = 152
    die[10]=0; die[11]=27;
    res.die = g.parseMonsterDie(die);

    // 上行攻击包 C1 07 15 00 EA 22 03
    res.attack = Array.from(g.buildAttackPacket(0x00ea, 34, 3));

    // 大经验 70000（跨 16 位）：HIWORD=1, LOWORD=4464
    const big = die.slice(); big[7]=0; big[6]=0; big[9]=1; big[8]=0x70; big[11]=0x70;
    res.dieBig = g.parseMonsterDie(new Uint8Array([
      0xc3,24,0x9c,0x00,0xea, 0, 0,1, 0x70,0x11, 0,27, 0,0,0,0, 0,0,0,0, 0,0,0,0
    ]));
    return JSON.stringify(res, null, 1);
  })()`);

  console.log(out);
} catch (e) {
  console.error('ERR', e.message);
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
