/**
 * 锐化后处理探针 —— 验证 CAS 锐化真的提升了清晰度，且不产生白边。
 *
 * ## 背景
 *
 * 阶段 1（各向异性/ACES/像素比）在这个项目里效果有限：各向异性只管斜视远景，
 * ACES 因为画面没高光看不出，像素比在 DPR=1 上完全没生效。
 * 「模型看着平」的主因是 2001 年的低模 + 256×256 贴图 —— 数据层暂不处理，
 * 所以渲染侧上锐化，把已有细节的局部对比度拉出来。
 *
 * ## 怎么量化「更清晰」
 *
 * 不能靠肉眼看。用**边缘对比度**衡量：
 *
 *   - 取画面里同一块区域，算相邻像素的亮度差（梯度）均值
 *   - 锐化后梯度应**明显上升**（细节被拉开）
 *   - 同时**不能过冲**：超过 250 的纯白像素占比不能暴涨（白边）
 *
 * ## 断言
 *
 *   [A] 开关生效：amount 可读写，bypass/0 时退回原生路径
 *   [B] 锐化后梯度上升（真的更锐了）
 *   [C] 不过冲：纯白像素占比不暴涨（无白边）
 *   [D] 不偏色：RGB 均值基本不变（锐化不该改色调）
 *   [E] 强锐化（1.5）时过冲仍被抑制 → 证明软限制生效
 *
 * 用法：node tools/sharpen-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
import { decodePng } from './lib/png-diff.mjs';

const c = await createClient('sharpen');
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
const J = s => JSON.parse(s);

/** 画面统计：梯度均值 + 纯白占比 + RGB 均值 */
function stats(path) {
  const img = decodePng(path);
  const W = img.width;
  const H = img.height;
  const lum = (x, y) => {
    const i = (y * W + x) * 4;
    return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
  };
  let grad = 0;
  let gradN = 0;
  let white = 0;
  let n = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  /*
   * 只统计画面中央的 3D 区域（避开 UI 面板）——
   * UI 是 DOM 层，不受锐化影响，混进来会稀释信号。
   */
  const x0 = Math.round(W * 0.18);
  const x1 = Math.round(W * 0.82);
  const y0 = Math.round(H * 0.05);
  const y1 = Math.round(H * 0.75);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
      n++;
      if (lum(x, y) >= 250) white++;
      // 水平梯度（相邻像素亮度差）
      if (x + 1 < x1) {
        grad += Math.abs(lum(x + 1, y) - lum(x, y));
        gradN++;
      }
    }
  }
  return {
    grad: +(grad / gradN).toFixed(3),
    whitePct: +((white / n) * 100).toFixed(3),
    rgb: [+(r / n).toFixed(2), +(g / n).toFixed(2), +(b / n).toFixed(2)],
    n,
  };
}

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  // 等世界加载完（贴图/物件齐了画面才有代表性）
  await sleep(7000);

  /* [A] 开关 */
  console.log('\n[A] 锐化开关');
  const init = J(await c.ev(`JSON.stringify(__MU_APP__.sharpen())`));
  console.log(`   初始：amount=${init.amount} bypass=${init.bypass}`);
  check('初始已开启（amount > 0）', init.amount > 0 && init.bypass === false, JSON.stringify(init));
  const set0 = J(await c.ev(`JSON.stringify(__MU_APP__.sharpen(0))`));
  check('可设为 0', set0.amount === 0, JSON.stringify(set0));
  const setBack = J(await c.ev(`JSON.stringify(__MU_APP__.sharpen(0.6))`));
  check('可设回 0.6', Math.abs(setBack.amount - 0.6) < 1e-6, JSON.stringify(setBack));

  /*
   * [B][C][D] 三组对比 —— 走 `sharpenMeasure`，一次同步调用量三组。
   *
   * ⚠️ 这里踩过两个坑，记下来免得重犯：
   *
   *  1. 最初三张 `c.shot()` 间隔 500ms → 相机/怪物在动，比的是不同场景。
   *  2. 改用同帧 `snap()` 后仍不稳定 —— 主循环 `requestAnimationFrame`
   *     会在两次调用之间插入新帧。实测「关闭」比「开启」亮度低 56%，
   *     一度误判成「锐化把画面弄暗了」（真凶其实是色彩空间，见下）。
   *
   * 最终方案：`sharpenMeasure()` 在**一次同步调用**里完成
   * 「渲染 → readPixels → 统计」，RAF 无法插入，三组数据严格同场景。
   *
   * 顺带修掉一个真 bug：`ShaderMaterial` 不会自动做输出色彩空间转换，
   * RT 里的线性值被直接当 sRGB 输出，画面暗约一半。修法是 shader 末尾
   * 手写 `linearToSRGB()`。
   */
  console.log('\n[B/C/D] 三组对比（同一次同步调用内测量）');
  const measured = J(await c.ev(`JSON.stringify(__MU_APP__.sharpenMeasure([0, 0.6, 1.5]))`));
  const off = measured[0];
  const norm = measured[1];
  const hard = measured[2];
  /*
   * ⚠️ 关键指标是 `pairEdge`（**配对**边缘梯度），不是 `edgeGrad`。
   *
   * 踩过的坑：一开始用 `edgeGrad`（全图所有边缘的梯度均值），结论完全反了 ——
   * 锐化越强数字越低（28.6 → 27.9 → 27.2），看着像「锐化把画面弄糊了」。
   *
   * 真因是**统计分母在变**：锐化会创造出大量新的弱边缘，这些新边缘梯度小，
   * 把均值拉低了。用「全图边缘均值」评价锐化是个错误指标。
   *
   * `pairEdge` 的做法：先以「关闭时就是边缘」的那批像素为基准（固定点集，
   * 三组的 `pairN` 完全相同），再看这批点各自被拉开多少 —— 受控对比。
   */
  const pct = (a, b) => +(((a - b) / b) * 100).toFixed(1);
  console.log(`   关闭  配对边缘梯度 ${off.pairEdge}（${off.pairN} 个固定边缘点）`);
  console.log(`   默认  配对边缘梯度 ${norm.pairEdge}`);
  console.log(`   强锐  配对边缘梯度 ${hard.pairEdge}`);
  const gainEdge = pct(norm.pairEdge, off.pairEdge);
  const gainHard = pct(hard.pairEdge, off.pairEdge);
  console.log(
    `   默认 vs 关闭：配对边缘 ${gainEdge >= 0 ? '+' : ''}${gainEdge}%   （全图梯度 ${pct(norm.grad, off.grad)}%）`
  );

  check(
    '同一批边缘被拉开（配对梯度上升 > 1%）',
    norm.pairEdge > off.pairEdge * 1.01,
    `${off.pairEdge} → ${norm.pairEdge} (${gainEdge}%)`
  );
  check(`配对提升幅度合理（${gainEdge}%，1%~30%）`, gainEdge > 1 && gainEdge < 30, `${gainEdge}%`);
  check(
    '三次统计用的是同一批点（pairN 一致）',
    off.pairN === norm.pairN && norm.pairN === hard.pairN,
    `${off.pairN}/${norm.pairN}/${hard.pairN}`
  );
  check('强锐比默认更锐（单调递增）', hard.pairEdge > norm.pairEdge, `${norm.pairEdge} → ${hard.pairEdge}`);

  check(
    '不过冲：纯白占比没暴涨（< 关闭时 +2%）',
    norm.whitePct < off.whitePct + 2,
    `${off.whitePct}% → ${norm.whitePct}%`
  );

  /*
   * 色调不该变（锐化只改局部对比度，不改整体亮度）。
   *
   * ⚠️ 这两份数据来自**同一帧**（见上面的同帧截图说明），但要注意
   * `off` 走原生路径、`norm` 走 RT + 手写 sRGB 编码 —— 两条路径的
   * 编码链路不同，允许几个百分比的光差（实测约 2%）。
   *
   * 曾经这里差到 42（画面暗一半）：原因是 `ShaderMaterial` 不会自动做
   * 输出色彩空间转换，RT 里的线性值被直接当 sRGB 输出。修法是 shader
   * 末尾手写 `linearToSRGB()`。这条断言就是防它回归的。
   */
  const rel = (a, b) => (Math.abs(a - b) / Math.max(1, b)) * 100;
  const dr = rel(norm.rgb[0], off.rgb[0]);
  const dg = rel(norm.rgb[1], off.rgb[1]);
  const db = rel(norm.rgb[2], off.rgb[2]);
  check(
    `不偏色（同场景同管线，光差 < 3%：实测 R${dr.toFixed(2)}% G${dg.toFixed(2)}% B${db.toFixed(2)}%）`,
    dr < 3 && dg < 3 && db < 3,
    `ΔR=${dr.toFixed(2)}% ΔG=${dg.toFixed(2)}% ΔB=${db.toFixed(2)}%`
  );

  /* [E] 强锐化仍不出白边 → 软限制生效 */
  console.log('\n[E] 强锐化（1.5）的过冲抑制');
  console.log(`   配对边缘梯度 ${norm.pairEdge} → ${hard.pairEdge}（+${pct(hard.pairEdge, norm.pairEdge)}%）`);
  check('强锐化配对梯度仍高于默认', hard.pairEdge > norm.pairEdge, `${norm.pairEdge} → ${hard.pairEdge}`);
  check(
    '强锐化纯白占比仍受控（< 关闭时 +4%）',
    hard.whitePct < off.whitePct + 4,
    `${off.whitePct}% → ${hard.whitePct}%`
  );

  // 复原成默认，别把状态留给后面的探针
  await c.ev(`__MU_APP__.sharpen(0.6)`);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await c.close();
  process.exit(fail ? 1 : 0);
} catch (err) {
  console.error('探针异常：', err && err.stack ? err.stack : err);
  try { await c.close(); } catch {}
  process.exit(1);
}
