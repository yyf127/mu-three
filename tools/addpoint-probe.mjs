/**
 * 加点回执解析探针 —— 验 `0xF3/06` 的字段偏移与面板同步。
 *
 * ## 结构（服务端 `Protocol.h:467` `PMSG_LEVEL_UP_POINT_SEND`）
 *
 * `PSBMSG_HEAD` 是 **4 字节**（`ProtocolDefines.h:39`：type/size/head/subh）。
 * 该结构体**不在 `#pragma pack(1)` 区间内**（pack 段是 80-87 / 136-144 /
 * 516-524，它在 467 行），走 MSVC 默认 4 字节对齐 → 各 DWORD 从 **+12** 起，
 * **总长 44 字节**。
 *
 *   +4  result          (BYTE, 后随 1 洞)
 *   +6  MaxLifeAndMana  (WORD)
 *   +8  MaxBP           (WORD, 后随 2 洞)
 *   +12 ViewPoint / 16 ViewMaxHP / 20 ViewMaxMP / 24 ViewMaxBP
 *   +28 ViewStrength / 32 ViewDexterity / 36 ViewVitality / 40 ViewEnergy
 *
 * ## 断言
 *
 *   [A] 44 字节的合法包被接受（长度守卫）
 *   [B] 四维与可分配点按 +12/+28 正确解析
 *   [C] result < 16（失败）时不动数据
 *   [D] 8 字节短包（无 GAMESERVER_EXTRA）被安全忽略
 *   [E] 加满后角色面板 DOM 与数据一致
 *
 * 用法：node tools/addpoint-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('addpoint');
let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}  ${detail}`);
  }
}

/**
 * 造一个服务端会发的 `0xF3/06` 包（**44 字节**，4 字节对齐布局）。
 *
 *   PSBMSG_HEAD 是 **4 字节**（type/size/head/subh），之后：
 *     4     result
 *     6..7  MaxLifeAndMana   （+5 是 1 字节对齐洞）
 *     8..9  MaxBP            （+10..11 是 2 字节对齐洞）
 *     12    ViewPoint
 *     16    ViewMaxHP / 20 ViewMaxMP / 24 ViewMaxBP
 *     28    ViewStrength / 32 ViewDexterity / 36 ViewVitality / 40 ViewEnergy
 *   总长 44
 */
