import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Boxes, ChevronDown, ChevronRight, Cpu, FolderOpen, LayoutDashboard, LogOut, Menu,
  Plus, Settings, Shield, Store, Users, X, Bot, BrainCircuit, Code2,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Avatar, Logo, LogoMark, Modal, PageLoader, Spinner, Toggle, Field } from '@/components/UI';
import { Icon } from '@/components/Icon';
import { cn, initials, relativeTime } from '@/lib/utils';

const PRIMARY_NAV = [
  { to: '/app', label: '工作台', icon: LayoutDashboard, end: true },
  { to: '/app/agents', label: '智能体', icon: Bot },
  { to: '/app/experts', label: '能力库', icon: Boxes, match: ['/app/experts', '/app/skills', '/app/connectors'] },
  { to: '/app/market', label: '插件市场', icon: Store },
];

const TOOL_NAV = [
  { to: '/app/files', label: '文件', icon: FolderOpen },
  { to: '/app/memories', label: '记忆', icon: BrainCircuit },
  { to: '/app/sandbox', label: '代码沙箱', icon: Code2 },
];

const MANAGE_NAV = [
  { to: '/app/models', label: '模型与 Provider', icon: Cpu, adminOnly: true },
  { to: '/app/members', label: '成员与权限', icon: Users },
  { to: '/app/settings', label: '工作区设置', icon: Settings },
];

