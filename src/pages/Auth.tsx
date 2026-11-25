import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, Loader2, Mail, ShieldCheck, Sparkles, UserPlus } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Logo, LogoMark } from '@/components/UI';

function AuthAside() {
  return (
    <aside className="auth-aside">
      <Logo />
      <div>
        <div className="eyebrow" style={{ marginBottom: 16 }}>A calmer way to work with AI</div>
        <blockquote className="auth-quote" style={{ margin: 0 }}>
          “把方法沉淀为<strong>能力</strong>，把能力交给<strong>智能体</strong>。团队只负责判断与创造。”
        </blockquote>
        <div style={{ display: 'flex', gap: 16, marginTop: 30 }}>
          {[
            { icon: ShieldCheck, label: '租户隔离' },
            { icon: Sparkles, label: '可组合智能体' },
            { icon: CheckCircle2, label: '审计可追溯' },
          ].map(({ icon: ItemIcon, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: 11 }}>
              <ItemIcon size={13} color="var(--accent)" />{label}
            </div>
          ))}
        </div>
      </div>
      <div style={{ color: 'var(--faint)', fontSize: 10.5 }}>OrbitWork · 私有化部署 · 数据留在你选择的服务器</div>
    </aside>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-page">
      <AuthAside />
      <main className="auth-main">
        <div className="auth-card fade-in">
          <Link to="/" className="btn btn-ghost btn-sm" style={{ marginBottom: 24, paddingLeft: 0 }}><ArrowLeft size={14} /> 返回首页</Link>
          {children}
        </div>
      </main>
    </div>
  );
}

export function LoginPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const next = params.get('next');
  const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/api/auth/login', { email, password });
      await refresh();
      navigate(destination, { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <h1 className="auth-title">欢迎回来</h1>
      <p className="auth-sub">登录你的工作区，继续未完成的任务。</p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="field">
          <span className="label">邮箱</span>
          <div style={{ position: 'relative' }}>
            <Mail size={14} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--faint)' }} />
            <input className="input" style={{ paddingLeft: 35 }} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
        </label>
        <label className="field">
          <span className="label">密码</span>
          <div style={{ position: 'relative' }}>
            <KeyRound size={14} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--faint)' }} />
            <input className="input" style={{ paddingLeft: 35 }} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
        </label>
        {error && <div style={{ color: 'var(--danger)', fontSize: 12, lineHeight: 1.5 }}>{error}</div>}
        <button className="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: '100%', marginTop: 4 }}>
          {loading ? <Loader2 size={15} className="spin" /> : null}{loading ? '正在登录…' : '登录'} {!loading && <ArrowRight size={15} />}
        </button>
      </form>
      <div style={{ marginTop: 16, padding: '11px 12px', border: '1px solid var(--line)', borderRadius: 10, background: 'rgba(255,255,255,.02)', fontSize: 11, color: 'var(--faint)', lineHeight: 1.6 }}>
        本地演示账号见 README 或部署环境的 <span className="mono">.env</span>。生产环境请使用管理员账号并关闭演示种子。
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 22 }}>
        还没有账号？ <Link to="/signup" style={{ color: 'var(--accent)' }}>创建工作区</Link>
      </p>
    </AuthShell>
  );
}

