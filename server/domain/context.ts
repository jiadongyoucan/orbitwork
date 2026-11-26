export type HistoryMessage = { role: string; content: string };

/**
 * Approximate token count without a tokenizer: CJK ≈ 0.7 token/char,
 * everything else ≈ 0.25 token/char (4 chars/token). Deliberately generous.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let rest = 0;
  for (const char of text) {
    if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\uff00-\uffef]/.test(char)) cjk += 1;
    else rest += 1;
  }
  return Math.ceil(cjk * 0.7 + rest / 4);
}

export function truncateToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0) return '';
  if (estimateTokens(text) <= maxTokens) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokens(text.slice(0, mid)) <= maxTokens) low = mid;
    else high = mid - 1;
  }
  let output = `${text.slice(0, low)}…`;
  while (low > 0 && estimateTokens(output) > maxTokens) {
    low -= 1;
    output = `${text.slice(0, low)}…`;
  }
  return estimateTokens(output) > maxTokens ? text.slice(0, low) : output;
}

export type TrimResult = {
  messages: HistoryMessage[];
  usedTokens: number;
  dropped: number;
};

/**
 * Budget-aware history trimming. The earliest user message is pinned (it holds
 * the task/background), then messages are filled newest-first. Oversized tool
 * results degrade to a one-line note instead of being dropped outright.
 * This never mutates the database — only the payload sent to the model.
 */
export function trimHistory(messages: HistoryMessage[], budgetTokens: number): TrimResult {
  if (budgetTokens <= 0) return { messages: [], usedTokens: 0, dropped: messages.length };
  const entries = messages.map((message, index) => ({
    index,
    role: message.role,
    content: message.content,
    cost: estimateTokens(message.content) + 4,
  }));

  const chosen = new Map<number, HistoryMessage>();
  let usedTokens = 0;
  let dropped = 0;

  const pinnedIndex = entries.findIndex((entry) => entry.role === 'user');
  if (pinnedIndex >= 0) {
    const pinned = entries[pinnedIndex];
    const cap = Math.max(1, Math.floor(budgetTokens * 0.25));
    const content = truncateToTokens(pinned.content, cap);
    chosen.set(pinned.index, { role: pinned.role, content });
    usedTokens += estimateTokens(content) + 4;
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (chosen.has(entry.index)) continue;
    if (usedTokens + entry.cost <= budgetTokens) {
      chosen.set(entry.index, { role: entry.role, content: entry.content });
      usedTokens += entry.cost;
      continue;
    }
    if (entry.role === 'tool') {
      const note = `[tool output omitted: ${entry.content.length} chars]`;
      const cost = estimateTokens(note) + 4;
      if (usedTokens + cost <= budgetTokens) {
        chosen.set(entry.index, { role: entry.role, content: note });
        usedTokens += cost;
        continue;
      }
    }
    dropped += 1;
  }

  return {
    messages: [...chosen.entries()].sort((left, right) => left[0] - right[0]).map(([, message]) => message),
    usedTokens,
    dropped,
  };
}
