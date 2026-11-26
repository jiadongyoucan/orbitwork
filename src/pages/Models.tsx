import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, CheckCircle2, Cpu, ExternalLink, KeyRound, Loader2, Pencil, Plus, RefreshCw,
  ArrowLeft, Server, ShieldCheck, Trash2, Zap,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { ModelSettings, ProviderConfig, WorkspaceModel } from '@/lib/types';
import { Badge, ConfirmModal, EmptyState, ErrorState, Field, Modal, PageHeader, Spinner, Toggle } from '@/components/UI';
import { cn } from '@/lib/utils';

const PRESETS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', hint: 'deepseek-chat / deepseek-reasoner' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', hint: 'gpt-4.1 / o3' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', hint: '多模型统一网关' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', hint: 'qwen-max / qwen-plus' },
  { name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', hint: 'moonshot-v1' },
  { name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', hint: '开源模型托管' },
  { name: 'Ollama 本地', baseUrl: 'http://127.0.0.1:11434/v1', hint: '需要 ALLOW_PRIVATE_PROVIDERS=true' },
  { name: '自定义', baseUrl: '', hint: '任意 OpenAI 兼容接口' },
];

type ProviderForm = { name: string; baseUrl: string; apiKey: string; enabled: boolean; clearKey: boolean };
type ModelForm = { providerId: string; modelId: string; label: string; contextWindow: number; enabled: boolean; isDefault: boolean };

export default function ModelsPage() {
  const { workspace, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [providerOpen, setProviderOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | null>(null);
  const [providerForm, setProviderForm] = useState<ProviderForm>({ name: '', baseUrl: '', apiKey: '', enabled: true, clearKey: false });
  const [modelOpen, setModelOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<WorkspaceModel | null>(null);
  const [modelForm, setModelForm] = useState<ModelForm>({ providerId: '', modelId: '', label: '', contextWindow: 128000, enabled: true, isDefault: false });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState('');
  const [deletingProvider, setDeletingProvider] = useState<ProviderConfig | null>(null);
  const [deletingModel, setDeletingModel] = useState<WorkspaceModel | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const isAdmin = workspace?.role === 'owner' || workspace?.role === 'admin';

  async function load() {
    if (!workspace) return;
    setLoading(true);
    setLoadError('');
    try {
      setSettings(await api.get<ModelSettings>(`/api/w/${workspace.id}/model-settings`));
    } catch (caught) {
      setLoadError(errorMessage(caught));
      toast.push(errorMessage(caught), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [workspace]);

  if (!isAdmin) {
    return (
      <div className="page-wrap"><EmptyState icon={<ShieldCheck size={20} />} title="需要管理员权限" description="模型、Provider 与 API Key 仅工作区所有者或管理员可以配置。" /></div>
    );
  }

  function openCreateProvider() {
    setEditingProvider(null);
    setProviderForm({ name: '', baseUrl: '', apiKey: '', enabled: true, clearKey: false });
    setProviderOpen(true);
  }

  function openEditProvider(provider: ProviderConfig) {
    setEditingProvider(provider);
    setProviderForm({ name: provider.name, baseUrl: provider.baseUrl, apiKey: '', enabled: provider.enabled, clearKey: false });
    setProviderOpen(true);
  }

  function applyPreset(preset: typeof PRESETS[number]) {
    setProviderForm((current) => ({
      ...current,
      name: current.name && current.name !== '自定义' ? current.name : preset.name,
      baseUrl: preset.baseUrl,
    }));
  }

  async function saveProvider(event: React.FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    setSaving(true);
    try {
      if (editingProvider) {
        await api.patch(`/api/w/${workspace.id}/providers/${editingProvider.id}`, {
          name: providerForm.name, baseUrl: providerForm.baseUrl, enabled: providerForm.enabled,
          ...(providerForm.apiKey ? { apiKey: providerForm.apiKey } : {}), ...(providerForm.clearKey ? { clearKey: true } : {}),
        });
        toast.push('Provider 已更新', 'success');
      } else {
        await api.post(`/api/w/${workspace.id}/providers`, {
          name: providerForm.name, baseUrl: providerForm.baseUrl, enabled: providerForm.enabled,
          ...(providerForm.apiKey ? { apiKey: providerForm.apiKey } : {}),
        });
        toast.push('Provider 已添加', 'success');
      }
      setProviderOpen(false);
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function testProvider(provider: ProviderConfig) {
    if (!workspace) return;
    setTesting(provider.id);
    try {
      const result = await api.post<{ ok: boolean; status: number; message: string; modelCount?: number }>(`/api/w/${workspace.id}/providers/${provider.id}/test`);
      toast.push(result.ok ? `${provider.name}：${result.message}${result.modelCount !== undefined ? `（${result.modelCount} 个模型）` : ''}` : `${provider.name}：${result.message}`, result.ok ? 'success' : 'error');
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setTesting('');
    }
  }

  function openCreateModel() {
    if (!settings?.providers.length) { toast.push('请先添加一个 Provider', 'error'); return; }
    setEditingModel(null);
    setModelForm({ providerId: settings.providers[0].id, modelId: '', label: '', contextWindow: 128000, enabled: true, isDefault: settings.models.length === 0 });
    setModelOpen(true);
  }

  function openEditModel(model: WorkspaceModel) {
    setEditingModel(model);
    setModelForm({ providerId: model.providerId, modelId: model.modelId, label: model.label, contextWindow: model.contextWindow, enabled: model.enabled, isDefault: model.isDefault });
    setModelOpen(true);
  }

  async function saveModel(event: React.FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    setSaving(true);
    try {
      if (editingModel) {
        await api.patch(`/api/w/${workspace.id}/models/${editingModel.id}`, modelForm);
        toast.push('模型已更新', 'success');
      } else {
        await api.post(`/api/w/${workspace.id}/models`, modelForm);
        toast.push('模型已添加', 'success');
      }
      setModelOpen(false);
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function removeProvider() {
    if (!workspace || !deletingProvider) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/api/w/${workspace.id}/providers/${deletingProvider.id}`);
      toast.push('Provider 及其模型已删除', 'success');
      setDeletingProvider(null);
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setDeleteLoading(false);
    }
  }

  async function removeModel() {
    if (!workspace || !deletingModel) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/api/w/${workspace.id}/models/${deletingModel.id}`);
      toast.push('模型已删除', 'success');
      setDeletingModel(null);
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="page-wrap fade-in">
      <PageHeader
        eyebrow="Models & Providers"
        title="模型与 Provider"
        actions={<><button className="btn" onClick={() => navigate('/app/settings?tab=workspace')}><ArrowLeft size={14} />返回</button><button className="btn" onClick={() => void load()}><RefreshCw size={14} />刷新</button><button className="btn btn-primary" onClick={openCreateProvider}><Plus size={14} />添加 Provider</button></>}
      />

      {loading ? <div className="skeleton" style={{ height: 260 }} /> : loadError ? <div className="card"><ErrorState message={loadError} onRetry={() => void load()} /></div> : settings && (
        <>
          <div className="model-summary">
            <div className="model-summary-main">
              <span className={settings.configured ? 'model-summary-icon active' : 'model-summary-icon'}>{settings.configured ? <Cpu size={19} /> : <Zap size={19} />}</span>
              <div>
                <div className="model-summary-title">{settings.configured ? `${settings.effectiveModels.length} 个可用模型` : '使用平台默认模型'}</div>
                <div className="model-summary-sub">{settings.configured ? `默认：${settings.defaultModel || '未设置'} · 配置已覆盖环境变量` : '当前尚未添加 Provider，应用会读取部署环境变量中的 LLM_* 配置。'}</div>
              </div>
            </div>
            <div className="model-summary-meta">
              <span>Provider <b>{settings.providers.length}</b></span>
              <span>模型 <b>{settings.models.length}</b></span>
              <span>环境兜底 <b>{settings.env.hasKey ? '已配置' : '演示'}</b></span>
            </div>
          </div>

          <div className="model-layout">
            <section className="card model-panel">
              <div className="model-panel-head">
                <div><h2 title="支持任意 OpenAI 兼容接口">Provider <span className="help-dot" title="支持 DeepSeek、OpenAI、OpenRouter、私网或本地接口">?</span></h2></div>
                <button className="btn btn-sm" onClick={openCreateProvider}><Plus size={13} />添加</button>
              </div>
              {settings.providers.length === 0 ? (
                <div className="empty" style={{ padding: '38px 16px' }}>
                  <div className="empty-icon"><Server size={19} /></div>
                  <div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>还没有自定义 Provider</div>
                  <div style={{ marginTop: 6, lineHeight: 1.6 }}>添加 DeepSeek、OpenAI、OpenRouter 或任何 OpenAI 兼容服务。</div>
                  <button className="btn btn-primary btn-sm" style={{ marginTop: 14 }} onClick={openCreateProvider}><Plus size={12} />添加 Provider</button>
                </div>
              ) : settings.providers.map((provider) => (
                <div className="provider-card" key={provider.id}>
                  <div className="provider-card-head">
                    <span className="provider-icon"><Server size={15} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="provider-name">{provider.name} {provider.enabled ? <Badge tone="accent">启用</Badge> : <Badge tone="muted">停用</Badge>} {provider.keyError && <Badge tone="danger">密钥异常</Badge>}</div>
                      <div className="provider-url mono">{provider.baseUrl}</div>
                    </div>
                    <div className="provider-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => void testProvider(provider)} disabled={testing === provider.id}>{testing === provider.id ? <Loader2 size={12} className="spin" /> : <Zap size={12} />}测试</button>
                      <button className="btn btn-ghost btn-icon btn-sm" style={{ width: 28 }} onClick={() => openEditProvider(provider)} aria-label="编辑 Provider"><Pencil size={12} /></button>
                      <button className="btn btn-ghost btn-icon btn-sm" style={{ width: 28 }} onClick={() => setDeletingProvider(provider)} aria-label="删除 Provider"><Trash2 size={12} /></button>
                    </div>
                  </div>
                  <div className="provider-foot">
                    <span><KeyRound size={11} />{provider.keyError ? 'API Key 无法解密' : provider.hasKey ? 'API Key 已保存' : '未配置 Key'}</span>
                    <span>{provider.modelCount} 个模型</span>
                  </div>
                </div>
              ))}
            </section>

            <section className="card model-panel">
              <div className="model-panel-head">
                <div><h2>模型</h2></div>
                <button className="btn btn-sm" onClick={openCreateModel} disabled={!settings.providers.length}><Plus size={13} />添加模型</button>
              </div>
              {settings.models.length === 0 ? (
                <div className="empty" style={{ padding: '38px 16px' }}>
                  <div className="empty-icon"><Cpu size={19} /></div>
                  <div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>还没有模型</div>
                  <div style={{ marginTop: 6, lineHeight: 1.6 }}>{settings.providers.length ? '添加模型 ID 和展示名称，设为默认后即可开始对话。' : '先添加一个 Provider，再添加模型。'}</div>
                </div>
              ) : settings.models.map((model) => {
                const provider = settings.providers.find((item) => item.id === model.providerId);
                return (
                  <div className="model-row" key={model.id}>
                    <span className={cn('model-dot', model.enabled ? 'on' : '')} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="model-name">{model.label} {model.isDefault && <Badge tone="accent">默认</Badge>} {!model.enabled && <Badge tone="muted">停用</Badge>}</div>
                      <div className="model-id mono">{model.modelId} · {provider?.name ?? '未知 Provider'} · {Math.round(model.contextWindow / 1000)}k context</div>
                    </div>
                    <div className="provider-actions">
                      <button className="btn btn-ghost btn-icon btn-sm" style={{ width: 28 }} onClick={() => openEditModel(model)} aria-label="编辑模型"><Pencil size={12} /></button>
                      <button className="btn btn-ghost btn-icon btn-sm" style={{ width: 28 }} onClick={() => setDeletingModel(model)} aria-label="删除模型"><Trash2 size={12} /></button>
                    </div>
                  </div>
                );
              })}
              {settings.configured && (
                <div className="model-fallback">
                  <CheckCircle2 size={12} />
                  <span>已配置工作区模型，不再使用部署环境变量中的 LLM_* 作为对话模型。</span>
                </div>
              )}
              {!settings.configured && (
                <div className="model-fallback">
                  <Zap size={12} />
                  <span>当前使用平台默认：{settings.env.baseUrl} · {settings.env.hasKey ? '环境变量已提供 Key' : '演示模式，请添加 Provider 或设置 LLM_API_KEY'}。</span>
                </div>
              )}
            </section>
          </div>
        </>
      )}

      <Modal
        open={providerOpen}
        onClose={() => setProviderOpen(false)}
        title={editingProvider ? '编辑 Provider' : '添加 Provider'}
        subtitle="兼容 OpenAI Chat Completions 协议；base URL 通常以 /v1 结尾。"
        large
        footer={<><button className="btn" onClick={() => setProviderOpen(false)}>取消</button><button className="btn btn-primary" form="provider-form" disabled={saving}>{saving ? <Spinner size={13} /> : <Check size={13} />}{editingProvider ? '保存' : '添加'}</button></>}
      >
        <form id="provider-form" onSubmit={saveProvider} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!editingProvider && (
            <div>
              <div className="label" style={{ marginBottom: 8 }}>快速预设</div>
              <div className="provider-presets">
                {PRESETS.map((preset) => (
                  <button type="button" key={preset.name} className={cn('chip', providerForm.baseUrl === preset.baseUrl && 'chip-active')} onClick={() => applyPreset(preset)} title={preset.hint}>
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Field label="名称"><input className="input" required minLength={2} maxLength={60} value={providerForm.name} onChange={(event) => setProviderForm({ ...providerForm, name: event.target.value })} placeholder="例如：DeepSeek 生产" /></Field>
          <Field label="Base URL" hint="示例：https://api.deepseek.com/v1。私网 / 本地地址需要服务端开启 ALLOW_PRIVATE_PROVIDERS。">
            <input className="input mono" required type="url" value={providerForm.baseUrl} onChange={(event) => setProviderForm({ ...providerForm, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
          </Field>
          <Field label={editingProvider ? 'API Key（留空保持不变）' : 'API Key'}>
            <input className="input mono" type="password" value={providerForm.apiKey} onChange={(event) => setProviderForm({ ...providerForm, apiKey: event.target.value })} placeholder={editingProvider?.hasKey ? '已保存，留空保持不变' : 'sk-...'} autoComplete="new-password" />
          </Field>
          {editingProvider?.hasKey && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
              <input type="checkbox" checked={providerForm.clearKey} onChange={(event) => setProviderForm({ ...providerForm, clearKey: event.target.checked })} />
              清除已保存的 API Key
            </label>
          )}
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 13 }}><Toggle checked={providerForm.enabled} onChange={(value) => setProviderForm({ ...providerForm, enabled: value })} label="启用这个 Provider" /></div>
        </form>
      </Modal>

      <Modal
        open={modelOpen}
        onClose={() => setModelOpen(false)}
        title={editingModel ? '编辑模型' : '添加模型'}
        subtitle="模型 ID 必须与 Provider 的 API 文档一致。"
        footer={<><button className="btn" onClick={() => setModelOpen(false)}>取消</button><button className="btn btn-primary" form="model-form" disabled={saving}>{saving ? <Spinner size={13} /> : <Check size={13} />}{editingModel ? '保存' : '添加'}</button></>}
      >
        <form id="model-form" onSubmit={saveModel} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Provider">
            <select className="select" required value={modelForm.providerId} onChange={(event) => setModelForm({ ...modelForm, providerId: event.target.value })}>
              {settings?.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            </select>
          </Field>
          <div className="grid-2">
            <Field label="模型 ID"><input className="input mono" required value={modelForm.modelId} onChange={(event) => setModelForm({ ...modelForm, modelId: event.target.value })} placeholder="deepseek-chat" /></Field>
            <Field label="显示名称"><input className="input" required value={modelForm.label} onChange={(event) => setModelForm({ ...modelForm, label: event.target.value })} placeholder="DeepSeek Chat" /></Field>
          </div>
          <Field label="上下文窗口 (tokens)" hint="用于历史裁剪与预算，必须与模型真实能力一致。">
            <input className="input mono" type="number" min={4096} max={2000000} step={1024} value={modelForm.contextWindow} onChange={(event) => setModelForm({ ...modelForm, contextWindow: Number(event.target.value) })} />
          </Field>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11, border: '1px solid var(--line)', borderRadius: 10, padding: 13 }}>
            <Toggle checked={modelForm.enabled} onChange={(value) => setModelForm({ ...modelForm, enabled: value })} label="启用（出现在模型选择器中）" />
            <Toggle checked={modelForm.isDefault} onChange={(value) => setModelForm({ ...modelForm, isDefault: value })} label="设为工作区默认模型" />
          </div>
        </form>
      </Modal>

      <ConfirmModal open={Boolean(deletingProvider)} onClose={() => setDeletingProvider(null)} onConfirm={() => void removeProvider()} title="删除 Provider" description={`确定删除「${deletingProvider?.name ?? ''}」及其 ${deletingProvider?.modelCount ?? 0} 个模型吗？使用这些模型的历史会话将回退到默认模型。`} loading={deleteLoading} />
      <ConfirmModal open={Boolean(deletingModel)} onClose={() => setDeletingModel(null)} onConfirm={() => void removeModel()} title="删除模型" description={`确定删除「${deletingModel?.label ?? ''}」吗？历史会话会保留，新的消息将使用默认模型。`} loading={deleteLoading} />
    </div>
  );
}
