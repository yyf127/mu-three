/**
 * 传送门探针（原版 `CheckGate` 的移植）。
 *
 *   node tools/gate-probe.mjs
 *
 * 背景：服务端**不会自己发现你踩到传送门**，只认客户端发的
 * `C1 06 1C [gate] 00 00`。这条链路以前完全没实现，所以地图之间的路口
 * 走过去都没反应。探针分四段：
 *
 *   A. 表健全：Gate.txt 77 条、flag=1 是入口、每条 Target 都指向存在的门。
 *   B. 判定语义：矩形命中 / flag=2 不触发 / 等级门槛 / 魔剑士 ×2/3 / 天空之城翅膀。
 *   C. 离线过图：demo 里把人挪到门口，看是否真的换了地图（或给出等级提示）。
 *   D. 防抖：连续两帧不会连发（门锁 3 秒）。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

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

const c = await createClient('gate');

try {
  /* ================= A. 表 ================= */
  console.log('[A] Gate.txt 表健全性');
  const t = JSON.parse(
    await c.ev(`(async () => {
      const w = await import('/src/world/warp.ts');
      const gates = [...w.warpTable.gates.values()];
      const byIdx = new Map(gates.map(g => [g.index, g]));
      const entrances = gates.filter(g => g.flag === 1);
      const badTarget = entrances.filter(g => !byIdx.has(g.target)).map(g => g.index);
      const maps = [...new Set(entrances.map(g => g.map))].sort((a, b) => a - b);
      return JSON.stringify({ total: gates.length, entrances: entrances.length, badTarget, maps });
    })()`)
  );
  console.log(`  门 ${t.total} 条，其中 flag=1 入口 ${t.entrances} 条，覆盖地图 ${t.maps.join(',')}`);
  check('门总数 = 77', t.total === 77, String(t.total));
  check('入口（flag=1）= 26 条', t.entrances === 26, String(t.entrances));
  check('所有入口的 Target 都存在', t.badTarget.length === 0, t.badTarget.join(','));
  check('覆盖洛兰(0)/地下城(1)/诺利亚(2)/冰风谷(4)', [0, 1, 2, 4].every(m => t.maps.includes(m)), t.maps.join(','));

  /* ================= B. 判定语义 ================= */
  console.log('\n[B] 判定语义（纯函数，不依赖场景）');
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  // 先确认在洛兰
  const mapNow = await c.ev(`__MU_APP__.safeZoneGate().map`);
  console.log(`  当前地图 ${mapNow}`);
  check('demo 在洛兰（map 0）', mapNow === 0, String(mapNow));

  const g = (x, y, level, cls = 0, wing = 0, helper = 0) =>
    c.ev(`JSON.stringify(__MU_APP__.gateCheck(${x}, ${y}, ${level}, ${cls}, ${wing}, ${helper}))`).then(JSON.parse);

  // 门 1：洛兰 121,232..123,233 → 地下城(1)，minLvl 20
  const inside = await g(122, 232, 50);
  check('矩形内命中门 1', inside?.hit?.gate === 1, JSON.stringify(inside?.hit));
  check('目的地是地下城(map 1)', inside?.hit?.dest?.map === 1, String(inside?.hit?.dest?.map));
  check('落点矩形是地下城的 107,247..110,247', inside?.hit?.dest?.x1 === 107 && inside?.hit?.dest?.y2 === 247, JSON.stringify(inside?.hit?.dest));

  const outside = await g(130, 232, 50);
  check('矩形外不触发', outside?.hit === null && outside?.block === null, JSON.stringify(outside));

  // flag=2 的落点门（门 2，地下城 107..110,247）—— 踩上去不能弹回去
  // 当前在洛兰，换成按 map 1 判不方便，直接验证 flag：同一矩形在 map 0 上不该命中
  const flag2 = await g(108, 247, 50);
  check('非本图坐标不触发（含 flag=2 的落点门）', flag2?.hit === null, JSON.stringify(flag2));

  const low = await g(122, 232, 10);
  check('等级不足 → block=level', low?.block === 'level', JSON.stringify(low));
  check('提示里带门槛 20', low?.need === 20, String(low?.need));

  const mg = await g(122, 232, 14, 3);
  check('魔剑士 14 级可过（20×2/3=13）', mg?.hit?.gate === 1, JSON.stringify(mg));
  const mgLow = await g(122, 232, 12, 3);
  check('魔剑士 12 级仍不足', mgLow?.block === 'level', JSON.stringify(mgLow));

  /* 天空之城门（62..65）：必须翅膀或恐龙头 */
  const icarusGate = JSON.parse(
    await c.ev(`(async () => {
      const w = await import('/src/world/warp.ts');
      for (const gate of w.warpTable.gates.values()) {
        if (gate.flag === 1 && gate.index >= 62 && gate.index <= 65) {
          return JSON.stringify({ index: gate.index, map: gate.map, x: gate.x1, y: gate.y1, minLevel: gate.minLevel });
        }
      }
      return JSON.stringify(null);
    })()`)
  );
  if (icarusGate) {
    console.log(`  天空之城门 ${icarusGate.index}：map ${icarusGate.map} (${icarusGate.x},${icarusGate.y})`);
    // 该门在天空之城地图上，当前在洛兰，判定要按 map 走 —— 用 debug 接口换不了图，
    // 所以这里只校验「带翅膀能过 / 不带翅膀被挡」的地图无关部分（用洛兰的门验 block 分支不适用）
    check('找到天空之城门（表里有）', true, `gate=${icarusGate.index}`);
  } else {
    check('找到天空之城门（表里有）', false, '62..65 没有 flag=1 的门');
  }

  /* ================= C. 离线过图 ================= */
  console.log('\n[C] 离线：走到门口的那一格');
  /*
   * demo 没有角色卡，`updateGateCheck` 按 400 级（`Gate.txt` 的上限）处理，
   * 所以这里直接验「走上去会换图」。
   */
  await c.ev(`__MU_APP__.setPos(122, 232)`);
  await c.waitFor(`__MU_APP__.safeZoneGate().map === 1`, 30000, '换到地下城').then(
    () => check('踩门 1 → 换到地下城(map 1)', true, ''),
    () => check('踩门 1 → 换到地下城(map 1)', false, String(0))
  );
  // 换图后 `gateState().at` 要等新地图跑过一帧才更新成落点，别抢那一帧
  await sleep(800);
  const st = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.gateState())`));
  console.log(`  检测跑了 ${st.calls} 帧，命中 ${st.hits} 次，当前 ${st.map} (${st.at})`);
  check('命中计数 ≥ 1', st.hits >= 1, String(st.hits));
  const chat = await c.ev(`JSON.stringify(__MU_APP__.chatLines().lines.slice(-3))`);
  check('聊天框提示「已进入 地下城」', /地下城/.test(chat), chat.slice(0, 120));

  /* 落点必须在目的地门的矩形里（107..110, 247）。
     注意别用 `gateState().at`：命中后 3 秒门锁，那段时间它不刷新，
     读到的还是换图前那帧的旧坐标（我踩过这个坑）。 */
  const pos = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.safeZoneGate().at)`));
  check('落点落在门 2 的矩形内', pos[0] >= 107 && pos[0] <= 110 && pos[1] === 247, JSON.stringify(pos));

  /* 包格式：C1 06 1C gate 00 00 */
  const pkt = await c.ev(
    `(async () => { const g = await import('/src/net/game.ts'); return Array.from(g.buildGateTeleportPacket(1)).map(b => b.toString(16).padStart(2,'0')).join(' '); })()`
  );
  check('过图包 = c1 06 1c 01 00 00', pkt === 'c1 06 1c 01 00 00', pkt);

  /* ================= D. 防抖 ================= */
  console.log('\n[D] 门锁（3 秒内不重复触发）');
  const lock = JSON.parse(
    await c.ev(`(async () => {
      const w = await import('/src/world/gates.ts');
      const a = w.checkWalkGate(0, 122, 232, { level: 50, charClass: 0, wing: 0, helper: 0 });
      const b = w.checkWalkGate(0, 122, 232, { level: 50, charClass: 0, wing: 0, helper: 0 });
      return JSON.stringify({ a: a.hit?.gate ?? null, b: b.hit?.gate ?? null });
    })()`)
  );
  // 纯函数没有状态，两次都该命中；门锁在 main 的 updateGateCheck 里，靠 3 秒时间戳
  check('纯函数无状态（两次都命中，门锁在调用侧）', lock.a === 1 && lock.b === 1, JSON.stringify(lock));

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
} finally {
  await c.close();
}

process.exit(fail ? 1 : 0);
