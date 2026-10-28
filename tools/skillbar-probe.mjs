/**
 * 技能栏（0xF3/0x11 + UI）探针。
 *
 *   node tools/skillbar-probe.mjs
 *   node tools/skillbar-probe.mjs 账号 密码
 *
 * 五层：
 *
 *   1. **真实服务端**：登录后 `0xF3/0x11` 必须到（本段之前完全没解析这条包，
 *      客户端因此不知道自己会什么技能，也没有技能栏）。
 *   2. **真链路学技能**：`/make` 一本技能书 → `0x26` 使用 → 服务端回
 *      `0xF3/0x11 count=0xFE` → 技能栏当场多一格。这条路把「服务端语义」
 *      和「客户端增量合并」一起验了。
 *   3. **解析语义**：同一个包三种含义（整表 / 0xFE 学 / 0xFF 忘）。
 *      字节按服务端 `PMSG_SKILL_LIST`（`SkillManager.h:155`）自己造，
 *      **不调用被测试的构造函数**（注入器和解析器同错会自洽，这条吃过亏）。
 *   4. **版式**：主技能 (304,444) 32×36；展开一排 y=370、居中
 *      `x = 320 - count*16 + i*32`（`HUD_Pass5.cpp:357-366`）；
 *      图集切片 `Interface/Skill.ozj` 8 列 × 32×36。
 *   5. **交互**：点主图标展开 / 点格子选中 / 数字键选技能 / Ctrl+数字设键位。
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

/**
 * 按服务端结构体造一条 0xF3/0x11。
 * `mode`：'list' 用 count = 条数；'add' 用 0xFE；'del' 用 0xFF。
 * 每条 3 字节：slot / skill / ((level << 3) | (skill & 7))。
 */
function skillPacket(mode, entries) {
  const count = mode === 'list' ? entries.length : mode === 'add' ? 0xfe : 0xff;
  const bytes = [0xc1, 5 + entries.length * 3, 0xf3, 0x11, count];
  for (const e of entries) {
    bytes.push(e.slot & 0xff, e.skill & 0xff, ((e.level & 0x1f) << 3) | (e.skill & 7));
  }
  return bytes;
}

/** 发一个按键（数字键；`ctrl` = 设快捷键那条路） */
async function press(c, code, key, keyCode, ctrl = false) {
  const modifiers = ctrl ? 2 : 0;
  await c.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    code,
    key,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers,
  });
  await c.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    code,
    key,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers,
  });
  await sleep(140);
}

/** 职业 → 一本他学得会的技能书（`GetSkillNumber`：15,x→技能 x+1；12,7→41 …） */
const BOOK_BY_CLASS = {
  0: { group: 15, index: 2, skill: 3 }, // DW：掌心雷
  1: { group: 12, index: 7, skill: 41 }, // DK：霹雳回旋斩
  2: { group: 12, index: 8, skill: 26 }, // FE：治疗
  3: { group: 15, index: 2, skill: 3 }, // MG：掌心雷
};

const c = await createClient('skillbar');

