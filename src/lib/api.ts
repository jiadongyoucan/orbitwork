export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/signup')) {
      window.dispatchEvent(new Event('orbit:unauthorized'));
    }
    throw new ApiError(response.status, payload?.error?.code ?? 'REQUEST_FAILED', payload?.error?.message ?? '请求失败，请稍后重试', payload?.error?.details);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export type StreamEvent = {
  type: string;
  [key: string]: any;
};

/**
 * Fetch-based SSE parser. POST is required for chat messages, so EventSource
 * (GET-only) is not sufficient. Returns when the server closes the stream.
 */
export async function streamChat(
  path: string,
  body: unknown,
  onEvent: (event: StreamEvent, raw: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    let message = '发送失败，请稍后重试';
    let code = 'REQUEST_FAILED';
    try {
      const data = await response.json();
      message = data?.error?.message ?? message;
      code = data?.error?.code ?? code;
    } catch {
      /* noop */
    }
    throw new ApiError(response.status, code, message);
  }
  if (!response.body) throw new ApiError(500, 'NO_STREAM', '浏览器不支持流式响应');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      if (!block.trim() || block.startsWith(':')) continue;
      let eventName = 'message';
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      try {
        const data = JSON.parse(dataLines.join('\n'));
        onEvent({ ...data, type: data.type ?? eventName }, block);
      } catch {
        /* ignore malformed keepalive */
      }
    }
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '发生未知错误';
}
