import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [path = '/app', name = 'app', width = '1440', height = '960', login = '1'] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://127.0.0.1:8797';
const target = await (await fetch(`http://127.0.0.1:9224/json/new?${encodeURIComponent(base + '/')}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, reject) => { ws.onopen = resolveOpen; ws.onerror = reject; });
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve: done, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message)); else done(msg.result);
  }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails?.text + ' ' + (msg.params.exceptionDetails?.exception?.description ?? ''));
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args?.map(a => a.value ?? a.description).join(' '));
};
const send = (method, params = {}) => new Promise((done, reject) => {
  const id = ++seq;
  pending.set(id, { resolve: done, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: Number(width), height: Number(height), deviceScaleFactor: 1, mobile: Number(width) < 600 });
  if (login === '1') {
    await send('Page.navigate', { url: base + '/login' });
    await sleep(1200);
    const loginResult = await evaluate(`fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(process.env.SHOOT_EMAIL ?? 'demo@orbitwork.local')},password:${JSON.stringify(process.env.SHOOT_PASSWORD ?? 'Demo!2026')}})}).then(r=>r.status)`);
    if (loginResult !== 200) throw new Error('login failed ' + loginResult);
  }
  await send('Page.navigate', { url: base + path });
  await sleep(1800);
  const title = await evaluate('document.title');
  const bodyText = await evaluate('document.body.innerText.slice(0,500)');
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  mkdirSync(resolve('.shots'), { recursive: true });
  writeFileSync(resolve('.shots', `${name}.png`), Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify({ title, path, bodyText, errors }, null, 2));
} catch (error) {
  console.error('SHOOT FAILED', error.message);
  process.exitCode = 1;
} finally {
  ws.close();
  await fetch(`http://127.0.0.1:9224/json/close/${target.id}`).catch(() => {});
}
