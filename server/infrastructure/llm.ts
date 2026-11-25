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

export type ModelResult = {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage: { input: number; output: number };
};

type StreamOptions = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
};

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

export async function streamModel(options: StreamOptions): Promise<ModelResult> {
  if (isDemoLlm()) {
    const lastUser = [...options.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
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
      usage: { input: Math.ceil(lastUser.length / 4), output: Math.ceil(answer.length / 4) },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llm.timeoutMs);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        })),
        tools: options.tools?.length ? options.tools : undefined,
        tool_choice: options.tools?.length ? 'auto' : undefined,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new Error(`模型请求失败 (${response.status}) ${detail.slice(0, 300)}`);
    }

    let content = '';
    let reasoning = '';
    let usage = { input: 0, output: 0 };
    const toolMap = new Map<number, { id: string; name: string; args: string }>();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') return;
      let event: Record<string, any>;
      try {
        event = JSON.parse(data);
      } catch {
        return;
      }
      if (event.usage) usage = { input: event.usage.prompt_tokens ?? 0, output: event.usage.completion_tokens ?? 0 };
      const delta = event.choices?.[0]?.delta;
      if (!delta) return;
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        options.onDelta?.(delta.content);
      }
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        options.onReasoning?.(delta.reasoning_content);
      }
      for (const [index, call] of (delta.tool_calls ?? []).entries()) {
        const existing = toolMap.get(call.index ?? index) ?? { id: '', name: '', args: '' };
        if (call.id) existing.id = call.id;
        if (call.function?.name) existing.name += call.function.name;
        if (call.function?.arguments) existing.args += call.function.arguments;
        toolMap.set(call.index ?? index, existing);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(processLine);
    }
    if (buffer) processLine(buffer);

    const toolCalls: ToolCall[] = [...toolMap.values()].map((call, index) => ({
      id: call.id || `call_${index}_${Date.now()}`,
      type: 'function',
      function: { name: call.name, arguments: call.args || '{}' },
    }));

    return { content, reasoning, toolCalls, usage };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}
