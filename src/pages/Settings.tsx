import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Cpu, Database, Globe2, KeyRound, Lock, Save, Server, Settings2, ShieldCheck, Sparkles, Users, Zap } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { ModelOption } from '@/lib/types';
import { Badge, Field, PageHeader, Spinner, Toggle } from '@/components/UI';
import { formatDate } from '@/lib/utils';

type SettingsState = {
  defaultModel: string;
  allowMemberPublish: boolean;
  sandboxEnabled: boolean;
  memoryEnabled: boolean;
  networkEnabled: boolean;
  filesEnabled: boolean;
};

export default function SettingsPage() {
  const { workspace, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<SettingsState>({ defaultModel: '', allowMemberPublish: true, sandboxEnabled: true, memoryEnabled: true, networkEnabled: true, filesEnabled: true });
  const [models, setModels] = useState<ModelOption[]>([]);
  const [demo, setDemo] = useState(false);
  const [name, setName] = useState(workspace?.name ?? '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const isAdmin = workspace?.role === 'owner' || workspace?.role === 'admin';

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);
    Promise.all([
      api.get<{ settings: SettingsState }>(`/api/w/${workspace.id}/settings`),
      api.get<{ models: ModelOption[]; demo: boolean }>('/api/models'),
    ])
      .then(([settingData, modelData]) => {
        setSettings({
          defaultModel: settingData.settings.defaultModel ?? '',
          allowMemberPublish: settingData.settings.allowMemberPublish !== false,
          sandboxEnabled: settingData.settings.sandboxEnabled !== false,
          memoryEnabled: settingData.settings.memoryEnabled !== false,
          networkEnabled: settingData.settings.networkEnabled !== false,
          filesEnabled: settingData.settings.filesEnabled !== false,
        });
        setModels(modelData.models);
        setDemo(modelData.demo);
        setName(workspace.name);
      })
      .catch((caught) => toast.push(errorMessage(caught), 'error'))
      .finally(() => setLoading(false));
  }, [workspace, toast]);

  async function save() {
    if (!workspace) return;
    setSaving(true);
    try {
      await api.patch(`/api/w/${workspace.id}/settings`, settings);
      if (name.trim() && name.trim() !== workspace.name) await api.patch(`/api/w/${workspace.id}`, { name: name.trim() });
      await refresh();
      toast.push('工作区设置已保存', 'success');
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (passwords.next !== passwords.confirm) { toast.push('两次输入的新密码不一致', 'error'); return; }
    setPasswordSaving(true);
    try {
      await api.post('/api/auth/password', { current: passwords.current, next: passwords.next });
      setPasswords({ current: '', next: '', confirm: '' });
      toast.push('密码已更新，其他会话已下线', 'success');
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setPasswordSaving(false);
    }
  }

  if (loading) return <div className="page-wrap"><div className="skeleton" style={{ height: 300 }} /></div>;

  return (
    <div className="page-wrap fade-in">
      <PageHeader eyebrow="Workspace settings" title="工作区设置" subtitle="模型、安全边界与协作策略。仅所有者和管理员可修改工作区配置。" />

      {!isAdmin && <div className="admin-banner"><Lock size={14} />你当前是成员，以下设置只读。请联系管理员调整。</div>}

      <div className="settings-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Settings2 size={15} color="var(--accent)" /><span style={{ fontSize: 13, fontWeight: 650 }}>基本信息</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="工作区名称"><input className="input" disabled={!isAdmin} value={name} onChange={(event) => setName(event.target.value)} maxLength={48} /></Field>
              <div className="grid-2">
                <Field label="工作区 ID"><input className="input mono" disabled value={workspace?.id ?? ''} style={{ fontSize: 10.5 }} /></Field>
                <Field label="工作区套餐"><input className="input" disabled value={workspace?.plan === 'team' ? 'Team · 自托管' : workspace?.plan ?? ''} /></Field>
              </div>
              <div className="hint">工作区是严格的租户边界：成员、会话、资产、记忆与审计都归属于它。</div>
            </div>
          </section>

          <section className="card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Cpu size={15} color="var(--accent)" /><span style={{ fontSize: 13, fontWeight: 650 }}>模型与能力</span>
              {demo && <Badge tone="warn"><Zap size={9} />演示模式</Badge>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="默认模型" hint="新会话默认使用；仍可在创建会话时覆盖。服务端会拒绝不在允许列表内的模型。">
                <select className="select" disabled={!isAdmin} value={settings.defaultModel} onChange={(event) => setSettings({ ...settings, defaultModel: event.target.value })}>
                  {models.map((model) => <option key={model.id} value={model.id}>{model.label} — {model.id}</option>)}
                </select>
              </Field>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                <Toggle checked={settings.memoryEnabled} onChange={(value) => isAdmin && setSettings({ ...settings, memoryEnabled: value })} label="允许工作区使用长期记忆" />
                <Toggle checked={settings.sandboxEnabled} onChange={(value) => isAdmin && setSettings({ ...settings, sandboxEnabled: value })} label="允许智能体调用代码沙箱" />
                <Toggle checked={settings.filesEnabled} onChange={(value) => isAdmin && setSettings({ ...settings, filesEnabled: value })} label="允许工作区文件（上传与读写工具）" />
                <Toggle checked={settings.networkEnabled} onChange={(value) => isAdmin && setSettings({ ...settings, networkEnabled: value })} label="允许智能体联网抓取网页（web_fetch）" />
                <Toggle checked={settings.allowMemberPublish} onChange={(value) => isAdmin && setSettings({ ...settings, allowMemberPublish: value })} label="允许普通成员发布资产到插件市场" />
              </div>
              {demo && (
                <div className="card" style={{ padding: 13, borderColor: 'rgba(247,200,115,.22)', background: 'rgba(247,200,115,.04)' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--warning)', fontWeight: 600 }}>当前未配置真实模型</div>
                  <div className="hint" style={{ marginTop: 4 }}>在部署环境的 <span className="mono">.env</span> 中设置 LLM_API_KEY / LLM_BASE_URL / LLM_MODELS 后重启应用。接口兼容 OpenAI Chat Completions。</div>
                </div>
              )}
              <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={!isAdmin || saving} onClick={() => void save()}>{saving ? <Spinner size={13} /> : <Save size={14} />}保存设置</button>
            </div>
          </section>

          <section className="card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <KeyRound size={15} color="var(--accent)" /><span style={{ fontSize: 13, fontWeight: 650 }}>修改密码</span>
            </div>
            <form onSubmit={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
              <Field label="当前密码"><input className="input" type="password" required value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })} autoComplete="current-password" /></Field>
              <div className="grid-2">
                <Field label="新密码"><input className="input" type="password" required minLength={12} value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} autoComplete="new-password" /></Field>
                <Field label="确认新密码"><input className="input" type="password" required minLength={12} value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })} autoComplete="new-password" /></Field>
              </div>
              <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={passwordSaving}>{passwordSaving ? <Spinner size={13} /> : <ShieldCheck size={14} />}更新密码</button>
              <div className="hint">更新后除当前会话外的所有会话立即失效。</div>
            </form>
          </section>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 18 }}>
            <div className="eyebrow">Workspace</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <div className="workspace-avatar" style={{ width: 40, height: 40, fontSize: 15 }}>{workspace?.name.slice(0, 1)}</div>
              <div><div style={{ fontSize: 14, fontWeight: 650 }}>{workspace?.name}</div><div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 2 }}>{workspace?.role === 'owner' ? '所有者' : workspace?.role === 'admin' ? '管理员' : '成员'} · {workspace?.plan}</div></div>
            </div>
            <div className="divider" style={{ margin: '15px 0' }} />
            {[
              { label: '成员', value: '权限隔离', icon: Users },
              { label: '数据存储', value: 'SQLite WAL', icon: Database },
              { label: '认证方式', value: '服务端会话', icon: ShieldCheck },
              { label: '部署形态', value: 'Docker Compose', icon: Server },
            ].map(({ label, value, icon: ItemIcon }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0', fontSize: 11.5 }}>
                <ItemIcon size={13} color="var(--faint)" /><span style={{ color: 'var(--muted)', flex: 1 }}>{label}</span><span style={{ color: 'var(--text)' }}>{value}</span>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><Globe2 size={14} color="var(--accent)" /><span style={{ fontSize: 12.5, fontWeight: 650 }}>模型网关</span></div>
            <div className="hint" style={{ lineHeight: 1.7 }}>
              默认支持任意 OpenAI 兼容接口。生产环境通过环境变量注入，不把 API Key 写入数据库或浏览器。
            </div>
            <pre className="console" style={{ marginTop: 12, fontSize: 10, minHeight: 0 }}>{`LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-***
LLM_MODELS=deepseek-chat:DeepSeek Chat,
  deepseek-reasoner:DeepSeek Reasoner`}</pre>
          </div>

          <div className="card danger-zone" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger)' }}><AlertTriangle size={14} /><span style={{ fontSize: 12.5, fontWeight: 650 }}>数据与合规</span></div>
            <p className="hint" style={{ lineHeight: 1.7, marginTop: 8 }}>平台管理员可导出数据库备份（部署侧 cron）。工作区删除需由所有者在 API 侧显式执行，Web 端默认不提供误触入口。</p>
            <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => navigate('/app/members')}>查看成员与审计 <Users size={12} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
