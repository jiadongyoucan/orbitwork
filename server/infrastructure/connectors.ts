import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from '../config.js';
import { AppError } from '../domain/errors.js';

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe80')) return true;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, 'INVALID_URL', '连接器 URL 不合法');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new AppError(400, 'INVALID_URL', '仅支持 HTTP/HTTPS');
  if (url.username || url.password) throw new AppError(400, 'INVALID_URL', 'URL 不能包含账号密码');
  if (config.allowPrivateConnectors) return url;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new AppError(400, 'PRIVATE_URL', '禁止访问内网地址');
  }
  if (isIP(host) && isPrivateIp(host)) throw new AppError(400, 'PRIVATE_URL', '禁止访问内网地址');
  if (!isIP(host)) {
    const records = await lookup(host, { all: true }).catch(() => []);
    if (!records.length) throw new AppError(400, 'DNS_FAILED', '无法解析连接器域名');
    if (records.some((r) => isPrivateIp(r.address))) throw new AppError(400, 'PRIVATE_URL', '域名解析到内网地址');
  }
  return url;
}

export type ConnectorPayload = {
  method: 'GET' | 'POST';
  url: string;
  toolName?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  headers?: Record<string, string>;
};

export async function callConnector(
  payload: ConnectorPayload,
  args: Record<string, unknown>,
  secretHeaders: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const url = await assertSafeUrl(payload.url);
  const method = payload.method === 'GET' ? 'GET' : 'POST';
  if (method === 'GET') {
    for (const [key, value] of Object.entries(args)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'OrbitWork-Connector/1.0',
        ...payload.headers,
        ...secretHeaders,
      },
      body: method === 'POST' ? JSON.stringify(args) : undefined,
      signal: controller.signal,
      redirect: 'error',
    });
    const text = (await response.text()).slice(0, 100_000);
    return { status: response.status, body: text };
  } catch (error) {
    throw new AppError(502, 'CONNECTOR_FAILED', `连接器调用失败：${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}
