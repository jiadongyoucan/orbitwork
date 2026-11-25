import { writeFileSync } from 'node:fs';
const target = await (await fetch('http://127.0.0.1:9224/json/new?http://127.0.0.1:8797/login', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (event) => { const msg = JSON.parse(event.data); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails?.exception?.description); };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:8797/login' }); await sleep(800);
  await evalJs(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'demo@orbitwork.local',password:'Demo!2026'})}).then(r=>r.status)`);
  await send('Page.navigate', { url: 'http://127.0.0.1:8797/app/sandbox' }); await sleep(1200);
  await evalJs(`document.querySelector('.page-head .btn-primary').click()`);
  await sleep(2000);
  const output = await evalJs(`document.querySelector('.console')?.innerText`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('.shots/sandbox.png', Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify({ output, errors }, null, 2));
} catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
finally { ws.close(); await fetch('http://127.0.0.1:9224/json/close/'+target.id).catch(()=>{}); }
