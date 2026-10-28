/**
 * 经验与升级探针。
 *
 *   node tools/levelup-probe.mjs
 *   node tools/levelup-probe.mjs 账号 密码
 *
 * 验两条之前完全没接的线：
 *
 *   1. **经验累加**：0x9C 死亡包里带经验，原版在客户端 `CharacterAttribute+16 += Exp`
 *      （服务端不逐只同步），所以经验条得自己走。
 *   2. **升级** `0xF3/0x05`：等级/点数/上限 + **回满血蓝** + 15 道 joint 与光环特效。
 *
 * 升级包按服务端 `PMSG_LEVEL_UP_SEND`（`Protocol.h:445`，`GAMESERVER_EXTRA=1`
 * 所以是 48 字节，九个 WORD 后有一个 2 字节对齐洞）自己造字节，
 * **不调用被测的构造函数**（同错自洽这条吃过亏）。
 *
 * 注意：真服务端**没法在探针里练到升级**（99 → 100 要几千万经验），
 * 所以「真机」这一段只验经验累加与连接不被打断。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const account = process.argv[2] || '1234';
const password = process.argv[3] || '1234';

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? `  ${detail}` : ''}`);
  }
};

const hex = arr => arr.map(n => n.toString(16).padStart(2, '0')).join(' ');

/**
 * 经验条的宽度**独立重算**（不 import `hudValues` 的实现，避免同错自洽）。
 *
 * 原版这条不是「总进度条」：它把经验切成 0..9 十档，
 * 条上画的是**当前档内填了多少**，档位由旁边那个数字表示。
 * 所以 `+1000` 这种小增量通常看不出宽度变化 —— 断言要看的是「宽度和公式一致」。
 */
function expectExpWidth(exp, next, level) {
  const lv = Math.max(0, Math.floor(level) || 0);
  const prior = lv - 1;
  let prevExp = 0;
  if (prior > 0) {
    prevExp = 10 * prior * prior * (prior + 9);
    if (prior > 255) prevExp += 1000 * (lv - 256) * (lv - 256) * (lv - 256 + 9);
  }
  const cumNeed = next - prevExp;
  const cumulative = cumNeed > 0;
  const need = cumulative ? cumNeed : next;
  const cur = cumulative ? exp - prevExp : exp;
  if (need <= 0) return 0;
  const scaled = (cur / need) * 10;
  const tick = Math.max(0, Math.min(9, Math.floor(scaled)));
  const ratio = Math.min(1, scaled - tick);
  return Math.round(ratio * 198);
}

/**
 * 0xF3/0x05：`C1 30 F3 05` + 9×WORD + pad2 + 6×DWORD = 48 字节。
 * `extra` 为 false 时只发前 22 字节（服务端短包，走公式兜底那条路）。
 */
function levelUpPacket(ev, extra = true) {
  const size = extra ? 48 : 22;
  const p = new Uint8Array(size);
  p[0] = 0xc1;
  p[1] = size;
  p[2] = 0xf3;
  p[3] = 0x05;
  const w = (o, v) => {
    p[o] = v & 0xff;
    p[o + 1] = (v >> 8) & 0xff;
  };
  const d = (o, v) => {
    p[o] = v & 0xff;
    p[o + 1] = (v >> 8) & 0xff;
    p[o + 2] = (v >> 16) & 0xff;
    p[o + 3] = (v >>> 24) & 0xff;
  };
  w(4, ev.level);
  w(6, ev.point); // 短包用的就是这个（WORD）
  w(8, ev.maxLife);
  w(10, ev.maxMana);
  w(12, ev.maxBp);
  w(14, ev.fruitAdd ?? 0);
  w(16, ev.maxFruit ?? 0);
  w(18, 0);
  w(20, 0);
  if (extra) {
    // +22/+23 是对齐洞（结构体没 pack，DWORD 要从 +24 开始）
    d(24, ev.point);
    d(28, ev.maxLife);
    d(32, ev.maxMana);
    d(36, ev.maxBp);
    d(40, ev.exp);
    d(44, ev.next);
  }
  return Array.from(p);
}

/** 0x9C：`C3 len 9C idHi idLo pad expHi(2) expLo(2) dmg(2)` */
function dieExpPacket(id, exp, damage = 10) {
  const p = new Uint8Array(18);
  p[0] = 0xc3;
  p[1] = 18;
  p[2] = 0x9c;
  p[3] = ((id >> 8) & 0x7f) | 0x80;
  p[4] = id & 0xff;
  p[5] = 0; // 对齐洞
  const hi = (exp >>> 16) & 0xffff;
  const lo = exp & 0xffff;
  p[6] = hi & 0xff;
  p[7] = (hi >> 8) & 0xff;
  p[8] = lo & 0xff;
  p[9] = (lo >> 8) & 0xff;
  p[10] = (damage >> 8) & 0xff;
  p[11] = damage & 0xff;
  return Array.from(p);
}

const c = await createClient('levelup');

