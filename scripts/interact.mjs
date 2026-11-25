import { writeFileSync } from 'node:fs';
const target = await (await fetch('http://127.0.0.1:9224/json/new?' + encodeURIComponent('http://127.0.0.1:8797/login'), { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args?.map(a => a.value ?? a.description).join(' '));
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`.shots/${name}.png`, Buffer.from(r.data, 'base64'));
};
try {
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:8797/login' }); await sleep(900);
  await evalJs(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'demo@orbitwork.local',password:'Demo!2026'})}).then(r=>r.status)`);
  await send('Page.navigate', { url: 'http://127.0.0.1:8797/app/c/613affbe-3976-4884-a960-dd0f3214ab08' }); await sleep(1400);
  const result = await evalJs(`(async()=>{
    const ta=document.querySelector('.chat-composer textarea');
    const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
    setter.call(ta,'用一句话总结这次实验的重点。');
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,100));
    document.querySelector('.chat-composer .send-btn').click();
    return {clicked:true, disabled: document.querySelector('.chat-composer .send-btn')?.disabled};
  })()`);
  await sleep(800);
  await shot('chat-streaming');
  await sleep(3500);
  const streamed = await evalJs(`({text:document.querySelector('.chat-inner')?.innerText.slice(-1200), streaming:!!document.querySelector('.badge-accent')})`);
  await shot('chat-after');
  console.log(JSON.stringify({ result, streamed, errors }, null, 2));
} catch (e) { console.error('FAIL', e.message); process.exitCode = 1; }
finally { ws.close(); await fetch('http://127.0.0.1:9224/json/close/'+target.id).catch(()=>{}); }
