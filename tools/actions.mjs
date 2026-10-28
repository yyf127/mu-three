import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { makeProfile } from './lib/profile.mjs';
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT=9337;
const edge=spawn(EDGE,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${makeProfile('edge-a')}`,'--window-size=600,400','--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-first-run','about:blank'],{stdio:'ignore'});
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
  await sleep(22000);
  const out = await ev(`(() => {
    const d = window.__MU_DEBUG__;
    const out = {};
    for (const a of [1,15,25,37]) {
      const s = d.sampleAction(a);
      if (!s) continue;
      const feet = s.frames.map(f=>f.feet), hands=s.frames.map(f=>f.hands);
      const range = arr => +(Math.max(...arr)-Math.min(...arr)).toFixed(3);
      const ry = s.frames.map(f => f.root[1]);
      const rx = s.frames.map(f => f.root[0]);
      out[a] = { keys: s.keys, feetRange: range(feet),
                 rootXRange: range(rx), rootYRange: range(ry),
                 rootY: ry.map(v => +v.toFixed(2)) };
    }
    return out;
  })()`);
  console.log(JSON.stringify(out,null,1));
}catch(e){console.error('ERR',e.message);}finally{try{ws?.close()}catch{};edge.kill();await sleep(200);process.exit(0);}
