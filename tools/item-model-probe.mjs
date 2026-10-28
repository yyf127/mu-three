/**
 * 物品模型 / 图标 / 地面物品名 探针。
 *
 * 覆盖用户报的三个现象：
 *   ① 部分物品掉在地上没有模型
 *   ② 背包、仓库里那几格是空的
 *   ③ 地上掉了东西，看不到名字
 *
 * 关键是这套映射必须照抄原版 `OpenItems`（`Model/Model_Players.cpp`，IDA 0x005079D0）：
 * **模型槽 = type + 400**，而槽号和文件名之间没有任何算术关系 ——
 *   group 12 的 index 7.. 是技能石（Gem01..13），不是翅膀；
 *   830/831 是 Quest04/05（洛克之羽 / 果实）；
 *   864..874 是生命宝石 / 恶魔系列 / 创造宝石 / 帝王之书 / 断魂之剑 / 精灵之泪 / 先知之魂。
 *
 * 断言：
 *   1. item.bmd 里 283 件物品，模型文件全部能取到
 *   2. 全部能解析出至少一个 mesh（proto.parts > 0）
 *   3. 曾经失败的 30 件（技能石 / 洛克之羽 / 果实 / 生命宝石 / 任务道具）逐个点名通过
 *   4. 背包里图标的 dataURL 真的不是全透明（按像素统计）
 *   5. 仓库面板同理
 *   6. 地面物品：Alt 全显、悬停单显，名字/颜色按 RenderItemName 的分档
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

let pass = 0;
let fail = 0;
const check = (l, ok, d = '') => {
  ok ? (pass++, console.log(`  ✓ ${l}${d ? '  ' + d : ''}`))
     : (fail++, console.log(`  ✗ ${l}${d ? '  ' + d : ''}`));
};

/** 之前扫出来「映射表无此项」的全部 30 件 */
const ONCE_BROKEN = [
  [391, '霹雳回旋斩之石'], [392, '治疗之石'], [393, '防御之石'], [394, '攻击之石'],
  [395, '召唤之石'], [396, '雷霆裂闪之石'], [397, '钻云枪之石'], [398, '生命之光之石'],
  [399, '玛雅之石'], [400, '玄月斩之石'], [401, '穿透箭之石'], [402, '冰封箭之石'],
  [403, '袭风刺之石'], [430, '洛克之羽'], [431, '果实'], [432, '血灵之书'],
  [433, '血灵之骷'], [434, '透明披风'], [464, '生命宝石'], [465, '恶魔之眼'],
  [466, '恶魔之钥'], [467, '恶魔广场通行证'], [468, '爱情的魔力'], [469, 'Rena奇迹通宝'],
  [470, '创造宝石'], [471, '帝王之书'], [472, '断魂之剑'], [473, '精灵之泪'],
  [474, '先知之魂'],
];

