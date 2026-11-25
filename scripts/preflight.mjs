import { existsSync, readFileSync } from 'node:fs';

const env = { ...process.env };
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in env)) env[key] = value;
  }
}
const issues = [];
const warnings = [];
const production = env.NODE_ENV === 'production';
const origin = env.APP_ORIGIN ?? '';
const site = env.SITE_ADDRESS ?? '';
const cookieSecure = String(env.COOKIE_SECURE).toLowerCase() === 'true';
const httpPort = String(env.HTTP_PORT ?? '8080');
const httpsPort = String(env.HTTPS_PORT ?? '8443');

let parsed;
try { parsed = new URL(origin); } catch { issues.push('APP_ORIGIN must be a valid absolute URL (e.g. https://work.example.com)'); }
if (parsed && !['http:', 'https:'].includes(parsed.protocol)) issues.push('APP_ORIGIN must use http or https');
if (parsed?.protocol === 'https:' && !cookieSecure) issues.push('COOKIE_SECURE must be true when APP_ORIGIN is https');
if (parsed?.protocol === 'http:' && cookieSecure) issues.push('COOKIE_SECURE must be false for local HTTP, otherwise the browser will not send the session');
if (production && (!env.APP_SECRET || env.APP_SECRET.includes('CHANGE_ME') || env.APP_SECRET.length < 32)) issues.push('APP_SECRET must be a unique 32+ character value in production');
if (env.SEED_ADMIN_PASSWORD && (env.SEED_ADMIN_PASSWORD.includes('CHANGE_ME') || env.SEED_ADMIN_PASSWORD.length < 12)) issues.push('SEED_ADMIN_PASSWORD must be 12+ characters and not a placeholder');
if (env.SEED_DEMO_PASSWORD && env.SEED_DEMO_PASSWORD.includes('CHANGE_ME')) warnings.push('SEED_DEMO_PASSWORD is a placeholder; it is ignored when SEED_DEMO=false');
if (String(env.SEED_DEMO).toLowerCase() === 'true') warnings.push('SEED_DEMO=true: disable demo seeding before public production launch');

const isLocal = site === ':80' || site.startsWith('localhost') || site.startsWith('127.0.0.1') || site === '';
if (production && !isLocal) {
  if (httpPort !== '80') issues.push('HTTP_PORT must be 80 for a domain-based production deployment (ACME + redirect)');
  if (httpsPort !== '443') issues.push('HTTPS_PORT must be 443 for a domain-based production deployment');
  if (parsed?.protocol !== 'https:') issues.push('APP_ORIGIN must be https for a domain-based production deployment');
}
if (!env.LLM_API_KEY) warnings.push('LLM_API_KEY is empty: the app boots in demo mode (UI is fully usable; replies are samples)');
if (env.SANDBOX_TIMEOUT_MS && (Number(env.SANDBOX_TIMEOUT_MS) < 1000 || Number(env.SANDBOX_TIMEOUT_MS) > 30000)) issues.push('SANDBOX_TIMEOUT_MS must be between 1000 and 30000');

for (const warning of warnings) console.warn(`[preflight] WARN ${warning}`);
for (const issue of issues) console.error(`[preflight] ERROR ${issue}`);
if (issues.length) {
  console.error(`[preflight] ${issues.length} problem(s). Fix .env before deployment.`);
  process.exit(1);
}
console.log('[preflight] OK — environment is internally consistent for this deployment mode.');
console.log(`[preflight] origin=${origin} site=${site || '(empty)'} ports=${httpPort}/${httpsPort} cookieSecure=${cookieSecure} demo=${env.SEED_DEMO}`);
