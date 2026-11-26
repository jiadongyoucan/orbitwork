import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ChevronDown, Copy, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { TraceEvent, TracePayload } from '@/lib/types';
import { Badge, Modal, Spinner } from '@/components/UI';
import { useToast } from '@/context/ToastContext';

const KIND_LABEL: Record<string, string> = {
  'run.start': '开始运行',
  'prompt.ready': '提示构建',
  'model.call': '模型调用',
  'model.first_token': '首 token',
  'model.done': '模型完成',
  'tool.call': '工具调用',
  'run.done': '运行完成',
  'run.error': '运行失败',
};

function timeOf(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

/**
 * Conversation-level execution trace. REST is the reload path; SSE `trace`
 * events are merged live by seq while the drawer stays open.
 */
export function TraceDrawer({
  open, onClose, workspaceId, chatId, liveEvents = [],
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  chatId: string;
  liveEvents?: TraceEvent[];
}) {
  const toast = useToast();
  const [data, setData] = useState<TracePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.get<TracePayload>(`/api/w/${workspaceId}/chats/${chatId}/trace?limit=500`));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, chatId]);

  useEffect(() => {
    if (!open) return;
    void load();
    // Refresh while open so a run started mid-stream stops showing "进行中".
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 3000);
    return () => window.clearInterval(timer);
  }, [open, load]);

  const events = useMemo(() => {
    const merged = new Map<number, TraceEvent>();
    for (const event of [...(data?.events ?? []), ...liveEvents]) merged.set(event.seq, event);
    return [...merged.values()].sort((a, b) => a.seq - b.seq).filter((event) => !onlyErrors || event.status === 'error');
  }, [data, liveEvents, onlyErrors]);

  const totals = useMemo(() => {
    const runs = data?.runs ?? [];
    return {
      runs: runs.length,
      errors: events.filter((event) => event.status === 'error').length,
      durationMs: data?.totals.durationMs ?? 0,
      tokensIn: runs.reduce((sum, run) => sum + run.tokensIn, 0),
      tokensOut: runs.reduce((sum, run) => sum + run.tokensOut, 0),
    };
  }, [data, events]);

  async function downloadExport(format: 'json' | 'md') {
    try {
      const response = await fetch(`/api/w/${workspaceId}/chats/${chatId}/trace/export?format=${format}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('导出失败，请稍后重试');
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = `orbitwork-trace.${format}`;
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    }
  }

  function copyMarkdown() {
    const lines = [
      `# 对话轨迹（chat ${chatId.slice(0, 8)}）`,
      '',
      `- 运行次数：${totals.runs}`,
      `- 总耗时：${(totals.durationMs / 1000).toFixed(2)}s`,
      `- tokens：${totals.tokensIn} in / ${totals.tokensOut} out`,
      `- 错误：${totals.errors}`,
      '',
      '| seq | 时间 | 类型 | 状态 | 耗时 | 细节 |',
      '|---|---|---|---|---|---|',
      ...events.map((event) => `| ${event.seq} | ${timeOf(event.at)} | ${event.kind} | ${event.status} | ${event.durationMs}ms | \`${JSON.stringify(event.detail)}\` |`),
    ];
    void navigator.clipboard.writeText(lines.join('\n')).then(
      () => toast.push('轨迹已复制为 Markdown', 'success'),
      () => toast.push('复制失败，请手动选择', 'error'),
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      large
      title="对话轨迹"
      subtitle="按时间记录提示构建、模型调用、工具执行与耗时。不包含提示词正文、文件内容或工具输出。"
      footer={
        <>
          <button className="btn" onClick={() => void load()} disabled={loading}>{loading ? <Spinner size={13} /> : <RefreshCw size={13} />}刷新</button>
          <button className="btn" onClick={copyMarkdown} disabled={!events.length}><Copy size={13} />复制 Markdown</button>
          <button className="btn" onClick={() => void downloadExport('json')}>导出 JSON</button>
          <button className="btn" onClick={() => void downloadExport('md')}>导出 MD</button>
          <button className="btn btn-primary" onClick={onClose}>关闭</button>
        </>
      }
    >
      {data?.metrics && (
        <div className="trace-metrics">
          <div><span>总耗时</span><strong>{(data.totals.durationMs / 1000).toFixed(2)}s</strong></div>
          <div><span>模型</span><strong>{(data.metrics.modelMs / 1000).toFixed(2)}s</strong></div>
          <div><span>工具</span><strong>{(data.metrics.toolMs / 1000).toFixed(2)}s</strong></div>
          <div><span>首 token</span><strong>{data.metrics.firstTokenMs}ms</strong></div>
        </div>
      )}

      <div className="trace-summary">
        <span><Activity size={12} />{totals.runs} 次运行</span>
        <span>{(totals.durationMs / 1000).toFixed(2)}s</span>
        <span>{totals.tokensIn} in / {totals.tokensOut} out</span>
        <span className={totals.errors ? 'trace-error-text' : ''}>{totals.errors} 个错误</span>
        {data?.truncated && <span title={`共 ${data.totalEvents} 条`}>仅显示最近 {events.length} 条</span>}
        <button className="btn btn-ghost btn-sm" onClick={() => setOnlyErrors((value) => !value)}>
          {onlyErrors ? '显示全部' : '仅看错误'}
        </button>
      </div>

      {error ? (
        <div className="card" role="alert" style={{ padding: 14, color: 'var(--danger)', fontSize: 12 }}>{error}</div>
      ) : loading && !events.length ? (
        <div className="trace-empty"><Spinner size={14} />正在读取轨迹…</div>
      ) : !events.length ? (
        <div className="trace-empty">还没有轨迹。发一条消息后即可看到完整执行过程。</div>
      ) : (
        <div className="trace-list">
          {events.map((event) => {
            const isOpen = Boolean(expanded[event.id]);
            return (
              <div key={event.id} className="trace-item">
                <button
                  className="trace-row"
                  onClick={() => setExpanded((current) => ({ ...current, [event.id]: !current[event.id] }))}
                  aria-expanded={isOpen}
                >
                  <span className="trace-time">{timeOf(event.at)}</span>
                  <span className={`trace-dot ${event.status}`} aria-hidden />
                  <span className="trace-kind">{KIND_LABEL[event.kind] ?? event.kind}</span>
                  {event.status !== 'ok' && <Badge tone={event.status === 'error' ? 'danger' : 'warn'}>{event.status}</Badge>}
                  <span className="trace-dur">{event.durationMs}ms</span>
                  <ChevronDown size={12} style={{ transform: isOpen ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
                </button>
                {isOpen && <pre className="trace-detail">{JSON.stringify(event.detail, null, 2)}</pre>}
              </div>
            );
          })}
        </div>
      )}

      {(data?.runs.length ?? 0) > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="label" style={{ marginBottom: 6 }}>运行记录</div>
          {data!.runs.map((run) => (
            <div key={run.id} className="trace-run">
              <span className={`trace-dot ${run.status === 'complete' ? 'ok' : run.status === 'cancelled' ? 'warn' : 'error'}`} aria-hidden />
              <span className="mono" style={{ fontSize: 10 }}>{run.id.slice(0, 8)}</span>
              <span>{run.status}</span>
              <span>{run.model}</span>
              <span>{run.tokensIn} in / {run.tokensOut} out</span>
              <span>{run.finishedAt ? `${((run.finishedAt - run.startedAt) / 1000).toFixed(2)}s` : '进行中'}</span>
              {run.error && <span className="trace-error-text" title={run.error}>{run.error.slice(0, 40)}</span>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