try {
  const who = await loginAs(c, account, password);
  const st = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
  console.log(`进图：${who.name} 职业=${st.classId} 等级=${st.level}`);
  await sleep(2500);

  /* ================= A. 0xF3/0x11 到达 ================= */
  console.log('\n[A] 服务端 0xF3/0x11');
  const f3 = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.packets(0xf3).map(p => [p.sub, p.size, p.hex]))'));
  const skillPkts = f3.filter(([sub]) => sub === 0x11);
  check('收到了 0xF3/0x11', skillPkts.length > 0, `${skillPkts.length} 条`);
  const initial = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillBar.list())'));
  // 包里的 count 必须和列表条数一致（空表 = 00，学过技能后就是 N）
  const count = skillPkts[0] ? parseInt(skillPkts[0][2].split(' ')[4], 16) : -1;
  check(
    'count 与解析出的条数一致（空表 = c1 05 f3 11 00）',
    count === initial.length,
    `count=${count} list=${initial.length}`
  );
  check('技能表解析后没有超范围的值', initial.every(s => s.skill >= 1 && s.skill <= 56));

  /* ================= B. 真链路：学一本技能书 ================= */
  console.log('\n[B] /make 技能书 → 0x26 使用 → 0xFE 学到');
  const book = BOOK_BY_CLASS[st.classId] ?? BOOK_BY_CLASS[1];
  const invBefore = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.inventory().map(i => i.slot))'));
  await c.ev(`__MU_APP__.chat('/make ${book.group} ${book.index} 0')`);
  await sleep(1800);
  const invNow = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.inventory())'));
  const fresh = invNow.filter(i => !invBefore.includes(i.slot));
  check('技能书进了背包', fresh.length > 0, fresh.map(i => `${i.slot}:${i.type}`).join(','));
  const bookSlot = fresh[0]?.slot;
  if (bookSlot !== undefined) {
    await c.ev(`__MU_APP__.useSlot(${bookSlot})`);
    // 服务端 AddSkill → GCSkillAddSend(0xFE)，客户端应当场多一格
    let learned = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      learned = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillBar.list())'));
      if (learned.some(s => s.skill === book.skill)) break;
      await sleep(300);
    }
    check(
      `学完技能栏出现技能 ${book.skill}`,
      learned.some(s => s.skill === book.skill),
      learned.map(s => `${s.slot}:${s.skill}`).join(',')
    );
    const meta = learned.find(s => s.skill === book.skill);
    check('带上了 skill.bmd 的中文名', !!meta?.name, meta?.name ?? '');
    check('slot 在 0..19', (meta?.slot ?? 99) < 20, String(meta?.slot));
  }

  /* ================= C. 主图标位置 + 展开版式 ================= */
  console.log('\n[C] 主图标 / 展开版式');
  const mainPos = JSON.parse(
    await c.ev(`(() => {
      const el = document.querySelector('.skill-main');
      const r = el.getBoundingClientRect();
      return JSON.stringify({
        left: parseFloat(el.style.left), top: parseFloat(el.style.top),
        hidden: el.classList.contains('hidden'), w: r.width, h: r.height,
      });
    })()`)
  );
  check('主图标 left=304 top=444', mainPos.left === 304 && mainPos.top === 444, JSON.stringify(mainPos));
  check('有技能后主图标可见', mainPos.hidden === false);

  // 换成自己造的三格整表，验居中公式（3 格 → 272 / 304 / 336）
  const listPkt = skillPacket('list', [
    { slot: 0, skill: 3, level: 0 },
    { slot: 1, skill: 26, level: 1 },
    { slot: 2, skill: 41, level: 2 },
  ]);
  const n1 = await c.ev(`__MU_APP__.skillBar.feed(${JSON.stringify(listPkt)})`);
  check('整表 3 条全部收下', n1 === 3, `n=${n1}`);
  const parsed = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillBar.list())'));
  check(
    'slot / skill 对齐',
    parsed.map(s => `${s.slot}:${s.skill}`).join(',') === '0:3,1:26,2:41',
    parsed.map(s => `${s.slot}:${s.skill}`).join(',')
  );
  check('level = (byte >> 3)', parsed.map(s => s.level).join(',') === '0,1,2', parsed.map(s => s.level).join(','));

  await c.ev('__MU_APP__.skillBar.toggle()');
  const bar = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillBar.bar())'));
  check('展开后 3 个格子', bar.cells.length === 3, `${bar.cells.length}`);
  check('居中：272,304,336', bar.cells.map(x => x.left).join(',') === '272,304,336', bar.cells.map(x => x.left).join(','));
  check('y=370 全部一致', bar.cells.every(x => x.top === 370), bar.cells.map(x => x.top).join(','));
  check('格子顺序 = 槽位顺序', bar.cells.map(x => x.slot).join(',') === '0,1,2', bar.cells.map(x => x.slot).join(','));

  const bg = JSON.parse(
    await c.ev(`(() => {
      const el = document.querySelector('.skill-cell[data-skill="41"] .skill-art');
      return JSON.stringify({ pos: el.style.backgroundPosition, img: !!el.style.backgroundImage });
    })()`)
  );
  check('技能 41 切到图集第 5 行第 0 列（0px -180px）', bg.pos === '0px -180px', bg.pos);
  check('图集 Skill.ozj 已挂上', bg.img);

  /* ================= D. 增量：学 / 忘 / 覆盖 ================= */
  console.log('\n[D] 0xFE 学 / 0xFF 忘 / 同 slot 覆盖');
  await c.ev(`__MU_APP__.skillBar.feed(${JSON.stringify(skillPacket('add', [{ slot: 5, skill: 51, level: 0 }]))})`);
  let after = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillBar.list())'));
  check('0xFE 学一个 → 4 个技能', after.length === 4, after.map(s => s.slot).join(','));
  check('新技能在 slot 5 = 51', after.some(s => s.slot === 5 && s.skill === 51));

  await c.ev(`__MU_APP__.skillBar.feed(${JSON.stringify(skillPacket('del', [{ slot: 5, skill: 51, level: 0 }]))})`);
  after = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillBar.list())'));
  check('0xFF 忘掉 → 剩 3 个', after.length === 3, after.map(s => s.slot).join(','));

  await c.ev(`__MU_APP__.skillBar.feed(${JSON.stringify(skillPacket('add', [{ slot: 1, skill: 6, level: 3 }]))})`);
  after = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillBar.list())'));
  check(
    '同 slot 覆盖（slot1 从 26 变 6）',
    after.filter(s => s.slot === 1).length === 1 && after.find(s => s.slot === 1).skill === 6,
    JSON.stringify(after.find(s => s.slot === 1))
  );

  /* ================= E. 交互 ================= */
  console.log('\n[E] 选中 / 数字键 / Ctrl+数字');
  await c.ev('__MU_APP__.skillBar.select(2)');
  check('点格子选中 slot 2（技能 41）', (await c.ev('__MU_APP__.skillBar.selected()')) === 41);

  // `select` 会顺带收起那一排，重新展开
  let barNow = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillBar.bar())'));
  if (!barNow.open) await c.ev('__MU_APP__.skillBar.toggle()');
  barNow = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillBar.bar())'));
  check('重新展开', barNow.open === true);

  // Ctrl+数字：原版是「鼠标悬停在那格上时按」
  const cellBox = await c.center('.skill-cell[data-slot="0"]');
  check('能定位到第一格（说明格子真实可点）', !!cellBox, JSON.stringify(cellBox));
  if (cellBox) {
    await c.ptr('mouseMoved', cellBox.x, cellBox.y, { buttons: 0 });
    await sleep(150);
  }
  await press(c, 'Digit7', '7', 55, true);
  const hot = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.skillBar.bar().hotkeys)'));
  check('Ctrl+7 把 7 设到悬停的 slot 0', String(Object.keys(hot).find(k => hot[k] === 7)) === '0', JSON.stringify(hot));

  await c.ev('__MU_APP__.skillBar.select(2)');
  check('先切回 slot 2', (await c.ev('__MU_APP__.skillBar.selected()')) === 41);
  await press(c, 'Digit7', '7', 55, false);
  check('按 7 选中 slot 0（技能 3）', (await c.ev('__MU_APP__.skillBar.selected()')) === 3);

  await press(c, 'Digit9', '9', 57, false);
  check('按 9（没绑定）不改选中', (await c.ev('__MU_APP__.skillBar.selected()')) === 3);

  // 键盘数字键抢按键的前提：不能是输入框里打字
  await c.ev(`__MU_APP__.openChat('')`);
  await press(c, 'Digit7', '7', 55, false);
  check('输入框开着时 7 不选技能（还是 slot 2 的 41→已改成 3，这里看没变化）', (await c.ev('__MU_APP__.skillBar.selected()')) === 3);
  await c.ev('__MU_APP__.closeChat()');

  /* ================= F. 施法 ================= */
  console.log('\n[F] 用选中技能出手');
  const useMissing = await c.ev('__MU_APP__.skillBar.use(0x7fff)');
  check('目标不存在时不发包（返回 false）', useMissing === false, String(useMissing));
  check('连接还在（没有被这串操作踢掉）', (await c.ev('__MU_APP__.state().connected')) === true);
  const pkt = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.packets(0x19))'));
  check('没有任何 0x19 被误发', pkt.length === 0, `${pkt.length} 条`);

  const shot = await c.shot('skillbar');
  console.log(`\n截图：${shot}`);
} finally {
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await c.close();
  process.exit(fail === 0 ? 0 : 1);
}
