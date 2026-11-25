import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, BrainCircuit, ChevronRight, Code2, Database, Plus, Sparkles, Trash2, Users, Wand2, Wrench } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { Agent, Asset, ModelOption } from '@/lib/types';
import { Badge, ConfirmModal, EmptyState, ErrorState, Field, Modal, PageHeader, Spinner, Toggle } from '@/components/UI';
import { Icon } from '@/components/Icon';
import { cn, relativeTime } from '@/lib/utils';

type AgentForm = {
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  icon: string;
  color: string;
  skillIds: string[];
  connectorIds: string[];
  memoryEnabled: boolean;
  sandboxEnabled: boolean;
};

const EMPTY_FORM: AgentForm = {
  name: '', description: '', systemPrompt: '', model: '', icon: 'sparkles', color: '#c8f768',
  skillIds: [], connectorIds: [], memoryEnabled: true, sandboxEnabled: true,
};

const ICON_CHOICES = ['sparkles', 'bot', 'telescope', 'graduation-cap', 'code', 'pen-tool', 'trending-up', 'database'];
const COLOR_CHOICES = ['#c8f768', '#8bd3ff', '#f7c873', '#ff9f80', '#c4a7ff'];

export default function AgentsPage() {
  const { workspace } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Asset[]>([]);
  const [connectors, setConnectors] = useState<Asset[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [form, setForm] = useState<AgentForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Agent | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const load = async () => {
    if (!workspace) return;
    setLoading(true);
    setLoadError('');
    try {
      const [agentData, skillData, connectorData, modelData] = await Promise.all([
        api.get<{ agents: Agent[] }>(`/api/w/${workspace.id}/agents`),
        api.get<{ assets: Asset[] }>(`/api/w/${workspace.id}/assets?kind=skill`),
        api.get<{ assets: Asset[] }>(`/api/w/${workspace.id}/assets?kind=connector`),
        api.get<{ models: ModelOption[] }>('/api/models'),
      ]);
      setAgents(agentData.agents);
      setSkills(skillData.assets);
      setConnectors(connectorData.assets);
      setModels(modelData.models);
    } catch (caught) {
      setLoadError(errorMessage(caught));
      toast.push(errorMessage(caught), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [workspace]);

  function startCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, model: models[0]?.id ?? '' });
    setOpen(true);
  }

  function startEdit(agent: Agent) {
    setEditing(agent);
    setForm({
      name: agent.name, description: agent.description, systemPrompt: agent.systemPrompt, model: agent.model,
      icon: agent.icon, color: agent.color, skillIds: agent.skillIds, connectorIds: agent.connectorIds,
      memoryEnabled: agent.memoryEnabled, sandboxEnabled: agent.sandboxEnabled,
    });
    setOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/api/w/${workspace.id}/agents/${editing.id}`, form);
        toast.push('智能体已更新', 'success');
      } else {
        await api.post(`/api/w/${workspace.id}/agents`, form);
        toast.push('智能体已创建', 'success');
      }
      setOpen(false);
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!workspace || !deleting) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/api/w/${workspace.id}/agents/${deleting.id}`);
      setDeleting(null);
      await load();
      toast.push('智能体已删除', 'success');
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setDeleteLoading(false);
    }
  }

  async function startChat(agent: Agent) {
    if (!workspace) return;
    try {
      const result = await api.post<{ chat: { id: string } }>(`/api/w/${workspace.id}/chats`, { agentId: agent.id });
      window.dispatchEvent(new Event('orbit:chats-changed'));
      navigate(`/app/c/${result.chat.id}`);
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    }
  }

  function toggleId(key: 'skillIds' | 'connectorIds', id: string) {
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(id) ? current[key].filter((item) => item !== id) : [...current[key], id],
    }));
  }

  return (
    <div className="page-wrap fade-in">
      <PageHeader
        eyebrow="Agents"
        title="智能体"
        subtitle="把角色、模型、技能、连接器与记忆组合成可复用的工作伙伴。"
        actions={
          <>
            <button className="btn" onClick={() => navigate('/app/experts')}><Users size={14} />从专家启用</button>
            <button className="btn btn-primary" onClick={startCreate}><Plus size={14} />新建智能体</button>
          </>
        }
      />

      {loading ? (
        <div className="grid-3">{Array.from({ length: 3 }).map((_, index) => <div className="skeleton" key={index} style={{ height: 184 }} />)}</div>
      ) : loadError ? (
        <div className="card"><ErrorState message={loadError} onRetry={() => void load()} /></div>
      ) : agents.length === 0 ? (
        <div className="card"><EmptyState icon={<Bot size={20} />} title="还没有智能体" description="创建一个专属角色，或从插件市场安装专家后一键启用。" action={<button className="btn btn-primary btn-sm" onClick={startCreate}><Plus size={13} />创建智能体</button>} /></div>
      ) : (
        <div className="grid-3">
          {agents.map((agent) => (
            <div key={agent.id} className="card card-hover agent-card">
              <div className="agent-card-top">
                <div style={{ width: 37, height: 37, borderRadius: 11, display: 'grid', placeItems: 'center', color: agent.color, background: `${agent.color}14`, border: `1px solid ${agent.color}26` }}>
                  <Icon name={agent.icon} size={18} />
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => startEdit(agent)}>编辑</button>
                  <button className="btn btn-ghost btn-icon btn-sm" style={{ width: 28 }} onClick={() => setDeleting(agent)} aria-label="删除"><Trash2 size={12} /></button>
                </div>
              </div>
              <h3>{agent.name}</h3>
              <p>{agent.description || '未填写描述'}</p>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 12 }}>
                <Badge tone="muted"><Icon name="sparkles" size={9} />{models.find((m) => m.id === agent.model)?.label ?? '默认模型'}</Badge>
                {agent.memoryEnabled && <Badge tone="accent"><BrainCircuit size={9} />记忆</Badge>}
                {agent.sandboxEnabled && <Badge tone="sky"><Code2 size={9} />沙箱</Badge>}
                {agent.skillIds.length > 0 && <Badge tone="muted"><Wand2 size={9} />{agent.skillIds.length} 技能</Badge>}
                {agent.connectorIds.length > 0 && <Badge tone="muted"><Wrench size={9} />{agent.connectorIds.length} 工具</Badge>}
              </div>
              <div className="agent-card-foot">
                <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => void startChat(agent)}>开始对话 <ChevronRight size={12} /></button>
                <span style={{ fontSize: 9.5, color: 'var(--faint)' }}>{relativeTime(agent.updatedAt)}</span>
              </div>
            </div>
          ))}
          <button className="card card-hover" style={{ minHeight: 184, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--faint)', borderStyle: 'dashed' }} onClick={startCreate}>
            <Plus size={20} /><span style={{ fontSize: 12 }}>新建智能体</span>
          </button>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? '编辑智能体' : '新建智能体'}
        subtitle="角色指令决定行为，技能与连接器扩展能力边界。"
        large
        footer={<><button className="btn" onClick={() => setOpen(false)}>取消</button><button className="btn btn-primary" form="agent-form" disabled={saving}>{saving ? <Spinner size={13} /> : null}{editing ? '保存修改' : '创建智能体'}</button></>}
      >
        <form id="agent-form" onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          <div className="grid-2">
            <Field label="名称"><input className="input" required maxLength={48} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：增长分析师" /></Field>
            <Field label="默认模型">
              <select className="select" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })}>
                <option value="">跟随工作区默认</option>
                {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="一句话描述"><input className="input" maxLength={240} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="它擅长什么？适合什么任务？" /></Field>
          <Field label="角色指令" hint="系统提示词，会与工作区上下文、记忆和技能一起注入。">
            <textarea className="textarea" rows={6} value={form.systemPrompt} onChange={(event) => setForm({ ...form, systemPrompt: event.target.value })} placeholder="你是一位……先……再……。输出必须……" />
          </Field>
          <div>
            <div className="label" style={{ marginBottom: 7 }}>图标与颜色</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ICON_CHOICES.map((name) => (
                <button type="button" key={name} className={cn('chip', form.icon === name && 'chip-active')} style={{ width: 34, padding: 0, justifyContent: 'center' }} onClick={() => setForm({ ...form, icon: name })} aria-label={name}>
                  <Icon name={name} size={14} />
                </button>
              ))}
              <span style={{ width: 1, background: 'var(--line)', margin: '0 3px' }} />
              {COLOR_CHOICES.map((color) => (
                <button type="button" key={color} onClick={() => setForm({ ...form, color })} aria-label={color} style={{ width: 19, height: 19, borderRadius: '50%', background: color, border: form.color === color ? '2px solid #fff' : '2px solid transparent', margin: 5 }} />
              ))}
            </div>
          </div>
          <div className="grid-2">
            <div>
              <div className="label" style={{ marginBottom: 7 }}>绑定技能</div>
              <div style={{ border: '1px solid var(--line)', borderRadius: 10, maxHeight: 150, overflowY: 'auto', padding: 4 }}>
                {skills.length === 0 ? <div className="hint" style={{ padding: 8 }}>尚未创建技能</div> : skills.map((skill) => (
                  <button type="button" key={skill.id} className="nav-item" onClick={() => toggleId('skillIds', skill.id)}>
                    <span className={cn('toggle', form.skillIds.includes(skill.id) && 'on')} style={{ transform: 'scale(.72)', marginRight: -4 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill.name}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="label" style={{ marginBottom: 7 }}>绑定连接器</div>
              <div style={{ border: '1px solid var(--line)', borderRadius: 10, maxHeight: 150, overflowY: 'auto', padding: 4 }}>
                {connectors.length === 0 ? <div className="hint" style={{ padding: 8 }}>尚未创建连接器</div> : connectors.map((connector) => (
                  <button type="button" key={connector.id} className="nav-item" onClick={() => toggleId('connectorIds', connector.id)}>
                    <span className={cn('toggle', form.connectorIds.includes(connector.id) && 'on')} style={{ transform: 'scale(.72)', marginRight: -4 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{connector.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11, border: '1px solid var(--line)', borderRadius: 10, padding: 13 }}>
            <Toggle checked={form.memoryEnabled} onChange={(value) => setForm({ ...form, memoryEnabled: value })} label="启用长期记忆（自动注入相关记忆，并提供 save_memory 工具）" />
            <Toggle checked={form.sandboxEnabled} onChange={(value) => setForm({ ...form, sandboxEnabled: value })} label="启用代码沙箱（无网络、只读、6 秒超时）" />
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove()}
        title="删除智能体"
        description={`确定删除「${deleting?.name ?? ''}」吗？历史会话会保留，但智能体配置将无法恢复。`}
        loading={deleteLoading}
      />
    </div>
  );
}
