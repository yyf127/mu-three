import { readFileSync } from 'node:fs';
import { parseBmd } from '../src/core/bmd';

const ROOT = 'D:/Project/H5_mu/muonlinejs-master/public/Data/';
const rels = process.argv.slice(2);
for (const rel of rels) {
  try {
    const b = parseBmd(new Uint8Array(readFileSync(ROOT + rel)));
    console.log(`== ${rel}  bones=${b.bones.length} meshes=${b.meshes.length} actions=${b.actions.length}`);
    if (b.bones.length < 80) {
      b.bones.forEach((bone: any, i: number) => {
        console.log(`   ${String(i).padStart(3)} ${bone.name} parent=${bone.parent}`);
      });
    } else {
      for (const i of [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50]) {
        const bone: any = b.bones[i];
        console.log(`   ${i} ${bone?.name} parent=${bone?.parent}`);
      }
    }
    console.log('   actions:', b.actions.map((a: any, i: number) => `${i}:${a.numKeys}`).join(' '));
  } catch (e) {
    console.log(`== ${rel} FAIL ${(e as Error).message}`);
  }
}