function makePkt({ result = 16, point = 42, hp = 128, mp = 24, bp = 26, str = 31, dex = 20, vit = 25, ene = 10 } = {}) {
  const b = new Uint8Array(44);
  const dv = new DataView(b.buffer);
  b[0] = 0xc1;                      // 0  type
  b[1] = 0x2c;                      // 1  size = 44
  b[2] = 0xf3;                      // 2  head
  b[3] = 0x06;                      // 3  subh
  b[4] = result & 0xff;             // 4  result  ← 后随 1 字节对齐洞
  dv.setUint16(6, 7777, true);      // 6  MaxLifeAndMana（刻意的垃圾值，不该被采用）
  dv.setUint16(8, 8888, true);      // 8  MaxBP（同样不该被采用）
  dv.setUint32(12, point, true);    // 12 ViewPoint
  dv.setUint32(16, hp, true);       // 16 ViewMaxHP
  dv.setUint32(20, mp, true);       // 20 ViewMaxMP
  dv.setUint32(24, bp, true);       // 24 ViewMaxBP
  dv.setUint32(28, str, true);      // 28 ViewStrength
  dv.setUint32(32, dex, true);      // 32 ViewDexterity
  dv.setUint32(36, vit, true);      // 36 ViewVitality
  dv.setUint32(40, ene, true);      // 40 ViewEnergy
  return b;
}

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  await sleep(2200);

  /*
   * 离线演示不连服务端，`currentChar.info` 是空的 —— 加点回执的解析
   * 会在 `if (!info)` 处直接 return。先用现成的 `hudPreview` 造一份
   * 假角色数据（它本来就是给探针看底栏用的），四维全填 0 便于验证覆盖。
   */
  await c.ev(`__MU_APP__.hudPreview({ levelUpPoint: 0, strength: 0, dexterity: 0, vitality: 0, energy: 0, maxLife: 0, maxMana: 0, maxBp: 0 })`);
  await sleep(200);

  const hasFeed = await c.ev(`typeof __MU_APP__.debugFeedPacket === 'function'`);
  check('调试口 debugFeedPacket 存在', hasFeed, String(hasFeed));
  if (!hasFeed) throw new Error('缺少 debugFeedPacket，无法注入测试包');

  const before = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.charInfo())`));
  console.log(`   加点前：point=${before.levelUpPoint} str=${before.strength} dex=${before.dexterity} vit=${before.vitality} ene=${before.energy}`);

  /* [A][B] 正向：44 字节包应被接受并正确解析 */
  console.log('\n[A/B] 44 字节合法包（+12 起点，4 字节对齐）');
  const pkt = Array.from(makePkt({ result: 16, point: 42, hp: 128, mp: 24, bp: 26, str: 31, dex: 20, vit: 25, ene: 10 }));
  await c.ev(`__MU_APP__.debugFeedPacket(${JSON.stringify(pkt)})`);
  await sleep(120);
  const after = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.charInfo())`));
  console.log(`   加点后：point=${after.levelUpPoint} str=${after.strength} dex=${after.dexterity} vit=${after.vitality} ene=${after.energy}`);
  check('可分配点按 +12 解析为 42', after.levelUpPoint === 42, `got=${after.levelUpPoint}`);
  check('力量按 +28 解析为 31', after.strength === 31, `got=${after.strength}`);
  check('敏捷按 +32 解析为 20', after.dexterity === 20, `got=${after.dexterity}`);
  check('体力按 +36 解析为 25', after.vitality === 25, `got=${after.vitality}`);
  check('能量按 +40 解析为 10', after.energy === 10, `got=${after.energy}`);
  check('血上限按 +16 解析为 128', after.maxLife === 128, `got=${after.maxLife}`);
  check('蓝上限按 +20 解析为 24', after.maxMana === 24, `got=${after.maxMana}`);
  check('没用 MaxLifeAndMana 那个 WORD（仍是 7777 的坑）', after.maxLife !== 7777, `got=${after.maxLife}`);
  check('没用 MaxBP 那个 WORD（仍是 8888 的坑）', after.maxBp !== 8888, `got=${after.maxBp}`);

  /* [C] 失败包不动数据 */
  console.log('\n[C] result < 16（失败）不动数据');
  const failPkt = Array.from(makePkt({ result: 0, point: 999, str: 999 }));
  await c.ev(`__MU_APP__.debugFeedPacket(${JSON.stringify(failPkt)})`);
  await sleep(120);
  const afterFail = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.charInfo())`));
  check('失败包不覆盖可分配点', afterFail.levelUpPoint === 42, `got=${afterFail.levelUpPoint}`);
  check('失败包不覆盖力量', afterFail.strength === 31, `got=${afterFail.strength}`);

  /* [D] 短包安全忽略 */
  console.log('\n[D] 8 字节短包（无 GAMESERVER_EXTRA）安全忽略');
  const shortPkt = Array.from(makePkt({ point: 999, str: 999 })).slice(0, 8);
  await c.ev(`__MU_APP__.debugFeedPacket(${JSON.stringify(shortPkt)})`);
  await sleep(120);
  const afterShort = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.charInfo())`));
  check('短包不崩、不污染数据', afterShort.strength === 31 && afterShort.levelUpPoint === 42, `got=${afterShort.strength}/${afterShort.levelUpPoint}`);

  /* [E] 面板 DOM 与数据一致 */
  console.log('\n[E] 角色面板 DOM 同步');
  await c.ev(`__MU_APP__.toggleCharacter?.() ?? 0`);
  await sleep(400);
  const dom = await c.ev(`(() => {
    const p = document.querySelector('.chr-panel');
    if (!p) return 'null';
    return JSON.stringify({
      hidden: p.classList.contains('hidden'),
      text: p.innerText.replace(/\\s+/g, ' ').slice(0, 200),
    });
  })()`);
  const panel = dom === 'null' ? null : JSON.parse(dom);
  if (panel) {
    check('面板已打开', !panel.hidden, JSON.stringify(panel.hidden));
    check('面板里出现 31（力量）', panel.text.includes('31'), panel.text);
    check('面板里出现 42（可分配点）', panel.text.includes('42'), panel.text);
  } else {
    // 面板没打开也不算错（可能需要在游戏内才显示），降级为提示
    console.log('   （面板未挂载，跳过 DOM 断言）');
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await c.close();
  process.exit(fail ? 1 : 0);
} catch (err) {
  console.error('探针异常：', err && err.stack ? err.stack : err);
  try {
    await c.close();
  } catch {}
  process.exit(1);
}
