import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, ArrowRight, Ban, CheckCircle2, Database, Eye, Flag, KeyRound, Package,
  Shield, ShieldCheck, Sparkles, Star, Store, Users, XCircle,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Badge, EmptyState, Field, Modal, PageHeader, Spinner } from '@/components/UI';
import { Icon } from '@/components/Icon';
import { cn, compactNumber, formatDate } from '@/lib/utils';

type Stats = {
  users: number; workspaces: number; chats: number; messages: number; assets: number; published: number;
  tokens: { i: number; o: number };
  signups: Array<{ day: string; n: number }>;
};
type AdminUser = { id: string; email: string; name: string; platform_role: string; created_at: number; last_login_at: number; workspace_count: number; chat_count: number };
type AdminAsset = { id: string; kind: string; name: string; summary: string; status: string; visibility: string; installs: number; stars: number; featured?: boolean; version: string; author_name: string; workspace_name: string; created_at: number };
type AdminLog = { id: string; action: string; target_type: string; created_at: number; actor_name: string; workspace_name: string };

const KIND_LABELS: Record<string, string> = { expert: '专家', skill: '技能', connector: '连接器', plugin: '插件' };

export default function AdminPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'overview' | 'assets' | 'users' | 'audit'>('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [assets, setAssets] = useState<AdminAsset[]>([]);
  const [logs, setLogs] = useState<AdminLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [password, setPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  async function load() {
    if (user?.platformRole !== 'admin') { setLoading(false); return; }
    setLoading(true);
    try {
      const [statsData, userData, assetData, logData] = await Promise.all([
        api.get<Stats>('/api/admin/stats'),
        api.get<{ users: AdminUser[] }>('/api/admin/users'),
        api.get<{ assets: AdminAsset[] }>('/api/admin/assets'),
        api.get<{ logs: AdminLog[] }>('/api/admin/audit'),
      ]);
      setStats(statsData);
      setUsers(userData.users);
      setAssets(assetData.assets);
      setLogs(logData.logs);
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [user]);

  async function moderate(asset: AdminAsset, action: 'suspend' | 'restore' | 'feature' | 'unfeature') {
    try {
      await api.post(`/api/admin/assets/${asset.id}/moderate`, { action });
      toast.push('审核状态已更新', 'success');
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    }
  }

  async function changeRole(target: AdminUser, role: string) {
    try {
      await api.patch(`/api/admin/users/${target.id}/role`, { role });
      toast.push('平台角色已更新', 'success');
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    }
  }

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!resetUser) return;
    setResetting(true);
    try {
      await api.post(`/api/admin/users/${resetUser.id}/password`, { password });
      toast.push('密码已重置，该用户全部会话已下线', 'success');
      setResetUser(null);
      setPassword('');
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setResetting(false);
    }
  }

  if (user?.platformRole !== 'admin') {
    return (
      <div className="page-wrap">
        <EmptyState icon={<Shield size={20} />} title="需要平台管理员权限" description="此页面仅对平台管理员开放。" action={<button className="btn btn-sm" onClick={() => navigate('/app')}>返回工作台</button>} />
      </div>
    );
  }

  return (
    <div className="page-wrap fade-in">
      <PageHeader
        eyebrow="Platform admin"
        title="平台管理"
        subtitle="跨工作区的运营视图、内容审核与用户支持。所有管理动作均写入审计。"
        actions={<button className="btn" onClick={() => void load()}><Activity size={14} />刷新数据</button>}
      />

      <div className="admin-banner"><ShieldCheck size={14} />你正在查看平台级数据。聊天内容不在此视图展示，管理员不能读取用户的私有会话。</div>

      <div className="tabs">
        {([['overview', '概览'], ['assets', '内容审核'], ['users', '用户'], ['audit', '审计']] as const).map(([key, label]) => (
          <button key={key} className={cn('tab', tab === key && 'active')} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {loading ? <div className="skeleton" style={{ height: 260 }} /> : tab === 'overview' && stats ? (
        <>
          <div className="stats-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {[
              { label: '用户', value: stats.users, icon: Users },
              { label: '工作区', value: stats.workspaces, icon: Database },
              { label: '消息', value: stats.messages, icon: Activity },
              { label: '已发布资产', value: stats.published, icon: Store },
            ].map(({ label, value, icon: ItemIcon }) => (
              <div key={label} className="card stat">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="stat-label">{label}</span><ItemIcon size={14} color="var(--faint)" /></div>
                <div className="stat-value">{compactNumber(value)}</div>
              </div>
            ))}
          </div>
          <div className="grid-2" style={{ marginTop: 14 }}>
            <div className="card" style={{ padding: 18 }}>
              <div style={{ fontSize: 12.5, fontWeight: 650, marginBottom: 14 }}>使用量</div>
              <div style={{ display: 'flex', gap: 24 }}>
                <div><div className="stat-value" style={{ fontSize: 22 }}>{compactNumber(stats.tokens.i)}</div><div className="stat-label">Input tokens</div></div>
                <div><div className="stat-value" style={{ fontSize: 22 }}>{compactNumber(stats.tokens.o)}</div><div className="stat-label">Output tokens</div></div>
                <div><div className="stat-value" style={{ fontSize: 22 }}>{stats.chats}</div><div className="stat-label">会话</div></div>
              </div>
              <div className="divider" style={{ margin: '16px 0' }} />
              <div className="hint">Token 由 OpenAI 兼容接口返回；演示模式下为估算值。生产环境建议在网关侧追加配额。</div>
            </div>
            <div className="card" style={{ padding: 18 }}>
              <div style={{ fontSize: 12.5, fontWeight: 650, marginBottom: 14 }}>近 14 天注册</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 90 }}>
                {(stats.signups.length ? [...stats.signups].reverse() : []).map((day) => (
                  <div key={day.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} title={`${day.day}: ${day.n}`}>
                    <div style={{ width: '100%', minHeight: 4, height: Math.max(4, day.n * 12), background: 'var(--accent)', opacity: .7, borderRadius: 3 }} />
                    <span style={{ fontSize: 7.5, color: 'var(--faint)' }}>{day.day?.slice(5)}</span>
                  </div>
                ))}
                {!stats.signups.length && <div className="hint">暂无数据</div>}
              </div>
            </div>
          </div>
        </>
      ) : tab === 'assets' ? (
        <div className="card">
          {assets.length === 0 ? <EmptyState icon={<Package size={20} />} title="暂无已发布资产" /> : assets.map((asset) => (
            <div className="list-row" key={asset.id}>
              <div className="asset-ico" style={{ width: 30, height: 30 }}><Icon name={asset.kind === 'connector' ? 'plug' : asset.kind === 'plugin' ? 'package' : 'sparkles'} size={14} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 550, display: 'flex', alignItems: 'center', gap: 7 }}>{asset.name}<Badge tone={asset.status === 'published' ? 'accent' : asset.status === 'suspended' ? 'danger' : 'muted'}>{asset.status}</Badge></div>
                <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 2 }}>{KIND_LABELS[asset.kind]} · {asset.workspace_name} · {asset.author_name} · {compactNumber(asset.installs)} 安装 · {compactNumber(asset.stars)} 收藏</div>
              </div>
              <div style={{ display: 'flex', gap: 5 }}>
                {asset.status !== 'suspended' ? <button className="btn btn-sm" onClick={() => void moderate(asset, 'suspend')}><Ban size={12} />下架</button> : <button className="btn btn-sm" onClick={() => void moderate(asset, 'restore')}><CheckCircle2 size={12} />恢复</button>}
                <button className="btn btn-sm btn-ghost" onClick={() => void moderate(asset, asset.featured ? 'unfeature' : 'feature')} title="精选"><Star size={13} fill={asset.featured ? 'var(--accent)' : 'none'} /></button>
              </div>
            </div>
          ))}
        </div>
      ) : tab === 'users' ? (
        <div className="card">
          {users.map((item) => (
            <div className="list-row" key={item.id}>
              <div className="avatar">{item.name.slice(0, 1)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 550 }}>{item.name} <span style={{ color: 'var(--faint)', fontWeight: 400, fontSize: 10.5 }}>{item.email}</span></div>
                <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 2 }}>{item.workspace_count} 工作区 · {item.chat_count} 会话 · 注册于 {formatDate(item.created_at)}</div>
              </div>
              <select className="select" style={{ width: 100, height: 29, fontSize: 10.5, padding: '3px 25px 3px 8px' }} value={item.platform_role} onChange={(event) => void changeRole(item, event.target.value)} disabled={item.id === user.id}>
                <option value="user">普通用户</option>
                <option value="admin">平台管理员</option>
              </select>
              <button className="btn btn-sm" onClick={() => { setResetUser(item); setPassword(''); }}><KeyRound size={12} />重置密码</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          {logs.length === 0 ? <EmptyState icon={<Activity size={20} />} title="暂无审计记录" /> : logs.map((log) => (
            <div className="list-row" key={log.id}>
              <div className="recent-icon"><Activity size={12} /></div>
              <div style={{ flex: 1 }}><div style={{ fontSize: 12 }}><span className="mono" style={{ color: 'var(--accent)', fontSize: 10.5 }}>{log.action}</span> · {log.workspace_name}</div><div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 2 }}>{log.actor_name} · {formatDate(log.created_at)}</div></div>
              <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{log.target_type}</span>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(resetUser)}
        onClose={() => setResetUser(null)}
        title="重置用户密码"
        subtitle={`为 ${resetUser?.email ?? ''} 设置临时密码。该用户所有会话将立即失效。`}
        footer={<><button className="btn" onClick={() => setResetUser(null)}>取消</button><button className="btn btn-primary" form="reset-form" disabled={resetting}>{resetting ? <Spinner size={13} /> : <KeyRound size={13} />}重置</button></>}
      >
        <form id="reset-form" onSubmit={resetPassword}>
          <Field label="临时密码" hint="至少 12 位；请通过安全渠道告知用户。">
            <input className="input" type="password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
