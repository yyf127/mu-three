/**
 * 头顶标签探针（阶段 AZ）：`Render_HPBars` + `Render_CharNameTags`。
 *
 *   node tools/worldtags-probe.mjs
 *   node tools/worldtags-probe.mjs 账号 密码
 *
 * 单人服上凑不出第二个真人，所以「视野里有人」这一步是造 `0x12` 视野包灌进
 * **收包路径**（`__MU_APP__.inject`），队伍成员则用 `injectPartyList` /
 * `injectPartyLife`（它们和真 0x42 / 0x44 走同一段状态）。
 *
 * 验的东西：
 *   A. 普通玩家 → 只有名字，没有血条
 *   B. 队友 → 名字 + `cur/max` + 10 格血条；格子数跟着 0x44 的十等分变
 *   C. 几何/颜色 1:1 对源码（42×5、3×2 格、步距 4、rgb(51,0,0) 底、rgb(253,8,0) 格）
 *   D. 位置：X 对准角色投影，Y 在脚下投影之上（不是世界原点）
 *   E. NPC 不画（原版明确排除 0x87 / 0x8f）
 *   F. 当前目标怪物 → 冷色名字
 *   G. 实体离开视野（0x14）→ 标签删掉，不留 DOM 垃圾
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

/** 0x12 玩家视野（32 字节/条，`PMSG_VIEWPORT_PLAYER`） */
function viewportPlayer(p) {
  const r = new Array(32).fill(0);
  r[0] = ((p.id >> 8) & 0x7f) | 0x80; // 0x80 = created
  r[1] = p.id & 0xff;
  r[2] = p.x;
  r[3] = p.y;
  for (let i = 0; i < 11; i++) r[4 + i] = p.charSet?.[i] ?? 0;
  const nm = ascii(p.name ?? '', 10);
  for (let i = 0; i < 10; i++) r[18 + i] = nm[i];
  r[28] = p.tx ?? p.x;
  r[29] = p.ty ?? p.y;
  r[30] = ((p.dir ?? 0) << 4) | 0;
  const total = 5 + 32;
  return [0xc2, (total >> 8) & 0xff, total & 0xff, 0x12, 1, ...r];
}

