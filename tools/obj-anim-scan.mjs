/**
 * 洛兰物件的动画潜力扫描：哪些 Object*.bmd 带动作、每个 id 放了多少个。
 *
 *   node tools/obj-anim-scan.mjs
 *
 * 页面内动态 import 项目自己的 bmd 解析器（Vite 会转译 TS），避免在 node 侧
 * 再写一份 BMD 解析。输出按「有动画 + 实例数」排序，决定哪些物件要改成
 * SkinnedMesh 单独播动画。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('objanim');

const SCAN = `(async () => {
  const objMod = await import('/src/world/objects.ts');
  const mapsMod = await import('/src/world/maps.ts');
  const bmdMod = await import('/src/core/bmd.ts');
  const texMod = await import('/src/core/texture.ts');
  const terrMod = await import('/src/world/terrain.ts');

  const mapId = 0;
  const dir = mapsMod.mapObjectDir(mapId);
  const worldDir = mapsMod.mapWorldDir(mapId);
  const folder = mapsMod.getMapDefinition(mapId).folder;

  // 实例数：直接读 EncTerrain0.obj
  const objBuf = await texMod.fetchBytes(worldDir + 'EncTerrain' + folder + '.obj');
  const records = terrMod.parseTerrainObjects(objBuf);
  const counts = {};
  for (const r of records) counts[r.id] = (counts[r.id] || 0) + 1;

  const out = [];
  for (let id = 0; id < 160; id++) {
    const name = objMod.objectModelName(mapId, id);
    if (!name) continue;
    let bytes = null;
    for (const ext of ['.bmd', '.BMD']) {
      try { bytes = await texMod.fetchBytes(dir + name + ext); break; } catch {}
    }
    if (!bytes) { out.push({ id, name, n: counts[id] || 0, missing: true }); continue; }
    let bmd;
    try { bmd = bmdMod.parseBmd(bytes); } catch (e) {
      out.push({ id, name, n: counts[id] || 0, bad: String(e).slice(0, 40) });
      continue;
    }
    const keys = bmd.actions.map(a => a.numKeys);
    const maxKeys = keys.length ? Math.max(...keys) : 0;
    out.push({
      id, name, n: counts[id] || 0,
      idHex: '0x' + id.toString(16),
      meshes: bmd.meshes.length,
      bones: bmd.bones.length,
      actions: keys.length,
      maxKeys,
      anim: maxKeys > 1,
    });
  }
  return JSON.stringify(out);
})()`;

try {
  await c.ev(`__MU_APP__.offline()`);
  await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
  await sleep(1000);

  const rows = JSON.parse(await c.ev(SCAN));
  const anim = rows.filter(r => r.anim).sort((a, b) => (b.n * b.maxKeys) - (a.n * a.maxKeys));
  console.log('=== 有动作的物件 ===');
  for (const r of anim) {
    console.log(
      `${String(r.id).padStart(3)} ${r.idHex.padEnd(6)} ${r.name.padEnd(16)}` +
      ` 实例 ${String(r.n).padStart(3)}  mesh ${r.meshes}  bone ${r.bones}` +
      `  actions ${r.actions}  keys ${r.maxKeys}  → 工作单元 ${r.n * r.maxKeys}`
    );
  }
  const stat = rows.filter(r => !r.anim && !r.missing && !r.bad);
  console.log('\\n=== 静态物件 ===');
  console.log(stat.map(r => `${r.id}:${r.name}(x${r.n})`).join(', '));
  console.log('\\n缺失/异常:', rows.filter(r => r.missing || r.bad).map(r => `${r.id}:${r.name}${r.missing ? '(缺)' : '(' + r.bad + ')'}`).join(', '));
  console.log('\\n总实例', rows.reduce((s, r) => s + (r.n || 0), 0),
              '/ 有动画实例', anim.reduce((s, r) => s + r.n, 0));
} finally {
  await c.close();
}
