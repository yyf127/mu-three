import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { makeProfile } from './lib/profile.mjs';
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT=Number(process.env.CDP_PORT||(9400+Math.floor(Math.random()*200)));
const edge=spawn(EDGE,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${makeProfile('sk')}`,'--window-size=1600,900','--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-first-run','about:blank'],{stdio:'ignore'});
let ws,id=0;const pend=new Map();
const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r.exceptionDetails?{error:r.exceptionDetails.exception?.description}:r.result.value;};
try{
  let t=null;for(let i=0;i<40;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);t=await r.json();if(t&&t.length)break;}catch{}await sleep(300);}
  const page=t.find(x=>x.type==='page');
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.addEventListener('open',r);ws.addEventListener('error',j);});
  ws.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.id&&pend.has(d.id)){const{res,rej}=pend.get(d.id);pend.delete(d.id);d.error?rej(new Error(JSON.stringify(d.error))):res(d.result);}});
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:5180/'});
  await sleep(30000);
  const out = await ev(`(() => {
    const m=window.__MU__, d=window.__MU_DEBUG__;
    m.muCamera.pitch=0.72; m.muCamera.distance=10; m.player.yaw=Math.PI/4;
    m.muCamera.update(1/60);
    const W=innerWidth,H=innerHeight;
    const pts=[]; for (let y=4;y<H;y+=24) pts.push({x:Math.round(W*0.5), y});
    const s=d.probePixels(pts);
    return { size:[W,H], column: s.map(p=>({y:p.y, rgb:p.rgb})) };
  })()`);
  console.log(JSON.stringify(out));
  const shot=await send('Page.captureScreenshot',{format:'png'});
  writeFileSync('shots/column.png',Buffer.from(shot.data,'base64'));
}catch(e){console.error('ERR',e.message);}finally{try{ws?.close()}catch{};try{edge.kill()}catch{};process.exit(0);}
