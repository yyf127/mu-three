/**
 * GM 命令探针 —— 按 `MuServer/Data/Command.txt` 逐条发，记录「回了什么包 +
 * 聊天框多了哪行 + 界面有没有变」，用来判断某条命令在**当前 H5 客户端**里
 * 到底能不能用。
 *
 *   node tools/command-probe.mjs          # 安全的一批（不改存档结构）
 *   node tools/command-probe.mjs all      # 连 /clearinv、/grandreset 也跑
 *
 * 判定标准：不是「服务端回了 Item created 就算成功」，而是客户端状态真的变
 * （背包多一件、地图变了、金币变了）。服务端只回 0xFF/不回包的命令会被标成
 * 「服务端拒绝」。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const ALL = process.argv.includes('all');

/** 安全：只读或可撤销 */
const SAFE = [
  '/onlines',
  '/addmoney 1000',
  '/submoney 1000',
  '/pkclear',
  '/post h5 post test',
  '/global h5 global test',
  '/make 14 0 0 0 0 0 0', // Apple（1×1，最不容易被背包碎片挡住）
  '/drop 14 1 0 0 0 0 0',
  '/move lorencia',
  '/ware 0',
  '/re ON',
  '/fireworks',
  '/makemob 3 1',
  '/reset',
  '/skin 1234 1',
];
/** 会改存档的，默认跳过 */
const DESTRUCTIVE = ['/str 1', '/agi 1', '/vit 1', '/ene 1', '/grandreset', '/clearinv', '/makeset 0 0 0 0 0'];

const state = async c =>
  JSON.parse(
    await c.ev(`(() => {
      const st = __MU_APP__.state();
      const s = __MU_APP__.stats() || {};
      const inv = __MU_APP__.inventory();
      return JSON.stringify({
        map: st.map ?? null,
        money: s.info ? s.info.money : null,
        str: s.info ? s.info.strength : null,
        inv: inv.length,
        invHead: inv.map(i => i.slot + ':' + i.type).join(','),
        ground: __MU_APP__.items().length,
        mobs: __MU_APP__.monsters().length,
        lines: __MU_APP__.chatLog().lines.length,
      });
    })()`)
  );

const c = await createClient('cmd');
try {
  await loginAs(c, '1234', '1234');
  await sleep(1500);

  for (const cmd of ALL ? [...SAFE, ...DESTRUCTIVE] : SAFE) {
    const before = await state(c);
    await c.ev(`__MU_APP__.chat(${JSON.stringify(cmd)})`);
    await sleep(1300);
    const after = await state(c);

    const diff = [];
    if (before.map !== after.map) diff.push(`地图 ${before.map}→${after.map}`);
    if (before.money !== after.money) diff.push(`金币 ${before.money}→${after.money}`);
    if (before.str !== after.str) diff.push(`力量 ${before.str}→${after.str}`);
    if (before.inv !== after.inv) diff.push(`背包 ${before.inv}→${after.inv} 件`);
    if (before.ground !== after.ground) diff.push(`地面 ${before.ground}→${after.ground}`);
    if (before.mobs !== after.mobs) diff.push(`怪物 ${before.mobs}→${after.mobs}`);

    const line = (await c.ev(`JSON.stringify((__MU_APP__.chatLog().lines.slice(-1)[0] || {}).text || '')`)) ?? '';
    console.log(`${cmd.padEnd(24)} ${diff.length ? '✓ ' + diff.join(' · ') : '— 界面无变化'}`);
    console.log(`    提示: ${line}`);
  }

  const errs = c.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exc]'));
  console.log('控制台错误:', errs.length);
} finally {
  await c.close();
}
