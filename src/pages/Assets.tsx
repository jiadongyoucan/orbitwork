import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  BookOpen, Check, ChevronRight, CloudUpload, Code2, ExternalLink, Globe2, KeyRound, Plus,
  Rocket, Send, Sparkles, Store, Trash2, Wand2, Wrench, X,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { Asset, AssetKind, ModelOption } from '@/lib/types';
import { Badge, ConfirmModal, EmptyState, ErrorState, Field, Modal, PageHeader, Spinner } from '@/components/UI';
import { Icon } from '@/components/Icon';
import { cn, compactNumber, relativeTime, safeJson } from '@/lib/utils';

type KindConfig = {
  kind: AssetKind;
  title: string;
  eyebrow: string;
  subtitle: string;
  createLabel: string;
  icon: string;
  category: string;
  empty: string;
};

const CONFIG: Record<'experts' | 'skills' | 'connectors', KindConfig> = {
  experts: {
    kind: 'expert', title: '专家', eyebrow: 'Experts', subtitle: '把资深角色的判断方式封装起来，一键启用为智能体。',
    createLabel: '新建专家', icon: 'graduation-cap', category: '咨询', empty: '还没有专家。创建专家，或到插件市场安装。',
  },
  skills: {
    kind: 'skill', title: '技能', eyebrow: 'Skills', subtitle: '可复用的方法、流程与输出规范，注入到任意智能体。',
    createLabel: '新建技能', icon: 'book-open', category: '方法', empty: '还没有技能。把团队方法论写下来，让每次对话都更稳定。',
  },
  connectors: {
    kind: 'connector', title: '连接器', eyebrow: 'Connectors', subtitle: '用标准 HTTP 工具连接第三方服务，密钥加密存储。',
    createLabel: '新建连接器', icon: 'plug', category: '集成', empty: '还没有连接器。连接一个 API，让智能体真正能执行动作。',
  },
};

type SecretRow = { key: string; value: string };

type FormState = {
  name: string;
  summary: string;
  description: string;
  category: string;
  icon: string;
  version: string;
  systemPrompt: string;
  model: string;
  instructions: string;
  outputFormat: string;
  method: 'GET' | 'POST';
  url: string;
  toolName: string;
  toolDescription: string;
  parameters: string;
  secrets: SecretRow[];
};

function blankForm(kind: AssetKind): FormState {
  return {
    name: '', summary: '', description: '', category: CONFIG.experts.category, icon: kind === 'expert' ? 'graduation-cap' : kind === 'skill' ? 'book-open' : 'plug',
    version: '1.0.0', systemPrompt: '', model: '', instructions: '', outputFormat: '',
    method: 'POST', url: '', toolName: '', toolDescription: '', parameters: '{\n  "type": "object",\n  "properties": {}\n}', secrets: [{ key: '', value: '' }],
  };
}

