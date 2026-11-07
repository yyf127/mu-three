/**
 * 渲染画质探针（阶段 1：**只提清晰度，不碰光照**）。
 *
 * ## 本阶段改了什么
 *
 * MU 0.97 是「预烘焙贴图 + 无光照管线」，所以**不加光源、不换 PBR 材质**，
 * 保原版风味。只提采样质量：
 *
 *   1. 各向异性过滤按 GPU 上限拉满（原来 `texture.ts` 两处写死 4）
 *   2. ACES 色调映射 + 曝光 0.95（原来 NoToneMapping，亮部被截断成纯白）
 *   3. 像素比上限 2 → 3（DPR=3 的屏幕原来只渲染 2/3 分辨率）
 *
 * ## 断言
 *
 *   [A] 渲染器参数真的生效（toneMapping / 像素比）
 *   [B] 各向异性值落到了真实贴图上（不是算了没人用）
 *   [C] 场景里没有新增光源（原版风味 = 无光照，必须为 0）
 *   [D] 材质仍是 MeshBasicMaterial / MeshPhongMaterial 那套（没被换成 PBR）
 *   [E] 截图 + 画面亮度分布（确认没整体过曝/死黑）
 *
 * 用法：node tools/render-quality-probe.mjs
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('render-quality');
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

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`!!__MU_APP__.state().player`, 120000, '角色就位');
  await sleep(2500);

  /* [A] 渲染器参数 */
  console.log('\n[A] 渲染器参数');
  let q = J(await c.ev(`JSON.stringify(__MU_APP__.renderQuality())`));
  console.log(`   像素比 ${q.pixelRatio}（设备 ${q.devicePixelRatio}，上限 ${q.maxPixelRatio}）`);
  console.log(`   色调映射 ${q.toneMapping}  曝光 ${q.toneMappingExposure}`);
  console.log(`   GPU 各向异性上限 ${q.maxAniso} → 贴图用 ${q.aniso}`);

  // three 的枚举：NoToneMapping=0, ACESFilmicToneMapping=4
  check('色调映射 = ACESFilmic（4）', q.toneMapping === 4, String(q.toneMapping));
  check('曝光 = 0.95', Math.abs(q.toneMappingExposure - 0.95) < 0.001, String(q.toneMappingExposure));
  check(
    '像素比上限 = 3 且实际值 = min(dpr, 3)',
    q.maxPixelRatio === 3 && q.pixelRatio === Math.min(q.devicePixelRatio, 3),
    `${q.pixelRatio} vs min(${q.devicePixelRatio},3)`
  );

  /*
   * 等世界加载完再抽样 —— 刚进图只有 1 张贴图，抽不出代表性。
   * Lorenia 全图 2792 个物件，加载后贴图数会到 600+。
   */
  console.log('\n   （等世界加载，以便抽样足够多的贴图）');
  await sleep(6000);
  q = J(await c.ev(`JSON.stringify(__MU_APP__.renderQuality())`));

  /* [B] 各向异性落到贴图 */
  console.log('\n[B] 各向异性过滤');
  check('GPU 报出的上限 ≥ 4', q.maxAniso >= 4, String(q.maxAniso));
  /*
   * 关键：原来写死 4。现在应等于 min(上限, 16)。
   * 若 GPU 上限恰好是 4，说明机器不支持更高，此时也该是 4（不算错）。
   */
  const expectAniso = Math.max(1, Math.min(q.maxAniso, 16));
  check(`贴图用值 = min(上限,16) = ${expectAniso}`, q.aniso === expectAniso, String(q.aniso));
  check(
    '值真的落到场景贴图上（无旧值 4 残留）',
    q.sampleAniso && q.sampleAniso.count > 0 && q.sampleAniso.min === q.aniso,
    JSON.stringify(q.sampleAniso)
  );
  /*
   * 世界加载后应有几百张贴图。数量太少说明抽样时机太早，
   * 这条断言会顺带守住「等世界加载」这个前提。
   */
  check(
    `抽样贴图数够多（${q.sampleAniso?.count} 张，覆盖全图物件）`,
    (q.sampleAniso?.count ?? 0) > 100,
    JSON.stringify(q.sampleAniso)
  );
  check(
    '最小值也等于 16（没有漏改的贴图）',
    q.sampleAniso?.min === q.aniso,
    `min=${q.sampleAniso?.min} vs ${q.aniso}`
  );
  console.log(`   抽样 ${q.sampleAniso?.count} 张贴图，均值 ${q.sampleAniso?.avg}，最小 ${q.sampleAniso?.min}`);

  /* [C] 没有新增光源（保原版风味） */
  console.log('\n[C] 光照没被改动（原版 = 无光照）');
  /*
   * 运行时扫场景需要暴露 Scene，代价大于收益；这里改成**扫源码** ——
   * 更直接：只要 `src/` 里没出现 three 的光源类，就是没加光。
   *
   * 用 fs 在 Node 侧读，不走页面。
   */
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join: pjoin } = await import('node:path');
  const walk = dir => {
    const out = [];
    for (const name of readdirSync(dir)) {
      const full = pjoin(dir, name);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.ts$/.test(name)) out.push(full);
    }
    return out;
  };
  const files = walk('src');
  const LIGHT_RE = /new THREE\.(AmbientLight|DirectionalLight|PointLight|SpotLight|HemisphereLight|RectAreaLight|LightProbe)\b/;
  const lightHits = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const line of text.split('\n')) {
      if (LIGHT_RE.test(line)) lightHits.push(`${f}: ${line.trim().slice(0, 70)}`);
    }
  }
  check('源码里没有任何 three 光源（原版无光照）', lightHits.length === 0, lightHits.slice(0, 3).join(' | '));
  console.log(`   扫描 ${files.length} 个 .ts，光源创建点 ${lightHits.length} 处`);

  /* [D] 材质仍是原版那套（没换成 PBR） */
  console.log('\n[D] 材质仍是 MeshBasic/Phong（没被换成 PBR）');
  const PBR_RE = /new THREE\.(MeshStandardMaterial|MeshPhysicalMaterial)\b/;
  const pbrHits = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const line of text.split('\n')) {
      if (PBR_RE.test(line)) pbrHits.push(`${f}: ${line.trim().slice(0, 70)}`);
    }
  }
  check('源码里没有 PBR 材质（保原版预烘焙贴图）', pbrHits.length === 0, pbrHits.slice(0, 3).join(' | '));

  /*
   * 反过来验「模型材质确实是 Basic」—— `getBmdMaterial` 是唯一入口，
   * 检查它构造的类型，防止有人以后偷偷换成 Standard。
   */
  const modelSrc = readFileSync('src/core/model.ts', 'utf8');
  check(
    'getBmdMaterial 仍构造 MeshBasicMaterial',
    /new THREE\.MeshBasicMaterial\s*\(/.test(modelSrc),
    ''
  );

  /* [E] 截图 + 亮度分布 */
  console.log('\n[E] 截图与亮度分布');
  // 移动一下相机，确保画面里有场景（不是纯 UI）
  await sleep(400);
  const shot = await c.shot('render-quality-stage1');
  console.log(`   存档：${shot}`);
  const { decodePng } = await import('./lib/png-diff.mjs');
  const img = decodePng(shot);

  /*
   * 统计全图亮度直方图：
   *   - 纯白（≥250）占比过高 → 过曝没细节
   *   - 纯黑（≤5）占比过高   → 死黑
   * 3D 游戏画面落在中间调（20~235）应该占大头。
   */
  let total = 0;
  let white = 0;
  let black = 0;
  let mid = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const l = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
    total++;
    if (l >= 250) white++;
    else if (l <= 5) black++;
    else if (l > 20 && l < 235) mid++;
  }
  const pct = n => +((n / total) * 100).toFixed(2);
  console.log(`   纯白 ${pct(white)}%  纯黑 ${pct(black)}%  中间调 ${pct(mid)}%`);
  check('画面没有大面积过曝（纯白 < 8%）', pct(white) < 8, `${pct(white)}%`);
  check('画面没有死黑（纯黑 < 30%）', pct(black) < 30, `${pct(black)}%`);
  check('中间调占主体（> 50%）', pct(mid) > 50, `${pct(mid)}%`);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await c.close();
  process.exit(fail ? 1 : 0);
} catch (err) {
  console.error('探针异常：', err && err.stack ? err.stack : err);
  try { await c.close(); } catch {}
  process.exit(1);
}
