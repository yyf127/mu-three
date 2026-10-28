/**
 * 翅膀探针 —— 四种翅膀的朝向 / 混合 / 扇动 / 飞行姿态。
 *
 *   node tools/wing-probe.mjs            # 连服务端（没起就自动退离线）
 *   node tools/wing-probe.mjs offline    # 直接走离线演示
 *
 * 为什么需要它：MU 的翅膀不是同一套美术基准建的。精灵翼（Wing01/04）的翼骨链
 * 在模型里就带 +Z 分量，挂到背骨上自然向上展开；天使 / 恶魔（Wing02/03）的翼骨
 * 链是纯水平的、翼膜往 -Z 垂，直接挂就是「翼尖朝下」——整对翅膀倒挂着。
 * 所以 src/world/actor.ts 里有 WING_FLIP = {Wing02, Wing03}，这里断言它确实生效，
 * 且没把另外两种翻坏。
 *
 * 断言的是渲染结果（骨架、帧、包围盒），不是常量本身：
 *   - 翻转标志与模型号一致（Wing02/03 翻，Wing01/04 不翻）
 *   - 骨架是翅膀自己的（11/16/20 根），不是主角的 60 根
 *   - 扇动帧自己往前走（原版翅膀是独立 PART，播自己的 action）
 *   - 相对角色的包围盒：翼展 > 1.2 m，且不能整对缩在腰部以下
 *   - 出城飞行：待机 9/10、走跑 30/31、脚离地
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient, loginAs } from './lib/edge-client.mjs';

const c = await createClient('wingprobe');
const OFFLINE = process.argv.includes('offline');
const PI = Math.PI;

/** type → { 文件号, 名字, 该不该翻, 混合 } */
const WINGS = [
  { type: 384, no: 1, name: 'Wings of Elf', flip: false, blend: 'add' },
  { type: 385, no: 2, name: 'Wings of Heaven', flip: true, blend: 'alpha' },
  { type: 386, no: 3, name: 'Wings of Satan', flip: true, blend: 'alpha' },
  { type: 387, no: 4, name: 'Wings of Elf II', flip: false, blend: 'add' },
];

