/**
 * 地面物品探针：模型解析 + 掉落显示 + 拾取链路 + 角色数值面板。
 *
 *   node tools/item-probe.mjs
 *
 * 用调试接口伪造 0x20 视野包（不依赖打怪掉落，结果可复现），
 * 然后在真实服务端上走完「走过去 → 发 0x22 → 收回执」。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, loginAs } from './lib/edge-client.mjs';

const TYPES = [
  { type: 0, name: 'Sword01', label: '剑' },
  { type: 32, name: 'Axe01', label: '斧' },
  { type: 128, name: 'Bow01', label: '弓' },
  { type: 192, name: 'Shield01', label: '盾' },
  { type: 256, name: 'ArmorMale01', label: '铠甲' },
  { type: 384, name: 'Wing01', label: '翅膀' },
  { type: 448, name: 'Potion01', label: '药水' },
  { type: 461, name: 'Jewel01', label: '宝石' },
  { type: 480, name: 'Book01', label: '书' },
];

const state = async c => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.state())'));
const items = async c => JSON.parse(await c.ev('JSON.stringify(__MU_APP__.items())'));

const client = await createClient('item');

try {
  console.log('登录中…');
  const who = await loginAs(client, '1234', '1234');
  console.log(`进图 ${who.name} 格(${Math.floor(who.player.x)},${Math.floor(who.player.y)})`);

  const p = await state(client);
  const cx = Math.floor(p.player.x);
  const cy = Math.floor(p.player.y);

  /* ---- 1) 在玩家左侧摆一排物品，验证每种 model 都能解析 ---- */
  console.log('\n=== 摆放物品（伪造 0x20）===');
  let id = 1;
  const placed = [];
  for (let i = 0; i < TYPES.length; i++) {
    const t = TYPES[i];
    // 围着角色摆一圈（半径 2 格）：相机是固定俯视角，单侧摆放容易被
    // 角色模型或 HUD 挡掉，围一圈保证至少一半在画面里
    const ang = (i / TYPES.length) * Math.PI * 2;
    const x = cx + Math.round(Math.cos(ang) * 2);
    const y = cy + Math.round(Math.sin(ang) * 2);
    const r = await client.ev(
      `JSON.stringify(__MU_APP__.testItem(${t.type}, ${x}, ${y}, ${0x6000 + id++}, ${i % 3}))`
    );
    const parsed = JSON.parse(r);
    placed.push({ ...t, x, y, parsed: parsed?.[0] ?? null });
  }
  await sleep(2500); // 等 BMD 异步解析

  console.log('已放置:');
  for (const it of placed) {
    const ok = it.parsed && it.parsed.type === it.type;
    console.log(
      `  ${ok ? '✓' : '✗'} type=${String(it.type).padStart(3)} ${it.label.padEnd(3)} ` +
        `模型=${it.name.padEnd(12)} 格(${it.x},${it.y}) ` +
        `解析=${it.parsed ? `type=${it.parsed.type} lv=${it.parsed.level}` : 'null'}`
    );
  }

  /* ---- 2) 场景里真的有网格吗（解析成功≠渲染出来） ---- */
  const meshStat = JSON.parse(
    await client.ev(`JSON.stringify((()=>{
      const s = __MU__.scene.getObjectByName('ground-items');
      if (!s) return { found: false };
      const out = [];
      s.traverse(o => {
        if (o.isMesh) {
          const b = o.geometry.boundingBox;
          if (!b) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox;
          out.push({
            parent: o.parent?.name || '',
            visible: o.visible,
            tris: o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3,
            size: bb ? [+(bb.max.x-bb.min.x).toFixed(2), +(bb.max.y-bb.min.y).toFixed(2), +(bb.max.z-bb.min.z).toFixed(2)] : null,
          });
        }
      });
      return { found: true, total: s.children.length, meshes: out.length, sample: out.slice(0, 4) };
    })())`)
  );
  console.log('\n场景节点:', JSON.stringify(meshStat));

  /* ---- 3) 金币 ---- */
  const moneyRes = JSON.parse(
    await client.ev(`JSON.stringify(__MU_APP__.testMoney(${cx + 2}, ${cy + 2}, 12345, 0x70ff))`)
  );
  console.log('金币条目:', JSON.stringify(moneyRes?.[0] ?? null));

  await sleep(1200);
  await client.shot('items-spawn');
  const all = await items(client);
  console.log(`当前地面物品 ${all.length} 件（含金币）:`);
  for (const it of all.slice(0, 14)) {
    console.log(
      `  id=${String(it.id).padStart(4)} type=${String(it.type).padStart(3)} ` +
        `格(${it.x},${it.y}) ${it.isMoney ? `金币 ${it.money}` : `lv${it.level}`}`
    );
  }

  /* ---- 4) 用 /drop 造一件真实物品，走开再走回来捡 ---- */
  console.log('\n=== 真实掉落（GM 命令 /drop）===');
  await client.ev(`__MU_APP__.chat('/drop 0 0 0 0 0 0 0')`);
  await sleep(1500);

  const afterDrop = await items(client);
  const real = afterDrop.filter(i => i.id < 0x1000 && i.type === 0);
  console.log(`/drop 后地面物品 ${afterDrop.length} 件，新掉落的剑:`, JSON.stringify(real));

  if (!real.length) {
    console.log('⚠ /drop 没有产生物品（命令未生效或掉在别处），跳过真实拾取');
  } else {
    const dropped = real[0];
    console.log(`真实物品 id=${dropped.id} type=${dropped.type} 格(${dropped.x},${dropped.y})`);

    // 先走开 4 格，验证「点物品 → 自己走过去 → 进 2 格才发 0x22」
    const away = await state(client);
    await client.ev(`__MU_APP__.walkTo(${Math.floor(away.player.x) + 4}, ${Math.floor(away.player.y)})`);
    await sleep(3500);
    const far = await state(client);
    console.log(
      `已走开：(${far.player.x},${far.player.y}) 距物品 ` +
        Math.hypot(dropped.x + 0.5 - far.player.x, dropped.y + 0.5 - far.player.y).toFixed(2) + ' 格'
    );

    const beforeMoney =
      JSON.parse(await client.ev('JSON.stringify(__MU_APP__.stats())'))?.info?.money ?? '?';
    console.log('→ 点物品（应当自动走回去并拾取）…');
    await client.ev(`__MU_APP__.pickupItem(${dropped.id})`);

    // 等一下：地上那个 id 消失才算真捡到（服务端还会主动推 0x22 同步金币，
    // 只看 picked 会被它提前 satisfy）
    let gone = false;
    for (let i = 0; i < 100; i++) {
      await sleep(120);
      const list = await items(client);
      if (!list.some(x => x.id === dropped.id)) {
        gone = true;
        break;
      }
      if (i % 12 === 0) {
        const s2 = await state(client);
        const got2 = JSON.parse(await client.ev('JSON.stringify(__MU_APP__.itemDebug())'));
        console.log(
          `  …${(i * 0.12).toFixed(1)}s 玩家(${s2.player.x},${s2.player.y}) ` +
            `pending=${got2.pending} 剩余物品=${list.length}`
        );
      }
    }
    console.log('地面物品已消失:', gone);
    const end = await state(client);
    const dbg = JSON.parse(await client.ev('JSON.stringify(__MU_APP__.itemDebug())'));
    const left = await items(client);
    console.log(
      `结果: picked=${dbg.picked} failed=${dbg.failed} recv22=${dbg.recv22} ` +
        `lastGet=${JSON.stringify(dbg.lastGet)} raw22=[${(dbg.raw22 || []).join(' ')}]`
    );
    const mi = JSON.parse(await client.ev('JSON.stringify(__MU_APP__.moveInfo())'));
    console.log(
      `moveInfo: goal=${JSON.stringify(mi.goal)} 剩余=${mi.len - mi.cursor} ` +
        `clear=${mi.clearReason} next=${JSON.stringify(mi.next)}`
    );
    console.log(
      `玩家停在 (${end.player.x},${end.player.y})，地面还剩 ${left.length} 件，` +
        `物品 ${dropped.id} 还在? ${left.some(i => i.id === dropped.id)}`
    );
    console.log(
      `金币 ${beforeMoney} → ${JSON.parse(await client.ev('JSON.stringify(__MU_APP__.stats())'))?.info?.money}`
    );
  }

  /* ---- 6) 角色数值面板 ---- */
  console.log('\n=== 角色数值面板 ===');
  const stats = JSON.parse(await client.ev('JSON.stringify(__MU_APP__.stats())'));
  console.log(
    `面板数据: ${stats.name} Lv.${stats.level} ` +
      `力${stats.info.strength} 敏${stats.info.dexterity} ` +
      `体${stats.info.vitality} 智${stats.info.energy} ` +
      `HP ${stats.info.life}/${stats.info.maxLife} 金币 ${stats.info.money}`
  );
  // 数值已经搬进底栏（src/ui/hudValues.ts），这里只核对一遍快照
  console.log('底栏数值:', await client.ev('JSON.stringify(__MU_APP__.hudValues())'));
  await sleep(600);
  await client.shot('items-hud');

  /* ---- 7) 报错检查 ---- */
  const errs = client.logs.filter(l => l.startsWith('[error]') || l.startsWith('[exc]'));
  const warns = client.logs.filter(l => l.includes('[items]'));
  console.log(`\n控制台错误 ${errs.length} 条，物品相关 ${warns.length} 条`);
  for (const e of errs.slice(0, 6)) console.log('  ' + e.slice(0, 160));
  for (const w of warns.slice(0, 8)) console.log('  ' + w.slice(0, 160));
} finally {
  await client.close();
}
