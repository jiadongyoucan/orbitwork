import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Cpu, KeyRound, Save, Settings2, ShieldCheck, Users } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { ModelOption } from '@/lib/types';
import { Avatar, Badge, Field, PageHeader, Spinner, Toggle } from '@/components/UI';
import { MembersPanel } from '@/pages/Members';
import { cn } from '@/lib/utils';

type SettingsState = {
  defaultModel: string;
  allowMemberPublish: boolean;
  sandboxEnabled: boolean;
  memoryEnabled: boolean;
  networkEnabled: boolean;
  filesEnabled: boolean;
};

type Tab = 'workspace' | 'members' | 'security';

export default function SettingsPage() {
  const { user, workspace, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isAdmin = workspace?.role === 'owner' || workspace?.role === 'admin';
  const rawTab = params.get('tab');
  const tab: Tab = !isAdmin && rawTab !== 'members' ? 'security' : rawTab === 'workspace' || rawTab === 'members' || rawTab === 'security' ? rawTab : 'security';
  const [settings, setSettings] = useState<SettingsState>({ defaultModel: '', allowMemberPublish: true, sandboxEnabled: true, memoryEnabled: true, networkEnabled: true, filesEnabled: true });
  const [models, setModels] = useState<ModelOption[]>([]);
  const [demo, setDemo] = useState(false);
  const [name, setName] = useState(workspace?.name ?? '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const loadedWorkspace = useRef('');

  useEffect(() => {
    if (!workspace || loadedWorkspace.current === workspace.id) return;
    loadedWorkspace.current = workspace.id;
    setLoading(true);
    Promise.all([
      api.get<{ settings: SettingsState }>(`/api/w/${workspace.id}/settings`),
      api.get<{ models: ModelOption[]; demo: boolean }>(`/api/w/${workspace.id}/models`),
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

  function switchTab(next: Tab) {
    setParams(next === 'security' ? {} : { tab: next });
  }

  async function save() {
    if (!workspace) return;
    setSaving(true);
    try {
      const { defaultModel: _readonlyDefault, ...persisted } = settings;
      await api.patch(`/api/w/${workspace.id}/settings`, persisted);
      if (name.trim() && name.trim() !== workspace.name) await api.patch(`/api/w/${workspace.id}`, { name: name.trim() });
      await refresh();
      toast.push('设置已保存', 'success');
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

  const defaultModel = models.find((model) => model.id === settings.defaultModel);
  const role = workspace?.role === 'owner' ? '所有者' : workspace?.role === 'admin' ? '管理员' : '成员';
  const tabs: Array<{ id: Tab; label: string; icon: typeof Settings2 }> = [
    ...(isAdmin ? [{ id: 'workspace' as const, label: '工作区', icon: Settings2 }] : []),
    { id: 'members', label: '成员与权限', icon: Users },
    { id: 'security', label: '登录安全', icon: KeyRound },
  ];

  return (
    <div className="page-wrap fade-in">
      <PageHeader title="账号与安全" />

      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        {tabs.map(({ id, label, icon: TabIcon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={cn('settings-tab', tab === id && 'active')} onClick={() => switchTab(id)}>
            <TabIcon size={14} />{label}
          </button>
        ))}
      </div>

      {tab === 'workspace' && isAdmin && (
        <div className="settings-stack">
          <section className="card settings-card">
            <div className="settings-card-head"><span>工作区</span></div>
            <Field label="名称"><input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={48} /></Field>
          </section>

          <section className="card settings-card">
            <div className="settings-card-head">
              <span>模型</span>
              {demo && <Badge tone="warn">演示</Badge>}
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => navigate('/app/models')}>管理 <Cpu size={12} /></button>
            </div>
            <div className="settings-model-row">
              <span>{defaultModel?.label ?? '未配置模型'}</span>
              <span>{defaultModel?.providerName ?? '平台默认'}</span>
            </div>
          </section>

          <section className="card settings-card">
            <div className="settings-card-head"><span>能力开关</span></div>
            <div className="settings-toggles">
              <Toggle checked={settings.memoryEnabled} onChange={(value) => setSettings({ ...settings, memoryEnabled: value })} label="长期记忆" />
              <Toggle checked={settings.sandboxEnabled} onChange={(value) => setSettings({ ...settings, sandboxEnabled: value })} label="代码沙箱" />
              <Toggle checked={settings.filesEnabled} onChange={(value) => setSettings({ ...settings, filesEnabled: value })} label="工作区文件" />
              <Toggle checked={settings.networkEnabled} onChange={(value) => setSettings({ ...settings, networkEnabled: value })} label="联网抓取" />
              <Toggle checked={settings.allowMemberPublish} onChange={(value) => setSettings({ ...settings, allowMemberPublish: value })} label="成员发布资产" />
            </div>
          </section>

          <div className="settings-actions">
            <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? <Spinner size={13} /> : <Save size={14} />}保存</button>
          </div>
        </div>
      )}

      {tab === 'members' && <MembersPanel />}

      {tab === 'security' && (
        <div className="settings-stack">
          <section className="card settings-card">
            <div className="settings-card-head"><span>账号</span></div>
            <div className="settings-identity">
              <Avatar name={user?.name ?? ''} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="settings-identity-name">{user?.name}</div>
                <div className="settings-identity-email">{user?.email}</div>
              </div>
              <Badge tone="muted">{role}</Badge>
            </div>
          </section>

          <section className="card settings-card">
            <div className="settings-card-head"><span>修改密码</span><span className="help-dot" title="更新后除当前会话外的所有会话立即失效">?</span></div>
            <form onSubmit={changePassword} className="settings-form">
              <Field label="当前密码"><input className="input" type="password" required value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })} autoComplete="current-password" /></Field>
              <Field label="新密码"><input className="input" type="password" required minLength={12} value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} autoComplete="new-password" /></Field>
              <Field label="确认新密码"><input className="input" type="password" required minLength={12} value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })} autoComplete="new-password" /></Field>
              <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={passwordSaving}>{passwordSaving ? <Spinner size={13} /> : <ShieldCheck size={14} />}更新密码</button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
