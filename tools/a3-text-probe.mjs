/**
 * A3 的探针：硬编码文案 → `Text.bmd`（`GlobalText`）。
 *
 *   node tools/a3-text-probe.mjs
 *
 * 以前这些地方写死中文，和原版对不上：
 *
 * | 位置 | 以前 | 原版 |
 * |---|---|---|
 * | 背包标题 | 物品栏 | `GlobalText[223]`「装  备」 |
 * | 商店标题 | 商店 | `GlobalText[230]`「商  人」 |
 * | 仓库标题 | 仓库 (开启) | `"%s (%s)"` 234+240 =「仓 库 (开启状态)」 |
 * | 仓库费用 | 仓库费用 | `GlobalText[266]`「仓库使用费」 |
 * | tooltip 需求 | 「需求 Lv40 力200」（一行） | `[73]/[75]/[76]/[77]` 每项一行，缺了补 `[74] "(还需 %d)"` |
 * | tooltip 耐久 | 「耐久 40」 | `[71]`「耐久度 : [%d/%d]」 |
 * | tooltip 价格 | 「售价 100 zen」 | `[62]/[63]`「买入价格: %s / 卖出价格: %s」 |
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('a3text');
const ev = e => c.ev(e);

let pass = true;
const check = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) pass = false;
};

/** 悬停某个格子并读 tooltip 文本行 */
const tipOf = async slot => {
  const cell = JSON.parse(
    await ev(`(() => {
      const el = document.querySelector('#mu-ui [data-drag-panel="inventory"] [data-slot="${slot}"]');
      if (!el) return 'null';
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    })()`)
  );
  if (!cell) return null;
  // 先挪到别处再挪回来：同一个坐标重复 mouseMoved 浏览器不会派 pointermove，
  // tooltip 就不会重算（验「补足属性后还需消失」时会卡在这里）
  await c.ptr('mouseMoved', cell.x + 40, cell.y + 40, { buttons: 0 });
  await sleep(60);
  await c.ptr('mouseMoved', cell.x, cell.y, { buttons: 0 });
  await sleep(400);
  return JSON.parse(await ev(`JSON.stringify(__MU_APP__.itemTip())`));
};

try {
  await c.waitFor(`!!document.getElementById('login-account')`, 25000, '登录');
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 90000, '选角');
  await sleep(2200);
  await ev(`(() => { const b = document.querySelectorAll('.char-card')[3]; b && b.click(); })()`);
  await sleep(400);
  await ev(`(() => { const b = document.getElementById('btn-char-ok'); b && !b.disabled && b.click(); })()`);
  await c.waitFor(`__MU_APP__.state().mapId !== null`, 120000, '进图');
  await sleep(2200);

  // 1) 背包标题
  await ev(`__MU_APP__.toggleInventory(true)`);
  await sleep(600);
  const invTitle = await ev(`document.querySelector('#mu-ui .inv-title').textContent`);
  console.log('背包标题 =', JSON.stringify(invTitle));
  check(invTitle.includes('装') && invTitle.includes('备'), '背包标题 = GlobalText[223]「装  备」');

  // 2) 商店 / 仓库标题
  await ev(`__MU_APP__.npcPanelOpen('shop')`);
  await sleep(700);
  const shopTitle = await ev(`document.querySelector('#mu-ui .npc-title').textContent`);
  console.log('商店标题 =', JSON.stringify(shopTitle));
  check(shopTitle.includes('商') && shopTitle.includes('人'), '商店标题 = GlobalText[230]「商  人」');

  await ev(`__MU_APP__.npcPanelOpen('warehouse')`);
  await sleep(700);
  const whTitle = await ev(`document.querySelector('#mu-ui .npc-title').textContent`);
  console.log('仓库标题 =', JSON.stringify(whTitle));
  check(whTitle.includes('仓') && whTitle.includes('状态'), '仓库标题 = 234 + 240「仓 库 (开启状态)」');

  const whTexts = JSON.parse(
    await ev(`(() => {
      const el = document.querySelector('#mu-ui .npc-panel') || document.querySelector('#mu-ui [data-drag-panel="warehouse"]');
      const root = el ? el.parentElement : document;
      const pick = sel => [...root.querySelectorAll(sel)].map(e => e.textContent.trim()).filter(Boolean);
      return JSON.stringify({
        zen: pick('.npc-zen-label'),
        tax: pick('.npc-tax-label'),
        // 仓库三个按钮是**图标按钮**（原版 24×24 贴图），文案在 title 里；
        // 只有商店那个「全体修理(A)」是文字按钮，textContent 才有内容
        btns: [...root.querySelectorAll('.npc-btn')].map(e => (e.getAttribute('title') || '').trim()).filter(Boolean),
        // 只看仓库那块（npc-wh）的按钮；商店的「全体修理(A)」是同面板里的文字按钮
        btnLabels: pick('[data-drag-panel="warehouse"] .npc-wh .npc-btn'),
      });
    })()`)
  );
  console.log('仓库文案：', JSON.stringify(whTexts));
  check(whTexts.zen[0] === '金', '金币条标签 = GlobalText[224]「金」');
  check(whTexts.tax[0].includes('仓库使用费'), '费用标签 = GlobalText[266]「仓库使用费」');
  check(
    whTexts.btns.includes('存款') && whTexts.btns.includes('提款'),
    '按钮 title = GlobalText[235]「存款」/ [236]「提款」'
  );
  check(whTexts.btnLabels.length === 0, '图标按钮里不再塞文字（否则会把 <img> 顶掉）');

  await ev(`__MU_APP__.npcPanelHide()`);
  await sleep(300);

  {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync('shots/npc-warehouse.png', Buffer.from(r.data, 'base64'));
  }

  // 3) tooltip：拿一件需求很高的装备（力量故意设成 0）
  await ev(`__MU_APP__.heroStats({ level: 1, str: 0, agi: 0, ene: 0 })`);
  // 8 = Kris（短剑），需求力量/敏捷
  await ev(`(() => { __MU_APP__.mockInventory([{ slot: 12, type: 8, durability: 31 }]); return 1; })()`);
  await sleep(900);
  const tip = await tipOf(12);
  console.log('tooltip 行：', JSON.stringify(tip));
  check(!!tip && tip.length > 1, 'tooltip 出来了');
  const flat = (tip || []).join(' | ');
  check(/所需(力量|敏捷|智力|等级)/.test(flat), '需求行用 GlobalText[73/75/76/77]（「所需力量: N」）');
  check(flat.includes('还需'), '力量不够时补一行 GlobalText[74]「(还需 N)」');
  check(/耐久度 : \[/.test(flat), '耐久行用 GlobalText[71]「耐久度 : [x/y]」');
  check(!/价格: /.test(flat), '背包 tooltip 不显示价格（原版只在 ShopOpened 时显示）');

  {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync('shots/item-tooltip.png', Buffer.from(r.data, 'base64'));
  }

  // 4) 把属性补足 → 「还需」消失
  await ev(`__MU_APP__.heroStats({ level: 300, str: 999, agi: 999, ene: 999 })`);
  await sleep(200);
  const tip2 = await tipOf(12);
  const flat2 = (tip2 || []).join(' | ');
  console.log('补足属性后：', JSON.stringify(tip2));
  check(!flat2.includes('还需'), '属性够了就不再显示「(还需 N)」');

  await ev(`__MU_APP__.toggleInventory(false)`);
  console.log(pass ? 'PASS' : 'FAIL');
} finally {
  await c.close();
}
