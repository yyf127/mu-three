/**
 * 下行包补齐探针（阶段 AY）。
 *
 *   node tools/downlink-probe.mjs
 *   node tools/downlink-probe.mjs 账号 密码
 *
 * 这一批补的是「服务端会发、客户端以前完全没接」的 9 条：
 *
 *   0x1F 召唤物视野 / 0x25 单件换装 / 0x45 变身 / 0x46 地形属性
 *   0x0F 天气 / 0x29 特殊物品计时 / 0x2C 果实 / 0x5A 战盟名 / 0x5B 战盟成员
 *
 * 全部按服务端结构体自己造字节（`Viewport.h` / `ItemManager.h` / `Protocol.h` /
 * `Party.cpp:229`），从 `__MU_APP__.inject()` 灌进**收包路径**，
 * 不调用内部函数 —— 注入器和解析器同错自洽这条吃过亏。
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
const ascii = (s, n) => {
  const out = new Array(n).fill(0);
  for (let i = 0; i < n && i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
const u16le = v => [v & 0xff, (v >> 8) & 0xff];
const u32le = v => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

/** 0x12 玩家视野（32 字节/条） */
function viewportPlayer(p) {
  const r = new Array(32).fill(0);
  r[0] = ((p.id >> 8) & 0x7f) | 0x80;
  r[1] = p.id & 0xff;
  r[2] = p.x;
  r[3] = p.y;
  for (let i = 0; i < 11; i++) r[4 + i] = p.charSet?.[i] ?? 0;
  const ss = u16le(p.skillState ?? 0);
  r[16] = ss[0];
  r[17] = ss[1];
  const nm = ascii(p.name ?? '', 10);
  for (let i = 0; i < 10; i++) r[18 + i] = nm[i];
  r[28] = p.tx ?? p.x;
  r[29] = p.ty ?? p.y;
  r[30] = ((p.dir ?? 0) << 4) | (p.pk ?? 0);
  const total = 5 + 32;
  return [0xc2, (total >> 8) & 0xff, total & 0xff, 0x12, 1, ...r];
}

/** 0x1F 召唤物视野（22 字节/条） */
function viewportSummon(s) {
  const r = new Array(22).fill(0);
  r[0] = ((s.id >> 8) & 0x7f) | 0x80;
  r[1] = s.id & 0xff;
  r[2] = s.type;
  const ss = u16le(s.skillState ?? 0);
  r[4] = ss[0];
  r[5] = ss[1];
  r[6] = s.x;
  r[7] = s.y;
  r[8] = s.tx ?? s.x;
  r[9] = s.ty ?? s.y;
  r[10] = ((s.dir ?? 0) << 4) | (s.pk ?? 0);
  const nm = ascii(s.name ?? '', 10);
  for (let i = 0; i < 10; i++) r[11 + i] = nm[i];
  const total = 5 + 22;
  return [0xc2, (total >> 8) & 0xff, total & 0xff, 0x1f, 1, ...r];
}

/** 0x25 单件换装：`C1 09 25 [idHi][idLo][info0][info1][info2][info3]` */
function itemChange(c) {
  const info1 = ((c.slot & 0x0f) << 4) | (c.level & 0x0f);
  const info0 = c.type < 0 ? 0xff : c.type & 0xff;
  const info3 = c.type >= 0x100 ? 0x80 : 0;
  return [0xc1, 9, 0x25, (c.id >> 8) & 0xff, c.id & 0xff, info0, info1, 0, info3];
}

/** 0x45 变身（32 字节/条） */
function viewportChange(c) {
  const r = new Array(32).fill(0);
  r[0] = ((c.id >> 8) & 0x7f) | 0x80;
  r[1] = c.id & 0xff;
  r[2] = c.x;
  r[3] = c.y;
  r[4] = c.skin;
  const ss = u16le(c.skillState ?? 0);
  r[6] = ss[0];
  r[7] = ss[1];
  const nm = ascii(c.name ?? '', 10);
  for (let i = 0; i < 10; i++) r[8 + i] = nm[i];
  r[18] = c.tx ?? c.x;
  r[19] = c.ty ?? c.y;
  r[20] = ((c.dir ?? 0) << 4) | (c.pk ?? 0);
  for (let i = 0; i < 11; i++) r[21 + i] = c.charSet?.[i] ?? 0;
  const total = 5 + 32;
  return [0xc2, (total >> 8) & 0xff, total & 0xff, 0x45, 1, ...r];
}