/** 标签 + 血条的 DOM 量测（全部用浏览器算出来的真实值，不读我们的内部状态） */
const DOM = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('.wtag')) {
    const name = el.querySelector('.wtag-name');
    const bar = el.querySelector('.wtag-bar');
    const segs = bar ? [...bar.querySelectorAll('.wtag-seg')] : [];
    const vis = segs.filter(s => s.style.visibility !== 'hidden');
    const cs = bar ? getComputedStyle(bar) : null;
    const s0 = segs[0] ? getComputedStyle(segs[0]) : null;
    const r = el.getBoundingClientRect();
    out.push({
      id: Number(el.dataset.id),
      text: (name?.textContent || '').trim(),
      cls: name?.className || '',
      bar: !!bar,
      // 血条有两种：队友 10 格（seg）↔ 怪物实心条（smooth）
      mode: bar ? (bar.querySelector('.wtag-fill') ? 'smooth' : 'seg') : 'none',
      fillW: bar?.querySelector('.wtag-fill')?.style.width ?? '',
      barW: bar ? bar.offsetWidth : 0,
      barH: bar ? bar.offsetHeight : 0,
      barBg: cs?.backgroundColor || '',
      segCount: segs.length,
      segVisible: vis.length,
      segW: segs[0]?.offsetWidth ?? 0,
      segH: segs[0]?.offsetHeight ?? 0,
      segColor: s0?.backgroundColor || '',
      segLefts: segs.map(s => parseFloat(s.style.left || '0')),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      left: parseFloat(el.style.left || '0'),
      top: parseFloat(el.style.top || '0'),
    });
  }
  const layer = document.getElementById('fx');
  const lr = layer.getBoundingClientRect();
  const stage = document.getElementById('stage').getBoundingClientRect();
  return JSON.stringify({ tags: out, layer: [lr.left, lr.top, lr.width, lr.height], stage: [stage.left, stage.top, stage.width, stage.height] });
})()`;

const c = await createClient('wtags');

/** 等某个实体真的建出来（模型是异步加载的，视野包到 ≠ 实体在） */
async function waitFor(id, ms = 16000) {
  for (let t = 0; t < ms; t += 200) {
    const ok = await c.ev(`__MU_APP__.state().remotes.some(e => e.id === ${id})`);
    if (ok) {
      await sleep(350); // 再等一两帧让标签跟上
      return true;
    }
    await sleep(200);
  }
  return false;
}

try {
  const who = await loginAs(c, account, password);
  const selfId = Number(await c.ev('__MU_APP__.state().selfId'));
  const pos = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state().player)'));
  console.log(`进图：${who.name} selfId=${selfId} 位置 ${pos.x},${pos.y}`);
  await sleep(2000);

  const MATE = 0x7101;
  const STRANGER = 0x7102;

  /* ============ A. 普通玩家：只有名字 ============ */
  console.log('\n[A] 视野里的普通玩家');
  await c.ev(
    `__MU_APP__.inject('${hex(
      viewportPlayer({ id: STRANGER, x: Math.round(pos.x) + 2, y: Math.round(pos.y) + 1, name: 'Stranger' })
    )}')`
  );
  check('假玩家实体建出来了', await waitFor(STRANGER), `id=${STRANGER}`);

  let dom = JSON.parse(await c.ev(DOM));
  let tag = dom.tags.find(t => t.id === STRANGER);
  check('普通玩家有名字标签', !!tag, tag ? tag.text : 'DOM 里没有');
  check('普通玩家没有血条', tag && !tag.bar, tag ? `bar=${tag.bar}` : '');
  check('名字就是服务器给的（不是世界原点上的空标签）', tag?.text === 'Stranger', tag?.text);

  /* ============ B. 队友：名字 + 10 格血条 ============ */
  console.log('\n[B] 队友血条（0x42 成员表 + 0x44 十等分）');
  await c.ev(
    `__MU_APP__.inject('${hex(
      viewportPlayer({ id: MATE, x: Math.round(pos.x) - 2, y: Math.round(pos.y) + 1, name: 'MateA' })
    )}')`
  );
  check('队友实体建出来了', await waitFor(MATE), `id=${MATE}`);
  await c.ev(
    `__MU_APP__.injectPartyList([
      { name: '${who.name}', number: 0, life: 900, maxLife: 900 },
      { name: 'MateA', number: 1, life: 150, maxLife: 300 },
    ], false)`
  );
  await c.ev(`__MU_APP__.injectPartyLife([{ number: 0, tenths: 10 }, { number: 1, tenths: 7 }])`);
  await sleep(700);

  dom = JSON.parse(await c.ev(DOM));
  tag = dom.tags.find(t => t.id === MATE);
  check('队友有血条', !!tag?.bar, tag ? `bar=${tag.bar}` : 'DOM 里没有该标签');
  check('名字后面跟 cur/max（原版 "%s %d/%d"）', /^MateA 150\/300$/.test(tag?.text ?? ''), tag?.text);
  check('格子总数 10（原版画 10 段）', tag?.segCount === 10, String(tag?.segCount));
  check('点亮格数 = 0x44 的十等分 7', tag?.segVisible === 7, String(tag?.segVisible));

  /* ============ C. 几何/颜色 1:1 对源码 ============ */
  console.log('\n[C] 几何与颜色（Render_HPBars）');
  check('条 42×5', tag?.barW === 42 && tag?.barH === 5, `${tag?.barW}×${tag?.barH}`);
  check('每格 3×2', tag?.segW === 3 && tag?.segH === 2, `${tag?.segW}×${tag?.segH}`);
  check(
    '格距 4px（源码 i*4）',
    tag && tag.segLefts.length === 10 && tag.segLefts.every((v, i) => v === 2 + i * 4),
    tag?.segLefts.join(',')
  );
  check('底色 rgb(51, 0, 0)（源码 glColor3f(0.2, 0, 0)）', tag?.barBg === 'rgb(51, 0, 0)', tag?.barBg);
  check('格色 rgb(253, 8, 0)（源码 glColor3f(0.992, 0.032, 0)）', tag?.segColor === 'rgb(253, 8, 0)', tag?.segColor);

  /* ============ D. 位置：对准角色头顶，不是世界原点 ============ */
  console.log('\n[D] 位置');
  const ent = JSON.parse(
    await c.ev(`JSON.stringify(__MU_APP__.state().remotes.find(e => e.id === ${MATE}) ?? null)`)
  );
  check('实体确实在视野里', !!ent, ent ? `${ent.x},${ent.y}` : '没有了');
  if (ent) {
    // 用**脚下地形高度**投影：拿 z=0 投会差出大半个头（相机是斜视的，z 也会影响 x）
    const entZ = Number(await c.ev(`__MU__.terrain.getHeight(${ent.x}, ${ent.y})`));
    const proj = JSON.parse(await c.ev(`JSON.stringify(__MU_DEBUG__.project(${ent.x}, ${ent.y}, ${entZ}))`));
    /*
     * `__MU_DEBUG__.project()` 是按**窗口**尺寸算的（innerWidth/Height），
     * 而标签用的是 4:3 舞台坐标 —— 要把 NDC 按舞台宽高等比换算，不是减去左偏移
     * （减偏移会差出大半个屏幕）。
     */
    const stage = dom.stage;
    const win = JSON.parse(await c.ev('JSON.stringify([innerWidth, innerHeight])'));
    const toStage = p => ({ x: (p.x / win[0]) * stage[2], y: (p.y / win[1]) * stage[3] });
    const feet = toStage(proj);
    const feetX = feet.x;
    const feetY = feet.y;
    check(
      'X 对准角色（±8px）',
      Math.abs(tag.left - feetX) <= 8,
      `标签 ${tag.left} vs 投影 ${Math.round(feetX)}`
    );
    check('Y 在脚下投影之上（头顶方向）', tag.rect[1] + tag.rect[3] < feetY - 6, `${tag.rect[1] + tag.rect[3]} < ${Math.round(feetY)}`);

    /*
     * 高度对不对：拿「一个 2.15 世界单位高的人在屏幕上有多少像素」当标尺，
     * 标签底边离脚底的像素距离应该在 0.75~1.4 倍之间。
     * （<=0.75 说明压在头上/陷进身体，>=1.4 说明飘太高 —— 之前用
     * `box.max.z - actor.z` 算身高就多算了地形高度，比值 1.63。）
     */
    const pz = Number(await c.ev('__MU_APP__.state().player.z'));
    const projTop = JSON.parse(
      await c.ev(`JSON.stringify(__MU_DEBUG__.project(${ent.x}, ${ent.y}, ${pz + 2.15}))`)
    );
    const unit = feetY - toStage(projTop).y;
    const gap = feetY - (tag.rect[1] + tag.rect[3]);
    check(
      '标签底边 ≈ 头顶（0.75~1.4 倍身高）',
      unit > 20 && gap / unit >= 0.75 && gap / unit <= 1.4,
      `gap=${Math.round(gap)}px 身高=${Math.round(unit)}px 比值=${(gap / unit).toFixed(2)}`
    );
  }

  /* ============ E. 0x44 变化 → 格子跟着变 ============ */
  console.log('\n[E] 血量变化');
  await c.ev(`__MU_APP__.injectPartyLife([{ number: 0, tenths: 10 }, { number: 1, tenths: 2 }])`);
  await sleep(400);
  dom = JSON.parse(await c.ev(DOM));
  tag = dom.tags.find(t => t.id === MATE);
  check('十等分 2 → 只亮 2 格', tag?.segVisible === 2, String(tag?.segVisible));

  /* ============ F. NPC 不画 ============ */
  console.log('\n[F] NPC 不画');
  const npcs = JSON.parse(
    await c.ev(`JSON.stringify(__MU_APP__.state().remotes.filter(e => e.kind === 'npc').map(e => e.id))`)
  );
  dom = JSON.parse(await c.ev(DOM));
  check(
    `视野里 ${npcs.length} 个 NPC 一个标签都没有`,
    npcs.every(id => !dom.tags.some(t => t.id === id)),
    npcs.length ? npcs.join(',') : '（本视野没 NPC，空过）'
  );

  /* ============ G. 目标怪物用冷色名字 ============ */
  console.log('\n[G] 当前目标');
  const MSTR = 0x7103;
  await c.ev(`__MU_APP__.testMonster(2, ${Math.round(pos.x) + 1}, ${Math.round(pos.y) - 2}, ${MSTR})`);
  await waitFor(MSTR);
  await c.ev(`__MU_APP__.focusOn(${MSTR})`);
  await sleep(500);
  dom = JSON.parse(await c.ev(DOM));
  tag = dom.tags.find(t => t.id === MSTR);
  check('锁定怪物有标签', !!tag, tag ? tag.text : '没有');
  check('目标名带 focused 类（冷色）', (tag?.cls ?? '').includes('focused'), tag?.cls);
  // 2026-10-26 需求变更：怪物也要血条（上限查 Monster.txt，当前血量来自 0x15）
  check('怪物有血条（实心条）', tag && tag.bar, tag ? `bar=${tag.bar} mode=${tag.mode}` : '');
  check('血条是 smooth 模式（不是队友的十格）', tag?.mode === 'smooth', tag?.mode);

  /* ============ H. 离开视野 → 标签删掉 ============ */
  console.log('\n[H] 离场清理');
  const before = JSON.parse(await c.ev(DOM)).tags.length;
  await c.ev(`__MU_APP__.inject('${hex([0xc1, 6, 0x14, 1, (MATE >> 8) & 0xff, MATE & 0xff])}')`);
  await sleep(600);
  dom = JSON.parse(await c.ev(DOM));
  check('0x14 之后队友标签没了', !dom.tags.some(t => t.id === MATE), `之前 ${before} 个，之后 ${dom.tags.length} 个`);
  check('DOM 里没留下孤儿节点', (await c.ev(`document.querySelectorAll('.wtag').length`)) === dom.tags.length);

  /* ============ I. 快照接口 ============ */
  console.log('\n[I] 调试口');
  const snap = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.worldTags())'));
  check('worldTags() 返回标签数组', Array.isArray(snap) && snap.length === dom.tags.length, `${snap.length} 条`);
  const life = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.partyLife())'));
  check('partyLife() 是 number → 十等分', life['1'] === 2, JSON.stringify(life));

  console.log(`\n截图：${await c.shot('worldtags')}`);
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
} finally {
  await c.close();
}
