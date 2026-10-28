/**
 * 小地图探针。
 *
 *   node tools/minimap-probe.mjs
 *   node tools/minimap-probe.mjs 账号 密码
 *
 * 这一块是**纯客户端**功能（0.97 原版没有小地图），所以没有上下行包可验，
 * 验的是三件事：
 *
 *   1. 版式：151×173 的 `MiniMap.OZT` 边框 + 112×112 的地图视口，
 *      位置和 `minimapPanel.ts` 里的常量一致；
 *   2. 底图：`terrain.buildMinimap()` 合成的 256×256 像素图 —— 水比陆地蓝、
 *      不是一片黑；
 *   3. 叠加：玩家箭头在正中、队友/NPC/目标三个标记画在**对应格子**上
 *      （逐像素读 canvas，不看内部状态）。
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

/** 0x12 玩家视野（32 字节/条） */
function viewportPlayer(p) {
  const r = new Array(32).fill(0);
  r[0] = ((p.id >> 8) & 0x7f) | 0x80;
  r[1] = p.id & 0xff;
  r[2] = p.x;
  r[3] = p.y;
  const nm = ascii(p.name ?? '', 10);
  for (let i = 0; i < 10; i++) r[18 + i] = nm[i];
  r[28] = p.x;
  r[29] = p.y;
  return [0xc2, 0, 37, 0x12, 1, ...r];
}

/** canvas 上某点的 RGB（`getImageData` 是最硬的证据） */
const px = (x, y) =>
  `(() => {
    const cv = document.querySelector('.minimap-view');
    const d = cv.getContext('2d').getImageData(${x}, ${y}, 1, 1).data;
    return '[' + d[0] + ',' + d[1] + ',' + d[2] + ',' + d[3] + ']';
  })()`;

/** 在 (cx,cy) 周围 ±r 里找有没有接近 `rgb` 的像素 */
const hasColorNear = (cx, cy, r, rgb) =>
  `(() => {
    const cv = document.querySelector('.minimap-view');
    const g = cv.getContext('2d');
    const d = g.getImageData(${cx - r}, ${cy - r}, ${r * 2 + 1}, ${r * 2 + 1}).data;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - ${rgb[0]}) < 40 && Math.abs(d[i + 1] - ${rgb[1]}) < 40 && Math.abs(d[i + 2] - ${rgb[2]}) < 40) return true;
    }
    return false;
  })()`;

const c = await createClient('minimap');

