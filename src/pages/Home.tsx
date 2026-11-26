import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Archive, ArrowRight, ArrowUp, Bot, ChevronDown, Cpu, FilePlus2, FolderOpen, Loader2, MessageSquareText,
  Plus, RotateCcw, Sparkles, Store, Trash2, Zap,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { Agent, Chat, ModelOption, Overview } from '@/lib/types';
import { ConfirmModal, EmptyState, Modal } from '@/components/UI';
import { Icon } from '@/components/Icon';
import { greeting, relativeTime } from '@/lib/utils';

const SUGGESTIONS = [
  '把本周零散笔记整理成给管理层的周报',
  '分析这份增长数据并给出三个行动建议',
  '为新产品写一版官网首屏文案',
];

export default function HomePage() {
  const { workspace, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [prompt, setPrompt] = useState('');
  const [agentId, setAgentId] = useState('');
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageTab, setManageTab] = useState<'active' | 'archived'>('active');
  const [managedChats, setManagedChats] = useState<Chat[]>([]);
  const [manageLoading, setManageLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Chat | null>(null);
  const [actionId, setActionId] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);
    Promise.all([
      api.get<Overview>(`/api/w/${workspace.id}/overview`),
      api.get<{ agents: Agent[] }>(`/api/w/${workspace.id}/agents`),
      api.get<{ models: ModelOption[] }>(`/api/w/${workspace.id}/models`),
    ])
      .then(([overviewData, agentData, modelData]) => {
        setOverview(overviewData);
        setAgents(agentData.agents);
        setModels(modelData.models);
        const preferred = String(overviewData.workspace.settings.defaultModel || '');
        const selected = modelData.models.find((item) => item.id === preferred)
          ?? modelData.models.find((item) => item.isDefault)
          ?? modelData.models[0];
        setModel(selected?.id ?? '');
      })
      .catch((caught) => toast.push(errorMessage(caught), 'error'))
      .finally(() => setLoading(false));
  }, [workspace, toast]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(150, Math.max(76, textarea.scrollHeight))}px`;
  }, [prompt]);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  async function send() {
    if (!workspace || !prompt.trim() || sending) return;
    setSending(true);
    try {
      const result = await api.post<{ chat: { id: string } }>(`/api/w/${workspace.id}/chats`, {
        agentId: agentId || null,
        model: model || undefined,
      });
      window.dispatchEvent(new Event('orbit:chats-changed'));
      navigate(`/app/c/${result.chat.id}`, { state: { initialMessage: prompt.trim() } });
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
      setSending(false);
    }
  }

  async function refreshRecent() {
    if (!workspace) return;
    try {
      const data = await api.get<Overview>(`/api/w/${workspace.id}/overview`);
      setOverview(data);
    } catch {
      /* keep the local list on transient refresh failure */
    }
  }

  async function loadManaged(tab: 'active' | 'archived') {
    if (!workspace) return;
    setManageLoading(true);
    try {
      const query = tab === 'archived' ? '?archived=1' : '?limit=100';
      const data = await api.get<{ chats: Chat[] }>(`/api/w/${workspace.id}/chats${query}`);
      setManagedChats(data.chats);
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setManageLoading(false);
    }
  }

  async function archiveChat(chat: Chat) {
    if (!workspace) return;
    setActionId(chat.id);
    try {
      await api.patch(`/api/w/${workspace.id}/chats/${chat.id}`, { archived: true });
      setOverview((current) => current ? { ...current, recentChats: current.recentChats.filter((item) => item.id !== chat.id) } : current);
      setManagedChats((current) => current.filter((item) => item.id !== chat.id));
      window.dispatchEvent(new Event('orbit:chats-changed'));
      toast.push('对话已归档', 'success');
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setActionId('');
    }
  }

  async function restoreChat(chat: Chat) {
    if (!workspace) return;
    setActionId(chat.id);
    try {
      await api.patch(`/api/w/${workspace.id}/chats/${chat.id}`, { archived: false });
      setManagedChats((current) => current.filter((item) => item.id !== chat.id));
      await refreshRecent();
      toast.push('对话已恢复', 'success');
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setActionId('');
    }
  }

  async function deleteChat() {
    if (!workspace || !deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/api/w/${workspace.id}/chats/${deleteTarget.id}`);
      setOverview((current) => current ? { ...current, recentChats: current.recentChats.filter((item) => item.id !== deleteTarget.id) } : current);
      setManagedChats((current) => current.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
      window.dispatchEvent(new Event('orbit:chats-changed'));
      toast.push('对话已删除', 'success');
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setDeleteLoading(false);
    }
  }

  function openManage(tab: 'active' | 'archived') {
    setManageTab(tab);
    setManageOpen(true);
    setManagedChats([]);
    void loadManaged(tab);
  }

  function switchManageTab(tab: 'active' | 'archived') {
    setManageTab(tab);
    void loadManaged(tab);
  }

  const activeModel = models.find((item) => item.id === model);
  const recent = overview?.recentChats ?? [];
  const filesEnabled = workspace?.settings.filesEnabled !== false;
  const demo = models.length === 0 || Boolean(activeModel?.demo);

  return (
    <div className="home-v2 fade-in">
      <header className="home-v2-head">
        <div>
          <div className="eyebrow">{greeting()}，{user?.name}</div>
          <h1>今天想完成什么？</h1>
          <p>把目标交给智能体，剩下的交给工作区里的能力与工具。</p>
        </div>
        <div className={demo ? 'model-status model-status-demo' : 'model-status'} aria-live="polite">
          {demo ? <Zap size={13} /> : <Cpu size={13} />}
          <span>{demo ? '演示模式' : activeModel?.label || '已配置模型'}</span>
        </div>
      </header>

      <section className="composer-v2" aria-label="新建任务">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="描述你想完成的任务，越具体越好…"
          aria-label="任务描述"
        />
        <div className="composer-v2-foot">
          <div className="composer-v2-selects">
            <label className="select-wrap">
              <Bot size={13} />
              <span className="sr-only">选择智能体</span>
              <select value={agentId} onChange={(event) => setAgentId(event.target.value)} aria-label="选择智能体">
                <option value="">通用助理</option>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
              <ChevronDown size={11} />
            </label>
            <label className="select-wrap">
              <Cpu size={13} />
              <span className="sr-only">选择模型</span>
              <select value={model} onChange={(event) => setModel(event.target.value)} aria-label="选择模型" disabled={!models.length}>
                {!models.length && <option value="">未配置模型</option>}
                {models.map((item) => <option key={item.id} value={item.id}>{item.label}{item.providerName ? ` · ${item.providerName}` : ''}</option>)}
              </select>
              <ChevronDown size={11} />
            </label>
          </div>
          <button className="send-btn" onClick={() => void send()} disabled={!prompt.trim() || sending} aria-label="发送">
            {sending ? <Loader2 size={16} className="spin" /> : <ArrowUp size={17} />}
          </button>
        </div>
      </section>

      <div className="home-v2-suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} className="chip" onClick={() => { setPrompt(suggestion); textareaRef.current?.focus(); }}>
            {suggestion}
          </button>
        ))}
      </div>

      <div className="home-v2-grid">
        <section>
          <div className="section-head">
            <span className="section-title">最近对话</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="badge badge-muted">仅你可见</span>
              <button className="btn btn-ghost btn-sm" style={{ height: 24, padding: '0 7px', fontSize: 10.5 }} onClick={() => openManage('active')}>查看全部</button>
              <button className="btn btn-ghost btn-sm" style={{ height: 24, padding: '0 7px', fontSize: 10.5 }} onClick={() => openManage('archived')}><Archive size={11} />已归档</button>
            </div>
          </div>
          <div className="card">
            {loading ? (
              <div style={{ padding: 20, display: 'grid', gap: 10 }}><div className="skeleton" style={{ height: 36 }} /><div className="skeleton" style={{ height: 36 }} /></div>
            ) : recent.length ? recent.slice(0, 5).map((chat) => (
              <div key={chat.id} className="recent-card recent-card-manage">
                <Link to={`/app/c/${chat.id}`} className="recent-main">
                  <div className="recent-icon"><Icon name={chat.agent_icon || 'message-square'} size={15} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="recent-title">{chat.title}</div>
                    <div className="recent-meta">{chat.agent_name || '通用助理'} · {relativeTime(chat.updated_at)}</div>
                  </div>
                </Link>
                <div className="recent-actions">
                  <button className="btn btn-ghost btn-icon btn-sm" disabled={actionId === chat.id} onClick={() => void archiveChat(chat)} title="归档对话" aria-label={`归档 ${chat.title}`}><Archive size={12} /></button>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setDeleteTarget(chat)} title="删除对话" aria-label={`删除 ${chat.title}`}><Trash2 size={12} /></button>
                </div>
              </div>
            )) : (
              <EmptyState
                icon={<MessageSquareText size={19} />}
                title="还没有对话"
                description="从上方输入框开始，或先配置一个可用的模型。"
              />
            )}
          </div>
        </section>

        <section>
          <div className="section-head"><span className="section-title">快速开始</span></div>
          <div className="quick-start-list">
            <Link to="/app/agents" className="quick-start-item">
              <span className="quick-start-icon"><Bot size={16} /></span>
              <span><b>创建智能体</b><small>把角色、技能和工具组合起来</small></span>
              <Plus size={14} />
            </Link>
            <Link to="/app/market" className="quick-start-item">
              <span className="quick-start-icon"><Store size={16} /></span>
              <span><b>安装一项能力</b><small>专家、技能、连接器与插件</small></span>
              <ArrowRight size={14} />
            </Link>
            {filesEnabled && (
              <Link to="/app/files" className="quick-start-item">
                <span className="quick-start-icon"><FolderOpen size={16} /></span>
                <span><b>上传工作区文件</b><small>让智能体读取和引用资料</small></span>
                <FilePlus2 size={14} />
              </Link>
            )}
          </div>
          <Link to="/app/memories" className="home-tip">
            <Sparkles size={14} />
            <span><b>让智能体更懂团队</b><small>添加一条长期记忆，例如品牌语气或目标用户。</small></span>
            <ArrowRight size={14} />
          </Link>
        </section>
      </div>

      <Modal open={manageOpen && !deleteTarget} onClose={() => setManageOpen(false)} title={manageTab === 'active' ? '全部对话' : '已归档对话'} subtitle={manageTab === 'active' ? '你的全部对话，按最近更新排序。' : '归档的对话不会出现在工作台，但可以随时恢复或删除。'}>
        <div className="manage-tabs" role="tablist" aria-label="对话范围">
          <button type="button" role="tab" aria-selected={manageTab === 'active'} className={manageTab === 'active' ? 'active' : ''} onClick={() => switchManageTab('active')}>全部对话</button>
          <button type="button" role="tab" aria-selected={manageTab === 'archived'} className={manageTab === 'archived' ? 'active' : ''} onClick={() => switchManageTab('archived')}><Archive size={11} />已归档</button>
        </div>
        {manageLoading ? <div style={{ display: 'grid', gap: 8 }}><div className="skeleton" style={{ height: 42 }} /><div className="skeleton" style={{ height: 42 }} /></div> : managedChats.length === 0 ? (
          <EmptyState icon={<Archive size={19} />} title={manageTab === 'active' ? '还没有对话' : '没有已归档对话'} description={manageTab === 'active' ? '从工作台上方输入框开始第一个任务。' : '在最近对话上点击归档按钮，对话会收进这里。'} />
        ) : managedChats.map((chat) => (
          <div className="archived-row" key={chat.id}>
            <div className="recent-icon"><Icon name={chat.agent_icon || 'message-square'} size={14} /></div>
            {manageTab === 'active' ? (
              <Link to={`/app/c/${chat.id}`} className="managed-main" onClick={() => setManageOpen(false)}>
                <div className="recent-title">{chat.title}</div>
                <div className="recent-meta">{chat.agent_name || '通用助理'} · {relativeTime(chat.updated_at)}</div>
              </Link>
            ) : (
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="recent-title">{chat.title}</div>
                <div className="recent-meta">{chat.agent_name || '通用助理'} · {relativeTime(chat.updated_at)}</div>
              </div>
            )}
            {manageTab === 'active' ? (
              <>
                <button className="btn btn-ghost btn-icon btn-sm" disabled={actionId === chat.id} onClick={() => void archiveChat(chat)} title="归档对话" aria-label={`归档 ${chat.title}`}><Archive size={13} /></button>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setDeleteTarget(chat)} title="删除对话" aria-label={`删除 ${chat.title}`}><Trash2 size={13} /></button>
              </>
            ) : (
              <>
                <button className="btn btn-sm" disabled={actionId === chat.id} onClick={() => void restoreChat(chat)}><RotateCcw size={12} />恢复</button>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setDeleteTarget(chat)} title="删除对话" aria-label={`删除 ${chat.title}`}><Trash2 size={13} /></button>
              </>
            )}
          </div>
        ))}
      </Modal>

      <ConfirmModal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} onConfirm={() => void deleteChat()} title="删除对话" description={`确定删除「${deleteTarget?.title ?? ''}」吗？消息记录将无法恢复。`} loading={deleteLoading} />
    </div>
  );
}
