import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { makeProfile } from './lib/profile.mjs';
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT=9336;
const edge=spawn(EDGE,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${makeProfile('edge-b')}`,'--window-size=800,600','--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-first-run','about:blank'],{stdio:'ignore'});
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
    const mesh0 = () => window.__MU__.player.rig.bones[0].position.constructor;
    const THREE = window.__MU__.THREE || null;
    const mu = window.__MU__, p = mu.player;
    // 每个网格的蒙皮包围盒（用骨骼矩阵变换）
    const res = [];
    const bones = p.rig.bones;
    for (const mesh of p.meshes) {
      const pos = mesh.geometry.getAttribute('position');
      const si = mesh.geometry.getAttribute('skinIndex');
      let mnx=1e9,mny=1e9,mnz=1e9,mxx=-1e9,mxy=-1e9,mxz=-1e9;
      const m = new (mesh.matrixWorld.constructor)();
      for (let i=0;i<pos.count;i++){
        const b = bones[si.getX(i)]; if(!b) continue;
        m.copy(b.matrixWorld);
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const e = m.elements;
        const wx = e[0]*x+e[4]*y+e[8]*z+e[12];
        const wy = e[1]*x+e[5]*y+e[9]*z+e[13];
        const wz = e[2]*x+e[6]*y+e[10]*z+e[14];
        mnx=Math.min(mnx,wx);mny=Math.min(mny,wy);mnz=Math.min(mnz,wz);
        mxx=Math.max(mxx,wx);mxy=Math.max(mxy,wy);mxz=Math.max(mxz,wz);
      }
      res.push({ name: mesh.name, min:[+ (mnx-p.x).toFixed(3), +(mny-p.y).toFixed(3), +mnz.toFixed(3)],
                 max:[+ (mxx-p.x).toFixed(3), +(mxy-p.y).toFixed(3), +mxz.toFixed(3)] });
    }
    const boneInfo = [];
    for (const b of bones) {
      if (!/Bip01$|Pelvis|L Foot$|R Foot$|Head$|Spine/.test(b.name)) continue;
      const v = b.getWorldPosition(new (mesh0())());
      boneInfo.push({ name: b.name, z: +(v.z - p.z).toFixed(3), x: +(v.x - p.x).toFixed(3), y: +(v.y - p.y).toFixed(3) });
    }
    return { yaw: +p.yaw.toFixed(2), meshes: res, bones: boneInfo, playerZ: p.z };
  })()`);
  console.log(JSON.stringify(out,null,1));
}catch(e){console.error('ERR',e.message);}finally{try{ws?.close()}catch{};edge.kill();await sleep(200);process.exit(0);}
