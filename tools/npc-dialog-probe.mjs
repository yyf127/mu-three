/**
 * NPC 对话窗的探针 —— 「多余对话框」回归。
 *
 *   node tools/npc-dialog-probe.mjs
 *
 * 原版只有**任务**会开对话窗（`CSQuest::ShowQuestNpcWindow` → `ShowDialogText`），
 * 商店/仓库/混沌/金弓/事件窗都由服务端的 `0x30` 自己开。所以断言是：
 *
 *   - 跟一个**没有任务**的 NPC 说话（铁匠 Hanzo 251 / 酒吧女 Lumen 255 /
 *     金弓 236 …）→ 对话窗必须**始终不出现**（服务端该开什么窗就开什么窗）
 *   - `questForNpc(cls) >= 0` 的 NPC（圣导士塞维娜 235，在迪威斯）→ 对话窗出现，
 *     且 `activeQuestDialog` 指向那条任务
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('npcdlg');
const ev = e => c.ev(e);
const snap = async () => (await ev(`JSON.stringify(__MU_APP__.dialogSnapshot())`)) ?? 'null';
const parse = s => (s === 'null' || s === undefined ? null : JSON.parse(s));

try {
  await c.waitFor(`!!document.getElementById('login-account')`, 20000, '登录');
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 60000, '选角');
  await sleep(3000);
  await ev(`(() => { const b = document.querySelectorAll('.char-card')[3]; b && b.click(); })()`);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);
  await c.waitFor(`__MU_APP__.state().mapId !== null`, 120000, '地图');
  await sleep(2500);

  // 走到洛兰广场（NPC 最密的 127,133），让金弓/铁匠/酒吧女都进视野
  await ev(`__MU_APP__.walkTo(127, 133)`);
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const st = JSON.parse(await ev(`JSON.stringify(__MU_APP__.state())`));
    if (st.pathLeft === 0 && Math.round(st.player.x) === 127) break;
  }
  await sleep(800);
  const npcs = JSON.parse(await ev(`JSON.stringify(__MU_APP__.npcs())`));
  console.log('视野内 NPC：', JSON.stringify(npcs.map(n => `${n.cls}:${n.name}`)));
  let bad = 0;

  for (const n of npcs) {
    const q = await ev(`__MU_APP__.questForNpc(${n.cls})`);
    await ev(`__MU_APP__.dialogClose()`);
    await ev(`__MU_APP__.npcPanelHide()`);
    await sleep(300);
    await ev(`__MU_APP__.talkClass(${n.cls})`);
    let opened = null;
    for (let i = 0; i < 12; i++) {
      await sleep(300);
      const s = parse(await snap());
      if (s && s.index >= 0) opened = s;
    }
    const hasQuest = q !== -1 && q !== null && q !== undefined;
    const ok = hasQuest ? !!opened : !opened;
    if (!ok) bad++;
    console.log(
      `  cls=${n.cls} (${n.name}) quest=${hasQuest ? q : '无'} → 对话窗 ${opened ? '开了 idx=' + opened.index : '没开'} ${ok ? 'OK' : '✗'}`
    );
  }

  /* 任务对话窗的渲染路径（不跑路：直接把 235 的第一句画出来） */
  const infoRaw = await ev(`(async () => JSON.stringify(await __MU_APP__.questDialogOpen(235)))()`);
  const info = infoRaw && typeof infoRaw === 'string' ? JSON.parse(infoRaw) : infoRaw;
  const qs = parse(await snap());
  console.log('questDialogOpen(235) →', JSON.stringify(info), ' 对话窗 idx=', qs?.index, ' 任务=', JSON.stringify(await ev(`__MU_APP__.questDialog()`)));
  await ev(`__MU_APP__.dialogClose()`);

  console.log(bad ? `✗ ${bad} 个 NPC 的对话窗行为不对` : '✓ 全部 NPC 都符合「只有任务才弹对话窗」');
} finally {
  await c.close();
}
