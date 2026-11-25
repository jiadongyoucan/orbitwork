import { Link } from 'react-router-dom';
import {
  ArrowRight, Boxes, CheckCircle2, Fingerprint, Layers3, LockKeyhole, PackageOpen,
  ShieldCheck, Sparkles, Store, Users, Workflow, Zap,
} from 'lucide-react';
import { Logo, LogoMark } from '@/components/UI';
import { useAuth } from '@/context/AuthContext';

const FEATURES = [
  { icon: Layers3, title: '智能体工作台', desc: '会话、记忆、模型、沙箱、工作区五个核心原语开箱即用。每个智能体都能拥有自己的技能、工具与记忆边界。' },
  { icon: Workflow, title: '专家 × 技能 × 连接器', desc: '把团队方法论沉淀为可复用资产。连接器以标准 HTTP 工具接入第三方系统，密钥加密存储、按工作区隔离。' },
  { icon: Store, title: '可发布、可安装的插件市场', desc: '专家、技能与连接器可打包为插件发布。版本快照、安装计数、精选与审核队列，让能力真正流动起来。' },
  { icon: ShieldCheck, title: '为团队而生的权限模型', desc: '服务端会话、工作区 RBAC、对象级授权、审计日志与平台管理后台。每一条查询都带租户边界。' },
  { icon: Boxes, title: '沙箱隔离执行', desc: '代码在独立、无网络、只读的沙箱容器中运行。超时、并发与输出上限受控，不碰业务进程与密钥。' },
  { icon: Zap, title: '一条命令部署', desc: 'SQLite WAL + Docker Compose，单台 ECS 即可运行。Caddy 自动 TLS，数据卷备份与恢复有据可循。' },
];

const MARKET = [
  { name: '增长策略顾问', kind: '专家', installs: '1.2k' },
  { name: '深度研究简报', kind: '技能', installs: '1.5k' },
  { name: 'Open-Meteo 天气', kind: '连接器', installs: '455' },
  { name: '出海增长工具箱', kind: '插件', installs: '328' },
];