export function SignupPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/api/auth/signup', { name, email, password, workspaceName: workspaceName || undefined });
      await refresh();
      navigate(destination, { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <div className="brand-mark" style={{ width: 38, height: 38, marginBottom: 18 }}><LogoMark size={22} /></div>
      <h1 className="auth-title">建立你的工作台</h1>
      <p className="auth-sub">30 秒创建账号与团队工作区。之后每一步都由你掌控。</p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <label className="field">
          <span className="label">你的名字</span>
          <input className="input" required minLength={2} maxLength={40} placeholder="例如：林默" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span className="label">工作邮箱</span>
          <input className="input" type="email" autoComplete="email" required placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="field">
          <span className="label">密码</span>
          <input className="input" type="password" autoComplete="new-password" required minLength={12} placeholder="至少 12 位" value={password} onChange={(event) => setPassword(event.target.value)} />
          <span className="hint">使用 scrypt 加盐哈希存储；建议使用密码管理器。</span>
        </label>
        <label className="field">
          <span className="label">工作区名称 <span style={{ color: 'var(--faint)', fontWeight: 400 }}>（可选）</span></span>
          <input className="input" maxLength={48} placeholder={`${name || '我'} 的工作区`} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
        </label>
        {error && <div style={{ color: 'var(--danger)', fontSize: 12, lineHeight: 1.5 }}>{error}</div>}
        <button className="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: '100%', marginTop: 4 }}>
          {loading ? <Loader2 size={15} className="spin" /> : <UserPlus size={15} />}{loading ? '正在创建…' : '免费开始'}
        </button>
      </form>
      <p style={{ color: 'var(--faint)', fontSize: 11, lineHeight: 1.6, marginTop: 14 }}>继续即表示你同意：工作区数据仅存储在部署实例中，管理员可执行审计与内容治理。</p>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 18 }}>
        已有账号？ <Link to="/login" style={{ color: 'var(--accent)' }}>直接登录</Link>
      </p>
    </AuthShell>
  );
}

export function InvitePage() {
  const { token } = useParams();
  const { user, refresh, switchWorkspace } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<{ workspaceName: string; email: string; role: string; inviterName: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    api.get<{ workspaceName: string; email: string; role: string; inviterName: string }>(`/api/invites/${token}`)
      .then(setInvite)
      .catch((caught) => setError(errorMessage(caught)))
      .finally(() => setLoading(false));
  }, [token]);

  async function accept() {
    setAccepting(true);
    try {
      const result = await api.post<{ workspaceId: string }>(`/api/invites/${token}/accept`);
      await refresh();
      switchWorkspace(result.workspaceId);
      navigate(`/app`, { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setAccepting(false);
    }
  }

  return (
    <AuthShell>
      {loading ? <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--muted)' }}><Loader2 size={16} className="spin" /> 正在检查邀请…</div> : error ? (
        <>
          <h1 className="auth-title">邀请不可用</h1>
          <p className="auth-sub">{error}</p>
          <Link to="/app" className="btn">返回工作台</Link>
        </>
      ) : invite ? (
        <>
          <div className="eyebrow">Workspace invitation</div>
          <h1 className="auth-title" style={{ marginTop: 10 }}>加入「{invite.workspaceName}」</h1>
          <p className="auth-sub">{invite.inviterName} 邀请你以 <strong style={{ color: 'var(--text)' }}>{invite.role === 'admin' ? '管理员' : '成员'}</strong> 身份加入，邀请发送至 {invite.email}。</p>
          {!user ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Link className="btn btn-primary btn-lg" to={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>登录后接受邀请</Link>
              <Link className="btn btn-lg" to={`/signup?next=${encodeURIComponent(`/invite/${token}`)}`}>创建账号</Link>
              <p className="hint" style={{ textAlign: 'center' }}>请使用受邀邮箱登录</p>
            </div>
          ) : user.email.toLowerCase() !== invite.email.toLowerCase() ? (
            <div className="card" style={{ padding: 15, borderColor: 'rgba(247,200,115,.25)', color: 'var(--warning)', fontSize: 12 }}>
              当前登录邮箱为 {user.email}，与受邀邮箱不一致。请登出后使用 {invite.email} 登录。
            </div>
          ) : (
            <button className="btn btn-primary btn-lg" onClick={accept} disabled={accepting} style={{ width: '100%' }}>
              {accepting && <Loader2 size={15} className="spin" />}{accepting ? '正在加入…' : '接受邀请并进入工作区'}
            </button>
          )}
        </>
      ) : null}
    </AuthShell>
  );
}
