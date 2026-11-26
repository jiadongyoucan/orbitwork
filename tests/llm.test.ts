import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createOpenAiAdapter, type LlmAdapterConfig } from '../server/infrastructure/llm.js';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', 'llm', name), 'utf8');

function config(overrides: Partial<LlmAdapterConfig> = {}): LlmAdapterConfig {
  return {
    baseUrl: 'http://127.0.0.1:0/v1',
    apiKey: 'test-key',
    timeoutMs: 5000,
    maxRetries: 0,
    retryBaseMs: 1,
    normalizeReasoning: true,
    ...overrides,
  };
}

async function withServer(
  handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => void,
  run: (baseUrl: string, state: { requests: number }) => Promise<void>,
) {
  const state = { requests: 0 };
  const server = createServer((request, response) => { state.requests += 1; handler(request, response); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await run(`http://127.0.0.1:${port}/v1`, state);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const sse = (response: import('node:http').ServerResponse, body: string) => {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end(body);
};

test('llm adapter: DeepSeek fixture yields content, reasoning and cached usage', async () => {
  await withServer((_request, response) => sse(response, fixture('deepseek.sse')), async (baseUrl) => {
    const adapter = createOpenAiAdapter(config({ baseUrl }));
    const result = await adapter.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(result.content, '结论：先拆解。');
    assert.equal(result.reasoning, '先看目标。');
    assert.equal(result.usage.input, 12);
    assert.equal(result.usage.output, 34);
    assert.equal(result.usage.cachedInput, 8);
    assert.deepEqual(result.toolCalls, []);
  });
});

test('llm adapter: OpenAI fixture assembles streamed tool calls and cached tokens', async () => {
  await withServer((_request, response) => sse(response, fixture('openai.sse')), async (baseUrl) => {
    const adapter = createOpenAiAdapter(config({ baseUrl }));
    const result = await adapter.stream({ model: 'm', messages: [{ role: 'user', content: 'weather?' }] });
    assert.equal(result.content, '查询天气。');
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].function.name, 'get_weather');
    assert.deepEqual(JSON.parse(result.toolCalls[0].function.arguments), { city: 'Shanghai' });
    assert.equal(result.usage.cachedInput, 5);
  });
});

test('llm adapter: port mode normalizes thinking/thought, legacy ignores them', async () => {
  await withServer((_request, response) => sse(response, fixture('anthropic.sse')), async (baseUrl) => {
    const port = createOpenAiAdapter(config({ baseUrl, normalizeReasoning: true }));
    const portResult = await port.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(portResult.reasoning, '先评估风险。');
    assert.equal(portResult.usage.cachedInput, 3);
  });

  await withServer((_request, response) => sse(response, fixture('anthropic.sse')), async (baseUrl) => {
    const legacy = createOpenAiAdapter(config({ baseUrl, normalizeReasoning: false }));
    const legacyResult = await legacy.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(legacyResult.reasoning, '');
    assert.equal(legacyResult.content, '建议分两步。');
  });
});

test('llm adapter: retries before the body on 503 and succeeds', async () => {
  let attempts = 0;
  const server = createServer((_request, response) => {
    attempts += 1;
    if (attempts === 1) { response.writeHead(503, { 'retry-after': '0' }); response.end('busy'); return; }
    sse(response, fixture('deepseek.sse'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const adapter = createOpenAiAdapter(config({ baseUrl: `http://127.0.0.1:${port}/v1`, maxRetries: 1 }));
    const result = await adapter.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(result.content, '结论：先拆解。');
    assert.equal(attempts, 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('llm adapter: without retries a 503 surfaces as a provider error', async () => {
  await withServer((_request, response) => {
    response.writeHead(503);
    response.end('busy');
  }, async (baseUrl) => {
    const adapter = createOpenAiAdapter(config({ baseUrl, maxRetries: 0 }));
    await assert.rejects(() => adapter.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }), /503/);
  });
});

test('llm: streamModel honours LLM_ADAPTER at call time', async () => {
  const { streamModel } = await import('../server/infrastructure/llm.js');
  const { config } = await import('../server/config.js');
  const original = { ...config.llm };
  try {
    await withServer((_request, response) => sse(response, fixture('anthropic.sse')), async (baseUrl) => {
      config.llm.apiKey = 'test-key';
      config.llm.baseUrl = baseUrl;
      config.llm.adapter = 'port';
      const ported = await streamModel({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
      assert.equal(ported.reasoning, '先评估风险。');

      config.llm.adapter = 'legacy';
      const legacy = await streamModel({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
      assert.equal(legacy.reasoning, '');
    });
  } finally {
    Object.assign(config.llm, original);
  }
});

test('llm adapter: [DONE] ends the stream even when the socket stays open', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(fixture('deepseek.sse')); // deliberately never ends
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const adapter = createOpenAiAdapter(config({ baseUrl: `http://127.0.0.1:${port}/v1`, timeoutMs: 5000 }));
    const startedAt = Date.now();
    const result = await adapter.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(result.content, '结论：先拆解。');
    assert.ok(Date.now() - startedAt < 2000, 'resolved before the socket timeout');
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('llm adapter: mid-stream errors and non-SSE bodies surface as failures', async () => {
  await withServer((_request, response) => sse(response, 'data: {"error":{"message":"boom"}}\n\n'), async (baseUrl) => {
    const adapter = createOpenAiAdapter(config({ baseUrl }));
    await assert.rejects(() => adapter.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }), /模型流返回错误/);
  });

  await withServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"choices":[]}');
  }, async (baseUrl) => {
    const adapter = createOpenAiAdapter(config({ baseUrl }));
    await assert.rejects(() => adapter.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }), /非 SSE/);
  });
});

test('llm adapter: gateways that resend the tool name do not duplicate it', async () => {
  const body = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"get_","arguments":"{\\"ci"}}]}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"get_weather","arguments":"ty\\":\\"SH\\"}"}}]}}]}',
    'data: [DONE]',
  ].join('\n\n');
  await withServer((_request, response) => sse(response, `${body}\n\n`), async (baseUrl) => {
    const adapter = createOpenAiAdapter(config({ baseUrl }));
    const result = await adapter.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].function.name, 'get_weather');
    assert.deepEqual(JSON.parse(result.toolCalls[0].function.arguments), { city: 'SH' });
  });
});
