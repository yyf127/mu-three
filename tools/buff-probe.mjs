/**
 * buff（持续技能效果）探针。
 *
 *   node tools/buff-probe.mjs
 *   node tools/buff-probe.mjs 账号 密码
 *
 * 验的是「状态位 → 身上特效」这条链，三个入口全走**收包路径**（不直接调内部函数）：
 *
 *   1. `0x07` 效果状态包（`C1 08 07 [state] [mask:LE16] [index:BE16]`）
 *      —— buff 起/停的权威通道。
 *   2. `0x1B` 取消技能效果（包体是**技能号**，客户端映射成状态位）。
 *   3. 视野包 `0x12` 里的 `ViewSkillState` —— 进视野时身上已经挂着的 buff。
 *
 * 字节一律按服务端结构体（`EffectManager.h:46` / `Viewport.h:39`）自己造，
 * 不调用被测的构造函数（注入器和解析器同错会自洽，这条吃过亏）。
 *
 * 注意：**这个角色（99 级 DK）学不到任何 buff 技能** —— 服务端的宝珠有等级门槛
 * （生命之光要 120 级、战神之力是精灵专用），所以「真服务端发一条 0x07」
 * 这一条在这里做不到，只能验下行字节与渲染。
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

/** 0x07 包：state / mask（LE16）/ index（BE16） */
function effectStatePacket(state, mask, index) {
  return [
    0xc1,
    8,
    0x07,
    state & 0xff,
    mask & 0xff,
    (mask >> 8) & 0xff,
    (index >> 8) & 0xff,
    index & 0xff,
  ];
}

/** 0x1B 包：技能号 / index（BE16） */
function skillCancelPacket(skill, index) {
  return [0xc1, 6, 0x1b, skill & 0xff, (index >> 8) & 0xff, index & 0xff];
}

/**
 * 0x12 玩家视野包（PWMSG_HEAD：C2 hi lo head count + 32B/人）。
 * 一条记录：index[2] x y charSet[11] skillState[2] name[10] tx ty dirPk
 */
function viewportPlayerPacket(rec) {
  const body = new Uint8Array(32);
  body[0] = ((rec.id >> 8) & 0x7f) | 0x80; // 高位 = 新建
  body[1] = rec.id & 0xff;
  body[2] = rec.x;
  body[3] = rec.y;
  for (let i = 0; i < 11; i++) body[4 + i] = rec.charSet?.[i] ?? 0;
  body[16] = rec.skillState & 0xff;
  body[17] = (rec.skillState >> 8) & 0xff;
  const name = rec.name ?? '';
  for (let i = 0; i < 10 && i < name.length; i++) body[18 + i] = name.charCodeAt(i);
  body[28] = rec.x;
  body[29] = rec.y;
  body[30] = ((rec.dir ?? 0) << 4) | (rec.pk ?? 0);
  const total = 5 + 32;
  return [0xc2, (total >> 8) & 0xff, total & 0xff, 0x12, 1, ...body];
}

const hex = arr => arr.map(n => n.toString(16).padStart(2, '0')).join(' ');

const c = await createClient('buff');