try {
  const who = await loginAs(c, account, password);
  const st0 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
  console.log(`进图：${who.name} Lv${st0.level} selfId=${st0.selfId}`);
  await sleep(2500);

  /* ================= A. 经验累加（0x9C） ================= */
  console.log('\n[A] 0x9C 经验累加');
  const before = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.stats().info)'));
  const beforeExp = before.experience ?? 0;
  const expFill0 = await c.ev(`document.querySelector('.hv-exp-fill')?.style.width ?? ''`);

  await c.ev(`__MU_APP__.inject('${hex(dieExpPacket(0x1f40, 1000))}')`);
  await sleep(400);
  const after = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.stats().info)'));
  check('经验 +1000', (after.experience ?? 0) === beforeExp + 1000, `${beforeExp} → ${after.experience}`);
  /*
   * 经验条只画「0..9 档内」的那一小段，`+1000` 在 6000 万里通常看不出宽度变化，
   * 所以这里不比前后，而是拿**独立算出来的期望宽度**对 DOM。
   */
  const expFill1 = parseFloat(
    await c.ev(`document.querySelector('.hv-exp-fill')?.style.width ?? 'NaN'`)
  );
  const want = expectExpWidth(after.experience ?? 0, after.nextExperience ?? 0, st0.level ?? 99);
  check(
    '经验条宽度 = 档内余量公式（198 × 档内比例）',
    Math.abs(expFill1 - want) <= 1,
    `dom=${expFill1} want=${want}（之前 ${expFill0}）`
  );
  check('nextExperience 有值（不会除零）', (after.nextExperience ?? 0) > 0, String(after.nextExperience));

  // 大数值也要跨过 16 位（服务端把 32 位经验拆成两个 WORD）
  const big = 70000;
  await c.ev(`__MU_APP__.inject('${hex(dieExpPacket(0x1f40, big))}')`);
  await sleep(300);
  const after2 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.stats().info)'));
  check(
    `经验 +${big}（跨 WORD 高低位拆分）`,
    (after2.experience ?? 0) === (after.experience ?? 0) + big,
    `${after.experience} → ${after2.experience}`
  );

  /* ================= B. 升级长包（48 字节） ================= */
  console.log('\n[B] 0xF3/0x05 升级（GAMESERVER_EXTRA 长包）');
  await c.ev('__MU_APP__.fxClear()');
  const pkt = levelUpPacket({
    level: (st0.level ?? 99) + 1,
    point: 7,
    maxLife: 3400,
    maxMana: 1200,
    maxBp: 1900,
    exp: 123456,
    next: 234567,
  });
  check('包长 48', pkt.length === 48, String(pkt.length));
  check('ViewPoint 在 +24（+22/+23 是对齐洞）', pkt[24] === 7 && pkt[22] === 0 && pkt[23] === 0, hex(pkt.slice(20, 30)));

  await c.ev(`__MU_APP__.inject('${hex(pkt)}')`);
  await sleep(600);
  const st1 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
  check('等级 +1', st1.level === (st0.level ?? 99) + 1, `${st0.level} → ${st1.level}`);
  const info1 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.stats().info)'));
  check('上限更新（HP/MP/BP）', info1.maxLife === 3400 && info1.maxMana === 1200 && info1.maxBp === 1900, `${info1.maxLife}/${info1.maxMana}/${info1.maxBp}`);
  check('**升级回满血蓝**（原版 CA+28 = CA+32）', info1.life === 3400 && info1.mana === 1200, `${info1.life}/${info1.mana}`);
  check('可分配点 = 7', info1.levelUpPoint === 7, String(info1.levelUpPoint));
  check('经验/下一级经验用服务端值', info1.experience === 123456 && info1.nextExperience === 234567, `${info1.experience}/${info1.nextExperience}`);

  /* ================= C. 升级特效 ================= */
  console.log('\n[C] 升级特效（15 道 joint + 光环）');
  const beams = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.fxBeams())'));
  const sprites = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.fxSprites())'));
  check('15 道 joint 光束', beams.length >= 15, `${beams.length} 条`);
  check('光束用的是 JointSpirit01', beams.every(b => /JointSpirit/i.test(b.file)), beams[0]?.file);
  check('光环/法阵至少 2 片', sprites.length >= 2, `${sprites.length} 片`);

  /* ================= D. 短包（22 字节）走公式兜底 ================= */
  console.log('\n[D] 短包（22 字节）→ 下一级经验用公式算');
  const short = levelUpPacket(
    { level: 50, point: 3, maxLife: 1200, maxMana: 600, maxBp: 900 },
    false
  );
  check('包长 22', short.length === 22, String(short.length));
  await c.ev(`__MU_APP__.inject('${hex(short)}')`);
  await sleep(500);
  const info2 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.stats().info)'));
  // 10 * 50² * (50+9) = 1,475,000
  check('nextExperience = 10·lvl²·(lvl+9) = 1475000', info2.nextExperience === 1475000, String(info2.nextExperience));
  check('短包也把血蓝回满', info2.life === 1200 && info2.mana === 600, `${info2.life}/${info2.mana}`);

  /* ================= E. 真机：连接仍然健康 ================= */
  console.log('\n[E] 真服务端');
  check('连接还在', (await c.ev('__MU_APP__.state().connected')) === true);
  const p05 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.packets(0xf3).filter(p => p.sub === 0x05))'));
  console.log(`  服务端下发的 0xF3/05 条数：${p05.length}（练级才有，探针里正常是 0）`);

  const shot = await c.shot('levelup');
  console.log(`截图：${shot}`);
} finally {
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await c.close();
  process.exit(fail === 0 ? 0 : 1);
}
