/**
 * 整数坐标移动探针。
 *
 *   node tools/intmove-probe.mjs
 *
 * 原版（Win 客户端 / muonlinejs）里角色坐标恒为整数格号，渲染直接画在 `(X, Y)`。
 * 这个探针验：
 *   1. **点地面**（真实鼠标事件 → 射线 → walkToCell）走过去以后，落点是整数格；
 *   2. 中途位置是小数（说明是平滑走过去，不是瞬移），停下后一定是整数；
 *   3. 远一点的多格路径、以及点在墙上时的「最近可走格」也落在整数上；
 *   4. 落点格号与点击的格子一致（±1 容忍：射线打在地面高度上会有半格误差）。
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

const c = await createClient('intmove');

/** 等角色停下来（连续 3 次采样位置不变） */
async function waitStop(ms = 12000) {
  let last = null;
  let same = 0;
  for (let t = 0; t < ms; t += 100) {
    const p = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.state().player)`));
    if (last && Math.abs(p.x - last.x) < 1e-6 && Math.abs(p.y - last.y) < 1e-6) {
      if (++same >= 3) return p;
    } else {
      same = 0;
      last = p;
    }
    await sleep(100);
  }
  return JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.state().player)`));
}

/** 采一帧位置，用来确认走的过程中是连续的小数坐标 */
async function samplePos() {
  return JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.state().player)`));
}

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!document.getElementById('sandbox').classList.contains('hidden')`, 120000);
  // 相机是 lerp 跟随的：headless 只有 ~10fps，1 秒还没落位，投影会算到旧位置
  await sleep(3500);
  // 关掉面板，免得挡住点击
  await c.ev(`document.getElementById('sandbox').classList.add('hidden')`);

  const p0 = await samplePos();
  console.log(`起点 (${p0.x}, ${p0.y})`);
  check('出生点就是整数坐标', Number.isInteger(p0.x) && Number.isInteger(p0.y), `${p0.x},${p0.y}`);

  /* ---------------- 1. 真实点击地面 ---------------- */
  console.log('\n[1] 点地面（真实鼠标事件）');
  // 找一个离玩家 3~4 格、能走的格子
  const target = JSON.parse(
    await c.ev(`(() => {
      const p = __MU_APP__.state().player;
      for (let r = 3; r <= 5; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = Math.round(p.x) + dx, y = Math.round(p.y) + dy;
            const a = __MU_APP__.mapAttrAt(x, y);
            if (a < 0) continue;
            if ((a & 0x1c) !== 0) continue;  // NOMOVE | NOGROUND | WATER
            return JSON.stringify([x, y]);
          }
        }
      }
      return 'null';
    })()`)
  );
  console.log(`  目标格 (${target[0]}, ${target[1]})`);

  /*
   * 注意：`__MU_DEBUG__.project()` 给的是**窗口**坐标（用 innerWidth/Height 算的），
   * 而 3D 画布是居中 letterbox 的 4:3 舞台，所以点屏幕必须换成 canvas 相对坐标，
   * 否则会差出舞台左边那一条黑边（探针第一次就点偏了一格）。
   */
  /** 投影可能会随相机移动，采样两次确认稳定 */
  const projectOnce = () => c.ev(`(() => {
      const cam = __MU__.muCamera.camera;
      const V = cam.position.constructor;
      const h = __MU__.terrain.getHeight(${target[0]} + 0.5, ${target[1]} + 0.5);
      const v = new V(${target[0]} + 0.5, ${target[1]} + 0.5, h).project(cam);
      const cv = document.querySelector('#app canvas');
      const r = cv.getBoundingClientRect();
      return JSON.stringify([Math.round(r.left + (v.x * 0.5 + 0.5) * r.width), Math.round(r.top + (-v.y * 0.5 + 0.5) * r.height)]);
    })()`);
  let scr = JSON.parse(await projectOnce());
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    const again = JSON.parse(await projectOnce());
    if (Math.abs(again[0] - scr[0]) <= 1 && Math.abs(again[1] - scr[1]) <= 1) {
      scr = again;
      break;
    }
    scr = again;
  }
  // 真实鼠标点击（CDP 输入管线 → 页面的 pointerdown → 射线拾取地面）
  await c.dragTo(scr[0], scr[1], scr[0], scr[1], 2);

  // 走的过程中抓一帧，确认是连续移动（小数）
  let mid = null;
  for (let i = 0; i < 12; i++) {
    await sleep(90);
    const p = await samplePos();
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) {
      mid = p;
      break;
    }
  }
  const p1 = await waitStop();
  console.log(`  落点 (${p1.x}, ${p1.y})，中途样本 ${mid ? `(${mid.x}, ${mid.y})` : '无'}`);
  check('走的过程中是连续小数坐标（不是瞬移）', !!mid, mid ? `(${mid.x},${mid.y})` : '没抓到中间帧');
  check('停下后 x 是整数', Number.isInteger(p1.x), String(p1.x));
  check('停下后 y 是整数', Number.isInteger(p1.y), String(p1.y));
  check(
    '落点就是点的那一格',
    p1.x === target[0] && p1.y === target[1],
    `(${p1.x},${p1.y}) vs (${target[0]},${target[1]})`
  );

  /* ---------------- 2. 多格 A* 路径 ---------------- */
  console.log('\n[2] 远一点的多格路径（walk 调试口，和点击同一条 walkToCell）');
  const far = JSON.parse(
    await c.ev(`(() => {
      const p = __MU_APP__.state().player;
      for (let r = 8; r <= 12; r++) {
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          const x = Math.round(p.x + Math.cos(a) * r);
          const y = Math.round(p.y + Math.sin(a) * r);
          const attr = __MU_APP__.mapAttrAt(x, y);
          if (attr < 0 || (attr & 0x1c) !== 0) continue;
          return JSON.stringify([x, y]);
        }
      }
      return 'null';
    })()`)
  );
  if (far) {
    await c.ev(`__MU_APP__.walk(${far[0]}, ${far[1]})`);
    const p2 = await waitStop(20000);
    console.log(`  目标 (${far[0]}, ${far[1]}) → 落点 (${p2.x}, ${p2.y})`);
    check('远距离也落在整数格', Number.isInteger(p2.x) && Number.isInteger(p2.y), `${p2.x},${p2.y}`);
    check('远距离走到了目标附近（±2）', Math.hypot(p2.x - far[0], p2.y - far[1]) <= 2, `距离 ${Math.hypot(p2.x - far[0], p2.y - far[1]).toFixed(1)}`);
  } else {
    check('（附近没找到 8~12 格外的空地，跳过）', true);
  }

  /* ---------------- 3. 点在墙里 ---------------- */
  console.log('\n[3] 点在墙/水里（会退到最近的空地）');
  const wall = JSON.parse(
    await c.ev(`(() => {
      const p = __MU_APP__.state().player;
      for (let r = 2; r <= 8; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const x = Math.round(p.x) + dx, y = Math.round(p.y) + dy;
            const a = __MU_APP__.mapAttrAt(x, y);
            if (a > 0 && (a & 0x0c) !== 0) return JSON.stringify([x, y]); // NOMOVE/NOGROUND
          }
        }
      }
      return 'null';
    })()`)
  );
  if (wall) {
    await c.ev(`__MU_APP__.walk(${wall[0]}, ${wall[1]})`);
    const p3 = await waitStop(15000);
    check('点墙也会停在整数格', Number.isInteger(p3.x) && Number.isInteger(p3.y), `${p3.x},${p3.y}`);
  } else {
    check('（附近没找到墙，跳过）', true);
  }

  /* ---------------- 4. 站定后的坐标形态 + 视觉落点 ---------------- */
  console.log('\n[4] 站定后的坐标形态');
  const p4 = await samplePos();
  check('逻辑 x/y 都是整数格号（没有 .5 格心偏移）', Number.isInteger(p4.x) && Number.isInteger(p4.y), `${p4.x},${p4.y}`);

  /*
   * 逻辑是整数，但**渲染要落在格心**（`Actor.wx = x + 0.5`）——
   * 否则角色永远站在四格交点上，看着就是「点了但没走到」。
   * 这里直接读 three 里的真实位置对一遍。
   */
  const vis = JSON.parse(
    await c.ev(`JSON.stringify((() => {
      const p = __MU__.player.root.position;
      return { x: +p.x.toFixed(3), y: +p.y.toFixed(3) };
    })())`)
  );
  check(
    '渲染位置 = 格号 + 0.5（视觉上正好站在点击的格心）',
    Math.abs(vis.x - (p4.x + 0.5)) < 0.03 && Math.abs(vis.y - (p4.y + 0.5)) < 0.03,
    `three(${vis.x},${vis.y}) 期望(${p4.x + 0.5},${p4.y + 0.5})`
  );

  console.log(`\n截图：${await c.shot('intmove')}`);
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
} finally {
  await c.close();
}
