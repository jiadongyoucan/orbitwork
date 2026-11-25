import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, ArrowUp, AtSign, Bot, ChevronDown, Command, Cpu, FileText, Globe2, Loader2,
  MessageSquareText, PenLine, Plus, Sparkles, Store, WandSparkles, Zap,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { Agent, Asset, Chat, ModelOption, Overview } from '@/lib/types';
import { Badge, EmptyState, Spinner } from '@/components/UI';
import { Icon } from '@/components/Icon';
import { cn, compactNumber, greeting, relativeTime } from '@/lib/utils';

const MODES = [
  { id: 'office', label: '办公', icon: FileText },
  { id: 'dev', label: '开发', icon: Command },
  { id: 'design', label: '设计', icon: PenLine },
];

const SUGGESTIONS: Record<string, string[]> = {
  office: ['把本周零散笔记整理成给管理层的周报', '设计一个客户续约风险预警清单', '分析这份增长数据并给出三个行动建议'],
  dev: ['审查这段代码的安全与租户隔离风险', '为这个接口设计一套集成测试', '把需求拆成可提交的工程任务'],
  design: ['为新产品写一版官网首屏文案', '把这个流程改造成更清晰的用户旅程', '生成 3 组品牌语气与对应示例'],
};

const QUICK_ACTIONS = ['创作文档', '数据分析', '制作PPT', '深度研究', '策划方案', '生成周报'];

