import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { makeProfile } from './lib/profile.mjs';
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT=Number(process.env.CDP_PORT || (9500+Math.floor(Math.random()*300)));
const profile = makeProfile('edge-s');
mkdirSync(profile, { recursive: true });
const edge=spawn(EDGE,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--window-size=1600,900','--enable-unsafe-swiftshader','--use-angle=swiftshader','--disable-gpu-sandbox','--no-first-run','--hide-scrollbars','about:blank'],{stdio:'ignore'});
let ws,id=0;const pend=new Map();
const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r.exceptionDetails?{error:r.exceptionDetails.exception?.description}:r.result.value;};
try{
  let t=null;for(let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);t=await r.json();if(t.length)break;}catch{}await sleep(300);}
  ws=new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.addEventListener('open',r);ws.addEventListener('error',j);});
  ws.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.id&&pend.has(d.id)){const{res,rej}=pend.get(d.id);pend.delete(d.id);d.error?rej(new Error(JSON.stringify(d.error))):res(d.result);}});
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:5180/'});
  console.log('page loaded, waiting...'); await sleep(30000); console.log('ready');

  console.log(JSON.stringify(await ev(`(() => {
    const m = window.__MU__, d = window.__MU_DEBUG__;
    return {
      monsters: m.monsters.map(x => ({ name: x.name, meshes: x.meshes.length,
        tris: x.meshes.reduce((s, mm) => s + (mm.geometry.index?.count ?? 0) / 3, 0),
        pos: [x.x, x.y, +x.z.toFixed(2)], screen: d.project(x.x, x.y, x.z + 1) })),
      playerScreen: d.project(m.player.x, m.player.y, m.player.z + 1),
    };
  })()`)));

  const shots = [
    { name: 'shots/spawn.png', js: `(() => {})()` },
    { name: 'shots/wide.png', js: `(() => { const m=window.__MU__; m.muCamera.distance = 24; m.muCamera.pitch = 0.62; })()` },
    { name: 'shots/front.png', js: `(() => { const m=window.__MU__; m.player.yaw = -Math.PI*0.75; m.muCamera.distance = 7.5; m.muCamera.pitch = 0.5; })()` },
  ];
  for (const s of shots) {
    await ev(s.js);
    await sleep(2500);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(s.name, Buffer.from(shot.data, 'base64'));
    console.log('saved', s.name);
  }
}catch(e){console.error('ERR',e.message);}finally{try{ws?.close()}catch{};edge.kill();await sleep(200);process.exit(0);}
