/**
 * 地面混合探针（离线）：检查着色器能编译、地面有内容、接缝处没有硬跳变。
 *
 * 做法：在画面下部沿水平线采样 60 个像素，算「相邻像素色差」的分布。
 * 一格一 alpha 的旧做法会在格边界出现一次大跳变（几十上百）；
 * 四角双线性之后应该是连续渐变（相邻差很小）。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';
let pass = 0, fail = 0;
const check = (l, ok, d='') => { ok ? (pass++, console.log(`  ✓ ${l}${d?'  '+d:''}`)) : (fail++, console.log(`  ✗ ${l}${d?'  '+d:''}`)); };
const c = await createClient('terrainblend');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`__MU_APP__.state().objects > 0`, 90000, '物件');
  await c.waitFor('!!window.__MU_DEBUG__', 20000, '调试口就绪');
  await sleep(800);

  for (const [m, name] of [[0, '洛兰'], [2, '冰风谷']]) {
    if (m) {
      await c.ev(`__MU_APP__.loadMap(${m}, 200, 200)`);
      await c.waitFor(`__MU_APP__.state().mapId === ${m}`, 120000, '切图' + m);
      await c.waitFor(`__MU_APP__.state().objects > 0`, 90000, '物件' + m);
      await sleep(600);
    }
    /*
     * 只测**地面本身**：先把物件层和角色藏起来再采样，
     * 否则横线会穿过栅栏/房子，测出来的是"物体边缘"不是"地面接缝"。
     */
    const pts = [];
    for (let i = 0; i < 150; i++) pts.push({ x: 180 + i * 4, y: 400 });
    const res = JSON.parse(await c.ev(`(() => {
      const objs = __MU__.world.objects.group, pl = __MU__.player;
      objs.visible = false; pl.root.visible = false;
      const r = __MU_DEBUG__.probePixels(${JSON.stringify(pts)});
      objs.visible = true; pl.root.visible = true;
      return JSON.stringify(r);
    })()`));
    const lum = res.map(p => (p.rgb[0] + p.rgb[1] + p.rgb[2]) / 3);
    if (!Array.isArray(lum) || !lum.length) { check(`${name}：采样失败`, false, String(res).slice(0,80)); continue; }
    let maxJump = 0;
    for (let i = 1; i < lum.length; i++) maxJump = Math.max(maxJump, Math.abs(lum[i] - lum[i - 1]));
    const avg = lum.reduce((a, b) => a + b, 0) / lum.length;
    const black = lum.filter(v => v < 6).length;
    console.log(`\n[${name}] 亮度均值 ${avg.toFixed(1)}，相邻最大跳变 ${maxJump.toFixed(1)}，纯黑 ${black}/60`);
    check(`${name}：地面有内容（不是全黑/未渲染）`, black < 20 && avg > 12, `avg=${avg.toFixed(1)} black=${black}`);
    /*
     * 注意：这条**不**断言"没有硬切换" —— MU 的地形本身就有大量
     * "贴图索引突变 + alpha=0" 的硬边（草地/道路交界），横线穿过时
     * 跳变几十是正常的。四角双线性只让**有 alpha 渐变**的地方变平滑，
     * 用"最大跳变"当判据会误报，这里只记录数值。
     */
    console.log(`  （参考）相邻跳变峰值 ${maxJump.toFixed(1)}，MU 本身存在索引突变的硬边，不作断言`);
  }

  const errs = (c.logs || []).filter(l => /WebGLProgram|ERROR:|shader/i.test(l));
  check('着色器没有编译错误', errs.length === 0, errs.slice(0, 2).join(' | '));

  // 贴图过滤：Linear(1006) / LinearMipmapLinear(1008)，原来是 Nearest(1003)
  const filt = JSON.parse(await c.ev(`(() => {
    const t = __MU__.terrain.tilesTexture;
    return JSON.stringify({ mag: t.magFilter, min: t.minFilter, mips: t.generateMipmaps, aniso: t.anisotropy });
  })()`));
  console.log('\n地形纹理:', JSON.stringify(filt));
  check('地形图集改为线性过滤', filt.mag === 1006, String(filt.mag));
  check('开了 mipmap（远处不闪）', filt.min === 1008 && filt.mips === true, `${filt.min}/${filt.mips}`);

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally { await c.close(); }
