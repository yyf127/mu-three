import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { makeProfile } from './lib/profile.mjs';
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT=9334;
const profile = makeProfile('edge-diff');
const edge = spawn(EDGE,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'--window-size=1600,900','--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-first-run','about:blank'],{stdio:'ignore'});
let ws, id=0; const pend=new Map(); const logs=[];
const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
try{
  let t=null;
  for(let i=0;i<80;i++){ try{ const r=await fetch(`http://127.0.0.1:${PORT}/json/list`); t=await r.json(); if(t.length)break;}catch{} await sleep(300);}
  const page=t.find(x=>x.type==='page');
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.addEventListener('open',r);ws.addEventListener('error',j);});
  ws.addEventListener('message',ev=>{const d=JSON.parse(ev.data);
    if(d.id&&pend.has(d.id)){const{res,rej}=pend.get(d.id);pend.delete(d.id);d.error?rej(new Error(JSON.stringify(d.error))):res(d.result);return;}
    if(d.method==='Runtime.consoleAPICalled'){logs.push('['+d.params.type+'] '+(d.params.args||[]).map(a=>a.value??a.description??'').join(' '));}
    if(d.method==='Runtime.exceptionThrown'){logs.push('[exc] '+(d.params.exceptionDetails.exception?.description||''));}
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:5180/'});
  await sleep(26000);
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r.exceptionDetails?{error:r.exceptionDetails.exception?.description}:r.result.value;};
  const out = await ev(`(() => {
    const d = window.__MU_DEBUG__, mu = window.__MU__, p = mu.player, W = innerWidth, H = innerHeight;
    const feet = d.project(p.x, p.y, p.z);
    // 以脚底投影为中心取一个竖条区域
    const pts = [];
    for (let dy = 0; dy <= 130; dy += 10) pts.push({ x: Math.round(feet.x), y: Math.round(feet.y - dy) });
    const on = d.probePixels(pts);
    mu.player.meshes.forEach(m => (m.visible = false));
    const off = d.probePixels(pts);
    mu.player.meshes.forEach(m => (m.visible = true));
    const diffs = on.map((s,i)=>({ y: s.y, on: s.rgb, off: off[i].rgb,
      d: Math.abs(s.rgb[0]-off[i].rgb[0])+Math.abs(s.rgb[1]-off[i].rgb[1])+Math.abs(s.rgb[2]-off[i].rgb[2]) }));
    return { feet, diffs, visibleTris: mu.player.meshes.map(m=>m.geometry.index.count/3) };
  })()`);
  console.log(JSON.stringify(out,null,1));
  console.log('--- console tail ---'); console.log(logs.slice(-12).join('\n'));
}catch(e){console.error('ERR',e.message);}finally{try{ws?.close()}catch{};edge.kill();await sleep(200);process.exit(0);}
