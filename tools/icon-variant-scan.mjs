/**
 * 扫「物品图标朝向」的参数组合。
 *
 *   node tools/icon-variant-scan.mjs
 *
 * 原版 `RenderObjectScreen` 给每个 modelId 一组欧拉角，但**「这组角度在
 * three.js 里该怎么套」**有几个自由度：
 *
 *   - EulerOrder（原版 `EulerToQuat` 展开后未必是直觉的 XYZ）
 *   - 要不要补 MU(Z-up) → three(Y-up) 的基变换 `C·R·C⁻¹`（还是直接乘）
 *
 * 这里把 6 个 order × 2 个 yUp × 2 个 noConj = 24 组都渲染一遍，
 * 导出 `shots/icons/scan/<order>_<y|n>_<conj|noconj>_<type>.png`，
 * 再用 `tools/icon-variant-score.py` 打分挑最优。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('iconscan');
const ev = e => c.ev(e);

const ORDERS = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'];
const TYPES = [0, 8, 32, 128, 160, 192, 224, 256];

mkdirSync('shots/icons/scan', { recursive: true });

try {
  await c.waitFor(`!!document.getElementById('login-account')`, 25000, '登录');
  // 图标渲染只要 renderer 就绪，先登一次拿到 3D（也可以用离线演示）
  await ev(`__MU_APP__.login('1234','1234')`);
  await c.waitFor(`__MU_APP__.state().screen === 'charselect'`, 90000, '选角');
  await sleep(2000);

  const results = [];
  for (const order of ORDERS) {
    for (const yUp of [true, false]) {
      for (const noConj of [false, true]) {
        if (!yUp && noConj) continue; // noConj 只在 yUp 时有意义
        const tag = `${order}_${yUp ? 'yup' : 'none'}_${noConj ? 'noconj' : 'conj'}`;
        await ev(`JSON.stringify(__MU_APP__.iconDebug(${JSON.stringify({ order, yUp, noConj })}))`);
        for (const type of TYPES) {
          const url = await ev(`(async () => await __MU_APP__.itemIcon(${type}, 0))()`);
          if (!url || typeof url !== 'string' || !url.startsWith('data:image')) continue;
          writeFileSync(
            `shots/icons/scan/${tag}_${type}.png`,
            Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
          );
          results.push({ tag, order, yUp, noConj, type });
        }
        process.stdout.write('.');
      }
    }
  }
  writeFileSync('shots/icons/scan/index.json', JSON.stringify(results, null, 1));
  console.log(`\n导出 ${results.length} 张，跑 python tools/icon-variant-score.py 打分`);
} finally {
  await c.close();
}
