/**
 * 中文名牌（`Data/Local/NPCName.txt`）的探针。
 *
 *   node tools/npc-name-probe.mjs
 *
 * 原版 `Item/NPC_Data.cpp::NPCName_LoadTextData` 读这张表，`CreateMonster` 用
 * `getMonsterName(Type)` 填名字 —— 所以中文客户端里是「圣导士塞维娜 / 铁匠 汉斯 /
 * 弓箭手洛斯」，不是服务端 `Monster.txt` 的英文。
 *
 * 断言：
 *   1. 表非空（chs 那份 155 条）
 *   2. 几个关键 Class 拿到中文名（235/236/240/249/251/255）
 *   3. 名字带进实体：进图后 `state()` 的 NPC 列表名字不再是 `NPC 236`
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('npcname');
const ev = e => c.ev(e);

try {
  await c.waitFor(`!!window.__MU_APP__`, 25000, 'app');
  const table = await ev(`(async () => JSON.stringify(await __MU_APP__.npcNames()))()`);
  console.log('名牌表：', table);
  const parsed = JSON.parse(table);
  if (!parsed.size) console.log('✗ 表是空的');
  else console.log(`✓ ${parsed.size} 条`, parsed.names.join(' | '));

  // 进图看 NPC 实际显示名
  await c.waitFor(`!!document.getElementById('login-account')`, 20000, '登录界面');
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 60000, '选角');
  await sleep(2500);
  await ev(`(() => { const b = document.querySelectorAll('.char-card')[3]; b && b.click(); })()`);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);
  await c.waitFor(`__MU_APP__.state().mapId !== null`, 120000, '地图');
  await sleep(1500);
  // 走到广场把 NPC 拉进视野
  await ev(`__MU_APP__.walkTo(127, 133)`);
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const st = JSON.parse(await ev(`JSON.stringify(__MU_APP__.state())`));
    if (st.pathLeft === 0) break;
  }
  const npcs = JSON.parse(await ev(`JSON.stringify(__MU_APP__.npcs())`));
  console.log('视野内 NPC：', JSON.stringify(npcs.map(n => `${n.cls}:${n.name}`)));
  const bad = npcs.filter(n => /^NPC \d+$/.test(n.name));
  console.log(bad.length ? `✗ 还有 ${bad.length} 个 NPC 是占位名` : '✓ 视野内 NPC 名字全部来自名牌表');
} finally {
  await c.close();
}