/** 0x46 地形属性：type 0 矩形（4B/条）/ 1 单格（2B/条），flag 0 置位 / 1 清位 */
function mapAttr(t, attr, flag, cells) {
  const per = t === 0 ? 4 : 2;
  const body = cells.flatMap(c => (t === 0 ? [c.x, c.y, c.tx, c.ty] : [c.x, c.y]));
  const size = 7 + body.length;
  return [0xc1, size, 0x46, t, attr, flag, cells.length, ...body];
}

/** 0x0F 天气 */
function weather(w) {
  return [0xc1, 4, 0x0f, w];
}

/** 0x29 特殊物品计时：`C3 08 29 [number][time:4]` */
function specialTime(number, time) {
  return [0xc3, 8, 0x29, number, ...u32le(time)];
}

/** 0x2C 果实结果（EXTRA 长包 28 字节） */
function fruitResult(f) {
  const p = new Array(28).fill(0);
  p[0] = 0xc1;
  p[1] = 28;
  p[2] = 0x2c;
  p[3] = f.result ?? 0;
  const put = (o, v) => {
    const b = u32le(v);
    for (let i = 0; i < 4; i++) p[o + i] = b[i];
  };
  put(4, 0); // ViewValue
  put(8, f.point ?? 0);
  put(12, f.strength ?? 0);
  put(16, f.dexterity ?? 0);
  put(20, f.vitality ?? 0);
  put(24, f.energy ?? 0);
  return p;
}

/** 0x5A 战盟名 + 标志（42 字节/条） */
function guildInfo(id, name, mark) {
  const r = new Array(42).fill(0);
  r[0] = (id >> 8) & 0xff;
  r[1] = id & 0xff;
  const nm = ascii(name, 8);
  for (let i = 0; i < 8; i++) r[2 + i] = nm[i];
  for (let i = 0; i < 32; i++) r[10 + i] = mark[i] ?? i & 0x0f;
  const total = 5 + 42;
  return [0xc2, (total >> 8) & 0xff, total & 0xff, 0x5a, 1, ...r];
}

/** 0x5B 战盟成员映射（4 字节/条） */
function guildMember(user, guild) {
  const total = 5 + 4;
  return [0xc2, (total >> 8) & 0xff, total & 0xff, 0x5b, 1, (user >> 8) & 0xff, user & 0xff, (guild >> 8) & 0xff, guild & 0xff];
}

/**
 * 等某个实体的某个字段变成期望值。
 *
 * 换模型（0x45）要重新加载 bmd，是异步的 —— 固定 `sleep` 在慢机器上会偶发
 * 抓到中间态（`skin` 已经是 3、`kind` 还是 player），所以这里轮询。
 */
async function waitField(id, pick, want, ms = 8000) {
  for (let t = 0; t < ms; t += 200) {
    const e = JSON.parse(
      await c.ev(`JSON.stringify(__MU_APP__.state().remotes.find(r => r.id === ${id}) ?? null)`)
    );
    if (e && pick(e) === want) return e;
    await sleep(200);
  }
  return JSON.parse(
    await c.ev(`JSON.stringify(__MU_APP__.state().remotes.find(r => r.id === ${id}) ?? null)`)
  );
}

const c = await createClient('downlink');