export default function HomePage() {
  const { workspace, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [market, setMarket] = useState<Asset[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [demo, setDemo] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [agentId, setAgentId] = useState('');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState('office');
  const [agentMenu, setAgentMenu] = useState(false);
  const [modelMenu, setModelMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);
    Promise.all([
      api.get<Overview>(`/api/w/${workspace.id}/overview`),
      api.get<{ agents: Agent[] }>(`/api/w/${workspace.id}/agents`),
      api.get<{ items: Asset[] }>('/api/market?sort=featured'),
      api.get<{ models: ModelOption[]; demo: boolean }>('/api/models'),
    ])
      .then(([overviewData, agentData, marketData, modelData]) => {
        setOverview(overviewData);
        setAgents(agentData.agents);
        setMarket(marketData.items.slice(0, 3));
        setModels(modelData.models);
        setDemo(modelData.demo);
        setModel(String(overviewData.workspace.settings.defaultModel || modelData.models[0]?.id || ''));
        setAgentId('');
      })
      .catch((caught) => toast.push(errorMessage(caught), 'error'))
      .finally(() => setLoading(false));
  }, [workspace, toast]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(160, Math.max(72, textarea.scrollHeight))}px`;
  }, [prompt]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

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

  const activeAgent = agents.find((agent) => agent.id === agentId);
  const activeModel = models.find((item) => item.id === model);
  const recent = overview?.recentChats ?? [];
  const suggestions = SUGGESTIONS[mode] ?? SUGGESTIONS.office;

  return (
    <div className="home-wrap fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="eyebrow">{greeting()}，{user?.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {demo && <Link to="/app/settings" className="badge badge-warn" title="未配置模型，点击查看设置"><Zap size={10} />演示模式</Link>}
          <span className="badge badge-muted">{workspace?.name}</span>
        </div>
      </div>

      <div className="hero-kicker" style={{ marginBottom: 12 }}>
        <span className="badge badge-accent"><Sparkles size={11} /> ORBITWORK AGENT</span>
      </div>
      <h1 className="hero-title">OrbitWork<span className="accent">，我帮你</span></h1>
      <p className="hero-sub">从一句话开始。选择智能体、模型与工作区上下文，剩下的交给一支会使用工具的团队。</p>

      <div className="composer-shell">
        <div className="composer-main">
          <textarea
            ref={textareaRef}
            className="composer-textarea"
            placeholder="描述你想完成的任务，越具体越好…"
            aria-label="描述任务"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
        </div>
        <div className="composer-toolbar">
          <div className="composer-tools">
            <div style={{ position: 'relative' }}>
              <button className="composer-select" onClick={() => { setAgentMenu((value) => !value); setModelMenu(false); }}>
                <Bot size={13} />{activeAgent?.name ?? '通用助理'}<ChevronDown size={11} />
              </button>
              {agentMenu && (
                <div className="card fade-in" style={{ position: 'absolute', bottom: 'calc(100% + 7px)', left: 0, width: 230, zIndex: 30, padding: 5, boxShadow: '0 18px 50px rgba(0,0,0,.5)' }}>
                  <button className="nav-item" onClick={() => { setAgentId(''); setAgentMenu(false); }}>
                    <Sparkles size={14} /><span style={{ flex: 1 }}>通用助理</span>{!agentId && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />}
                  </button>
                  {agents.map((agent) => (
                    <button key={agent.id} className="nav-item" onClick={() => { setAgentId(agent.id); setAgentMenu(false); }}>
                      <Icon name={agent.icon} size={14} /><span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.name}</span>
                      {agentId === agent.id && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />}
                    </button>
                  ))}
                  <div className="divider" style={{ margin: '4px 0' }} />
                  <Link to="/app/agents" className="nav-item" style={{ fontSize: 11.5 }}><Plus size={13} />管理智能体</Link>
                </div>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <button className="composer-select" onClick={() => { setModelMenu((value) => !value); setAgentMenu(false); }}>
                <Cpu size={13} />{activeModel?.label ?? model ?? '选择模型'}<ChevronDown size={11} />
              </button>
              {modelMenu && (
                <div className="card fade-in" style={{ position: 'absolute', bottom: 'calc(100% + 7px)', left: 0, width: 220, zIndex: 30, padding: 5, boxShadow: '0 18px 50px rgba(0,0,0,.5)' }}>
                  {models.map((item) => (
                    <button key={item.id} className="nav-item" onClick={() => { setModel(item.id); setModelMenu(false); }}>
                      <Cpu size={14} /><span style={{ flex: 1 }}>{item.label}</span>{model === item.id && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="composer-select" style={{ color: 'var(--faint)', cursor: 'default' }}><Globe2 size={12} />{workspace?.name}</span>
            <span className="composer-select" style={{ color: 'var(--faint)', cursor: 'default' }}><AtSign size={12} />工作区上下文</span>
          </div>
          <button className="send-btn" onClick={() => void send()} disabled={!prompt.trim() || sending} aria-label="发送">
            {sending ? <Loader2 size={16} className="spin" /> : <ArrowUp size={17} />}
          </button>
        </div>
      </div>

      <div className="quick-row">
        {QUICK_ACTIONS.map((action) => (
          <button key={action} className="chip" onClick={() => { setPrompt(`帮我${action}：`); textareaRef.current?.focus(); }}>
            {action}
          </button>
        ))}
      </div>

      <div className="mode-pills">
        {MODES.map(({ id, label, icon: ModeIcon }) => (
          <button key={id} className={cn('mode-pill', mode === id && 'active')} onClick={() => setMode(id)}>
            <ModeIcon size={13} />{label}
          </button>
        ))}
      </div>

      <div className="home-grid">
        <div>
          <div className="section-head">
            <span className="section-title">继续最近的任务</span>
            <span className="badge badge-muted">仅你可见</span>
          </div>
          <div className="card">
            {loading ? (
              <div style={{ padding: 24, display: 'grid', gap: 12 }}><div className="skeleton" style={{ height: 36 }} /><div className="skeleton" style={{ height: 36 }} /></div>
            ) : recent.length ? recent.slice(0, 4).map((chat) => (
              <Link key={chat.id} to={`/app/c/${chat.id}`} className="recent-card">
                <div className="recent-icon"><Icon name={chat.agent_icon || 'message-square'} size={15} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{chat.title}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 3 }}>{chat.agent_name || '通用助理'} · {relativeTime(chat.updated_at)}</div>
                </div>
                <ArrowRight size={13} color="var(--faint)" />
              </Link>
            )) : (
              <EmptyState
                icon={<MessageSquareText size={19} />}
                title="还没有进行中的任务"
                description="从上面的输入框开始，或安装一个市场里的专家。"
                action={<Link to="/app/market" className="btn btn-sm"><Store size={13} />逛插件市场</Link>}
              />
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
            {[
              { label: '会话', value: overview?.stats.chats ?? 0 },
              { label: '智能体', value: overview?.stats.agents ?? 0 },
              { label: 'Token 用量', value: overview ? compactNumber(overview.usage.tokens_in + overview.usage.tokens_out) : '0' },
            ].map((item) => (
              <div key={item.label} className="card" style={{ padding: '13px 14px' }}>
                <div style={{ fontSize: 20, fontWeight: 680, letterSpacing: '-.03em' }}>{item.value}</div>
                <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 2 }}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="section-head">
            <span className="section-title">从一张能力卡片开始</span>
            <Link to="/app/market" className="btn btn-ghost btn-sm">市场 <ArrowRight size={12} /></Link>
          </div>
          <div className="card">
            <div className="market-mini">
              {market.length ? market.map((item) => (
                <Link key={item.id} to="/app/market" className="market-mini-item">
                  <div className="asset-ico"><Icon name={item.icon} size={15} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 550 }}>{item.name}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 2 }}>{item.kind === 'expert' ? '专家' : item.kind === 'skill' ? '技能' : item.kind === 'connector' ? '连接器' : '插件'} · {compactNumber(item.installs)} 次安装</div>
                  </div>
                  <Badge tone={item.featured ? 'accent' : 'muted'}>{item.featured ? '精选' : '安装'}</Badge>
                </Link>
              )) : <div style={{ padding: 16, color: 'var(--faint)', fontSize: 12 }}>市场正在准备中。</div>}
            </div>
          </div>

          <div className="card" style={{ marginTop: 12, padding: 16, background: 'linear-gradient(145deg, rgba(200,247,104,.06), rgba(200,247,104,.01))', borderColor: 'rgba(200,247,104,.15)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent)', fontSize: 11, fontWeight: 650 }}><WandSparkles size={14} />让能力可复用</div>
            <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.65, margin: '9px 0 0' }}>把你的方法沉淀为技能，绑定到专家，再发布成插件。团队下一次就不用从零开始。</p>
            <Link to="/app/skills" className="btn btn-sm" style={{ marginTop: 13 }}>创建第一个技能 <ArrowRight size={12} /></Link>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 32, textAlign: 'center' }}>
        {suggestions.map((suggestion) => (
          <button key={suggestion} className="recent-item" style={{ display: 'inline-flex', width: 'auto', margin: 3, padding: '6px 10px', fontSize: 11 }} onClick={() => { setPrompt(suggestion); textareaRef.current?.focus(); }}>
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