function AssetPage({ scope }: { scope: 'experts' | 'skills' | 'connectors' }) {
  const meta = CONFIG[scope];
  const { workspace, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [canPublish, setCanPublish] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [form, setForm] = useState<FormState>(blankForm(meta.kind));
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState<Asset | null>(null);
  const [publishVersion, setPublishVersion] = useState('1.0.0');
  const [publishLoading, setPublishLoading] = useState(false);
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const load = async () => {
    if (!workspace) return;
    setLoading(true);
    setLoadError('');
    try {
      const [assetData, modelData, settingData] = await Promise.all([
        api.get<{ assets: Asset[] }>(`/api/w/${workspace.id}/assets?kind=${meta.kind}`),
        api.get<{ models: ModelOption[] }>(`/api/w/${workspace.id}/models`),
        api.get<{ role: string; settings: { allowMemberPublish?: boolean } }>(`/api/w/${workspace.id}/settings`),
      ]);
      setAssets(assetData.assets);
      setModels(modelData.models);
      setCanPublish(settingData.role !== 'member' || settingData.settings.allowMemberPublish !== false);
    } catch (caught) {
      setLoadError(errorMessage(caught));
      toast.push(errorMessage(caught), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [workspace, meta.kind]);

  function startCreate() {
    setEditing(null);
    setForm({ ...blankForm(meta.kind), category: meta.category });
    setOpen(true);
  }

  function startEdit(asset: Asset) {
    setEditing(asset);
    setForm({
      ...blankForm(meta.kind),
      name: asset.name, summary: asset.summary, description: asset.description, category: asset.category,
      icon: asset.icon, version: asset.version,
      systemPrompt: String(asset.payload.systemPrompt ?? ''),
      model: String(asset.payload.model ?? ''),
      instructions: String(asset.payload.instructions ?? ''),
      outputFormat: String(asset.payload.outputFormat ?? ''),
      method: (asset.payload.method === 'GET' ? 'GET' : 'POST'),
      url: String(asset.payload.url ?? ''),
      toolName: String(asset.payload.toolName ?? ''),
      toolDescription: String(asset.payload.description ?? ''),
      parameters: safeJson(asset.payload.parameters ?? { type: 'object', properties: {} }),
      secrets: (asset.secretKeys ?? []).map((key) => ({ key, value: '' })),
    });
    setOpen(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    setSaving(true);
    try {
      let payload: Record<string, unknown>;
      if (meta.kind === 'expert') {
        payload = { role: form.category, systemPrompt: form.systemPrompt, model: form.model || undefined };
      } else if (meta.kind === 'skill') {
        payload = { instructions: form.instructions, outputFormat: form.outputFormat };
      } else {
        let parameters: Record<string, unknown>;
        try {
          parameters = JSON.parse(form.parameters || '{}');
        } catch {
          throw new Error('参数 Schema 不是合法的 JSON');
        }
        payload = { method: form.method, url: form.url, toolName: form.toolName, description: form.toolDescription, parameters };
      }
      const secrets = Object.fromEntries(form.secrets.filter((row) => row.key.trim() && row.value.trim()).map((row) => [row.key.trim(), row.value]));
      const body = { kind: meta.kind, name: form.name, summary: form.summary, description: form.description, category: form.category, icon: form.icon, version: form.version, payload, ...(Object.keys(secrets).length ? { secrets } : {}) };
      if (editing) {
        await api.patch(`/api/w/${workspace.id}/assets/${editing.id}`, body);
        toast.push(`${meta.title}已更新，发布状态已回到草稿`, 'success');
      } else {
        await api.post(`/api/w/${workspace.id}/assets`, body);
        toast.push(`${meta.title}已创建`, 'success');
      }
      setOpen(false);
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!workspace || !publishing) return;
    setPublishLoading(true);
    try {
      await api.post(`/api/w/${workspace.id}/assets/${publishing.id}/publish`, { version: publishVersion });
      toast.push('已发布到插件市场', 'success');
      setPublishing(null);
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setPublishLoading(false);
    }
  }

  async function remove() {
    if (!workspace || !deleting) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/api/w/${workspace.id}/assets/${deleting.id}`);
      toast.push('已删除', 'success');
      setDeleting(null);
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setDeleteLoading(false);
    }
  }

  async function hire(asset: Asset) {
    if (!workspace) return;
    try {
      const result = await api.post<{ agentId: string }>(`/api/w/${workspace.id}/assets/${asset.id}/hire`);
      const chat = await api.post<{ chat: { id: string } }>(`/api/w/${workspace.id}/chats`, { agentId: result.agentId });
      window.dispatchEvent(new Event('orbit:chats-changed'));
      navigate(`/app/c/${chat.chat.id}`);
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    }
  }

  const canEdit = (asset: Asset) => user?.platformRole === 'admin' || workspace?.role !== 'member' || asset.authorId === user?.id;

  return (
    <div className="page-wrap fade-in">
      <PageHeader
        eyebrow="Capability library"
        title="能力库"
        subtitle="专家、技能与连接器。创建自己的方法，或从市场安装团队验证过的能力。"
        actions={
          <>
            <button className="btn" onClick={() => navigate('/app/market')}><Store size={14} />从市场安装</button>
            <button className="btn btn-primary" onClick={startCreate}><Plus size={14} />{meta.createLabel}</button>
          </>
        }
      />
      <div className="capability-tabs">
        {(['experts', 'skills', 'connectors'] as const).map((key) => (
          <NavLink key={key} to={`/app/${key}`} className={({ isActive }) => cn('capability-tab', isActive && 'active')}>
            {CONFIG[key].title}
          </NavLink>
        ))}
      </div>

      {loading ? (
        <div className="grid-3">{Array.from({ length: 3 }).map((_, index) => <div className="skeleton" key={index} style={{ height: 180 }} />)}</div>
      ) : loadError ? (
        <div className="card"><ErrorState message={loadError} onRetry={() => void load()} /></div>
      ) : assets.length === 0 ? (
        <div className="card"><EmptyState icon={<Icon name={meta.icon} size={20} />} title={meta.empty} description="你可以创建自己的版本，也可以从市场安装别人发布的能力。" action={<button className="btn btn-primary btn-sm" onClick={startCreate}><Plus size={13} />{meta.createLabel}</button>} /></div>
      ) : (
        <div className="grid-3">
          {assets.map((asset) => (
            <div className="card card-hover asset-card" key={asset.id}>
              <div className="asset-card-head">
                <div className="asset-ico"><Icon name={asset.icon} size={16} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <h3>{asset.name}</h3>
                    {asset.status === 'published' ? <Badge tone="accent">已发布</Badge> : asset.status === 'suspended' ? <Badge tone="danger">已下架</Badge> : <Badge tone="muted">草稿</Badge>}
                    {asset.sourceAssetId && <Badge tone="sky">已安装</Badge>}
                  </div>
                  <p className="summary">{asset.summary || '未填写简介'}</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', fontSize: 10 }}>
                <span className="badge badge-muted">{asset.category}</span>
                <span className="badge badge-muted">v{asset.version}</span>
                {asset.installs > 0 && <span className="badge badge-muted">{compactNumber(asset.installs)} 安装</span>}
                {asset.secretKeys.length > 0 && <span className="badge badge-sky"><KeyRound size={9} />{asset.secretKeys.length} 密钥</span>}
              </div>
              <div className="asset-foot">
                <span style={{ fontSize: 9.5, color: 'var(--faint)' }}>{relativeTime(asset.updatedAt)} · {asset.authorName}</span>
                <div style={{ display: 'flex', gap: 3 }}>
                  {meta.kind === 'expert' && <button className="btn btn-sm" onClick={() => void hire(asset)}>启用 <ChevronRight size={11} /></button>}
                  {canEdit(asset) && <button className="btn btn-sm btn-ghost" onClick={() => startEdit(asset)}>编辑</button>}
                  {canEdit(asset) && canPublish && asset.status !== 'published' && asset.status !== 'suspended' && <button className="btn btn-sm btn-ghost" onClick={() => { setPublishing(asset); setPublishVersion(asset.version); }} title="发布到市场"><CloudUpload size={13} /></button>}
                  {canEdit(asset) && asset.installs === 0 && <button className="btn btn-sm btn-ghost" style={{ width: 28, padding: 0 }} onClick={() => setDeleting(asset)} aria-label="删除"><Trash2 size={12} /></button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `编辑${meta.title}` : meta.createLabel}
        subtitle="保存为草稿；发布时会生成不可变版本快照。"
        large
        footer={<><button className="btn" onClick={() => setOpen(false)}>取消</button><button className="btn btn-primary" form="asset-form" disabled={saving}>{saving ? <Spinner size={13} /> : <Check size={13} />}{editing ? '保存' : '创建草稿'}</button></>}
      >
        <form id="asset-form" onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="grid-2">
            <Field label="名称"><input className="input" required maxLength={48} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={meta.kind === 'expert' ? '例如：定价策略顾问' : meta.kind === 'skill' ? '例如：竞品拆解框架' : '例如：CRM 查询'} /></Field>
            <Field label="分类"><input className="input" maxLength={32} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></Field>
          </div>
          <Field label="简介" hint="至少 8 个字，发布时会展示在市场卡片上。"><input className="input" maxLength={180} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} placeholder="一句话说明它解决什么问题" /></Field>
          <Field label="详细说明"><textarea className="textarea" rows={2} maxLength={4000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="适用场景、输入输出、注意事项" /></Field>

          {meta.kind === 'expert' && (
            <>
              <div className="grid-2">
                <Field label="角色标签"><input className="input" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></Field>
                <Field label="推荐模型">
                  <select className="select" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })}>
                    <option value="">跟随工作区默认</option>
                    {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="专家系统提示词" hint="描述角色、方法、输出标准与边界，至少 20 字。">
                <textarea className="textarea" required minLength={20} rows={8} value={form.systemPrompt} onChange={(event) => setForm({ ...form, systemPrompt: event.target.value })} placeholder="你是一位……你的工作方法是……输出必须……" />
              </Field>
            </>
          )}

          {meta.kind === 'skill' && (
            <>
              <Field label="技能指令" hint="会被注入到绑定它的智能体上下文，至少 20 字。">
                <textarea className="textarea" required minLength={20} rows={9} value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} placeholder="## 方法&#10;1. ...&#10;2. ...&#10;&#10;## 输出格式" />
              </Field>
              <Field label="输出格式"><textarea className="textarea" rows={2} value={form.outputFormat} onChange={(event) => setForm({ ...form, outputFormat: event.target.value })} placeholder="例如：Markdown 表格 + 行动清单" /></Field>
            </>
          )}

          {meta.kind === 'connector' && (
            <>
              <div className="grid-2">
                <Field label="HTTP 方法">
                  <select className="select" value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value as 'GET' | 'POST' })}><option value="POST">POST</option><option value="GET">GET</option></select>
                </Field>
                <Field label="工具名称" hint="LLM 调用时使用的函数名，字母数字下划线。">
                  <input className="input mono" required pattern="[a-zA-Z_][a-zA-Z0-9_]{1,40}" value={form.toolName} onChange={(event) => setForm({ ...form, toolName: event.target.value })} placeholder="query_crm" />
                </Field>
              </div>
              <Field label="请求 URL" hint="仅允许 HTTP/HTTPS；默认禁止内网与云元数据地址。"><input className="input mono" required type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://api.example.com/v1/query" /></Field>
              <Field label="工具描述"><input className="input" value={form.toolDescription} onChange={(event) => setForm({ ...form, toolDescription: event.target.value })} placeholder="告诉模型何时调用以及参数含义" /></Field>
              <Field label="参数 JSON Schema">
                <textarea className="textarea mono" rows={7} value={form.parameters} onChange={(event) => setForm({ ...form, parameters: event.target.value })} />
              </Field>
              <Field label="密钥 Headers" hint="加密存储，不回传到浏览器。编辑时留空表示保留已有密钥。">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {form.secrets.map((row, index) => (
                    <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr auto', gap: 6 }}>
                      <input className="input mono" placeholder="Authorization" value={row.key} onChange={(event) => setForm({ ...form, secrets: form.secrets.map((item, i) => i === index ? { ...item, key: event.target.value } : item) })} />
                      <input className="input mono" type="password" placeholder={row.key && editing?.secretKeys.includes(row.key) ? '已保存，留空保持不变' : 'Bearer sk-...'} value={row.value} onChange={(event) => setForm({ ...form, secrets: form.secrets.map((item, i) => i === index ? { ...item, value: event.target.value } : item) })} />
                      <button type="button" className="btn btn-ghost btn-icon" onClick={() => setForm({ ...form, secrets: form.secrets.filter((_, i) => i !== index) })} aria-label="移除"><X size={13} /></button>
                    </div>
                  ))}
                  <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setForm({ ...form, secrets: [...form.secrets, { key: '', value: '' }] })}><Plus size={12} />添加 Header</button>
                </div>
              </Field>
            </>
          )}

          <div className="grid-2">
            <Field label="图标">
              <select className="select" value={form.icon} onChange={(event) => setForm({ ...form, icon: event.target.value })}>
                {['graduation-cap', 'book-open', 'plug', 'shield-check', 'trending-up', 'pen-tool', 'chart-no-axes-combined', 'cloud-sun', 'wrench', 'sparkles'].map((name) => <option value={name} key={name}>{name}</option>)}
              </select>
            </Field>
            <Field label="版本"><input className="input mono" required pattern="\d+\.\d+\.\d+" value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} /></Field>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(publishing)}
        onClose={() => setPublishing(null)}
        title="发布到插件市场"
        subtitle="发布后所有人可浏览与安装。请确认内容不含敏感信息。"
        footer={<><button className="btn" onClick={() => setPublishing(null)}>取消</button><button className="btn btn-primary" onClick={() => void publish()} disabled={publishLoading}>{publishLoading ? <Spinner size={13} /> : <Rocket size={13} />}发布</button></>}
      >
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{publishing?.name}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{publishing?.summary}</div>
        </div>
        <Field label="发布版本" hint="同一版本只能发布一次。修改内容后请提升版本号。">
          <input className="input mono" value={publishVersion} onChange={(event) => setPublishVersion(event.target.value)} />
        </Field>
        <p className="hint" style={{ marginTop: 10 }}>发布时会生成不可变快照；连接器密钥不会进入市场快照，安装者需要自行配置。</p>
      </Modal>

      <ConfirmModal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove()}
        title={`删除${meta.title}`}
        description={`确定删除「${deleting?.name ?? ''}」吗？此操作不可恢复。`}
        loading={deleteLoading}
      />
    </div>
  );
}

export function ExpertsPage() { return <AssetPage scope="experts" />; }
export function SkillsPage() { return <AssetPage scope="skills" />; }
export function ConnectorsPage() { return <AssetPage scope="connectors" />; }