export default function Landing() {
  const { user } = useAuth();
  return (
    <div className="landing">
      <nav className="landing-nav">
        <Logo />
        <div className="landing-links" style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <a href="#product" style={{ color: 'var(--muted)', fontSize: 12.5 }}>产品</a>
          <a href="#market" style={{ color: 'var(--muted)', fontSize: 12.5 }}>市场</a>
          <a href="#security" style={{ color: 'var(--muted)', fontSize: 12.5 }}>安全</a>
          <Link to={user ? '/app' : '/login'} className="btn btn-sm">{user ? '进入工作台' : '登录'}</Link>
          <Link to={user ? '/app' : '/signup'} className="btn btn-primary btn-sm">{user ? '开始创作' : '免费开始'}</Link>
        </div>
      </nav>

      <header className="landing-hero">
        <div className="hero-kicker"><span className="badge badge-accent"><Sparkles size={11} /> ORBITWORK 1.0 · 面向真实工作</span></div>
        <h1 className="landing-title">让智能体<br /><span className="grad">真正进入你的工作流</span></h1>
        <p className="landing-sub">
          一个为团队打造的 AI 工作台：会话、专家、技能、连接器与插件市场。
          把方法论变成可复用的智能体能力，把一次对话变成可交付的成果。
        </p>
        <div className="landing-cta">
          <Link to={user ? '/app' : '/signup'} className="btn btn-primary btn-lg">开始免费使用 <ArrowRight size={16} /></Link>
          <a href="#product" className="btn btn-lg">看看它如何工作</a>
        </div>
        <div className="hero-note"><CheckCircle2 size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: -2 }} />本地 Docker 一键启动 · 支持 DeepSeek / Qwen / 任意 OpenAI 兼容模型</div>
      </header>

      <div className="hero-visual">
        <div className="mock-window">
          <div className="mock-bar"><span className="dot" /><span className="dot" /><span className="dot" /><span style={{ marginLeft: 12, fontSize: 10, color: 'var(--faint)' }}>orbitwork.local / 星图产品实验室</span></div>
          <div className="mock-body">
            <div className="mock-side">
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 20 }}><LogoMark size={17} /><span style={{ fontSize: 11, fontWeight: 700 }}>OrbitWork</span></div>
              {['工作台', '智能体', '专家', '技能', '连接器', '插件市场'].map((item, index) => (
                <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 7, background: index === 0 ? 'rgba(255,255,255,.06)' : 'transparent', color: index === 0 ? '#fff' : '#737984', fontSize: 10.5 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, border: '1px solid currentColor', opacity: .7 }} />{item}
                </div>
              ))}
            </div>
            <div className="mock-main">
              <div className="eyebrow">星图产品实验室</div>
              <div style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-.04em', marginTop: 11 }}>OrbitWork，我帮你</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 19 }}>
                {['办公', '开发', '设计'].map((item, index) => <span key={item} className="chip" style={{ height: 25, fontSize: 10, background: index === 0 ? 'rgba(255,255,255,.07)' : undefined }}>{item}</span>)}
              </div>
              <div style={{ marginTop: 22, background: '#15161a', border: '1px solid rgba(255,255,255,.13)', borderRadius: 12, padding: 14, minHeight: 120 }}>
                <div style={{ color: '#666b75', fontSize: 11 }}>描述你想完成的任务，越具体越好…</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 52 }}>
                  <span className="chip" style={{ height: 24, fontSize: 9.5 }}>＋ 添加</span>
                  <span className="badge badge-muted" style={{ fontSize: 9 }}>DeepSeek Chat <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent)', display: 'grid', placeItems: 'center' }}><ArrowRight size={11} color="#0b1103" /></span></span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7, marginTop: 14 }}>
                {['深度研究', '数据分析', '制作 PPT'].map((item) => <span key={item} className="mock-chip" style={{ display: 'grid', placeItems: 'center', fontSize: 9.5, color: '#8c919a' }}>{item}</span>)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 24, color: '#555a63', fontSize: 9.5 }}><LockKeyhole size={11} />工作区隔离 · 会话仅自己可见</div>
            </div>
          </div>
        </div>
      </div>

      <section className="landing-section" id="product">
        <div className="eyebrow">One workbench, every primitive</div>
        <h2>不只是聊天，是一套可组装的<br />智能体工作系统。</h2>
        <p className="lead">OrbitWork 把 DeepSeek Harness 式的工作区能力、WorkBuddy 式的任务体验，以及插件市场的可扩展性，收敛到一个单机可部署的 Web 应用里。</p>
        <div className="feature-grid">
          {FEATURES.map(({ icon: FeatureIcon, title, desc }) => (
            <div className="feature" key={title}>
              <div className="feature-icon"><FeatureIcon size={17} /></div>
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section" id="market" style={{ paddingTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow">Marketplace</div>
            <h2>能力应该流动，而不是重复造。</h2>
            <p className="lead">发布你的专家、技能与连接器，也可以一键安装别人的最佳实践。所有安装都来自不可变的版本快照。</p>
          </div>
          <Link to="/app/market" className="btn">浏览市场 <ArrowRight size={14} /></Link>
        </div>
        <div className="market-strip">
          {MARKET.map((item) => (
            <div className="market-tile" key={item.name}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="asset-ico" style={{ width: 30, height: 30 }}><PackageOpen size={15} /></div>
                <span className="badge badge-muted">{item.kind}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 650, marginTop: 14 }}>{item.name}</div>
              <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 5 }}>{item.installs} 次安装</div>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section" id="security" style={{ paddingTop: 20 }}>
        <div className="card" style={{ padding: '32px 34px', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 30, alignItems: 'center' }}>
          <div>
            <div className="eyebrow">Trust by design</div>
            <h2 style={{ fontSize: 30, marginTop: 10 }}>多人协作，但边界清晰。</h2>
            <p style={{ color: 'var(--muted)', lineHeight: 1.75, fontSize: 13, marginTop: 13 }}>
              每个请求都在服务端解析成员身份；每个对象查询都带工作区条件；会话只对创建者可见。
              连接器密钥使用 AES-256-GCM 加密，审计日志记录关键动作。
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 18 }}>
              {['HttpOnly 会话', 'RBAC + 对象级授权', 'AES-256-GCM', '审计日志', 'CSP / Origin 校验', '沙箱无网络'].map((item) => (
                <span key={item} className="chip" style={{ fontSize: 10.5 }}><ShieldCheck size={11} />{item}</span>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { icon: Fingerprint, label: '身份与成员' },
              { icon: Users, label: '工作区隔离' },
              { icon: LockKeyhole, label: '密钥加密' },
              { icon: ShieldCheck, label: '审核与下架' },
            ].map(({ icon: ItemIcon, label }) => (
              <div key={label} className="card" style={{ padding: 16, background: '#0b0c0e' }}>
                <ItemIcon size={18} color="var(--accent)" />
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 12 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section" style={{ textAlign: 'center', paddingTop: 30 }}>
        <div className="eyebrow">Ready when you are</div>
        <h2 style={{ maxWidth: 650, margin: '12px auto 0' }}>把下一个想法，交给一支会使用工具的智能体团队。</h2>
        <div className="landing-cta">
          <Link to={user ? '/app' : '/signup'} className="btn btn-primary btn-lg">创建工作区 <ArrowRight size={16} /></Link>
          <Link to="/login" className="btn btn-lg">使用演示账号</Link>
        </div>
      </section>

      <footer className="landing-footer">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><LogoMark size={15} /> OrbitWork · AI Workbench</div>
        <div>为真实工作而设计 · Docker-first · 支持私有化部署</div>
      </footer>
    </div>
  );
}