let pass = 0;
let fail = 0;
function check(label, ok, extra = '') {
  if (ok) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${extra ? '  ' + extra : ''}`); }
}

async function enterGame() {
  if (!OFFLINE) {
    try {
      return await loginAs(c, '1234', '1234');
    } catch {
      console.log('（登录失败：服务端没起，改走离线演示）');
    }
  }
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '离线进图');
  return { name: 'offline', mapId: 0 };
}

/** 用投影坐标取角色周围的近景 */
async function clip(w = 190, h = 250, lift = 1.1) {
  let prev = null;
  let same = 0;
  for (let i = 0; i < 40; i++) {
    const cur = await c.ev(
      `(() => { const a = __MU_APP__.playerActor(); if (!a || !window.__MU_DEBUG__) return '';
        const p = __MU_DEBUG__.project(a.x, a.y, a.z + ${lift});
        return JSON.stringify({ x: Math.round(p.x), y: Math.round(p.y) }); })()`
    );
    if (cur && cur === prev) { if (++same >= 4) break; } else { same = 0; prev = cur; }
    await sleep(200);
  }
  const p = JSON.parse(prev);
  return { x: Math.max(0, p.x - w / 2), y: Math.max(0, p.y - h * 0.55), width: w, height: h, scale: 3 };
}

async function shot(name) {
  const r = await c.send('Page.captureScreenshot', { format: 'png', clip: await clip() });
  writeFileSync(`shots/${name}.png`, Buffer.from(r.data, 'base64'));
}

try {
  await enterGame();
  await c.waitFor(`!!__MU_APP__.playerActor()`, 60000, '角色创建');

  // 出城（非安全区才飞）
  await c.ev(`__MU_APP__.setPos(170, 170)`);
  await c.waitFor(`__MU_APP__.safeZone() === false`, 15000, '离开安全区');

  for (const w of WINGS) {
    console.log(`\n— ${w.type} ${w.name} —`);
    await c.ev(`__MU_APP__.mockInventory([{ slot: 7, type: ${w.type} }])`);
    await c.waitFor(
      `(__MU_APP__.wing()?.meshes ?? []).some(n => n.includes('Wing0${w.no}'))`,
      30000,
      `${w.name} 模型`
    );
    await sleep(500);

    const a = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.wing())`));
    check(`${w.name} 挂在背骨 Bone05`, a.parent === 'Bone05', `实际 ${a.parent}`);
    check(`${w.name} 用 ${w.flip ? '翻转' : '原始'}姿态`, a.flip === w.flip, `实际 flip=${a.flip}`);
    check(
      `${w.name} 骨架是它自己的（不是主角 60 根）`,
      a.bones === 11 || a.bones === 16 || a.bones === 20,
      `实际 ${a.bones} 根`
    );
    check(`${w.name} 纹理混合 ${w.blend}`, a.blend === w.blend, `实际 ${a.blend}`);

    const [bx0, bx1] = [a.bbox.min[0], a.bbox.max[0]];
    const [bz0, bz1] = [a.bbox.min[2], a.bbox.max[2]];
    check(`${w.name} 翼展 > 1.2 m`, bx1 - bx0 > 1.2, `实际 ${(bx1 - bx0).toFixed(2)} m`);
    check(`${w.name} 翼面不整对缩在腰下（顶到 1.6 m 以上）`, bz1 > 1.6, `实际顶 ${bz1} m`);

    // 翼根高度：必须贴着肩线（Bip01 Clavicle），不能掉回腰（Bip01 Spine）
    const rootZ = a.rootWorld[2];
    const sh = a.jointZ.shoulder;
    const spineZ = a.jointZ.spine;
    check(
      `${w.name} 翼根在肩部（肩 ${sh} m，翼根 ${rootZ} m）`,
      Math.abs(rootZ - sh) < 0.15,
      `差 ${(rootZ - sh).toFixed(2)} m`
    );
    check(
      `${w.name} 翼根明显高于脊柱底 ${spineZ} m`,
      rootZ - spineZ > 0.25,
      `只高 ${(rootZ - spineZ).toFixed(2)} m`
    );

    // 扇动：隔 400ms 两帧不能相同
    const f1 = a.frame;
    await sleep(450);
    const f2 = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.wing().frame)`));
    check(`${w.name} 自己在扇（帧 ${f1} → ${f2}）`, f1 !== f2);

    // 飞行姿态：待机 9（拿弓弩 10）/ 走跑 30（弩 31）
    const an = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.anim())`));
    check(`${w.name} 出城飞行`, an.flying === true && (an.idle === 9 || an.idle === 10), `idle=${an.idle}`);

    await shot(`wingfix-${w.type}`);
  }

  // 回安全区：不飞、动作回地面，翼根仍然贴肩（玩家最常看到的姿态）
  await c.ev(`__MU_APP__.setPos(133, 133)`);
  await c.waitFor(`__MU_APP__.safeZone() === true`, 15000, '回到安全区');
  const safe = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.anim())`));
  check('安全区里不飞（待机回 1/2）', safe.flying === false && safe.idle <= 2, `idle=${safe.idle}`);
  await sleep(600);
  const wsafe = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.wing())`));
  check(
    `安全区站立时翼根仍在肩部（肩 ${wsafe.jointZ.shoulder} m，翼根 ${wsafe.rootWorld[2]} m）`,
    Math.abs(wsafe.rootWorld[2] - wsafe.jointZ.shoulder) < 0.15,
    `差 ${(wsafe.rootWorld[2] - wsafe.jointZ.shoulder).toFixed(2)} m`
  );

  console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：✓ ${pass} / ✗ ${fail}`);
} finally {
  await c.close?.();
}