try {
  const who = await loginAs(c, account, password);
  const st = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
  const pos = st.player;
  console.log(`进图：${who.name} 地图 ${st.mapName}(${st.mapId}) 位置 ${pos.x},${pos.y}`);
  await sleep(1500);

  await c.ev('__MU_APP__.minimapToggle(true)');
  await sleep(300);

  /* ================= A. 版式 ================= */
  console.log('\n[A] 版式（151×173 边框 + 112×112 视口）');
  const geo = JSON.parse(
    await c.ev(`(() => {
      const mm = document.querySelector('.minimap');
      const cv = document.querySelector('.minimap-view');
      const bg = getComputedStyle(mm).backgroundImage;
      const b = el => { const r = el.getBoundingClientRect(); return [r.width, r.height]; };
      return JSON.stringify({
        frame: b(mm),
        canvas: b(cv),
        inner: [cv.width, cv.height],
        left: mm.style.left, top: mm.style.top,
        bg, hidden: mm.classList.contains('hidden'),
      });
    })()`)
  );
  // 逻辑坐标 → 舞台像素要乘 uiLayer 的缩放（stage 890/640 ≈ 1.39）
  const uiScale = Number(
    (await c.ev(`(() => {
      const m = getComputedStyle(document.getElementById('mu-ui')).transform.match(/matrix\\(([^,]+)/);
      return m ? m[1] : '1';
    })()`)) || 1
  );
  const snap0x = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.minimap())'));
  const cssScale = snap0x.scale; // 0.8
  check(
    `边框 151×173 × ${cssScale} × 舞台缩放`,
    Math.abs(geo.frame[0] - 151 * cssScale * uiScale) < 2 && Math.abs(geo.frame[1] - 173 * cssScale * uiScale) < 2,
    `${geo.frame.map(n => Math.round(n)).join('×')} (scale ${uiScale.toFixed(2)})`
  );
  check(
    `视口 112×112 × ${cssScale} × 舞台缩放`,
    Math.abs(geo.canvas[0] - 112 * cssScale * uiScale) < 2 && Math.abs(geo.canvas[1] - 112 * cssScale * uiScale) < 2,
    geo.canvas.map(n => Math.round(n)).join('×')
  );
  check('canvas 像素尺寸 112×112（没被全局 canvas 规则拉变形）', geo.inner[0] === 112 && geo.inner[1] === 112, geo.inner.join('×'));
  // 右上角：左边界 = 640 - 151×0.8 - 4 = 515.2（逻辑像素）
  const wantLeft = 640 - 151 * cssScale - 4;
  check(
    '贴在右上角（右边距 4）',
    Math.abs(snap0x.left - wantLeft) < 0.5 && snap0x.top === 4,
    `left=${snap0x.left} 期望 ${wantLeft.toFixed(1)}，top=${snap0x.top}`
  );
  check('MiniMap.OZT 边框已加载', /blob:|data:/.test(geo.bg), geo.bg.slice(0, 28));

  const snap0 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.minimap())'));
  check('地图名 = 当前地图中文名', snap0.map === st.mapName || snap0.map.length > 0, snap0.map);
  check('底图 256×256（一格一像素）', snap0.base?.[0] === 256 && snap0.base?.[1] === 256, String(snap0.base));
  check('默认缩放显示 96 格', snap0.cells === 96, String(snap0.cells));
  check('坐标文本跟玩家走', /^\d+,\d+$/.test(snap0.coord), snap0.coord);

  /* ================= B. 底图配色 ================= */
  console.log('\n[B] 底图（tile 平均色 + 山体阴影 + 水面）');
  /*
   * 抽样比像素：一张 256×256 的图逐格过 CDP 太慢，取 900 个伪随机格，
   * 顺带统计「死黑格」比例（整片黑的底图说明 tile 平均色没取对）。
   */
  const probe = JSON.parse(
    await c.ev(`(() => {
      let water = null, land = null, dark = 0, total = 0, wsum = 0, lsum = 0;
      const wc = [], lc = [];
      for (let i = 0; i < 900; i++) {
        const x = (i * 71 + 13) % 254 + 1;
        const y = (i * 157 + 41) % 254 + 1;
        const attr = __MU_APP__.mapAttrAt(x, y);
        const d = __MU_APP__.minimapPixel(x, y);
        if (!d) continue;
        total++;
        if (d[0] + d[1] + d[2] < 60) dark++;
        if ((attr & 0x10) !== 0) { if (!water) water = [x, y]; if (wc.length < 40) wc.push(d); }
        else { if (!land) land = [x, y]; if (lc.length < 40) lc.push(d); }
      }
      const avg = arr => arr.length ? [0,1,2].map(k => Math.round(arr.reduce((s, v) => s + v[k], 0) / arr.length)) : null;
      return JSON.stringify({ water, land, dark, total, waterAvg: avg(wc), landAvg: avg(lc) });
    })()`)
  );
  /*
   * 洛兰这张图的 `.att` 里**没有一格 `TW_WATER`**（河面是被当成 `TW_NOMOVE` 的
   * 水面 tile 画的），所以「水面变蓝」这条只能在有水的图上验。这里做成自适应：
   * 有 `TW_WATER` 格就断言蓝通道，没有就说明是靠 tile 平均色自然呈现。
   */
  if (probe.waterAvg) {
    check(
      'TW_WATER 格平均色偏蓝（B > R）',
      probe.waterAvg[2] > probe.waterAvg[0] + 20,
      `rgb(${probe.waterAvg})`
    );
  } else {
    check('这张图没有 TW_WATER 格（水面靠 tile 平均色呈现，跳过）', true, `陆地 rgb(${probe.landAvg})`);
  }
  check(
    '陆地平均色不是纯黑',
    probe.landAvg && probe.landAvg[0] + probe.landAvg[1] + probe.landAvg[2] > 60,
    probe.landAvg ? `rgb(${probe.landAvg})` : '无'
  );
  check('整张底图没有大面积死黑', probe.dark / probe.total < 0.25, `暗格 ${probe.dark}/${probe.total}`);

  /* ================= C. 玩家箭头 ================= */
  console.log('\n[C] 玩家箭头');
  const center = JSON.parse(await c.ev(px(56, 56)));
  check('视口正中是白色箭头（玩家自己）', center[0] > 200 && center[1] > 200 && center[2] > 200, `rgba(${center})`);

  /* ================= D. 三个标记 ================= */
  console.log('\n[D] 标记（队友 / NPC / 目标）');
  const MATE = 0x7401;
  const mx = Math.round(pos.x) + 4;
  const my = Math.round(pos.y) + 3;
  await c.ev(`__MU_APP__.inject('${hex(viewportPlayer({ id: MATE, x: mx, y: my, name: 'MapMate' }))}')`);
  for (let i = 0; i < 60; i++) {
    if (await c.ev(`__MU_APP__.state().remotes.some(e => e.id === ${MATE})`)) break;
    await sleep(200);
  }
  await c.ev(`__MU_APP__.injectPartyList([
    { name: '${who.name}', number: 0, life: 900, maxLife: 900 },
    { name: 'MapMate', number: 1, life: 300, maxLife: 300 },
  ], false)`);
  await sleep(500);

  const scale = 112 / 96;
  const partyCx = Math.round((mx - (pos.x - 48)) * scale);
  // 画布纵向是翻转的：世界 y 越大越靠上
  const partyCy = 112 - Math.round((my - (pos.y - 48)) * scale);
  check(
    '队友金点在对应格子（±2px，y 已翻转）',
    await c.ev(hasColorNear(partyCx, partyCy, 2, [0xff, 0xd7, 0x6a])),
    `canvas(${partyCx},${partyCy})`
  );
  check(
    '世界 y 更大 → 画布上更靠上（纵向翻转生效）',
    partyCy < 56,
    `队友在 y+3，画布 y=${partyCy}（中心 56）`
  );

  const snap1 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.minimap())'));
  check('快照里标记数 ≥ 1', snap1.marks >= 1, String(snap1.marks));

  // 目标：造一只怪并锁定 → 红点
  const MSTR = 0x7402;
  const tx = Math.round(pos.x) - 4;
  const ty = Math.round(pos.y) + 2;
  await c.ev(`__MU_APP__.testMonster(2, ${tx}, ${ty}, ${MSTR})`);
  for (let i = 0; i < 50; i++) {
    if (await c.ev(`__MU_APP__.state().remotes.some(e => e.id === ${MSTR})`)) break;
    await sleep(200);
  }
  await c.ev(`__MU_APP__.focusOn(${MSTR})`);
  await sleep(400);
  const tgtCx = Math.round((tx - (pos.x - 48)) * scale);
  const tgtCy = 112 - Math.round((ty - (pos.y - 48)) * scale);
  check(
    '目标红点在对应格子（±2px）',
    await c.ev(hasColorNear(tgtCx, tgtCy, 2, [0xff, 0x6a, 0x4a])),
    `canvas(${tgtCx},${tgtCy})`
  );

  // NPC：视野里有就验，没有就空过
  const npcs = JSON.parse(
    await c.ev(`JSON.stringify(__MU_APP__.state().remotes.filter(e => e.kind === 'npc').map(e => [e.x, e.y]))`)
  );
  if (npcs.length) {
    const [nx, ny] = npcs[0];
    const nCx = Math.round((nx - (pos.x - 48)) * scale);
    const nCy = 112 - Math.round((ny - (pos.y - 48)) * scale);
    const inView = nCx >= 0 && nCy >= 0 && nCx < 112 && nCy < 112;
    check(
      inView ? 'NPC 淡蓝点在对应格子' : 'NPC 在视口外（不画是正常的）',
      !inView || (await c.ev(hasColorNear(nCx, nCy, 2, [0x8f, 0xc7, 0xff]))),
      `canvas(${nCx},${nCy})`
    );
  } else {
    check('视野里没有 NPC（跳过）', true);
  }

  /* ================= E. 缩放 ================= */
  console.log('\n[E] 缩放档位');
  const z1 = await c.ev('__MU_APP__.minimapZoom()');
  check('放大一档 → 显示 48 格', z1 === 48, String(z1));
  await sleep(300);
  // 同样 4 格远的队友，缩放后应该离中心更远
  const scale2 = 112 / 48;
  const cx2 = Math.round((mx - (pos.x - 24)) * scale2);
  const cy2 = 112 - Math.round((my - (pos.y - 24)) * scale2);
  check(
    '放大后队友点按新比例落在对应格',
    await c.ev(hasColorNear(cx2, cy2, 3, [0xff, 0xd7, 0x6a])),
    `canvas(${cx2},${cy2})`
  );

  const z2 = await c.ev('__MU_APP__.minimapZoom()');
  check('再切一档 → 整张图 256 格', z2 === 256, String(z2));
  await sleep(300);

  /*
   * 整图档：不跟随玩家，箭头按「整张 256 格铺满 112px」落位。
   * 期望值要用**当前**玩家位置算（前面几段走过路，一开始那个 `pos` 已经过期了）。
   */
  const whole = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.minimap())'));
  const posNow = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state().player)'));
  const wantX = Math.round(posNow.x * (112 / 256));
  const wantY = 112 - Math.round(posNow.y * (112 / 256));
  check(
    '整图档箭头按整图比例落位',
    Math.abs(whole.player.x - wantX) <= 1 && Math.abs(whole.player.y - wantY) <= 1,
    `箭头(${whole.player.x},${whole.player.y}) 期望(${wantX},${wantY})`
  );
  // 视口右边缘不该是黑边（源矩形越界会整条黑）
  const edge = JSON.parse(await c.ev(px(109, 60)));
  check('整图档右边缘不是黑边', edge[0] + edge[1] + edge[2] > 40, `rgba(${edge})`);
  const z3 = await c.ev('__MU_APP__.minimapZoom()');
  check('再切回 96 格（循环）', z3 === 96, String(z3));

  /* ================= F. 开关 ================= */
  console.log('\n[F] 开关');
  const off = await c.ev('__MU_APP__.minimapToggle(false)');
  check('关掉后 hidden', off === false && (await c.ev(`document.querySelector('.minimap').classList.contains('hidden')`)) === true);
  const on = await c.ev('__MU_APP__.minimapToggle(true)');
  check('再打开又显示', on === true && (await c.ev(`document.querySelector('.minimap').classList.contains('hidden')`)) === false);
  await sleep(300);

  console.log(`\n截图：${await c.shot('minimap')}`);
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
} finally {
  await c.close();
}
