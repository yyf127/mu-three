/**
 * 地面纹理结构校验：一张 tile 到底铺几格。
 *
 *   node tools/terrain-div-probe.mjs            # 洛兰
 *   node tools/terrain-div-probe.mjs 0 3 7      # 洛兰 / 诺利亚 / 亚特兰蒂斯
 *
 * 判据来自原版源码 FaceTexture（Terrain_RenderFace.cpp）：
 *
 *     Width = 64.0f / bmp->Width;      // 非水面（Scale=0）
 *     suf   = Width * xf;              // xf = 格子坐标（整数，1 格步进）
 *
 * 256px 的 tile → 每格 UV 前进 64/256 = 0.25 → **一张铺 4 格**
 * 128px 的 tile → 每格 UV 前进 64/128 = 0.5  → **一张铺 2 格**
 * 即「地面纹理只占索引纹理的 1/4」——两种尺寸的每格像素密度都是 64 texel，
 * 和 muonlinejs 的 `scale = size===256 ? size/4 : size` 完全一致。
 *
 * 探针输出：
 *   1. 每张 tile 的实际尺寸 / div / 每格 texel（应与上面的公式一致）；
 *   2. 同一机位下 div=4 与 div=1 的地面裁剪图（shots/terrain-div-*.png）；
 *   3. 两者的边缘密度（div=1 明显更高，说明重复周期真的变了）。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { createClient } from './lib/edge-client.mjs';

const maps = process.argv.slice(2).map(Number);
if (!maps.length) maps.push(0);

const c = await createClient('terraindiv');
await c.ev(`__MU_APP__.offline()`);
await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
await c.waitFor('!!window.__MU__ && !!window.__MU__.terrain', 60000, '地形');
await sleep(2500);

/** 只截 3D 画布，然后裁出中间那块地面 */
async function groundCrop(tag) {
  await sleep(600);
  const box = JSON.parse(
    await c.ev(`(() => {
      const cv = document.querySelector('#app canvas');
      const r = cv.getBoundingClientRect();
      return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height });
    })()`)
  );
  // 取画面中上部一块正方形地面区（避开底部 HUD 和角色）
  const w = Math.round(box.w * 0.34);
  const clip = {
    x: Math.round(box.x + box.w * 0.10),
    y: Math.round(box.y + box.h * 0.40),
    width: w,
    height: w,
    scale: 2,
  };
  const r = await c.send('Page.captureScreenshot', { format: 'png', clip });
  writeFileSync(`shots/terrain-div-${tag}.png`, Buffer.from(r.data, 'base64'));

  const dens = await c.ev(`(async () => {
    const im = new Image(); im.src = 'data:image/png;base64,' + ${JSON.stringify(r.data)};
    await im.decode();
    const cv = document.createElement('canvas');
    cv.width = im.width; cv.height = im.height;
    const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, im.width, im.height);
    let edge = 0, n = 0, sum = 0;
    for (let y = 1; y < d.height; y++) {
      for (let x = 1; x < d.width; x++) {
        const i = (y * d.width + x) * 4;
        const l = (d.data[i] + d.data[i+1] + d.data[i+2]) / 3;
        const li = i - 4;
        const l2 = (d.data[li] + d.data[li+1] + d.data[li+2]) / 3;
        sum += l; n++;
        if (Math.abs(l - l2) > 10) edge++;
      }
    }
    return JSON.stringify({ edge: +(edge / n * 100).toFixed(2), luma: +(sum / n).toFixed(1) });
  })()`);
  return JSON.parse(dens);
}

let bad = 0;
for (const mapId of maps) {
  if (mapId !== maps[0]) {
    await c.ev(`__MU_APP__.loadMap(${mapId}, 128, 128)`);
    await c.waitFor(`__MU_APP__.state().mapId === ${mapId}`, 90000, `切到地图 ${mapId}`);
    await c.waitFor('!!window.__MU__ && !!window.__MU__.terrain', 60000, '地形');
    await sleep(2000);
  }

  const info = JSON.parse(
    await c.ev(`(() => {
      const t = __MU__.terrain;
      const u = t.mesh.material.uniforms;
      return JSON.stringify({
        names: t.data.tileNames,
        sizes: t.tileSizes,
        uniformDiv: [...u.uTileDiv.value].slice(0, t.data.tileNames.length),
        count: u.uTileCount.value,
        mapId: __MU_APP__.state().mapId,
      });
    })()`)
  );

  const expect = info.sizes.map(s => Math.max(1, Math.round(s / 64)));
  const ok = JSON.stringify(expect) === JSON.stringify(info.uniformDiv);
  if (!ok) bad++;

  console.log(`\n── 地图 ${info.mapId} ── ${info.names.length} 个槽位`);
  for (let i = 0; i < info.names.length; i++) {
    console.log(
      `  [${String(i).padStart(2)}] ${String(info.names[i]).padEnd(14)} ` +
        `${String(info.sizes[i]).padStart(4)}px  div=${info.uniformDiv[i]}` +
        `  每格 ${(info.sizes[i] / info.uniformDiv[i]).toFixed(0)} texel`
    );
  }
  console.log(`  结构判定: ${ok ? '通过' : '不符 —— 期望 ' + expect.join(',')}`);

  const d4 = await groundCrop(`m${info.mapId}-div4`);
  await c.ev(`(() => {
    const u = __MU__.terrain.mesh.material.uniforms.uTileDiv.value;
    window.__savedDiv = [...u];
    for (let i = 0; i < u.length; i++) u[i] = 1;
    __MU__.renderer.render(__MU__.scene, __MU__.muCamera.camera);
    return true;
  })()`);
  const d1 = await groundCrop(`m${info.mapId}-div1`);
  await c.ev(`(() => {
    const u = __MU__.terrain.mesh.material.uniforms.uTileDiv.value;
    const s = window.__savedDiv;
    for (let i = 0; i < u.length; i++) u[i] = s[i];
    return true;
  })()`);

  console.log(`  地面边缘密度: div4 ${d4.edge}% / div1 ${d1.edge}%  → ${(d1.edge / d4.edge).toFixed(2)}×`);
}

console.log(`\n结论: ${bad ? `${bad} 张地图结构不符` : '全部地图的 div 都与源码公式一致'}`);
await c.close();
