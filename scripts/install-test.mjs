const target = await (await fetch('http://127.0.0.1:9224/json/new?http://127.0.0.1:8797/login', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (event) => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description); };
const send = (method, params={}) => new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const ev = async (expression) => { const r = await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}); if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };
try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:8797/login'}); await sleep(700);
  await ev(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'demo@orbitwork.local',password:'Demo!2026'})}).then(r=>r.status)`);
  await send('Page.navigate',{url:'http://127.0.0.1:8797/app/market'}); await sleep(1200);
  const before = await ev(`document.querySelectorAll('.asset-card').length`);
  const clicked = await ev(`(()=>{const b=[...document.querySelectorAll('.asset-card button')].find(b=>b.textContent.includes('安装')); if(!b)return false; b.click(); return true})()`);
  await sleep(1200);
  const toast = await ev(`document.querySelector('.toast')?.innerText ?? ''`);
  await send('Page.navigate',{url:'http://127.0.0.1:8797/app/experts'}); await sleep(1000);
  const experts = await ev(`document.querySelectorAll('.asset-card').length`);
  console.log(JSON.stringify({before,clicked,toast,experts,errors},null,2));
} catch(e){ console.error('FAIL',e.message); process.exitCode=1; }
finally { ws.close(); await fetch('http://127.0.0.1:9224/json/close/'+target.id).catch(()=>{}); }
