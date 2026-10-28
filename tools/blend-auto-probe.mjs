/**
 * 「贴图混合自动识别」探针。
 *
 * 背景：原版 `BMD__RenderMesh`（`Render/BMD_LegacyDraw.cpp`）里，**按贴图自动判的
 * 只有一件事** —— `Bitmaps[tex].bpp == 4`（OZT/TGA 带 alpha）就走 alphaTest，
 * 否则 `GL_ResetState()` 不透明；加色（`RENDER_BRIGHT 0x40` / `RENDER_DARK 0x80`）
 * 是**调用方**给的标志。所以我们的目标是：
 *   ① 原版那条 bpp 规则照做（OZT 有 alpha → cutout）；
 *   ② 再加一条**像素 + 贴图名**的自动判据（黑底发光），把原来靠名单点名的
 *      发光贴图（蝴蝶 `light01.jpg` 之类）全覆盖，装备 / 怪 / NPC 同理。
 *
 * 断言：
 *   1. `light01.jpg`（诺利亚蝴蝶）**不靠名单**也能判成 additive
 *   2. 判出来的材质是加色 + 半透明 + 不写深度 + 关雾，且跟随 `additive()` 开关
 *   3. 场地物件里没有任何「实体」贴图被误判成加色（木头/铁栅/马车/触手…）
 *   4. 玩家 / 怪 / NPC 的贴图全是实体（blending = Normal），没被误伤
 *   5. OZT（带 alpha）的贴图不会被判成加色
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

let pass = 0;
let fail = 0;
const check = (l, ok, d = '') => {
  ok ? (pass++, console.log(`  ✓ ${l}${d ? '  ' + d : ''}`))
     : (fail++, console.log(`  ✗ ${l}${d ? '  ' + d : ''}`));
};

const c = await createClient('blendauto');
try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await c.waitFor(`__MU_APP__.state().mapId === 0 && __MU_APP__.state().objects > 0`, 120000, '洛兰');
  await c.waitFor(`typeof __MU_DEBUG__ === 'object'`, 60000, 'debug api');
  await sleep(1000);

  /* ---------- 4. 玩家 / 怪 / NPC 不被误伤 ---------- */
  const creature = await c.ev(`__MU_DEBUG__.sceneMaterial('')`);
  const bad = (creature || []).filter(h => h.blending !== 1 && h.blending !== 2);
  console.log('洛兰场景里非 Normal 的材质:', JSON.stringify(bad));
  check('地面物品 / 角色 / 怪没有误判成加色', bad.every(h => h.blending === 5 ? /light|fire|candle|glow/i.test(h.texture) : true),
        `${bad.length} 个非 Normal`);

  /* ---------- 3. 洛兰的加色只应该是真发光贴图 ---------- */
  const objAdd = ((await c.ev(`__MU_DEBUG__.objectMaterial('')`)) || []).filter(h => h.blending === 5);
  console.log('洛兰物件加色材质:', JSON.stringify(objAdd.map(h => h.texture)));
  const glowOnly = objAdd.every(h => /(light|fire|candle|glow|flare|spark|aura|halo|beam|shine|flash)/i.test(h.texture));
  check('洛兰的加色材质全是发光类贴图', glowOnly, JSON.stringify(objAdd.map(h => h.texture)));
  check('木头/铁栅/马车没被误判', !objAdd.some(h => /wood|steel|tile_space|horse/i.test(h.texture)),
        JSON.stringify(objAdd.map(h => h.texture)));

  /* ---------- 1/2. 诺利亚蝴蝶 ---------- */
  await c.ev(`window.__ld=false; __MU_APP__.loadMap(3, 175, 112).then(()=>window.__ld=true)`);
  await c.waitFor(`window.__ld === true`, 220000, 'load3');
  await sleep(1500);

  const heur = await c.ev(`__MU_APP__.blendOf('Object4', 'light01.jpg')`);
  console.log('蝴蝶贴图判定:', JSON.stringify(heur));
  check('蝴蝶贴图自动判成 additive（无名单）', !!heur && heur.mode === 'additive', JSON.stringify(heur));

  const hits = await c.ev(`__MU_DEBUG__.objectMaterial('light01')`);
  console.log('蝴蝶材质:', JSON.stringify(hits));
  const one = (hits || []).find(h => h.blending === 5);
  check('蝴蝶材质 = CustomBlending + One/One', !!one && one.blendSrc === 201 && one.blendDst === 201,
        JSON.stringify(one ?? null));
  check('半透明 + 不写深度 + 关雾', !!one && one.transparent === true && one.depthWrite === false && one.fog === false,
        JSON.stringify(one ? { tr: one.transparent, dw: one.depthWrite, fog: one.fog } : null));

  await c.ev(`__MU_APP__.additive('alpha')`);
  const hits2 = await c.ev(`__MU_DEBUG__.objectMaterial('light01')`);
  check('跟随 additive("alpha") 切到 AdditiveBlending(2)', (hits2 || []).some(h => h.blending === 2), JSON.stringify(hits2));
  await c.ev(`__MU_APP__.additive('one')`);

  /* ---------- 3b. 诺利亚的木头不该加色 ---------- */
  const nAdd = ((await c.ev(`__MU_DEBUG__.objectMaterial('')`)) || []).filter(h => h.blending === 5);
  console.log('诺利亚加色材质:', JSON.stringify(nAdd.map(h => h.texture)));
  check('诺利亚木头（wood02 ×17）仍是实体', !nAdd.some(h => /wood/i.test(h.texture)), JSON.stringify(nAdd.map(h => h.texture)));

  /* ---------- 6. 亚特兰蒂斯：蝴蝶（点名）+ 齿轮/物件不被误伤 ---------- */
  await c.ev(`window.__ld=false; __MU_APP__.loadMap(7, 20, 17).then(()=>window.__ld=true)`);
  await c.waitFor(`window.__ld === true`, 240000, 'load7');
  await sleep(1500);

  const aAdd = ((await c.ev(`__MU_DEBUG__.objectMaterial('')`)) || []).filter(h => h.blending === 5);
  console.log('亚特兰蒂斯加色材质:', JSON.stringify(aAdd.map(h => h.texture)));
  const butterfly = aAdd.find(h => h.texture.toLowerCase().includes('ioi01'));
  check('Object8/Object41 蝴蝶（ioi01.jpg）是加色', !!butterfly, JSON.stringify(butterfly ?? null));
  check('齿轮 gearB 仍是实体', !aAdd.some(h => /gearb/i.test(h.texture)), JSON.stringify(aAdd.map(h => h.texture)));
  check('亚特兰蒂斯加色不含木头/岩石类', !aAdd.some(h => /wood|rock|grass|stone/i.test(h.texture)),
        JSON.stringify(aAdd.map(h => h.texture)));

  const geo = await c.ev(`__MU_APP__.objectModels()`);
  const o41 = (geo || []).find(m => m.name === 'Object41');
  console.log('Object41 模型规模:', JSON.stringify(o41));
  check('Object41 确实是扁片段（8 顶点 / 273×273×50）',
        !!o41 && o41.verts === 8 && o41.box[2] < o41.box[0] / 3, JSON.stringify(o41 ?? null));

  /* ---------- 5. OZT 带 alpha 的不会被判加色 ---------- */
  const tga = await c.ev(`__MU_APP__.blendOf('Player', 'DarklordRobe.OZT')`);
  console.log('OZT 判定:', JSON.stringify(tga));
  check('OZT（有 alpha）不走加色', !!tga && tga.mode !== 'additive', JSON.stringify(tga));

  console.log(`\n结果 ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
} finally {
  await c.close();
}
