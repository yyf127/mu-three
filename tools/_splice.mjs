import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const p = 'src/world/actor.ts';
let s = readFileSync(p, 'utf8');
const start = s.indexOf('const DEFAULT_EQUIPMENT = [');
const marker = '* 按服务端下发的 Class 建怪物 / NPC。';
const mi = s.indexOf(marker);
if (start < 0 || mi < 0) {
  console.error('miss', start, mi);
  process.exit(1);
}
const end = s.lastIndexOf('/**', mi);

let repl = readFileSync('src/world/_equip_block.ts.txt', 'utf8');
if (s.includes('\r\n')) repl = repl.replace(/\r?\n/g, '\r\n');

s = s.slice(0, start) + repl + s.slice(end);
writeFileSync(p, s);
unlinkSync('src/world/_equip_block.ts.txt');
console.log('ok', s.length);
