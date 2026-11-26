import { config } from '../config.js';
import { AppError } from '../domain/errors.js';
import { extractTitle, htmlToText, prettyJson } from '../domain/web-text.js';
import { assertSafeUrl } from './connectors.js';

export type FetchResult = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title: string;
  text: string;
  bytes: number;
  truncated: boolean;
};

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const TEXTUAL = /^text\/|^application\/(json|xml|javascript|x-www-form-urlencoded|x-ndjson)/i;

async function readCapped(response: Response, maxBytes: number): Promise<{ buffer: Buffer; truncated: boolean }> {
  if (!response.body) return { buffer: Buffer.alloc(0), truncated: false };
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    const remaining = maxBytes - total;
    if (remaining <= 0) {
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    const take = Math.min(value.byteLength, remaining);
    chunks.push(Buffer.from(value.buffer, value.byteOffset, take));
    total += take;
    if (take < value.byteLength) {
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return { buffer: Buffer.concat(chunks), truncated };
}

/**
 * Server-side fetch for agent tools. The code sandbox stays offline on purpose;
 * this path is SSRF-guarded, redirect is re-validated hop by hop, and the body
 * size / time / charset are all capped.
 */
export async function fetchAsText(rawUrl: string, maxChars = config.web.maxChars): Promise<FetchResult> {
  if (!config.web.enabled) throw new AppError(403, 'WEB_DISABLED', '联网抓取已被部署配置关闭（WEB_FETCH_ENABLED=false）');

  let current = await assertSafeUrl(rawUrl, { allowPrivate: false });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.web.timeoutMs);
  try {
    for (let hop = 0; hop <= 3; hop += 1) {
      const response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'OrbitWork/1.1 (web_fetch; +https://github.com/orbitwork)',
          accept: 'text/html,application/json,text/plain,text/markdown;q=0.9,*/*;q=0.1',
        },
      });
      if (REDIRECTS.has(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new AppError(502, 'WEB_FETCH_FAILED', '目标返回重定向但缺少 Location');
        current = await assertSafeUrl(new URL(location, current).toString(), { allowPrivate: false });
        continue;
      }

      const contentType = String(response.headers.get('content-type') ?? '');
      const { buffer, truncated } = await readCapped(response, config.web.maxBytes);
      const textual = !contentType || TEXTUAL.test(contentType);
      const charset = (/charset=["']?([\w-]+)/i.exec(contentType)?.[1]
        ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(buffer.subarray(0, 2048).toString('latin1'))?.[1]
        ?? 'utf-8').toLowerCase();
      let raw: string;
      try {
        raw = new TextDecoder(charset).decode(buffer);
      } catch {
        raw = buffer.toString('utf8');
      }
      const isHtml = /html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(raw);

      if (!textual) {
        return {
          url: rawUrl,
          finalUrl: current.toString(),
          status: response.status,
          contentType,
          title: '',
          text: `[非文本内容 ${contentType || 'unknown'}，${buffer.length} 字节，未解析正文]`,
          bytes: buffer.length,
          truncated,
        };
      }

      const title = isHtml ? extractTitle(raw) : '';
      const text = isHtml
        ? htmlToText(raw, maxChars)
        : /json/i.test(contentType)
          ? prettyJson(raw, maxChars)
          : raw.slice(0, maxChars);

      if (!response.ok) throw new AppError(502, 'WEB_FETCH_FAILED', `目标返回 HTTP ${response.status}${title ? `（${title}）` : ''}`);
      return {
        url: rawUrl,
        finalUrl: current.toString(),
        status: response.status,
        contentType,
        title,
        text,
        bytes: buffer.length,
        truncated,
      };
    }
    throw new AppError(502, 'WEB_FETCH_REDIRECT_LOOP', '重定向次数过多（最多 3 次）');
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = (error as Error).name === 'AbortError'
      ? `抓取超时（${config.web.timeoutMs}ms）`
      : `抓取失败：${(error as Error).message}`;
    throw new AppError(502, 'WEB_FETCH_FAILED', message);
  } finally {
    clearTimeout(timer);
  }
}