try {
  const who = await loginAs(c, account, password);
  const st = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
  const selfId = st.selfId;
  console.log(`进图：${who.name} selfId=${selfId} 地图=${st.mapName}`);
  await sleep(2500);

  /*
   * 先记下**进图阶段真服务端**发了哪些本批包（之后 inject 会把这些记录冲掉，
   * 因为 inject 也走同一条收包路径）。
   */
  const boot = JSON.parse(
    await c.ev(`JSON.stringify([0x0f,0x1f,0x25,0x45,0x46,0x29,0x2c,0x5a,0x5b].map(h => [h, __MU_APP__.packets(h).length]))`)
  );

  const FAKE = 3000; // 0x0BB8，避开自己的 9001
  const px = Math.round(st.player.x);
  const py = Math.round(st.player.y);

  /* ================= A. 0x12 + CharSet 外观 ================= */
  console.log('\n[A] 0x12 视野里的 CharSet → 远程玩家外观');
  // CharSet[3] = (helm<<4)|armor，[4] = (pants<<4)|gloves，[5] = (boots<<4)|wing
  const charSet = [0x20, 0, 0, (0 << 4) | 1, (2 << 4) | 3, (4 << 4) | 0, 0, 0, 0, 0, 0];
  await c.ev(`__MU_APP__.inject('${hex(viewportPlayer({ id: FAKE, x: px + 2, y: py, charSet, name: 'Probe1' }))}')`);
  // 建模型是异步的（要加载 player.bmd + 五件防具），轮询等它出现
  let list = [];
  let fake = null;
  for (let i = 0; i < 60; i++) {
    list = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state().remotes)'));
    fake = list.find(r => r.id === FAKE);
    if (fake) break;
    await sleep(200);
  }
  check('0x12 建出远程玩家', !!fake, fake ? fake.name : 'missing');
  check('名字对', fake?.name === 'Probe1', fake?.name);
  // 头盔 tier0 = 7*32+0=224、铠甲 tier1 = 8*32+1=257、护腿 tier2 = 9*32+2=290、
  // 手套 tier3 = 10*32+3=323、靴子 tier4 = 11*32+4=356、翅膀 0 = 12*32+0=384
  check(
    '五件装备按 CharSet 解出来了',
    fake && [224, 257, 290, 323, 356, 384].every((t, i) => fake.equip[2 + i] === t),
    JSON.stringify(fake?.equip?.slice(2, 8))
  );

  /* ================= B. 0x25 单件换装 ================= */
  console.log('\n[B] 0x25 单件换装 / 空槽');
  await c.ev(`__MU_APP__.inject('${hex(itemChange({ id: FAKE, slot: 3, level: 7, type: 8 * 32 + 5 }))}')`);
  await sleep(900);
  list = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state().remotes)'));
  fake = list.find(r => r.id === FAKE);
  check('铠甲换成 tier5（8*32+5=261）', fake?.equip[3] === 261, String(fake?.equip[3]));

  await c.ev(`__MU_APP__.inject('${hex(itemChange({ id: FAKE, slot: 2, level: 0, type: -1 }))}')`);
  await sleep(900);
  list = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state().remotes)'));
  fake = list.find(r => r.id === FAKE);
  check('头盔槽位清空（0xFF → -1，退回职业默认）', fake?.equip[2] === -1, String(fake?.equip[2]));

  /* ================= C. 0x45 变身 / 变回 ================= */
  console.log('\n[C] 0x45 变身');
  await c.ev(`__MU_APP__.inject('${hex(viewportChange({ id: FAKE, x: px + 2, y: py, skin: 3, name: 'Probe1', charSet }))}')`);
  // 换模型要重新加载 bmd，固定 sleep 会在慢机器上偶发失败 → 轮询
  fake = await waitField(FAKE, e => e.cls, 3);
  check('skin=3 → 实体换成怪物模型', fake?.skin === 3 && fake.cls === 3, `skin=${fake?.skin} cls=${fake?.cls} kind=${fake?.kind}`);
  check('名字保留', fake?.name === 'Probe1', fake?.name);

  await c.ev(`__MU_APP__.inject('${hex(viewportChange({ id: FAKE, x: px + 2, y: py, skin: 0, name: 'Probe1', charSet }))}')`);
  fake = await waitField(FAKE, e => e.kind, 'player');
  check('skin=0 → 变回人形并恢复装备', fake?.skin === 0 && fake.kind === 'player' && fake.equip[3] === 257, JSON.stringify({ skin: fake?.skin, kind: fake?.kind, armor: fake?.equip?.[3] }));

  /* ================= D. 0x46 地形属性 ================= */
  console.log('\n[D] 0x46 地形属性（血堡大门的开关就是它）');
  const cell = { x: px + 5, y: py + 5, tx: px + 6, ty: py + 6 };
  const before = await c.ev(`__MU_APP__.mapAttrAt(${cell.x}, ${cell.y})`);
  await c.ev(`__MU_APP__.inject('${hex(mapAttr(0, 4, 0, [cell]))}')`);
  await sleep(300);
  const setRect = await c.ev(`__MU_APP__.mapAttrAt(${cell.x}, ${cell.y})`);
  check('矩形置位 attr=4（TW_NOMOVE）', (setRect & 4) !== 0, `${before} → ${setRect}`);
  check('矩形覆盖到对角格', ((await c.ev(`__MU_APP__.mapAttrAt(${cell.tx}, ${cell.ty})`)) & 4) !== 0);

  await c.ev(`__MU_APP__.inject('${hex(mapAttr(0, 4, 1, [cell]))}')`);
  await sleep(300);
  const cleared = await c.ev(`__MU_APP__.mapAttrAt(${cell.x}, ${cell.y})`);
  check('flag=1 清位', (cleared & 4) === 0, `${setRect} → ${cleared}`);

  await c.ev(`__MU_APP__.inject('${hex(mapAttr(1, 8, 0, [{ x: cell.x, y: cell.y }]))}')`);
  await sleep(300);
  check('单格置位 attr=8（TW_NOGROUND）', ((await c.ev(`__MU_APP__.mapAttrAt(${cell.x}, ${cell.y})`)) & 8) !== 0);
  await c.ev(`__MU_APP__.inject('${hex(mapAttr(1, 8, 1, [{ x: cell.x, y: cell.y }]))}')`);

  /* ================= E. 0x0F 天气 ================= */
  console.log('\n[E] 0x0F 天气');
  await c.ev(`__MU_APP__.inject('${hex(weather(0x1f))}')`); // 类型 1 雨 / 强度 15
  await sleep(500);
  let w = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.weather())'));
  check('下雨：雨层可见', w.rainVisible === true, JSON.stringify(w));
  check('强度 15 → 雨的强度 = 1', Math.abs(w.rain - 1) < 0.01, String(w.rain));

  await c.ev(`__MU_APP__.inject('${hex(weather(0x00))}')`);
  await sleep(400);
  w = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.weather())'));
  check('转晴：雨层隐藏', w.rainVisible === false, JSON.stringify(w));

  /* ================= F. 0x29 特殊物品计时 ================= */
  console.log('\n[F] 0x29 特殊物品计时');
  await c.ev(`__MU_APP__.inject('${hex(specialTime(2, 60))}')`);
  await sleep(300);
  const sp = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.specialTime())'));
  check('记下了 number=2', sp?.number === 2, JSON.stringify(sp));
  check('剩余时间 58~60 秒', sp && sp.remaining >= 58 && sp.remaining <= 60, String(sp?.remaining));

  /* ================= G. 0x2C 果实 ================= */
  console.log('\n[G] 0x2C 果实结果');
  const info0 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.stats().info)'));
  await c.ev(`__MU_APP__.inject('${hex(fruitResult({ result: 0, strength: 1111, dexterity: 222, vitality: 333, energy: 444, point: 9 }))}')`);
  await sleep(400);
  const info1 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.stats().info)'));
  check('四维被服务端值覆盖', info1.strength === 1111 && info1.dexterity === 222 && info1.vitality === 333 && info1.energy === 444,
    `${info1.strength}/${info1.dexterity}/${info1.vitality}/${info1.energy}（原 ${info0.strength}/${info0.dexterity}/${info0.vitality}/${info0.energy}）`);
  check('可分配点同步', info1.levelUpPoint === 9, String(info1.levelUpPoint));

  const failPkt = fruitResult({ result: 3 });
  const logBefore = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.chatLog())')).lines.length;
  await c.ev(`__MU_APP__.inject('${hex(failPkt)}')`);
  await sleep(300);
  const logAfter = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.chatLog())')).lines.length;
  check('result=3 给失败提示（聊天多一条）', logAfter > logBefore, `${logBefore} → ${logAfter}`);

  /* ================= H. 0x5A / 0x5B 战盟 ================= */
  console.log('\n[H] 0x5A 战盟名 / 0x5B 成员映射');
  const mark = Array.from({ length: 32 }, (_, i) => i & 0x0f);
  await c.ev(`__MU_APP__.inject('${hex(guildInfo(FAKE, 'PROBEG', mark))}')`);
  await sleep(500);
  list = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state().remotes)'));
  fake = list.find(r => r.id === FAKE);
  check('战盟名落到实体上', fake?.guild === 'PROBEG', fake?.guild);
  check('32 字节标志也带上了', fake?.mark === 32, String(fake?.mark));

  await c.ev(`__MU_APP__.inject('${hex(guildMember(FAKE, 0x0042))}')`);
  await sleep(300);
  const gm = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.guildMembers())'));
  check('0x5B 记下 用户→盟 映射', gm.length === 1 && gm[0].user === FAKE && gm[0].guild === 0x42, JSON.stringify(gm));

  /* ================= I. 真机：这些包真的会来 ================= */
  console.log('\n[I] 真服务端');
  const seen = boot.filter(([, n]) => n > 0).map(([h, n]) => `0x${h.toString(16)}=${n}`);
  console.log(`  进图阶段真服务端发过的本批包：${seen.join(' ') || '（无）'}`);
  // 进图时服务端一定会发一次天气（`ObjectManager.cpp:2787` 每次进图都发）
  const weatherBoot = boot.find(([h]) => h === 0x0f)?.[1] ?? 0;
  check('进图时服务端真的发了 0x0F 天气', weatherBoot >= 1, `${weatherBoot} 条`);
  check('连接还在', (await c.ev('__MU_APP__.state().connected')) === true);

  // 装备模型加载失败会打 warning（`[player] 缺装备模型 …`），有就说明解码映射错
  const missModel = c.logs.filter(l => /缺装备模型|找不到职业默认模型/.test(l));
  check('五件防具模型都加载成功（没有缺模型警告）', missModel.length === 0, missModel.slice(0, 2).join(' | '));

  console.log(`截图：${await c.shot('downlink')}`);
} finally {
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await c.close();
  process.exit(fail === 0 ? 0 : 1);
}
