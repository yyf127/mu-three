import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { makeProfile } from './lib/profile.mjs';
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT=9335;
const edge = spawn(EDGE,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${makeProfile('edge-beh')}`,'--window-size=1280,800','--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-first-run','about:blank'],{stdio:'ignore'});
let ws,id=0;const pend=new Map();const logs=[];
const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r.exceptionDetails?{error:r.exceptionDetails.exception?.description}:r.result.value;};
try{
  let t=null;
  for(let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);t=await r.json();if(t.length)break;}catch{}await sleep(300);}
  ws=new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.addEventListener('open',r);ws.addEventListener('error',j);});
  ws.addEventListener('message',e=>{const d=JSON.parse(e.data);
    if(d.id&&pend.has(d.id)){const{res,rej}=pend.get(d.id);pend.delete(d.id);d.error?rej(new Error(JSON.stringify(d.error))):res(d.result);return;}
    if(d.method==='Runtime.consoleAPICalled')logs.push('['+d.params.type+'] '+(d.params.args||[]).map(a=>a.value??a.description??'').join(' '));
    if(d.method==='Runtime.exceptionThrown')logs.push('[exc] '+(d.params.exceptionDetails.exception?.description||''));
  });
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:5180/'});
  await sleep(24000);

  const S = `(() => { const m=window.__MU__,p=m.player;
    return { x:+p.x.toFixed(2), y:+p.y.toFixed(2), z:+p.z.toFixed(3), action:p.action, frame:+p.frame.toFixed(2),
             bone3:[...p.rig.bones[3].position.toArray().map(n=>+n.toFixed(3))],
             tH:+m.terrain.getHeight(p.x,p.y).toFixed(3), yaw:+p.yaw.toFixed(2) }; })()`;

  console.log('初始:', JSON.stringify(await ev(S)));

  const key = async (type, code, keyCode, keyStr) =>
    send('Input.dispatchKeyEvent', { type, code, key: keyStr, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });

  // 走 1.2 秒
  await key('keyDown','KeyW',87,'w');
  await sleep(1200);
  console.log('走路中:', JSON.stringify(await ev(S)));
  await key('keyUp','KeyW',87,'w');
  await sleep(400);
  console.log('停下:', JSON.stringify(await ev(S)));

  // 空格攻击
  await send('Input.dispatchKeyEvent',{type:'keyDown',code:'Space',key:' ',windowsVirtualKeyCode:32,nativeVirtualKeyCode:32});
  await sleep(250);
  console.log('攻击:', JSON.stringify(await ev(S)));
  await send('Input.dispatchKeyEvent',{type:'keyUp',code:'Space',key:' ',windowsVirtualKeyCode:32,nativeVirtualKeyCode:32});
  await sleep(700);
  console.log('攻击后:', JSON.stringify(await ev(S)));

  // 点击移动
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:400,y:300,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:400,y:300,button:'left',clickCount:1});
  await sleep(1500);
  console.log('点击移动后:', JSON.stringify(await ev(S)));

  const shot=await send('Page.captureScreenshot',{format:'png'});
  (await import('node:fs')).writeFileSync('behavior.png',Buffer.from(shot.data,'base64'));
  console.log('--- console tail ---');
  console.log(logs.slice(-8).join('\n'));
}catch(e){console.error('ERR',e.message);}finally{try{ws?.close()}catch{};edge.kill();await sleep(200);process.exit(0);}
