import { config, isDemoLlm } from '../config.js';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ToolDefinition = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type Usage = { input: number; output: number; cachedInput: number };

export type ModelResult = {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage: Usage;
};

export type StreamOptions = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
};

export type LlmPort = { stream(options: StreamOptions): Promise<ModelResult> };

export type LlmAdapterConfig = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  /** port mode normalizes provider-specific reasoning fields; legacy only reads reasoning_content. */
  normalizeReasoning: boolean;
};

const MAX_RETRY_WAIT_MS = 30_000;

const RETRYABLE_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET']);

function retryableCode(error: unknown): string {
  const value = error as { code?: string; cause?: { code?: string } };
  return String(value?.cause?.code ?? value?.code ?? '');
}

function isRetryableError(error: unknown): boolean {
  return RETRYABLE_CODES.has(retryableCode(error));
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.min(Math.max(0, date - Date.now()), MAX_RETRY_WAIT_MS) : null;
}

function reasoningChunk(delta: Record<string, unknown>, normalize: boolean): string {
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) return delta.reasoning_content;
  if (!normalize) return '';
  for (const key of ['reasoning', 'thinking', 'thought']) {
    const value = delta[key];
    if (typeof value === 'string' && value) return value;
    if (Array.isArray(value)) {
      const text = value.map((item) => (typeof item === 'string' ? item : (item as { text?: string })?.text ?? '')).join('');
      if (text) return text;
    }
  }
  return '';
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

async function abortableSleep(ms: number, signal: AbortSignal | undefined, sleep: (ms: number) => Promise<void>): Promise<void> {
  if (!signal) return sleep(ms);
  if (signal.aborted) return;
  await Promise.race([
    sleep(ms),
    new Promise<void>((resolve) => { signal.addEventListener('abort', () => resolve(), { once: true }); }),
  ]);
}

/**
 * Single OpenAI-compatible adapter. `normalizeReasoning` and `maxRetries` are
 * the only behaviour switches, so legacy mode is the same parser with retries
 * off and DeepSeek-only reasoning field.
 */
export function createOpenAiAdapter(cfg: LlmAdapterConfig, sleep: (ms: number) => Promise<void> = defaultSleep): LlmPort {
  return {
    async stream(options: StreamOptions): Promise<ModelResult> {
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, cfg.timeoutMs);
      const abort = () => controller.abort();
      options.signal?.addEventListener('abort', abort, { once: true });

      try {
        let response: Response | null = null;
        for (let attempt = 0; attempt <= cfg.maxRetries; attempt += 1) {
          try {
            const current = await fetch(`${cfg.baseUrl}/chat/completions`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
              body: JSON.stringify({
                model: options.model,
                messages: options.messages.map((message) => ({
                  role: message.role,
                  content: message.content,
                  ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
                  ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
                })),
                tools: options.tools?.length ? options.tools : undefined,
                tool_choice: options.tools?.length ? 'auto' : undefined,
                stream: true,
                stream_options: { include_usage: true },
              }),
              signal: controller.signal,
            });

            const retryable = current.status === 429 || current.status >= 500;
            if (retryable && attempt < cfg.maxRetries && !controller.signal.aborted) {
              const base = retryAfterMs(current.headers.get('retry-after')) ?? cfg.retryBaseMs * 2 ** attempt;
              const wait = Math.min(base * (0.5 + Math.random() * 0.5), MAX_RETRY_WAIT_MS);
              await current.body?.cancel().catch(() => undefined);
              await abortableSleep(Math.min(wait, MAX_RETRY_WAIT_MS), options.signal, sleep);
              continue;
            }
            if (!current.ok || !current.body) {
              // Never splice a provider body into a user-visible error: it can
              // echo prompts, keys or request URLs.
              throw new Error(`模型请求失败 (${current.status})`);
            }
            response = current;
            break;
          } catch (error) {
            const aborted = controller.signal.aborted || options.signal?.aborted;
            if (!aborted && attempt < cfg.maxRetries && isRetryableError(error)) {
              const wait = Math.min(cfg.retryBaseMs * 2 ** attempt * (0.5 + Math.random() * 0.5), MAX_RETRY_WAIT_MS);
              await abortableSleep(wait, options.signal, sleep);
              continue;
            }
            if (timedOut && !options.signal?.aborted) throw new Error(`模型请求超时（${cfg.timeoutMs}ms）`);
            throw error;
          }
        }
        if (!response?.body) throw new Error('模型未返回可读流');
        try {
          return await parseStream(response.body, options, cfg, () => clearTimeout(timeout));
        } catch (error) {
          if (timedOut && !options.signal?.aborted) throw new Error(`模型请求超时（${cfg.timeoutMs}ms）`);
          throw error;
        }
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
      }
    },
  };
}

