/**
 * 协议边角料探针 —— 专测那几个「服务端发了、我们以前没接」的包。
 *
 * 目前只有 `0xC1/0xDF`（`PMSG_CHARACTER_MAX_LEVEL_SEND`）：
 *
 * ```
 * C1 08 DF [PAD] DWORD MaxCharacterLevel
 *          ↑ 3 字节头之后有 1 字节对齐填充，值在 offset 4
 * ```
 *
 * 这个 pad 是最容易抄错的地方：按 offset 3 读会把 `0x0190`(400) 读成
 * `0x019000`(102400)。原版 `Net_Process.cpp:7335` 用 debug.log 记下的
 * 「op_de=DF size=8」就是为了确认这件事。
 *
 * 用法：node tools/proto-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('proto-gap');
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

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  await sleep(2000);

  /* ================= A. 0xDF 字节对齐 ================= */
  console.log('\n[A] 0xC1/0xDF 等级上限（DWORD 对齐）');
  const rows = JSON.parse(
    await c.ev(`(async () => {
      const g = await import('/src/net/game.ts');
      // C1 08 DF 00 | 90 01 00 00  → 400
      const good = new Uint8Array([0xc1, 0x08, 0xdf, 0x00, 0x90, 0x01, 0x00, 0x00]);
      // 350（0x015E）
      const alt = new Uint8Array([0xc1, 0x08, 0xdf, 0x00, 0x5e, 0x01, 0x00, 0x00]);
      // 非 DF
      const other = new Uint8Array([0xc1, 0x08, 0xde, 0x00, 0x90, 0x01, 0x00, 0x00]);
      return JSON.stringify({
        good: g.parseCharacterMaxLevel(good),
        alt: g.parseCharacterMaxLevel(alt),
        other: g.parseCharacterMaxLevel(other),
        short: g.parseCharacterMaxLevel(good.slice(0, 5)),
        // 对照：按 offset 3 硬读会得到什么
        naive: (good[3] | (good[4] << 8) | (good[5] << 16) | (good[6] << 24)) >>> 0,
      });
    })()`)
  );
  check('400 解析正确', rows.good === 400, String(rows.good));
  check('350 解析正确', rows.alt === 350, String(rows.alt));
  check('非 DF 返回 null', rows.other === null, String(rows.other));
  check('短包返回 null', rows.short === null, String(rows.short));
  check('若不跳过填充会读成 102400', rows.naive === 102400, String(rows.naive));

  /* ================= B. 落到面板 ================= */
  console.log('\n[B] 面板真的用了这个值');
  const before = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.charMaxLevel())`));
  check('默认 400', before.panel === 400, JSON.stringify(before));
  // 直接喂一个非默认值（模拟服务端配了 350）
  await c.ev(`(async () => {
    const g = await import('/src/net/game.ts');
    const pkt = new Uint8Array([0xc1, 0x08, 0xdf, 0x00, 0x5e, 0x01, 0x00, 0x00]);
    return g.parseCharacterMaxLevel(pkt);
  })()`);
  // 面板 setter 是公开接口，这里直接调它（收包路径要真 socket，离线没有）
  await c.ev(`__MU_APP__.setCharMaxLevel(350)`);
  const after = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.charMaxLevel())`));
  check('面板接受 350', after.panel === 350, JSON.stringify(after));
  await c.ev(`__MU_APP__.setCharMaxLevel(400)`);
  const back = JSON.parse(await c.ev(`JSON.stringify(__MU_APP__.charMaxLevel())`));
  check('能改回 400', back.panel === 400, JSON.stringify(back));

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
} finally {
  await c.close();
}
process.exit(fail ? 1 : 0);
