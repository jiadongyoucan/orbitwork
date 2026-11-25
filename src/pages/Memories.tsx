import { useEffect, useState } from 'react';
import { BrainCircuit, Filter, Plus, Search, Sparkles, Trash2, UserRound } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { Agent, Memory } from '@/lib/types';
import { Badge, ConfirmModal, EmptyState, ErrorState, Field, Modal, PageHeader, Spinner } from '@/components/UI';
import { formatDate } from '@/lib/utils';

const SUGGESTED = [
  { title: '品牌语气', content: '专业、克制、具体；避免「颠覆」「赋能」等空泛词。', tags: ['品牌'] },
  { title: '目标用户', content: '5-50 人的出海 SaaS 团队，最在意少开会、快验证。', tags: ['定位'] },
  { title: '输出规范', content: '所有方案先给结论，再给依据；数据必须标注口径与来源。', tags: ['规范'] },
];

export default function MemoriesPage() {
  const { workspace } = useAuth();
  const toast = useToast();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'all' | 'workspace' | 'agent'>('all');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Memory | null>(null);
  const [form, setForm] = useState({ title: '', content: '', scope: 'workspace' as 'workspace' | 'agent', agentId: '', tags: '' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Memory | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function load() {
    if (!workspace) return;
    setLoading(true);
    setLoadError('');
    try {
      const [memoryData, agentData] = await Promise.all([
        api.get<{ memories: Memory[] }>(`/api/w/${workspace.id}/memories`),
        api.get<{ agents: Agent[] }>(`/api/w/${workspace.id}/agents`),
      ]);
      setMemories(memoryData.memories);
      setAgents(agentData.agents);
    } catch (caught) {
      setLoadError(errorMessage(caught));
      toast.push(errorMessage(caught), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [workspace]);

  function startCreate(suggested?: { title: string; content: string; tags: string[] }) {
    setEditing(null);
    setForm({ title: suggested?.title ?? '', content: suggested?.content ?? '', scope: 'workspace', agentId: '', tags: suggested?.tags.join(', ') ?? '' });
    setOpen(true);
  }

  function startEdit(memory: Memory) {
    setEditing(memory);
    setForm({ title: memory.title, content: memory.content, scope: memory.scope, agentId: memory.agentId ?? '', tags: memory.tags.join(', ') });
    setOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    setSaving(true);
    try {
      const body = {
        title: form.title, content: form.content, scope: form.scope,
        agentId: form.scope === 'agent' ? form.agentId : null,
        tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      };
      if (editing) await api.patch(`/api/w/${workspace.id}/memories/${editing.id}`, body);
      else await api.post(`/api/w/${workspace.id}/memories`, body);
      toast.push(editing ? '记忆已更新' : '记忆已保存', 'success');
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
      await api.delete(`/api/w/${workspace.id}/memories/${deleting.id}`);
      setDeleting(null);
      await load();
      toast.push('记忆已删除', 'success');
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setDeleteLoading(false);
    }
  }

  const filtered = memories.filter((memory) => {
    if (scope !== 'all' && memory.scope !== scope) return false;
    if (!q.trim()) return true;
    const text = `${memory.title} ${memory.content} ${memory.tags.join(' ')}`.toLowerCase();
    return text.includes(q.trim().toLowerCase());
  });

  return (
    <div className="page-wrap fade-in">
      <PageHeader
        eyebrow="Memory"
        title="记忆"
        subtitle="让智能体记住团队事实、偏好与决策。记忆按工作区隔离，可显式编辑和删除。"
        actions={<button className="btn btn-primary" onClick={() => startCreate()}><Plus size={14} />添加记忆</button>}
      />

      <div className="card" style={{ padding: '14px 16px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(200,247,104,.03)', borderColor: 'rgba(200,247,104,.13)' }}>
        <BrainCircuit size={18} color="var(--accent)" />
        <div style={{ flex: 1, fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6 }}>
          每次对话会按关键词注入最多 6 条相关记忆；智能体也可通过 <span className="mono">save_memory</span> 工具主动保存。此实现不依赖向量数据库，保持单机部署简单可控。
        </div>
        <Badge tone="accent">LIKE 检索</Badge>
      </div>

      <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="segmented">
          {[['all', '全部'], ['workspace', '工作区'], ['agent', '智能体']].map(([value, label]) => (
            <button key={value} className={scope === value ? 'active' : ''} onClick={() => setScope(value as typeof scope)}>{label}</button>
          ))}
        </div>
        <div className="search"><Search size={14} /><input className="input" placeholder="搜索标题、内容或标签…" value={q} onChange={(event) => setQ(event.target.value)} /></div>
      </div>

      {loading ? (
        <div className="grid-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="skeleton" style={{ height: 130 }} />)}</div>
      ) : loadError ? (
        <div className="card"><ErrorState message={loadError} onRetry={() => void load()} /></div>
      ) : filtered.length === 0 ? (
        <div className="card"><EmptyState icon={<BrainCircuit size={20} />} title={memories.length ? '没有匹配的记忆' : '还没有记忆'} description="从一条团队共识开始，让后续对话更贴近真实上下文。" action={<button className="btn btn-sm btn-primary" onClick={() => startCreate()}>添加第一条</button>} /></div>
      ) : (
        <div className="grid-2">
          {filtered.map((memory) => {
            const agent = agents.find((item) => item.id === memory.agentId);
            return (
              <div key={memory.id} className="card card-hover" style={{ padding: 17 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="asset-ico" style={{ width: 28, height: 28 }}>{memory.scope === 'agent' ? <UserRound size={13} /> : <Sparkles size={13} />}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 620 }}>{memory.title}</div>
                      <div style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 2 }}>{memory.scope === 'agent' ? agent?.name ?? '智能体记忆' : '工作区共享'} · {formatDate(memory.updatedAt)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => startEdit(memory)}>编辑</button>
                    <button className="btn btn-ghost btn-icon btn-sm" style={{ width: 27 }} onClick={() => setDeleting(memory)} aria-label="删除"><Trash2 size={11} /></button>
                  </div>
                </div>
                <p style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.7, margin: '12px 0 0', whiteSpace: 'pre-wrap' }}>{memory.content}</p>
                {memory.tags.length > 0 && <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 11 }}>{memory.tags.map((tag) => <span key={tag} className="badge badge-muted">#{tag}</span>)}</div>}
              </div>
            );
          })}
        </div>
      )}

      {memories.length === 0 && !loading && (
        <div style={{ marginTop: 18 }}>
          <div className="label" style={{ marginBottom: 8 }}>从模板开始</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {SUGGESTED.map((item) => <button key={item.title} className="chip" onClick={() => startCreate(item)}><Plus size={11} />{item.title}</button>)}
          </div>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? '编辑记忆' : '添加记忆'}
        subtitle="写得越具体，被正确注入的概率越高。"
        footer={<><button className="btn" onClick={() => setOpen(false)}>取消</button><button className="btn btn-primary" form="memory-form" disabled={saving}>{saving ? <Spinner size={13} /> : null}{editing ? '保存' : '添加'}</button></>}
      >
        <form id="memory-form" onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="标题"><input className="input" required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="例如：Q4 北极星指标" /></Field>
          <Field label="内容"><textarea className="textarea" required rows={6} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} placeholder="完整、自包含的事实或决策…" /></Field>
          <div className="grid-2">
            <Field label="作用域">
              <select className="select" value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value as 'workspace' | 'agent' })}>
                <option value="workspace">整个工作区</option>
                <option value="agent">指定智能体</option>
              </select>
            </Field>
            {form.scope === 'agent' ? (
              <Field label="智能体">
                <select className="select" required value={form.agentId} onChange={(event) => setForm({ ...form, agentId: event.target.value })}>
                  <option value="">选择智能体</option>
                  {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              </Field>
            ) : <div />}
          </div>
          <Field label="标签" hint="用逗号分隔"><input className="input" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="定位, 目标" /></Field>
        </form>
      </Modal>

      <ConfirmModal open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={() => void remove()} title="删除记忆" description={`确定删除「${deleting?.title ?? ''}」吗？此操作不可恢复。`} loading={deleteLoading} />
    </div>
  );
}