async function parseStream(
  body: ReadableStream<Uint8Array>,
  options: StreamOptions,
  cfg: LlmAdapterConfig,
  onFirstEvent: () => void,
): Promise<ModelResult> {
  let content = '';
  let reasoning = '';
  const usage: Usage = { input: 0, output: 0, cachedInput: 0 };
  const toolMap = new Map<number, { id: string; name: string; args: string }>();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let firstEvent = false;
  let finished = false;
  let sawData = false;
  let finishReason = '';
  let streamError = '';

  const mergeText = (current: string, chunk: string): string =>
    current && chunk.length > current.length && chunk.startsWith(current) ? chunk : current + chunk;

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data) return;
    sawData = true;
    if (data === '[DONE]') {
      finished = true;
      return;
    }
    let event: any;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (event.error) {
      streamError = typeof event.error === 'string' ? event.error : String(event.error?.message ?? 'stream error');
      return;
    }
    if (event.usage) {
      usage.input = event.usage.prompt_tokens ?? usage.input;
      usage.output = event.usage.completion_tokens ?? usage.output;
      usage.cachedInput = event.usage.prompt_tokens_details?.cached_tokens
        ?? event.usage.prompt_cache_hit_tokens
        ?? event.usage.cache_read_input_tokens
        ?? usage.cachedInput;
    }
    if (event.choices?.[0]?.finish_reason) finishReason = String(event.choices[0].finish_reason);
    const delta = event.choices?.[0]?.delta;
    if (!delta) return;
    if (!firstEvent) {
      firstEvent = true;
      onFirstEvent();
    }
    if (typeof delta.content === 'string' && delta.content) {
      const next = mergeText(content, delta.content);
      const added = next.slice(content.length);
      content = next;
      if (added) options.onDelta?.(added);
    }
    const thought = reasoningChunk(delta, cfg.normalizeReasoning);
    if (thought) {
      const next = mergeText(reasoning, thought);
      const added = next.slice(reasoning.length);
      reasoning = next;
      if (added) options.onReasoning?.(added);
    }
    for (const [index, call] of (delta.tool_calls ?? []).entries()) {
      const key = typeof call.index === 'number' ? call.index : index;
      const existing = toolMap.get(key) ?? { id: '', name: '', args: '' };
      if (call.id) existing.id = call.id;
      const incomingName = String(call.function?.name ?? '');
      if (incomingName) {
        // Some gateways resend the full name on every chunk; don't concatenate it twice.
        if (!existing.name) existing.name = incomingName;
        else if (incomingName.startsWith(existing.name)) existing.name = incomingName;
        else if (!existing.name.endsWith(incomingName)) existing.name += incomingName;
      }
      if (call.function?.arguments) existing.args += call.function.arguments;
      toolMap.set(key, existing);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      processLine(line);
      if (finished || streamError) break;
    }
    if (finished || streamError) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  if (!finished && !streamError && buffer) processLine(buffer);

  if (streamError) throw new Error(`模型流返回错误：${streamError.slice(0, 120)}`);
  if (!sawData) throw new Error('模型返回了非 SSE 响应');

  if (!content && !toolMap.size && finishReason !== 'tool_calls') {
    throw new Error('模型返回空响应');
  }

  const toolCalls: ToolCall[] = [...toolMap.values()].map((call, index) => ({
    id: call.id || `call_${index}_${Date.now()}`,
    type: 'function',
    function: { name: call.name, arguments: call.args || '{}' },
  }));
  return { content, reasoning, toolCalls, usage };
}

function demoAnswer(userText: string): string {
  const topic = userText.slice(0, 80).replace(/\n/g, ' ');
  return [
    `我已经收到你的任务：**${topic}**`,
    '',
    '当前实例运行在 **演示模式**：还没有配置 LLM API Key，所以这是一条本地生成的可交互示例回复。配置后即可获得真实模型能力：',
    '',
    '```bash',
    'LLM_API_KEY=sk-...',
    'LLM_BASE_URL=https://api.deepseek.com/v1',
    'LLM_MODELS=deepseek-chat:DeepSeek Chat,deepseek-reasoner:DeepSeek Reasoner',
    '```',
    '',
    '在演示模式下，你仍然可以完整体验：工作区隔离、智能体配置、记忆、沙箱、连接器、插件发布与安装、成员权限和审计日志。',
    '',
    '### 建议的下一步',
    '1. 在「设置 → 模型」确认可用模型。',
    '2. 创建自己的智能体，绑定技能与连接器。',
    '3. 到插件市场安装一个专家或插件，立即发起会话。',
  ].join('\n');
}

export function adapterConfig(): LlmAdapterConfig {
  const port = config.llm.adapter === 'port';
  return {
    baseUrl: config.llm.baseUrl,
    apiKey: config.llm.apiKey,
    timeoutMs: config.llm.timeoutMs,
    maxRetries: port ? config.llm.maxRetries : 0,
    retryBaseMs: config.llm.retryBaseMs,
    normalizeReasoning: port,
  };
}

export async function streamModel(options: StreamOptions): Promise<ModelResult> {
  if (isDemoLlm()) {
    const lastUser = [...options.messages].reverse().find((message) => message.role === 'user')?.content ?? '';
    const answer = demoAnswer(lastUser);
    for (const chunk of answer.match(/.{1,12}/gs) ?? []) {
      if (options.signal?.aborted) break;
      options.onDelta?.(chunk);
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    return {
      content: answer,
      reasoning: '',
      toolCalls: [],
      usage: { input: Math.ceil(lastUser.length / 4), output: Math.ceil(answer.length / 4), cachedInput: 0 },
    };
  }
  // Built per call so tests and a future runtime config switch see fresh values.
  return createOpenAiAdapter(adapterConfig()).stream(options);
}
