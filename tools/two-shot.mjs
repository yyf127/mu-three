/**
 * 双账号同屏截图：确认「别的玩家」真的被建了模型，不是只在数据里占了一格。
 *
 *   node tools/two-shot.mjs
 *
 * A=1234/1234  B=1111/1111 都进洛兰西亚，A 走到 B 旁边一格停住，然后截图。
 * 顺便用 A 的相机把 B 投影到屏幕坐标，判断 B 是否真的在画面里。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const A = await createClient('shot-a');
const B = await createClient('shot-b');

const cellOf = async c => {
  const s = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
  return { x: Math.floor(s.player.x), y: Math.floor(s.player.y), fx: s.player.x, fy: s.player.y };
};

try {
  const [ia, ib] = await Promise.all([loginAs(A, '1234', '1234'), loginAs(B, '1111', '1111')]);
  console.log(`A=${ia.name} 地图${ia.mapId} @ (${Math.floor(ia.player.x)},${Math.floor(ia.player.y)})`);
  console.log(`B=${ib.name} 地图${ib.mapId} @ (${Math.floor(ib.player.x)},${Math.floor(ib.player.y)})`);
  await sleep(2500);

  const info = JSON.parse(await A.ev('JSON.stringify(__MU_APP__.remotesInfo())'));
  const b = info.entities.find(e => e.kind === 'player' && e.name === ib.name);
  if (!b) throw new Error(`A 没看到 B（${ib.name}）`);
  console.log(`A 看到的 B: id=${b.id} 目标格(${b.tx},${b.ty}) 插值(${b.x},${b.y})`);

  // 站在 B 左边 3 格：太近时相机是斜俯视，B 会被 A 自己整个挡住
  const D = 3;
  const candidates = [
    { x: b.tx - D, y: b.ty },
    { x: b.tx + D, y: b.ty },
    { x: b.tx, y: b.ty - D },
    { x: b.tx, y: b.ty + D },
    { x: b.tx - 2, y: b.ty + 2 },
    { x: b.tx + 2, y: b.ty - 2 },
  ];
  let goal = null;
  for (const c of candidates) {
    if (await A.ev(`__MU_APP__.canStand(${c.x}, ${c.y})`)) {
      goal = c;
      break;
    }
  }
  if (!goal) throw new Error('B 四周没有可站格');
  console.log(`A 走到 B 旁边 (${goal.x},${goal.y})`);

  const ok = await A.ev(`__MU_APP__.walkTo(${goal.x}, ${goal.y})`);
  const len = await A.ev(`__MU_APP__.pathTo(${goal.x}, ${goal.y})`);
  console.log(`  walkTo=${ok} A*=${len}`);
  let stalls = 0;
  let lfx = null;
  let lfy = null;
  for (let i = 0; i < 240; i++) {
    await sleep(120);
    const p = await cellOf(A);
    if (Math.hypot(p.fx - goal.x, p.fy - goal.y) < 1.4) break;
    if (lfx !== null && Math.hypot(p.fx - lfx, p.fy - lfy) < 0.02) stalls++;
    else stalls = 0;
    lfx = p.fx;
    lfy = p.fy;
    if (stalls > 15) {
      console.log(`  !! 停滞 ${stalls} 帧于 (${p.x},${p.y})，诊断:`,
        await A.ev('JSON.stringify(__MU_APP__.moveInfo())'));
      break;
    }
  }
  await sleep(1200);

  const pa = await cellOf(A);
  const info2 = JSON.parse(await A.ev('JSON.stringify(__MU_APP__.remotesInfo())'));
  const b2 = info2.entities.find(e => e.kind === 'player' && e.name === ib.name);
  console.log(`A 停在 (${pa.x},${pa.y})，B 在 (${b2.tx},${b2.ty})，相距 ${Math.hypot(b2.tx - pa.x, b2.ty - pa.y).toFixed(2)} 格`);
  console.log(`B 的格 canStand=${await A.ev(`__MU_APP__.canStand(${b2.tx}, ${b2.ty})`)}（应为 false）`);

  const p1 = await A.shot('two-shot-pair');
  const p2 = await B.shot('two-shot-pair-b');
  console.log('截图:', p1, p2);

  // 场景里到底有没有 B 的模型：名字 / 可见性 / 位置 / 缩放
  const objs = JSON.parse(
    await A.ev(
      `JSON.stringify(__MU__.scene.children.filter(o=>o.name&&o.name.startsWith('player-')).map(o=>({name:o.name,vis:o.visible,p:[+o.position.x.toFixed(1),+o.position.y.toFixed(1),+o.position.z.toFixed(1)],s:+o.scale.x.toFixed(2),kids:o.children.length})))`
    )
  );
  console.log('场景里的 player-* :', JSON.stringify(objs));

  console.log('--- A 日志 ---');
  console.log(A.logs.slice(-5).join('\n'));
} catch (e) {
  console.error('ERR', e.message);
  console.log(A.logs.slice(-6).join('\n'));
} finally {
  await A.close();
  await B.close();
  await sleep(300);
  process.exit(0);
}
