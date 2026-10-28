/**
 * 扫描「带屋顶的物件」：每个 mesh 在世界空间（Z 向上、已乘 MODEL_SCALE）的包围盒。
 * 用来决定「哪几个 mesh 算屋顶」以及「屋檐高度」（eaves）。
 *
 *   node tools/roof-scan.mjs
 */
import { createClient } from './lib/edge-client.mjs';

const c = await createClient('roofscan');

const SCAN = `(async () => {
  const objMod = await import('/src/world/objects.ts');
  const mapsMod = await import('/src/world/maps.ts');
  const bmdMod = await import('/src/core/bmd.ts');
  const modelMod = await import('/src/core/model.ts');
  const texMod = await import('/src/core/texture.ts');
  const terrMod = await import('/src/world/terrain.ts');

  const mapId = 0;
  const dir = mapsMod.mapObjectDir(mapId);
  const worldDir = mapsMod.mapWorldDir(mapId);
  const folder = mapsMod.getMapDefinition(mapId).folder;

  const objBuf = await texMod.fetchBytes(worldDir + 'EncTerrain' + folder + '.obj');
  const records = terrMod.parseTerrainObjects(objBuf);
  const counts = {};
  for (const r of records) counts[r.id] = (counts[r.id] || 0) + 1;

  const out = {};
  for (const id of [121, 122, 123, 124, 125, 126, 128]) {
    const name = objMod.objectModelName(mapId, id);
    if (!name) continue;
    let bytes = null;
    for (const ext of ['.bmd', '.BMD']) {
      try { bytes = await texMod.fetchBytes(dir + name + ext); break; } catch {}
    }
    if (!bytes) { out[id] = { name, error: 'no file' }; continue; }
    const bmd = bmdMod.parseBmd(bytes);
    const rig = modelMod.createRig(bmd, modelMod.MODEL_SCALE);
    const mats = modelMod.getBoneMatrices(rig);
    const meshes = [];
    for (let i = 0; i < bmd.meshes.length; i++) {
      const one = { ...bmd, meshes: [bmd.meshes[i]] };
      const s = modelMod.createStaticMeshes(one, mats, null, false);
      const g = s.geometries[0];
      g.computeBoundingBox();
      const b = g.boundingBox;
      meshes.push({
        i,
        tex: bmd.meshes[i].texturePath,
        tris: (g.index ? g.index.count : (g.getAttribute('position').count)) / 3,
        z: [ +b.min.z.toFixed(2), +b.max.z.toFixed(2) ],
        x: [ +b.min.x.toFixed(2), +b.max.x.toFixed(2) ],
        y: [ +b.min.y.toFixed(2), +b.max.y.toFixed(2) ],
      });
      g.dispose();
    }
    out[id] = { name, count: counts[id] || 0, meshes };
  }
  return JSON.stringify(out);
})()`;

const raw = await c.ev(SCAN);
const data = JSON.parse(raw);
for (const [id, v] of Object.entries(data)) {
  if (v.error) { console.log(id, v.name, v.error); continue; }
  console.log(`\n#${id} ${v.name} 实例 ${v.count} 个，${v.meshes.length} mesh`);
  for (const m of v.meshes) {
    console.log(`  m${m.i} z=[${m.z}] x=[${m.x}] y=[${m.y}] tris=${m.tris} ${m.tex}`);
  }
}
await c.close();
