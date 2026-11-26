import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, trimHistory } from '../server/domain/context.js';

test('tokens: CJK costs more per character than ASCII', () => {
  assert.ok(estimateTokens('中文') > estimateTokens('ab'));
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
});

test('trim: pins the first user message and degrades old tool output', () => {
  const messages = [{ role: 'user', content: '最初的背景与目标' }];
  for (let index = 0; index < 50; index += 1) {
    messages.push({ role: index % 2 ? 'assistant' : 'user', content: `第 ${index} 轮对话内容`.repeat(4) });
  }
  messages.push({ role: 'tool', content: 'x'.repeat(8000) });
  messages.push({ role: 'assistant', content: '最近一条回答' });

  const trimmed = trimHistory(messages, 600);
  assert.equal(trimmed.messages[0].content, '最初的背景与目标', 'first user stays first');
  assert.ok(trimmed.usedTokens <= 600, `used ${trimmed.usedTokens}`);
  assert.ok(trimmed.dropped > 0, 'old messages dropped');
  assert.equal(trimmed.messages[trimmed.messages.length - 1].content, '最近一条回答');
  const note = trimmed.messages.find((message) => message.role === 'tool');
  assert.ok(!note || note.content.startsWith('[tool output omitted:'), 'tool output reduced to a note');
});

test('trim: a tiny budget still returns the pinned user message', () => {
  const messages = [{ role: 'user', content: '目标：分析这份财报并给出结论。'.repeat(50) }, { role: 'assistant', content: 'ok' }];
  const trimmed = trimHistory(messages, 40);
  assert.equal(trimmed.messages[0].role, 'user');
  assert.ok(trimmed.messages[0].content.startsWith('目标：'));
  assert.ok(trimmed.usedTokens <= 40, `used ${trimmed.usedTokens}`);
});

test('trim: zero budget keeps nothing', () => {
  assert.deepEqual(trimHistory([{ role: 'user', content: 'x' }], 0), { messages: [], usedTokens: 0, dropped: 1 });
});

test('fit: keeps whole assistant+tool rounds when the loop exceeds budget', async () => {
  const { fitMessages } = await import('../server/application/agent-runtime.js');
  const base = [
    { role: 'system' as const, content: 'system' },
    { role: 'user' as const, content: 'task' },
  ];
  const round = (index: number) => ([
    { role: 'assistant' as const, content: `step ${index}`, tool_calls: [{ id: `c${index}`, type: 'function' as const, function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool' as const, content: 'x'.repeat(2000), tool_call_id: `c${index}` },
  ]);
  const loop = [...round(1), ...round(2), ...round(3)];
  const fitted = fitMessages(base, loop, 600);
  assert.ok(fitted.length >= 2);
  const assistants = fitted.filter((message) => message.role === 'assistant');
  const tools = fitted.filter((message) => message.role === 'tool');
  assert.ok(assistants.length <= 1, 'only the newest round fits');
  for (const assistant of assistants) {
    const ids = (assistant.tool_calls ?? []).map((call: { id: string }) => call.id);
    for (const id of ids) assert.ok(tools.some((message) => message.tool_call_id === id), `tool result ${id} kept`);
  }
  assert.ok(tools.length === assistants.length, 'no orphan tool results');
});

test('tokens: truncateToTokens respects CJK cost', async () => {
  const { truncateToTokens } = await import('../server/domain/context.js');
  const text = '中文内容'.repeat(100);
  const truncated = truncateToTokens(text, 30);
  assert.ok(truncated.length < text.length);
  assert.ok(truncated.endsWith('…'));
  assert.ok((await import('../server/domain/context.js')).estimateTokens(truncated) <= 31);
  assert.equal(truncateToTokens('short', 100), 'short');
});

test('tokens: truncation never exceeds a one-token budget', async () => {
  const { estimateTokens, truncateToTokens } = await import('../server/domain/context.js');
  const one = truncateToTokens('中文内容', 1);
  assert.ok(estimateTokens(one) <= 1, `got ${estimateTokens(one)} tokens`);
});

test('fit: result respects the budget when the newest round is oversized', async () => {
  const { fitMessages } = await import('../server/application/agent-runtime.js');
  const { estimateTokens } = await import('../server/domain/context.js');
  const base = [{ role: 'system' as const, content: 'system' }, { role: 'user' as const, content: 'task' }];
  const loop = [
    { role: 'assistant' as const, content: 'step', tool_calls: [{ id: 'c1', type: 'function' as const, function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool' as const, content: 'x'.repeat(4000), tool_call_id: 'c1' },
  ];
  const fitted = fitMessages(base, loop, 600);
  const used = fitted.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  assert.ok(used <= 600, `used ${used}`);
  assert.match(fitted[fitted.length - 1].content, /tool output omitted/);
});
