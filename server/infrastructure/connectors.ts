import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from '../config.js';
import { AppError } from '../domain/errors.js';

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

/** Deny everything that is not global unicast. */
function isPrivateV4(parts: number[]): boolean {
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;      // CGNAT
  if (a === 169 && b === 254) return true;                 // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;        // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true;        // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true;      // 6to4 relay anycast
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;    // benchmarking
  if (a === 198 && b === 51 && c === 100) return true;     // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;      // TEST-NET-3
  if (a >= 224) return true;                               // multicast, reserved, broadcast
  return false;
}

function parseIpv6(input: string): number[] | null {
  let value = input.split('%')[0].toLowerCase();
  if (!value.includes(':')) return null;
  const v4Tail = value.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Tail) {
    const parts = ipv4Parts(v4Tail[1]);
    if (!parts) return null;
    value = `${value.slice(0, -v4Tail[1].length)}${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...head, ...(halves.length === 2 ? Array<string>(missing).fill('0') : []), ...tail];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    const value = Number.parseInt(group, 16);
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

function isPrivateV6(bytes: number[]): boolean {
  if (bytes.every((byte, index) => index === 15 ? byte <= 1 : byte === 0)) return true; // :: and ::1
  if (bytes[0] === 0xff) return true;                                                   // multicast
  if ((bytes[0] & 0xfe) === 0xfc) return true;                                          // fc00::/7 ULA
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;                     // fe80::/10
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true;                     // fec0::/10 site-local
  const zeroPrefix = (from: number, to: number) => bytes.slice(from, to).every((byte) => byte === 0);
  if (zeroPrefix(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return isPrivateV4(bytes.slice(12)); // ::ffff:a.b.c.d
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && zeroPrefix(4, 12)) {
    return isPrivateV4(bytes.slice(12));                                                // NAT64 64:ff9b::/96
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return isPrivateV4(bytes.slice(2, 6));    // 6to4
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return true; // Teredo
  return false;
}

function isPrivateIp(ip: string): boolean {
  const v4 = ipv4Parts(ip);
  if (v4) return isPrivateV4(v4);
  const v6 = parseIpv6(ip);
  return v6 ? isPrivateV6(v6) : true;
}

export async function assertSafeUrl(raw: string, options: { allowPrivate?: boolean } = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, 'INVALID_URL', '连接器 URL 不合法');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new AppError(400, 'INVALID_URL', '仅支持 HTTP/HTTPS');
  if (url.username || url.password) throw new AppError(400, 'INVALID_URL', 'URL 不能包含账号密码');
  const allowPrivate = options.allowPrivate ?? config.allowPrivateConnectors;
  if (allowPrivate) return url;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
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
