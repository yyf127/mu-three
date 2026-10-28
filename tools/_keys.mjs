import { createClient } from './lib/edge-client.mjs';
const c = await createClient('keys');
await c.ev(`__MU_APP__.offline()`);
await c.waitFor(`__MU_APP__.state().screen === 'game'`, 90000, '进图');
await c.waitFor(`!!window.__MU__`, 60000, '__MU__');
console.log(await c.ev(`JSON.stringify(Object.keys(window.__MU__ || {}))`));
console.log(await c.ev(`JSON.stringify(Object.keys(window.__MU__.three || {}))`));
process.exit(0);
