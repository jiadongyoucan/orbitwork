import type { DB } from './db.js';
import { now } from './db.js';

export type TraceKind =
  | 'run.start'
  | 'prompt.ready'
  | 'model.call'
  | 'model.first_token'
  | 'model.done'
  | 'tool.call'
  | 'run.done'
  | 'run.error';

export type TraceEventInput = {
  workspaceId: string;
  chatId: string;
  runId?: string | null;
  kind: TraceKind;
  phase?: 'setup' | 'model' | 'tool' | 'finish' | '';
  status?: 'ok' | 'error' | 'warn';
  durationMs?: number;
  detail?: Record<string, unknown>;
};

export type TraceEventRow = {
  id: string;
  runId: string | null;
  seq: number;
  kind: string;
  phase: string;
  status: string;
  durationMs: number;
  at: number;
  detail: Record<string, unknown>;
};

const MAX_PER_CHAT = 1000;

/**
 * Append-only metadata trace. Never store prompts, file contents or tool output
 * here — only sizes, names, hosts, durations and status.
 */
export function traceEvent(db: DB, input: TraceEventInput): TraceEventRow | null {
  try {
    const event: TraceEventRow = {
      id: crypto.randomUUID(),
      runId: input.runId ?? null,
      seq: 0,
      kind: input.kind,
      phase: input.phase ?? '',
      status: input.status ?? 'ok',
      durationMs: Math.max(0, Math.round(input.durationMs ?? 0)),
      at: now(),
      detail: input.detail ?? {},
    };
    // Single statement so seq allocation cannot race between writers.
    db.prepare(
      `INSERT INTO trace_events (id, workspace_id, chat_id, run_id, seq, kind, phase, status, duration_ms, detail_json, created_at)
       SELECT ?, ?, ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?, ?
       FROM trace_events WHERE chat_id = ?`,
    ).run(
      event.id, input.workspaceId, input.chatId, input.runId ?? null,
      event.kind, event.phase, event.status, event.durationMs, JSON.stringify(event.detail), event.at, input.chatId,
    );
    event.seq = (db.prepare('SELECT seq FROM trace_events WHERE id = ?').get(event.id) as { seq: number }).seq;
    const seq = event.seq;
    // Keep exactly MAX_PER_CHAT rows: drop the row that just fell out of the window.
    if (seq > MAX_PER_CHAT) {
      db.prepare('DELETE FROM trace_events WHERE chat_id = ? AND seq <= ?').run(input.chatId, seq - MAX_PER_CHAT);
    }
    return event;
  } catch (error) {
    console.error('[trace] write failed', (error as Error).message);
    return null;
  }
}

export function listTrace(db: DB, workspaceId: string, chatId: string, limit = 200): TraceEventRow[] {
  const rows = db
    .prepare('SELECT * FROM trace_events WHERE chat_id = ? AND workspace_id = ? ORDER BY seq DESC LIMIT ?')
    .all(chatId, workspaceId, limit) as Array<{
      id: string; run_id: string | null; seq: number; kind: string; phase: string; status: string; duration_ms: number; detail_json: string; created_at: number;
    }>;
  return rows.reverse().map((row) => {
    let detail: Record<string, unknown> = {};
    try { detail = JSON.parse(row.detail_json) as Record<string, unknown>; } catch { detail = {}; }
    return {
      id: row.id,
      runId: row.run_id,
      seq: row.seq,
      kind: row.kind,
      phase: row.phase,
      status: row.status,
      durationMs: row.duration_ms,
      at: row.created_at,
      detail,
    };
  });
}
