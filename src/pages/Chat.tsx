import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Activity, ArrowDown, ArrowLeft, ArrowUp, Bot, Check, ChevronDown, CircleStop, Clock3, Copy, Cpu,
  Loader2, MessageSquareText, MoreHorizontal, PanelLeft, RefreshCw, Sparkles, SquarePen, Terminal,
  Wrench, X, Zap,
} from 'lucide-react';
import { api, errorMessage, streamChat } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { Agent, Message, ModelOption, ToolEvent, TraceEvent } from '@/lib/types';
import { Badge, CopyButton, Spinner } from '@/components/UI';
import { Icon } from '@/components/Icon';
import { Markdown } from '@/components/Markdown';
import { ReasoningBlock } from '@/components/ReasoningBlock';
import { TraceDrawer } from '@/components/TraceDrawer';
import { cn, copyText, relativeTime, safeJson } from '@/lib/utils';

type ChatDetail = {
  chat: { id: string; title: string; model: string; agent_id: string | null; user_id: string; created_at: number; updated_at: number };
  messages: Message[];
  agent: (Pick<Agent, 'id' | 'name' | 'icon' | 'description' | 'model'>) | null;
  runs: Array<{ id: string; status: string; model: string; started_at: number; finished_at?: number }>;
};

function ToolEventCard({ event }: { event: ToolEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool-card">
      <button className="tool-head" onClick={() => setOpen((value) => !value)} style={{ width: '100%', border: 0, background: 'transparent', textAlign: 'left' }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center', background: event.status === 'error' ? 'rgba(255,122,122,.08)' : 'rgba(200,247,104,.07)', color: event.status === 'error' ? 'var(--danger)' : 'var(--accent)' }}>
          {event.status === 'error' ? <X size={11} /> : <Wrench size={11} />}
        </span>
        <span style={{ flex: 1, color: 'var(--text)', fontFamily: 'ui-monospace, monospace', fontSize: 10.5 }}>{event.name}</span>
        <span style={{ fontSize: 9.5 }}>{event.durationMs}ms</span>
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
      </button>
      {open && (
        <div className="tool-body">
          <div style={{ color: 'var(--faint)', marginBottom: 4 }}>input</div>
          {safeJson(event.input)}
          <div style={{ color: 'var(--faint)', margin: '10px 0 4px' }}>output</div>
          {event.output || '(empty)'}
        </div>
      )}
    </div>
  );
}

function MessageItem({ message, agent, streaming }: { message: Message; agent: ChatDetail['agent']; streaming?: boolean }) {
  if (message.role === 'user') {
    return (
      <div className="msg-row msg-user">
        <div className="msg-user-bubble">{message.content}</div>
      </div>
    );
  }
  return (
    <div className="msg-row">
      <div className="msg-avatar"><Icon name={agent?.icon || 'sparkles'} size={15} /></div>
      <div className="msg-assistant" style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
          <span style={{ fontSize: 12, fontWeight: 650 }}>{agent?.name ?? 'OrbitWork'}</span>
          {streaming ? <span className="badge badge-accent"><span className="spinner" style={{ width: 8, height: 8, borderWidth: 1 }} />生成中</span> : null}
          {message.status === 'sample' && <Badge tone="sky">示例内容</Badge>}
          {message.status === 'error' && <Badge tone="danger">未完成</Badge>}
          {message.status === 'cancelled' && <Badge tone="warn">已停止</Badge>}
        </div>
        {message.reasoning ? <ReasoningBlock text={message.reasoning} streaming={streaming} durationMs={message.reasoningMs} /> : null}
        {message.toolEvents?.map((event) => <ToolEventCard key={event.id} event={event} />)}
        {message.content ? (
          <Markdown content={message.content} />
        ) : streaming ? (
          <div className="thinking"><span className="spinner" style={{ width: 12, height: 12 }} />正在思考与调用工具…</div>
        ) : null}
        {streaming && message.content && <span className="typing-cursor" />}
        {!streaming && message.status !== 'sample' && (
          <div className="msg-meta">
            <span>{message.model || ''}</span>
            {message.outputTokens ? <span>{message.outputTokens} tokens</span> : null}
            {message.createdAt ? <span>{relativeTime(message.createdAt)}</span> : null}
            {message.content && <CopyButton value={message.content} label="" />}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { workspace } = useAuth();
  const { chatId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [traceOpen, setTraceOpen] = useState(false);
  const [liveTrace, setLiveTrace] = useState<TraceEvent[]>([]);
  const [input, setInput] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialSent = useRef(false);
  const streamMessageId = useRef<string | null>(null);
  const streamStartedAt = useRef(0);
  const streamRunId = useRef<string | null>(null);
  const runToken = useRef(0);
  const chatIdRef = useRef<string | undefined>(chatId);
  chatIdRef.current = chatId;
  const hasLoaded = useRef(false);

  const load = useCallback(async (silent = false, preserveStreamKey = false) => {
    if (!workspace || !chatId) return;
    if (!silent) setLoading(true);
    try {
      const data = await api.get<ChatDetail>(`/api/w/${workspace.id}/chats/${chatId}`);
      setDetail(data);
      const last = data.messages[data.messages.length - 1];
      const keepStreamKey = preserveStreamKey
        && streamMessageId.current
        && last?.role === 'assistant'
        && (last.createdAt ?? 0) >= streamStartedAt.current
        && (!streamRunId.current || last.runId === streamRunId.current);
      setMessages(keepStreamKey
        ? data.messages.map((message, index) => (
            index === data.messages.length - 1
              ? { ...message, id: streamMessageId.current as string }
              : message
          ))
        : data.messages);
      setTitleDraft(data.chat.title);
      setError('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [workspace, chatId]);

  useEffect(() => {
    setLiveTrace([]);
    setTraceOpen(false);
  }, [chatId]);

  useEffect(() => {
    void load();
    if (workspace) api.get<{ models: ModelOption[]; demo: boolean }>(`/api/w/${workspace.id}/models`).then((data) => { setModels(data.models); setDemo(data.demo); }).catch(() => undefined);
    hasLoaded.current = true;
    initialSent.current = false;
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    if (!hasLoaded.current || !detail || initialSent.current) return;
    const state = location.state as { initialMessage?: string } | null;
    if (state?.initialMessage) {
      initialSent.current = true;
      navigate(location.pathname, { replace: true, state: null });
      void sendMessage(state.initialMessage);
    }
  }, [detail, location.state, location.pathname, navigate]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }));
  }, []);

  useEffect(() => {
    if (streaming) scrollToBottom();
  }, [messages, streaming, scrollToBottom]);

  useEffect(() => {
    if (!loading && detail && !streaming) textareaRef.current?.focus();
  }, [loading, detail?.chat.id]);

  async function sendMessage(text: string) {
    if (!workspace || !chatId || !text.trim() || streaming) return;
    const content = text.trim();
    const activeChatId = chatId;
    const token = ++runToken.current;
    setInput('');
    setError('');
    setStreaming(true);
    setRunId(null);
    setLiveTrace([]);
    const now = Date.now();
    const optimisticUser: Message = { id: `local-user-${now}`, role: 'user', content, createdAt: now };
    const placeholderId = `local-assistant-${now}`;
    streamMessageId.current = placeholderId;
    streamStartedAt.current = now;
    setMessages((current) => [
      ...current,
      optimisticUser,
      { id: placeholderId, role: 'assistant', content: '', toolEvents: [], status: 'streaming', createdAt: now },
    ]);
    scrollToBottom();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat(
        `/api/w/${workspace.id}/chats/${chatId}/messages`,
        { content },
        (event) => {
          if (event.type === 'meta') {
            setRunId(event.runId);
            streamRunId.current = event.runId;
            if (event.demo) setDemo(true);
          }
          if (event.type === 'delta') {
            setMessages((current) => current.map((message) => message.id === placeholderId ? { ...message, content: message.content + event.text } : message));
          }
          if (event.type === 'reasoning') {
            setMessages((current) => current.map((message) => message.id === placeholderId ? { ...message, reasoning: `${message.reasoning ?? ''}${event.text}` } : message));
          }
          if (event.type === 'trace' && event.event) {
            const incoming = event.event as TraceEvent;
            setLiveTrace((current) => current.some((item) => item.seq === incoming.seq) ? current : [...current, incoming]);
          }
          if (event.type === 'tool') {
            setMessages((current) => current.map((message) => message.id === placeholderId ? { ...message, toolEvents: [...(message.toolEvents ?? []), event.event] } : message));
          }
          if (event.type === 'usage') {
            setMessages((current) => current.map((message) => message.id === placeholderId ? { ...message, inputTokens: event.input, outputTokens: event.output } : message));
          }
          if (event.type === 'error') {
            setError(event.message);
            setMessages((current) => current.map((message) => message.id === placeholderId ? { ...message, status: 'error' } : message));
          }
        },
        controller.signal,
      );
    } catch (caught) {
      if ((caught as Error).name !== 'AbortError') {
        setError(errorMessage(caught));
        toast.push(errorMessage(caught), 'error');
      }
    } finally {
      // A chat switch aborts the stream; never let the old closure mutate the new chat.
      if (chatIdRef.current !== activeChatId || runToken.current !== token) return;
      abortRef.current = null;
      setStreaming(false);
      setRunId(null);
      window.dispatchEvent(new Event('orbit:chats-changed'));
      await load(true, true);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  async function stop() {
    if (!workspace || !runId) {
      abortRef.current?.abort();
      setStreaming(false);
      return;
    }
    try {
      await api.post(`/api/w/${workspace.id}/runs/${runId}/cancel`);
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    }
  }

  async function renameChat() {
    if (!workspace || !chatId || !titleDraft.trim()) { setEditingTitle(false); return; }
    try {
      await api.patch(`/api/w/${workspace.id}/chats/${chatId}`, { title: titleDraft.trim() });
      setDetail((current) => current ? { ...current, chat: { ...current.chat, title: titleDraft.trim() } } : current);
      setEditingTitle(false);
      window.dispatchEvent(new Event('orbit:chats-changed'));
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    }
  }

  if (loading) {
    return <div style={{ padding: 40, display: 'grid', gap: 14, maxWidth: 800, margin: '0 auto' }}><div className="skeleton" style={{ height: 48, width: '60%' }} /><div className="skeleton" style={{ height: 100 }} /><div className="skeleton" style={{ height: 180 }} /></div>;
  }

  if (!detail) {
    return (
      <div className="empty" style={{ paddingTop: 100 }}>
        <div className="empty-icon"><MessageSquareText size={20} /></div>
        <div style={{ color: 'var(--text)', fontSize: 14 }}>无法打开这个会话</div>
        <div style={{ marginTop: 7 }}>{error || '会话不存在或你没有访问权限'}</div>
        <Link to="/app" className="btn btn-sm" style={{ marginTop: 15 }}>返回工作台</Link>
      </div>
    );
  }

  const selectedModel = models.find((item) => item.id === detail.chat.model);
  const modelLabel = selectedModel?.label ?? detail.chat.model;
  const chatDemo = selectedModel ? Boolean(selectedModel.demo) : models.length === 0 ? true : demo;
  const modelSettingsPath = workspace?.role === 'owner' || workspace?.role === 'admin' ? '/app/models' : '/app/settings';
  const hasMessages = messages.length > 0;

  return (
    <div className="chat-layout">
      <div className="chat-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <button className="btn btn-ghost btn-icon" onClick={() => navigate('/app')} aria-label="返回"><ArrowLeft size={17} /></button>
          <div className="msg-avatar" style={{ marginTop: 0, width: 30, height: 30 }}><Icon name={detail.agent?.icon || 'sparkles'} size={15} /></div>
          <div style={{ minWidth: 0 }}>
            {editingTitle ? (
              <input
                className="input"
                style={{ height: 28, padding: '2px 8px', fontSize: 12.5, width: 300 }}
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => void renameChat()}
                onKeyDown={(event) => { if (event.key === 'Enter') void renameChat(); if (event.key === 'Escape') setEditingTitle(false); }}
                autoFocus
              />
            ) : (
              <button onClick={() => setEditingTitle(true)} style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'left', display: 'block', maxWidth: 500 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail.chat.title}</div>
                <div style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 2 }}>{detail.agent?.name || '通用助理'} · {modelLabel}</div>
              </button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {chatDemo && <Link to={modelSettingsPath} className="badge badge-warn" title="当前模型未配置 API Key"><Zap size={10} />DEMO</Link>}
          <span className="badge badge-muted"><Cpu size={10} />{modelLabel}</span>
          <button className="btn btn-ghost btn-icon" onClick={() => setTraceOpen(true)} aria-label="查看对话轨迹" title="对话轨迹"><Activity size={15} /></button>
          <button className="btn btn-ghost btn-icon" onClick={() => void load(true)} aria-label="刷新"><RefreshCw size={15} /></button>
        </div>
      </div>

      <div className="chat-scroll">
        <div className="chat-inner">
          {!hasMessages && !streaming && (
            <div className="empty" style={{ paddingTop: 80, paddingBottom: 40 }}>
              <div className="empty-icon"><Icon name={detail.agent?.icon || 'sparkles'} size={20} /></div>
              <div style={{ color: 'var(--text)', fontSize: 18, fontWeight: 650, letterSpacing: '-.02em' }}>{detail.agent?.name || '通用助理'}</div>
              <div style={{ marginTop: 7, maxWidth: 360, marginInline: 'auto' }}>{detail.agent?.description || '描述你的目标，我会拆解任务并交付结果。'}</div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', marginTop: 20 }}>
                {['帮我拆解一个复杂项目', '分析一组数据并给出洞察', '写一份结构化方案'].map((item) => (
                  <button key={item} className="chip" onClick={() => void sendMessage(item)}>{item}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              agent={detail.agent}
              streaming={streaming && message.id === streamMessageId.current}
            />
          ))}
          {error && (
            <div className="card" style={{ padding: '10px 13px', borderColor: 'rgba(255,122,122,.25)', background: 'rgba(255,122,122,.05)', color: 'var(--danger)', fontSize: 11.5, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
              <X size={13} />{error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="chat-composer">
        <div className="chat-composer-inner">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage(input);
              }
            }}
            placeholder={streaming ? '正在生成回复…' : '继续对话…'}
            disabled={streaming}
            rows={1}
            aria-label="消息内容"
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 7 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="composer-select" style={{ cursor: 'default' }}><Bot size={12} />{detail.agent?.name || '通用助理'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span className="hint" style={{ marginRight: 2 }}>Enter 发送 · Shift+Enter 换行</span>
              {streaming ? (
                <button className="btn btn-sm" onClick={() => void stop()}><CircleStop size={13} />停止</button>
              ) : (
                <button className="send-btn" onClick={() => void sendMessage(input)} disabled={!input.trim()} aria-label="发送"><ArrowUp size={16} /></button>
              )}
            </div>
          </div>
        </div>
      </div>

      {workspace && chatId && (
        <TraceDrawer
          open={traceOpen}
          onClose={() => setTraceOpen(false)}
          workspaceId={workspace.id}
          chatId={chatId}
          liveEvents={liveTrace}
        />
      )}
    </div>
  );
}