try {
  const who = await loginAs(c, account, password);
  const st = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
  const selfId = st.selfId;
  console.log(`进图：${who.name} selfId=${selfId} 职业=${st.classId} 等级=${st.level}`);
  await sleep(2000);

  const bits = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.stateBits())'));
  console.log(`  状态位表：${JSON.stringify(bits)}`);

  await c.ev('__MU_APP__.fxClear()');
  await c.ev(`__MU_APP__.buffs().forEach(b => __MU_APP__.buffSet(b.id, 0))`);

  /* ================= A. 0x07：加 / 撤 ================= */
  console.log('\n[A] 0x07 效果状态（mask = 0x0100 守护之魂）');
  const p1 = effectStatePacket(1, bits.REDUCE_MAGICDEFENSE, selfId);
  check('包长 8、state 在 +3、mask 小端、index 大端', p1.length === 8 && p1[3] === 1 && p1[4] === 0x00 && p1[5] === 0x01, hex(p1));
  await c.ev(`__MU_APP__.inject('${hex(p1)}')`);
  await sleep(600);
  let buffs = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.buffs())'));
  let me = buffs.find(b => b.id === selfId);
  check('状态位记上了 0x100', me?.mask === bits.REDUCE_MAGICDEFENSE, JSON.stringify(me));
  check('建了 1 组视觉、里面有子节点', (me?.visuals ?? 0) === 1 && (me?.parts ?? 0) > 0, JSON.stringify(me));
  check('视觉落在角色脚下（不是原点）',
    me ? Math.abs(me.pos[0]) > 0.01 || Math.abs(me.pos[1]) > 0.01 : false,
    me?.pos?.join(','));

  await c.ev(`__MU_APP__.inject('${hex(effectStatePacket(0, bits.REDUCE_MAGICDEFENSE, selfId))}')`);
  await sleep(400);
  buffs = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.buffs())'));
  check('state=0 → 整组删掉、实体从表里消失', !buffs.some(b => b.id === selfId), JSON.stringify(buffs));

  /* ================= B. 多位叠加 ================= */
  console.log('\n[B] 多个状态位叠加');
  await c.ev(`__MU_APP__.inject('${hex(effectStatePacket(1, bits.ATTACK, selfId))}')`);
  await sleep(200);
  await c.ev(`__MU_APP__.inject('${hex(effectStatePacket(1, bits.ADD_LIFE, selfId))}')`);
  await sleep(800);
  me = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.buffs())')).find(b => b.id === selfId);
  check('0x04 + 0x10 = 0x14', me?.mask === (bits.ATTACK | bits.ADD_LIFE), `mask=0x${(me?.mask ?? 0).toString(16)}`);
  check('两组视觉并存', (me?.visuals ?? 0) === 2, String(me?.visuals));
  check('子节点都建出来了（贴图异步，等了两帧）', (me?.parts ?? 0) >= 2, String(me?.parts));

  // 重复加同一位不应再建一份（原版 `physicalEffects` 位图去重）
  await c.ev(`__MU_APP__.inject('${hex(effectStatePacket(1, bits.ADD_LIFE, selfId))}')`);
  await sleep(400);
  me = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.buffs())')).find(b => b.id === selfId);
  check('重复加同一位不重建', (me?.visuals ?? 0) === 2, String(me?.visuals));

  /* ================= C. 0x1B：技能号 → 状态位 ================= */
  console.log('\n[C] 0x1B 取消技能效果');
  // 技能 0x30 = 48 生命之光 → 清 0x10
  await c.ev(`__MU_APP__.inject('${hex(skillCancelPacket(0x30, selfId))}')`);
  await sleep(400);
  me = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.buffs())')).find(b => b.id === selfId);
  check('0x1B skill=48 只清 0x10，留下 0x04', me?.mask === bits.ATTACK, `mask=0x${(me?.mask ?? 0).toString(16)}`);
  check('视觉剩 1 组', (me?.visuals ?? 0) === 1, String(me?.visuals));

  // 技能 41 没有对应状态位，不能动别的 buff
  await c.ev(`__MU_APP__.inject('${hex(skillCancelPacket(41, selfId))}')`);
  await sleep(300);
  me = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.buffs())')).find(b => b.id === selfId);
  check('0x1B skill=41（没有状态位）不动任何东西', me?.mask === bits.ATTACK, `mask=0x${(me?.mask ?? 0).toString(16)}`);

  // 技能 0x1C = 28 战神之力 → 清 0x04
  await c.ev(`__MU_APP__.inject('${hex(skillCancelPacket(0x1c, selfId))}')`);
  await sleep(300);
  buffs = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.buffs())'));
  check('清空后实体从表里消失', !buffs.some(b => b.id === selfId), JSON.stringify(buffs));

  /* ================= D. 视野包的 ViewSkillState ================= */
  console.log('\n[D] 视野 0x12 的 ViewSkillState（自己那条）');
  const vp = viewportPlayerPacket({
    id: selfId,
    x: Math.round(await c.ev('__MU_APP__.state().player.x')),
    y: Math.round(await c.ev('__MU_APP__.state().player.y')),
    skillState: bits.DEFENSE | bits.ADD_LIFE, // 0x08 | 0x10
    name: who.name,
  });
  await c.ev(`__MU_APP__.inject('${hex(vp)}')`);
  await sleep(900);
  me = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.buffs())')).find(b => b.id === selfId);
  check('视野包里的状态位直接建（0x18 = 守护之光 + 生命之光）',
    me?.mask === (bits.DEFENSE | bits.ADD_LIFE), `mask=0x${(me?.mask ?? 0).toString(16)}`);
  check('两组视觉', (me?.visuals ?? 0) === 2, String(me?.visuals));

  /*
   * 视野包的状态位**只加不减**（原版对 ViewSkillState 只做 state=1），
   * 所以再来一条 skillState=0 的刷新不应该把已有 buff 清掉。
   */
  await c.ev(`__MU_APP__.inject('${hex(viewportPlayerPacket({ id: selfId, x: 0, y: 0, skillState: 0, name: who.name }))}')`);
  await sleep(500);
  me = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.buffs())')).find(b => b.id === selfId);
  check('视野刷新 skillState=0 不清已有 buff（原版只加不减）', me?.mask === (bits.DEFENSE | bits.ADD_LIFE), `mask=0x${(me?.mask ?? 0).toString(16)}`);

  // 离开视野（0x14）才会删 —— 实体被删，特效跟着 owner 走
  // `C1 06 14 [count] [idHi] [idLo]`
  await c.ev(`__MU_APP__.inject('${hex([0xc1, 6, 0x14, 1, (selfId >> 8) & 0xff, selfId & 0xff])}')`);
  await sleep(500);
  buffs = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.buffs())'));
  check('0x14 离开视野 → buff 清掉', !buffs.some(b => b.id === selfId), JSON.stringify(buffs));

  /* ================= E. 截图（四种视觉一起挂） ================= */
  console.log('\n[E] 截图：护盾 + 战神之力 + 生命之光 + 冰封');
  const all = bits.REDUCE_MAGICDEFENSE | bits.ATTACK | bits.ADD_LIFE | bits.HARDEN;
  await c.ev(`__MU_APP__.buffSet(${selfId}, ${all})`);
  await sleep(1500);
  me = JSON.parse(await c.ev('JSON.stringify(__MU_APP__.buffs())')).find(b => b.id === selfId);
  check('四种状态位同时挂上', me?.mask === all, `mask=0x${(me?.mask ?? 0).toString(16)}`);
  check('4 组视觉', (me?.visuals ?? 0) === 4, String(me?.visuals));
  const names = await c.ev(`JSON.stringify(__MU_APP__.buffNames(${all}))`);
  check('中文名对得上（按位从低到高）', names === JSON.stringify(['战神之力', '生命之光', '石化', '守护之魂']), names);
  const shot = await c.shot('buffs');
  console.log(`截图：${shot}`);

  // 收尾：清掉 buff，别影响下一轮/别的探针
  await c.ev(`__MU_APP__.buffSet(${selfId}, 0)`);
  await sleep(200);
  check('收尾清干净', (await c.ev('JSON.stringify(__MU_APP__.buffs())')) === '[]');
  check('连接还在', (await c.ev('__MU_APP__.state().connected')) === true);
} finally {
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await c.close();
  process.exit(fail === 0 ? 0 : 1);
}