function WorkspaceBadge({ name, size = 28 }: { name: string; size?: number }) {
  return <span className="workspace-avatar" style={{ width: size, height: size }}>{initials(name).slice(0, 1)}</span>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, workspace, workspaces, switchWorkspace, logout, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [wsMenu, setWsMenu] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [createWs, setCreateWs] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
    setWsMenu(false);
    setUserMenu(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!workspace) return;
    document.title = `${workspace.name} · OrbitWork`;
  }, [workspace]);

  async function createWorkspace(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      await api.post('/api/workspaces', { name: newWsName, icon: '◎' });
      await refresh();
      setCreateWs(false);
      setNewWsName('');
      toast.push('工作区已创建', 'success');
      navigate('/app');
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <PageLoader />;
  if (!user) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  const currentLabel = [...PRIMARY_NAV, ...TOOL_NAV, ...MANAGE_NAV].find((item) => item.to === location.pathname)?.label
    ?? (['/app/experts', '/app/skills', '/app/connectors'].includes(location.pathname) ? '能力库' : location.pathname.startsWith('/app/c/') ? '对话' : location.pathname === '/app/admin' ? '平台管理' : '工作台');
  const isAdmin = workspace ? workspace.role === 'owner' || workspace.role === 'admin' : false;
  const navActive = (to: string, match: string[] = []) => location.pathname === to || match.includes(location.pathname) || (to !== '/app' && location.pathname.startsWith(`${to}/`));

  if (!workspace) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <div className="card" style={{ width: 'min(440px, 92vw)', padding: 30 }}>
          <Logo />
          <h2 style={{ fontSize: 22, letterSpacing: '-.03em', margin: '24px 0 8px' }}>创建一个工作区</h2>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.65, marginTop: 0 }}>工作区是数据、成员和智能体的隔离边界。你可以创建多个工作区。</p>
          <form onSubmit={createWorkspace} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="工作区名称">
              <input className="input" required minLength={2} maxLength={48} value={newWsName} onChange={(event) => setNewWsName(event.target.value)} placeholder="例如：产品实验室" autoFocus />
            </Field>
            <button className="btn btn-primary" disabled={creating}>{creating ? <Spinner size={13} /> : <Plus size={14} />}创建工作区</button>
          </form>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={() => void logout()}>退出登录</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
      <aside className={cn('sidebar', mobileOpen && 'open')}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link to="/app" aria-label="OrbitWork 首页"><Logo /></Link>
          <button className="btn btn-ghost btn-icon mobile-only" onClick={() => setMobileOpen(false)} aria-label="关闭导航"><X size={16} /></button>
        </div>

        <div style={{ position: 'relative', marginBottom: 10 }}>
          <button className="workspace-switcher" onClick={() => setWsMenu((value) => !value)}>
            <WorkspaceBadge name={workspace.name} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{workspace.name}</span>
              <span style={{ display: 'block', fontSize: 9.5, color: 'var(--faint)', marginTop: 2 }}>{workspace.role === 'owner' ? '所有者' : workspace.role === 'admin' ? '管理员' : '成员'} · {workspaces.length} 个工作区</span>
            </span>
            <ChevronDown size={13} color="var(--faint)" />
          </button>
          {wsMenu && (
            <div className="card" style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 5px)', zIndex: 70, padding: 5, boxShadow: '0 18px 50px rgba(0,0,0,.45)' }}>
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  className="nav-item"
                  style={{ height: 37, background: ws.id === workspace.id ? 'rgba(255,255,255,.05)' : undefined }}
                  onClick={() => { switchWorkspace(ws.id); setWsMenu(false); navigate('/app'); }}
                >
                  <WorkspaceBadge name={ws.name} size={22} />
                  <span style={{ flex: 1, fontSize: 12 }}>{ws.name}</span>
                  {ws.id === workspace.id && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />}
                </button>
              ))}
              <div className="divider" style={{ margin: '4px 0' }} />
              <button className="nav-item" onClick={() => { setWsMenu(false); setCreateWs(true); }}><Plus size={14} />新建工作区</button>
            </div>
          )}
        </div>

        <div className="sidebar-scroll">
          <div className="nav-label"><span>工作</span></div>
          <nav className="nav-group">
            {PRIMARY_NAV.filter((item) => item.to !== '/app/files' || workspace.settings.filesEnabled !== false).map(({ to, label, icon: NavIcon, match }) => (
              <NavLink key={to} to={to} className={cn('nav-item', navActive(to, match) && 'active')}>
                <NavIcon size={15} /><span>{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="nav-label"><span>工具</span></div>
          <nav className="nav-group">
            {TOOL_NAV.filter((item) => item.to !== '/app/files' || workspace.settings.filesEnabled !== false).map(({ to, label, icon: NavIcon }) => (
              <NavLink key={to} to={to} className={cn('nav-item', navActive(to) && 'active')}>
                <NavIcon size={15} /><span>{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="nav-label"><span>管理</span></div>
          <nav className="nav-group">
            {MANAGE_NAV.filter((item) => !item.adminOnly || isAdmin).map(({ to, label, icon: NavIcon }) => (
              <NavLink key={to} to={to} className={cn('nav-item', navActive(to) && 'active')}>
                <NavIcon size={15} /><span>{label}</span>
              </NavLink>
            ))}
            {user.platformRole === 'admin' && (
              <NavLink to="/app/admin" className={cn('nav-item', navActive('/app/admin') && 'active')}>
                <Shield size={15} /><span>平台管理</span>
              </NavLink>
            )}
          </nav>
        </div>

        <div className="sidebar-footer" style={{ position: 'relative' }}>
          {userMenu && (
            <div className="card" style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 70, padding: 5, boxShadow: '0 18px 50px rgba(0,0,0,.45)' }}>
              {isAdmin && <Link to="/app/models" className="nav-item"><Cpu size={14} />模型与 Provider</Link>}
              <Link to="/app/settings" className="nav-item"><Settings size={14} />账号与安全</Link>
              <button className="nav-item" onClick={() => void logout()}><LogOut size={14} />退出登录</button>
            </div>
          )}
          <button className="user-btn" onClick={() => setUserMenu((value) => !value)}>
            <Avatar name={user.name} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 550, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</span>
              <span style={{ display: 'block', fontSize: 9.5, color: 'var(--faint)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</span>
            </span>
            <ChevronDown size={12} color="var(--faint)" />
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <div className="topbar">
          <button className="btn btn-ghost btn-icon mobile-only" onClick={() => setMobileOpen(true)} aria-label="打开导航"><Menu size={18} /></button>
          <div className="crumbs">
            <WorkspaceBadge name={workspace.name} size={18} />
            <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{workspace.name}</span>
            <ChevronRight size={12} />
            <strong>{currentLabel}</strong>
          </div>
          <div style={{ flex: 1 }} />
        </div>
        <div className="main-scroll">{children}</div>
      </main>

      <Modal open={createWs} onClose={() => setCreateWs(false)} title="新建工作区" subtitle="数据、成员与账单的隔离边界。">
        <form onSubmit={createWorkspace} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="工作区名称">
            <input className="input" required minLength={2} maxLength={48} value={newWsName} onChange={(event) => setNewWsName(event.target.value)} placeholder="例如：增长实验室" autoFocus />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setCreateWs(false)}>取消</button>
            <button className="btn btn-primary" disabled={creating}>{creating ? <Spinner size={13} /> : <Plus size={14} />}创建</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
