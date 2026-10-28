/**
 * 角色外观 / 动作探针 —— 四条要求一次跑完：
 *   ① 没装备也要看得见人（职业默认身体）
 *   ② 安全区武器背在背上；非安全区握在手里
 *   ③ 装翅膀 + 非安全区 → 飞行待机/走跑（浮空）
 *   ④ 不同武器 → 不同攻击动作
 *
 *   node tools/equip-visual-probe.mjs           # 连服务端（没起就自动退离线）
 *   node tools/equip-visual-probe.mjs offline   # 直接走离线演示
 *
 * 断言的是渲染结果与动作号，不是「数据对」：
 *   - 网格名（HelmClass##/ArmorClass##… = 职业默认身体，HelmMale01… = 穿上的装备）
 *   - 武器挂在哪个骨骼（Bone05=背 / knife_gdf=右手 / hand_bofdgne01=左手）
 *   - 动作号（SetPlayerStop / SetPlayerWalk / SetPlayerAttack 三张表）
 *   - 像素差分（防止「节点在、画面上没有」）
 *
 * 每一步都用 `waitFor` 等「可观测结果」而不是等固定时长 ——
 * 换装是异步重建网格，按时间采样很容易截到中间态（比如头盔还挂着 Class01 默认模型）。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient, loginAs } from './lib/edge-client.mjs';

const c = await createClient('equipvis');
const OFFLINE = process.argv.includes('offline');

const HEAD_MALE = ['HelmMale', 'HelmFemale'];

const REPORT = `(() => {
  const a = __MU_APP__.playerActor();
  if (!a) return JSON.stringify({ none: true });
  const V = a.root.position.constructor;
  const held = a.props.map(g => {
    g.updateWorldMatrix(true, true);
    const bone = g.parent;
    let dist = null;
    if (bone) {
      const p1 = new V(), p2 = new V();
      bone.getWorldPosition(p1); g.getWorldPosition(p2);
      dist = Math.round(p1.distanceTo(p2) * 1e4) / 1e4;
    }
    /*
     * 背挂朝向：模型的 **+Y** 是「握把端」，刀身/梢头朝 −Y 伸出
     * （剑类实测包围盒 y[-0.65..0.10]，握把在原点、尖在 −Y）。
     *
     * 所以 (0,1,0) 的世界 z 分量 = **柄朝哪边**：
     *   剑  +0.94 → 柄朝上 = 尖朝下 ✓（剑类不翻，见 BACK_FLIP）
     *   矛  -0.94 → 柄朝下 = 梢头朝上 ✓（其余武器翻 180°）
     *   盾  +0.93 → 长轴朝上（= 盾面朝外、没被翻）
     *
     * 取**网格自己**的世界四元数（翻转是中间层 Group，外层看不出结果）。
     */
    let tipZ = null;
    let mesh = null;
    g.traverse(o => { if (!mesh && o.isMesh) mesh = o; });
    if (mesh) {
      const q = mesh.getWorldQuaternion(new (g.quaternion.constructor)());
      tipZ = +new V(0, 1, 0).applyQuaternion(q).normalize().z.toFixed(2);
    }
    return { name: g.name, bone: bone ? bone.name : null, meshes: g.children.length, boneDist: dist, tipZ };
  });
  const names = a.meshes.map(m => m.name.split(':')[0]);
  const at = n => { const i = a.rig.boneIndexByName.get(n); const p = new V(); if (i !== undefined) a.rig.bones[i].getWorldPosition(p); return +p.z.toFixed(2); };
  return JSON.stringify({
    wear: __MU_APP__.inventory().filter(i => i.slot < 12).map(i => i.slot + ':' + i.type),
    parts: [...new Set(names)],
    meshes: names.length,
    held,
    anim: __MU_APP__.anim(),
    foot: at('Bip01 L Foot'),
  });
})()`;
const report = async () => JSON.parse(await c.ev(REPORT));

/**
 * 在页面里算一份「角色快照」的表达式片段，配合 waitFor 用。
 * 传进来的 pred 拿到 { props, names, rig } 这些直接可用的东西。
 */
const snap = pred => `(() => {
  const a = __MU_APP__.playerActor();
  if (!a) return false;
  const props = a.props || [];
  const names = (a.meshes || []).map(m => m.name.split(':')[0]);
  const onBone = b => props.length > 0 && props.every(g => g.parent && g.parent.name === b);
  const holds = props.some(g => g.parent && (g.parent.name === 'knife_gdf' || g.parent.name === 'hand_bofdgne01'));
  return ${pred};
})()`;

async function shot(name, clip) {
  const box = clip ?? (await playerClip());
  const r = await c.send('Page.captureScreenshot', { format: 'png', clip: box });
  writeFileSync(`shots/${name}.png`, Buffer.from(r.data, 'base64'));
  return r.data;
}

/**
 * 用 `__MU_DEBUG__.project` 把角色身体投到屏幕上再取景。
 * 早先按 #stage 固定比例裁，瞬移后相机会晚几帧才追上，裁出来常常是一块空地。
 */
async function playerClip() {
  let prev = null;
  let same = 0;
  for (let i = 0; i < 40; i++) {
    const cur = await c.ev(
      `(() => { const a = __MU_APP__.playerActor(); if (!a || !window.__MU_DEBUG__) return '';
        const p = __MU_DEBUG__.project(a.x, a.y, a.z + 1.0);
        return JSON.stringify({ x: Math.round(p.x), y: Math.round(p.y), front: p.inFront }); })()`
    );
    if (cur && cur === prev) {
      if (++same >= 4) break; // 相机跟人有阻尼，连稳 4 次（约 0.8s）才算停住
    } else {
      same = 0;
      prev = cur;
    }
    await sleep(200);
  }
  const p = JSON.parse(prev);
  // 取景比人宽一圈：相机停稳前还有零点几像素的漂移，宁可留白也别把腿切掉
  const W = 260;
  const H = 360;
  return {
    x: Math.max(0, p.x - W / 2),
    y: Math.max(0, p.y - H * 0.62),
    width: W,
    height: H,
    scale: 2.5,
  };
}

async function diffPixels(a, b) {
  return JSON.parse(
    await c.ev(`(async () => {
      const load = async (b64) => {
        const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
        const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
        const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
        return g.getImageData(0, 0, cv.width, cv.height).data;
      };
      const x = await load('${a}'), y = await load('${b}');
      let n = 0;
      for (let i = 0; i < x.length; i += 4)
        if (Math.abs(x[i]-y[i]) + Math.abs(x[i+1]-y[i+1]) + Math.abs(x[i+2]-y[i+2]) > 40) n++;
      return JSON.stringify({ changed: n, total: x.length / 4 });
    })()`)
  );
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

try {
  await enterGame();
  await c.waitFor(`!!__MU_APP__.playerActor()`, 60000, '角色创建');

  // 进图后先等「职业默认身体」补齐 —— 这就是「没装备也看得见人」的那 5 件
  await c.waitFor(
    snap(`names.length >= 5 && names.every(n => /^[A-Za-z]+Class\\d+\\.bmd$/.test(n))`),
    60000,
    '职业默认身体'
  );

  // 读条遮罩是独立一层，角色刚建好时它可能还在淡出，先等它彻底不可见再截图
  await c.waitFor(`document.querySelector('#loading').className.includes('hidden')`, 30000, '读条遮罩消失');

  const naked0 = await report();
  console.log('① 进图（空背包，安全区）:', JSON.stringify(naked0));

  // ② 安全区穿整套：头盔换成 HelmMale##，武器 + 盾都挂到 Bone05（背）
  await c.ev(`__MU_APP__.mockInventory([
    { slot: 0, type: 0 }, { slot: 1, type: 192 },
    { slot: 2, type: 224 }, { slot: 3, type: 256 }, { slot: 4, type: 288 },
    { slot: 5, type: 320 }, { slot: 6, type: 352 }])`);
  await c.waitFor(
    snap(`props.length >= 2 && onBone('Bone05') && names.some(n => ${JSON.stringify(HEAD_MALE)}.some(h => n.startsWith(h)))`),
    30000,
    '安全区：装备上身 + 武器挂背'
  );
  const safe = await report();
  console.log('② 安全区穿全套:', JSON.stringify(safe));
  // 背着剑的时候姿势必须回到空手：待机 1 / 走 13 / 攻击 34（精灵是 2/14）
  console.log(
    `   姿势（安全区，武器在背上）: 待机 ${safe.anim.idle} 走跑 ${safe.anim.move} 攻击 ${safe.anim.attack}` +
      (safe.anim.idle === 1 && safe.anim.move === 13 && safe.anim.attack === 34 ? ' ✓ 空手姿势' : ' ✗ 期望 1/13/34')
  );
  // 背挂朝向：剑柄朝上（尖朝下）、盾面朝外（未翻，长轴朝上）
  {
    const back = safe.held.filter(h => h.bone === 'Bone05');
    const w = back.find(h => h.name.startsWith('held:0@'));
    const s = back.find(h => h.name.startsWith('held:192@'));
    const ok = w?.tipZ > 0.5 && s?.tipZ > 0.5;
    console.log(
      `   背挂朝向（模型 +Y = 握把端的世界 z，正=柄朝上）: 剑 ${w?.tipZ} / 盾牌 ${s?.tipZ}` +
        (ok ? ' ✓ 剑尖朝下、盾面朝外' : ' ✗ 期望 剑 > 0.5（不翻）、盾牌 > 0.5')
    );
  }
  await shot('equip-safezone');

  // ③ 出城：安全区标记消失 → 武器 + 盾回到两只手
  await c.ev(`__MU_APP__.setPos(170, 170)`);
  await c.waitFor(`__MU_APP__.safeZone() === false`, 10000, '离开安全区');
  await c.waitFor(snap(`props.length >= 2 && props.every(g => g.parent && (g.parent.name === 'knife_gdf' || g.parent.name === 'hand_bofdgne01'))`), 30000, '出城：绑回左右手');
  const field = await report();
  console.log('③ 出城（170,170）:', JSON.stringify(field));
  // 同一个角色、同一把剑，出城后姿势要切回「手持」：单手剑 3 / 15 / 35
  console.log(
    `   姿势（野外，剑在手）: 待机 ${field.anim.idle} 走跑 ${field.anim.move} 攻击 ${field.anim.attack}` +
      (field.anim.idle === 3 && field.anim.move === 15 ? ' ✓ 持剑姿势' : ' ✗ 期望 3/15')
  );
  await shot('equip-field');

  // ④ 回城：又背回去
  await c.ev(`__MU_APP__.setPos(133, 133)`);
  await c.waitFor(`__MU_APP__.safeZone() === true`, 10000, '回到安全区');
  await c.waitFor(snap(`props.length >= 2 && onBone('Bone05')`), 30000, '回城：武器挂背');
  console.log('④ 回城（133,133）:', JSON.stringify(await report()));

  // ⑤ 全裸：装备清空后必须还剩 5 件职业默认身体，且画面确实变了
  await c.ev(`__MU_APP__.mockInventory([])`);
  await c.waitFor(
    snap(`props.length === 0 && names.length === 5 && names.every(n => /Class\\d+\\.bmd$/.test(n))`),
    30000,
    '全裸：退回职业默认身体'
  );
  const naked = await report();
  console.log('⑤ 全裸:', JSON.stringify(naked));
  const nakedShot = await shot('equip-naked');

  await c.ev(`__MU_APP__.mockInventory([{ slot: 0, type: 0 }, { slot: 3, type: 256 }, { slot: 2, type: 224 }])`);
  await c.waitFor(snap(`names.some(n => /Male\\d+\\.bmd$/.test(n))`), 30000, '半装：装备模型上身');
  const clothedShot = await shot('equip-clothed');
  console.log('   像素差分（裸 vs 半装）:', JSON.stringify(await diffPixels(nakedShot, clothedShot)));

  // ⑥ 翅膀：自带骨架（不是主角骨架的蒙皮）+ 出城后待机动作变 9（飞行）
  await c.ev(`__MU_APP__.setPos(170, 170)`);
  await c.ev(`__MU_APP__.mockInventory([{ slot: 0, type: 0 }, { slot: 7, type: 384 }])`);
  // 光有「算出来的飞行动作」不够 —— 要等主循环真的把动作切到 9，
  // 否则量到的还是地面待机的脚高（动作 1 脚踩在地上）。
  await c.waitFor(
    snap(`names.some(n => n.startsWith('Wing')) && __MU_APP__.anim().flying === true &&
      (a.action === 9 || a.action === 10)`),
    30000,
    '翅膀 + 飞行待机'
  );
  await sleep(300);
  const w1 = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.wing())`));
  await sleep(400);
  const w2 = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.wing())`));
  const wing = await report();
  console.log('⑥ 出城 + 翅膀:', JSON.stringify(wing));
  console.log(
    `   翅膀: 挂 ${w1.parent}  骨架 ${w1.bones} 根 / 扇动 ${w1.keys} 帧  混合 ${w1.blend}  包围盒 ${JSON.stringify(w1.bbox)}`
  );
  // 扇动：帧号必须自己在走（原版翅膀是独立 PART，用自己的 action 播）
  console.log(`   扇动帧 ${w1.frame} → ${w2.frame}` + (w1.frame !== w2.frame ? ' ✓ 在扇' : ' ✗ 没动'));
  console.log(`   浮空高度: 裸站脚 z=${naked.foot} → 装翅膀脚 z=${wing.foot}`);
  await shot('equip-wing');

  // ⑦ 从真实 item.bmd 里挑出各类武器的代表型号（双手标记只有表里有，不能猜）
  const table = JSON.parse(
    await c.ev(`(() => {
      const out = {};
      for (let t = 0; t < 400; t++) {
        const i = __MU_APP__.weaponInfo(t);
        if (!i || i.kind === 'unknown' || i.kind === 'none') continue;
        const key = i.kind + (i.twoHand ? ':2h' : ':1h');
        if (!(key in out)) out[key] = t;
      }
      return JSON.stringify(out);
    })()`)
  );
  console.log('⑦ item.bmd 里的武器代表型号:', JSON.stringify(table));

  // ⑧ 攻击动作表：每种武器一个号（SetPlayerAttack）
  console.log('⑧ 攻击动作表（安全区外）:');
  const cases = [
    ['空手', { weapon: null, shield: null }],
    ['单手剑 ' + (table['sword:1h'] ?? 0), { weapon: table['sword:1h'] ?? 0 }],
    ['双手剑 ' + (table['sword:2h'] ?? 5), { weapon: table['sword:2h'] ?? 5 }],
    ['长柄 ' + (table['spear:2h'] ?? -1), { weapon: table['spear:2h'] ?? 0 }],
    ['锤/杖 ' + (table['staff:1h'] ?? table['mace:1h'] ?? 160), { weapon: table['staff:1h'] ?? table['mace:1h'] ?? 160 }],
    ['弓 ' + (table['bow:1h'] ?? table['bow:2h'] ?? 128), { weapon: table['bow:1h'] ?? table['bow:2h'] ?? 128 }],
    ['弩 ' + (table['crossbow:1h'] ?? 136), { weapon: table['crossbow:1h'] ?? 136 }],
    ['弓 + 翅膀', { weapon: table['bow:1h'] ?? table['bow:2h'] ?? 128, wing: 384 }],
  ];
  for (const [label, equip] of cases) {
    const a = await c.ev(`JSON.stringify(__MU_APP__.anim(${JSON.stringify({ wing: null, safeZone: false, cls: 1, ...equip })}))`);
    const o = JSON.parse(a);
    console.log(`   ${label.padEnd(16)} 待机 ${String(o.idle).padStart(2)}  走跑 ${String(o.move).padStart(2)}  攻击 ${String(o.attack).padStart(2)}`);
  }
  // 同一把剑放进安全区：武器挂背上，姿势回到空手
  const safeAnim = JSON.parse(
    await c.ev(`JSON.stringify(__MU_APP__.anim(${JSON.stringify({ weapon: 0, shield: 192, wing: null, safeZone: true, cls: 1 })}))`)
  );
  console.log(
    `   ${'安全区 剑+盾'.padEnd(16)} 待机 ${String(safeAnim.idle).padStart(2)}  走跑 ${String(safeAnim.move).padStart(2)}  攻击 ${String(safeAnim.attack).padStart(2)}` +
      (safeAnim.idle === 1 && safeAnim.move === 13 && safeAnim.attack === 34 ? '  ✓ 空手' : '  ✗ 期望 1/13/34')
  );

  // ⑨ 走真实链路：装上双手剑后连按三次，动作号必须轮转 39/40/41
  const twoHandSword = table['sword:2h'] ?? 5;
  await c.ev(`__MU_APP__.mockInventory([{ slot: 0, type: ${twoHandSword} }])`);
  await c.waitFor(snap(`props.some(g => g.parent && g.parent.name === 'knife_gdf')`), 30000, '双手剑入手');
  const combo = [];
  for (let i = 0; i < 3; i++) {
    // 出手 + 读动作必须在同一个同步表达式里：主循环下一帧就会把结束的动作切回待机
    const act = await c.ev(
      `(() => { __MU_APP__.attack(); const a = __MU_APP__.playerActor().action; __MU_APP__.playerActor().finished = true; return a; })()`
    );
    combo.push(Number(act));
    await sleep(120);
  }
  console.log(`⑨ 双手剑(${twoHandSword}) 三连 attack action =`, JSON.stringify(combo), combo[0] === 39 ? '✓ 39/40/41' : '✗ 期望 39,40,41');

  const errs = c.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exc]'));
  console.log('控制台错误:', errs.length, errs.slice(0, 4));
} finally {
  await c.close();
}
