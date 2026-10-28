/**
 * 物品图标朝向探针。
 *
 *   node tools/icon-orient-probe.mjs
 *
 * 原版 `RenderObjectScreen`（BMD_LegacyDraw.cpp:1750）给每个 modelId 写死一组
 * 欧拉角，`itemIcon.ts` 现在照抄那张表。这个探针把一批典型物品的图标导出来，
 * 用**像素统计**判断朝向合不合理：
 *
 *   剑 / 弓 / 矛  → 竖直（高 > 宽 × 1.3）
 *   翅膀 / 披风   → 横向展开（宽 > 高）
 *   盾 / 头盔     → 近方（0.6 < 宽/高 < 1.6）
 *   药水          → 竖直（瓶子）
 *
 * 导出到 shots/icons/<type>.png，方便肉眼复核。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('iconorient');
const ev = e => c.ev(e);

/** type → [名字, 期望形状] */
/**
 * 0.97 的物品号是**每 32 一组**：
 *
 *   0 剑 · 32 斧 · 64 槌 · 96 矛 · 128 弓 · 160 法杖 · 192 盾
 *   224 头盔 · 256 铠甲 · 288 护腿 · 320 护手 · 352 战靴 · 384 翅膀
 *   448 药水/卷轴
 *
 * （不是「0..95 剑、128 盾」那种猜法 —— 第一版探针就按错的分类写的，
 * 结果把弓当成了盾、把头盔当成了铠甲，判分全乱。）
 */
const CASES = [
  [0, '波刃剑', 'tall'],
  [8, '巨蛇魔剑', 'tall'],
  [32, '短斧', 'tall'],
  [64, '石槌', 'tall'],
  [128, '短弓', 'tall'],
  [160, '骷髅杖', 'tall'],
  [192, '圆盾', 'square'],
  [224, '青铜盔', 'square'],
  [256, '青铜铠', 'square'],
  [288, '青铜护腿', 'square'],
  [352, '战靴', 'square'],
  [452, '小瓶魔力药水', 'tall'],
];

mkdirSync('shots/icons', { recursive: true });

try {
  await c.waitFor(`!!window.__MU_APP__`, 25000, 'app');
  console.log('type  name                shape    导出');
  const rows = [];
  for (const [type, name, shape] of CASES) {
    const url = await ev(`(async () => await __MU_APP__.itemIcon(${type}, 0))()`);
    if (!url || typeof url !== 'string' || !url.startsWith('data:image')) {
      console.log(`  ${type}  ${name.padEnd(18)}  —        （没有模型）`);
      continue;
    }
    const b64 = url.slice(url.indexOf(',') + 1);
    writeFileSync(`shots/icons/${type}.png`, Buffer.from(b64, 'base64'));
    rows.push({ type, name, shape });
    console.log(`  ${type}  ${name.padEnd(18)}  ${shape.padEnd(8)} shots/icons/${type}.png`);
  }
  writeFileSync('shots/icons/index.json', JSON.stringify(rows, null, 1));
  console.log(`\n导出 ${rows.length} 张，接下来用 tools/icon-orient-check.py 分析长宽比`);
} finally {
  await c.close();
}