const c = await createClient('itemmodel');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`typeof __MU_DEBUG__ === 'object'`, 60000, 'debug api');
  await sleep(1200);

  /* ---------- 1/2. 全量：文件存在 + 能解析 ---------- */
  const types = await c.ev(`(() => {
    const out = [];
    for (let t = 0; t < 512; t++) {
      const n = __MU_APP__.itemName(t).fromAttr;
      if (n && !/^Item \\d+$/.test(n)) out.push(t);
    }
    return out;
  })()`);
  console.log(`\nitem.bmd 条目 ${types.length} 件`);

  // 分批，避免一次 await 太久（每件都要 fetch + 解析 BMD）
  const all = [];
  for (let i = 0; i < types.length; i += 24) {
    const chunk = types.slice(i, i + 24);
    const r = await c.ev(`__MU_APP__.itemProbe(${JSON.stringify(chunk)})`);
    all.push(...r);
  }
  /*
   * 已知例外：type 435「大天使之武器」（模型槽 835）在 0.97 客户端里**原版就没加载**
   * （`OpenItems` 的 sword/shield 段都止于更小的槽号），资源包里也没有对应文件。
   * 现在走「模型缺失 → 占位方块 / 占位图标」，不再是一格空白。
   */
  const KNOWN_NO_MODEL = new Set([435]);
  const noFile = all.filter(r => !r.exists && !KNOWN_NO_MODEL.has(r.type));
  const noProto = all.filter(r => r.exists && !r.proto && !KNOWN_NO_MODEL.has(r.type));
  console.log(`取不到文件 ${noFile.length} 件 / 解析不出网格 ${noProto.length} 件`);
  for (const r of noFile) console.log(`   [文件] type=${r.type} ${r.name} → ${r.file ?? '(无映射)'}`);
  for (const r of noProto) console.log(`   [解析] type=${r.type} ${r.name} → ${r.file}`);
  check('283 件物品的模型文件都能取到（435 原版无模型）', noFile.length === 0, `${noFile.length} 件缺文件`);
  check('每件都能解析出网格', noProto.length === 0, `${noProto.length} 件空网格`);

  /* ---------- 3. 曾经失败的 30 件 ---------- */
  const brokenTypes = ONCE_BROKEN.map(x => x[0]);
  const again = await c.ev(`__MU_APP__.itemProbe(${JSON.stringify(brokenTypes)})`);
  const stillBad = again.filter(r => !r.exists || !r.proto);
  for (const r of again) {
    const label = ONCE_BROKEN.find(x => x[0] === r.type)?.[1] ?? '';
    if (!r.exists || !r.proto) console.log(`   ✗ ${r.type} ${label} → ${r.file ?? '(无映射)'}`);
  }
  check('曾经画不出来的 30 件现在全部可画', stillBad.length === 0, `${stillBad.length} 件仍失败`);
  console.log('   抽样：', again.slice(0, 6).map(r => `${r.type}:${r.file}`).join('  '));

  /* ---------- 4. 背包图标：不是全透明 ---------- */
  const invTypes = [0, 39, 224, 391, 399, 430, 431, 464, 471, 472, 473, 474, 448, 463];
  await c.ev(`__MU_APP__.inventoryFill(${JSON.stringify(invTypes)})`);
  await sleep(2500);
  const inv = await c.ev(`(async () => {
    const out = [];
    for (const img of document.querySelectorAll('.inv-item-icon')) {
      const url = img.getAttribute('src') || '';
      let opaque = 0, total = 0;
      if (url.startsWith('data:image')) {
        const im = new Image();
        im.src = url;
        await im.decode().catch(() => {});
        const cv = document.createElement('canvas');
        cv.width = im.width; cv.height = im.height;
        const ctx = cv.getContext('2d');
        ctx.drawImage(im, 0, 0);
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        total = cv.width * cv.height;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 16) opaque++;
      }
      out.push({ hasSrc: !!url, opaque, total });
    }
    return out;
  })()`);
  const invBad = inv.filter(x => !x.hasSrc || x.opaque / Math.max(1, x.total) < 0.02);
  console.log(`\n背包图标 ${inv.length} 个，空白 ${invBad.length} 个`);
  for (const [i, x] of inv.entries()) {
    const t = invTypes[i];
    console.log(`   type=${String(t).padStart(3)} src=${x.hasSrc} 不透明像素=${x.opaque}/${x.total}`);
  }
  check('背包图标全部有内容', invBad.length === 0, `${invBad.length} 个空白`);

  /* ---------- 5. 仓库图标 ---------- */
  await c.ev(`__MU_APP__.toggleInventory(false)`);
  await c.ev(`__MU_APP__.npcPanelOpen('warehouse')`);
  await c.ev(`__MU_APP__.npcPanelFill(${JSON.stringify(invTypes)})`);
  await sleep(2500);
  const wh = await c.ev(`(async () => {
    const out = [];
    for (const img of document.querySelectorAll('.npc-item-icon')) {
      const url = img.getAttribute('src') || '';
      let opaque = 0, total = 0;
      if (url.startsWith('data:image')) {
        const im = new Image(); im.src = url;
        await im.decode().catch(() => {});
        const cv = document.createElement('canvas');
        cv.width = im.width; cv.height = im.height;
        const ctx = cv.getContext('2d');
        ctx.drawImage(im, 0, 0);
        const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        total = cv.width * cv.height;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 16) opaque++;
      }
      out.push({ hasSrc: !!url, opaque, total });
    }
    return out;
  })()`);
  const whBad = wh.filter(x => !x.hasSrc || x.opaque / Math.max(1, x.total) < 0.02);
  console.log(`仓库图标 ${wh.length} 个，空白 ${whBad.length} 个`);
  check('仓库图标全部有内容', wh.length > 0 && whBad.length === 0, `${wh.length} 个里 ${whBad.length} 个空白`);
  await c.ev(`__MU_APP__.npcPanelHide ? __MU_APP__.npcPanelHide() : 0`);

  /* ---------- 6. 地面物品名 ---------- */
  await c.ev(`__MU_APP__.spawnItem(0, { level: 0 })`);
  await c.ev(`__MU_APP__.spawnItem(39, { level: 9, excellent: true })`);
  await c.ev(`__MU_APP__.spawnItem(471)`);
  await c.ev(`__MU_APP__.spawnItem(463, { money: 12345 })`);
  await sleep(1500);

  /* 模型真的挂上去了吗（0 = 只有光斑，看不到东西） */
  const meshes = await c.ev(`__MU_APP__.itemMeshes()`);
  console.log('地面物品模型:', JSON.stringify(meshes));
  const noMesh = meshes.filter(m => m.meshes === 0);
  check('4 件地面物品都挂上了模型 mesh', meshes.length === 4 && noMesh.length === 0, JSON.stringify(meshes));

  const off = await c.ev(`__MU_APP__.itemLabels()`);
  check('没按 Alt 时不刷屏（只有悬停那一条，这里鼠标不在地上）', off.length === 0, JSON.stringify(off));

  await c.ev(`__MU_APP__.setAlt(true)`);
  await sleep(600);
  const on = await c.ev(`__MU_APP__.itemLabels()`);
  console.log('\nAlt 全显：', JSON.stringify(on.map(x => `${x.text}|${x.color}`)));
  check('Alt 显示全部 4 件地面物品', on.length === 4, `${on.length} 条`);
  check('名字里有中文物品名', on.some(x => /[\u4e00-\u9fa5]/.test(x.text)), JSON.stringify(on.map(x => x.text)));
  check('金币带数量', on.some(x => /12,345/.test(x.text)), JSON.stringify(on.map(x => x.text)));

  const colors = await c.ev(`[
    __MU_APP__.itemLabelOf(0, {}),
    __MU_APP__.itemLabelOf(39, { level: 3 }),
    __MU_APP__.itemLabelOf(39, { level: 9 }),
    __MU_APP__.itemLabelOf(39, { level: 0, excellent: true }),
    __MU_APP__.itemLabelOf(471, {}),
    __MU_APP__.itemLabelOf(463, { money: 500 }),
    __MU_APP__.itemLabelOf(431, {}),
    __MU_APP__.itemLabelOf(399, {}),
  ]`);
  console.log('颜色分档:', JSON.stringify(colors));
  check('+0 灰 / +3 橙 / +9 金 / 卓越绿', colors[0].color === '#b3b3b3' && colors[1].color === '#ff8033' &&
        colors[2].color === '#ffcc1a' && colors[3].color === '#1aff80', JSON.stringify(colors.map(x => x.color)));
  /*
   * 帝王之书（model 871 = Quest00）在原版走的是**默认分档**（+0 灰）——
   * `RenderItemName` 的金色特例只有 799/830/831/861/862/864/865..867/870。
   * 所以这里断言它「是灰的」才对得上源码；果实（831）才是金色。
   */
  check('帝王之书 +0 = 灰（原版默认档）', colors[4].color === '#b3b3b3', JSON.stringify(colors[4]));
  check('果实（model 831）走金色特例', colors[6].color === '#ffcc1a', JSON.stringify(colors[6]));
  check('玛雅之石（model 799）走金色特例', colors[7].color === '#ffcc1a', JSON.stringify(colors[7]));
  check('金币名字带数量', /500/.test(colors[5].text), JSON.stringify(colors[5]));

  /* ---------- 7. 悬停单显（原版 Sort=0：画在鼠标上方，不用按 Alt） ---------- */
  await c.ev(`__MU_APP__.setAlt(false)`);
  await sleep(300);
  const dbg0 = await c.ev(`__MU_APP__.pointerDebug()`);
  console.log('\n地面物品投影:', JSON.stringify(dbg0.items));
  let hoverOk = false;
  let hoverText = '';
  for (const it of dbg0.items) {
    if (it.sx < 4 || it.sy < 4 || it.sx > 1276 || it.sy > 740) continue;
    await c.ptr('mouseMoved', it.sx, it.sy, { buttons: 0 });
    await sleep(450);
    const d = await c.ev(`__MU_APP__.pointerDebug()`);
    const labels = await c.ev(`__MU_APP__.itemLabels()`);
    if (d.pick === it.id && labels.length) {
      hoverOk = true;
      hoverText = `${labels[0].text} @ ${labels[0].left},${labels[0].top}`;
      console.log(`   悬停 id=${it.id} → pick=${d.pick} 「${labels[0].text}」${labels[0].color} (${labels[0].left},${labels[0].top})`);
      break;
    }
  }
  check('鼠标指着地面物品就显示名字（不用按 Alt）', hoverOk, hoverText);

  await c.ev(`__MU_APP__.setAlt(true)`);
  await c.shot('item-labels');
  await c.ev(`__MU_APP__.setAlt(false)`);

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
