import { Link } from 'react-router-dom';
import {
  ArrowRight, Boxes, BrainCircuit, CheckCircle2, Cpu, Fingerprint, Layers3, LockKeyhole,
  Server, ShieldCheck, Sparkles, Workflow,
} from 'lucide-react';
import { Logo, LogoMark } from '@/components/UI';
import { useAuth } from '@/context/AuthContext';

const FEATURES = [
  { icon: Cpu, title: '模型自由，Provider 自管', desc: 'DeepSeek、OpenAI、Qwen、OpenRouter 或任意 OpenAI 兼容接口。一个工作区，一套模型配置。' },
  { icon: Boxes, title: '能力库，而不是提示词堆', desc: '专家、技能、连接器与插件统一沉淀；团队成员复用经过验证的工作方法。' },
  { icon: Workflow, title: '从目标到交付', desc: '描述目标，智能体拆解任务、调用工具、读写文件，把成果留在工作区。' },
  { icon: BrainCircuit, title: '记得上下文，也守得住边界', desc: '长期记忆、推理过程与对话轨迹可查看、可编辑；会话默认仅创建者可见。' },
  { icon: ShieldCheck, title: '工具很多，权限很窄', desc: '服务端 RBAC、对象级授权、受控联网与无网络代码沙箱，默认拒绝，按需开启。' },
  { icon: Server, title: '部署在你自己的机器上', desc: 'SQLite WAL + Docker Compose，单台 ECS 即可运行；会话、文件与密钥留在你的实例，模型请求只发往你配置的 Provider。' },
];

const PIPELINE = [
  { n: '01', title: '描述目标', desc: '一句话说出结果，不必先学提示词工程。' },
  { n: '02', title: '智能体执行', desc: '选择智能体与模型，自动规划、调用技能与工具。' },
  { n: '03', title: '留下成果', desc: '文件、记忆与可回放的轨迹，留在团队工作区。' },
];

export default function Landing() {
  const { user, loading } = useAuth();
  const startPath = user ? '/app' : '/signup';
  return (
    <div className="landing">
      <nav className="landing-nav">
        <Logo />
        <div className="landing-links" style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <a href="#product" style={{ color: 'var(--muted)', fontSize: 12.5 }}>产品</a>
          <a href="#workflow" style={{ color: 'var(--muted)', fontSize: 12.5 }}>工作流</a>
          <a href="#security" style={{ color: 'var(--muted)', fontSize: 12.5 }}>安全</a>
          {!loading && !user && <Link to="/login" className="btn btn-sm">登录</Link>}
          {loading ? <span className="btn btn-primary btn-sm" aria-busy="true">开始创作</span> : <Link to={startPath} className="btn btn-primary btn-sm">开始创作</Link>}
        </div>
      </nav>

      <header className="landing-hero">
        <div className="hero-kicker"><span className="badge badge-accent"><Sparkles size={11} /> ORBITWORK 2.4 · AI WORKBENCH</span></div>
        <h1 className="landing-title">让 AI 从对话<br /><span className="grad">走进真实工作流</span></h1>
        <p className="landing-sub">
          一个能配置模型、使用工具、记住上下文，并把成果留在工作区里的 AI 工作台。
          面向团队，私有部署，数据归你。
        </p>
        <div className="landing-cta">
          {loading ? <span className="btn btn-primary btn-lg" aria-busy="true">开始创作</span> : <Link to={startPath} className="btn btn-primary btn-lg">开始创作 <ArrowRight size={16} /></Link>}
          <a href="#product" className="btn btn-lg">看它如何工作</a>
        </div>
        <div className="hero-note"><CheckCircle2 size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: -2 }} />自托管 · OpenAI 兼容 · DeepSeek / Qwen / 本地模型</div>
        <div className="hero-stats">
          <div><b>12</b><span>能力原语</span></div>
          <div><b>76</b><span>自动化测试</span></div>
          <div><b>1</b><span>条命令部署</span></div>
          <div><b>100%</b><span>自托管部署</span></div>
        </div>
      </header>

      <div className="hero-visual">
        <div className="mock-window">
          <div className="mock-bar"><span className="dot" /><span className="dot" /><span className="dot" /><span style={{ marginLeft: 12, fontSize: 10, color: 'var(--faint)' }}>orbitwork.local / 星图产品实验室</span></div>
          <div className="mock-body">
            <div className="mock-side">
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 20 }}><LogoMark size={17} /><span style={{ fontSize: 11, fontWeight: 700 }}>OrbitWork</span></div>
              {['工作台', '智能体', '能力库', '插件市场', '文件', '记忆'].map((item, index) => (
                <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 7, background: index === 0 ? 'rgba(255,255,255,.06)' : 'transparent', color: index === 0 ? '#fff' : '#737984', fontSize: 10.5 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, border: '1px solid currentColor', opacity: .7 }} />{item}
                </div>
              ))}
              <div style={{ marginTop: 20, paddingTop: 13, borderTop: '1px solid rgba(255,255,255,.08)', color: '#737984', fontSize: 9.5 }}>林默<br /><span style={{ color: '#4f5560' }}>所有者</span></div>
            </div>
            <div className="mock-main">
              <div className="eyebrow">星图产品实验室</div>
              <div style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-.04em', marginTop: 11 }}>今天想完成什么？</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 19 }}>
                <span className="chip" style={{ height: 25, fontSize: 10 }}>把用户访谈整理成洞察</span>
                <span className="chip" style={{ height: 25, fontSize: 10 }}>做一版增长实验方案</span>
              </div>
              <div style={{ marginTop: 22, background: '#15161a', border: '1px solid rgba(255,255,255,.13)', borderRadius: 12, padding: 14, minHeight: 120 }}>
                <div style={{ color: '#666b75', fontSize: 11 }}>描述你想完成的任务，越具体越好…</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 52 }}>
                  <span className="chip" style={{ height: 24, fontSize: 9.5 }}>◎ 通用助理</span>
                  <span className="badge badge-muted" style={{ fontSize: 9 }}>DeepSeek Chat <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent)', display: 'grid', placeItems: 'center' }}><ArrowRight size={11} color="#0b1103" /></span></span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7, marginTop: 14 }}>
                {['深度研究', '数据分析', '生成文档'].map((item) => <span key={item} className="mock-chip" style={{ display: 'grid', placeItems: 'center', fontSize: 9.5, color: '#8c919a' }}>{item}</span>)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 24, color: '#555a63', fontSize: 9.5 }}><LockKeyhole size={11} />工作区隔离 · 会话仅自己可见</div>
            </div>
          </div>
        </div>
      </div>

      <section className="landing-section" id="product">
        <div className="eyebrow">One workbench, every primitive</div>
        <h2>不是一个聊天框，<br />是一套可组装的工作系统。</h2>
        <p className="lead">OrbitWork 把模型、智能体、能力、文件、记忆、权限和部署收进同一个工作区。团队不必在十个工具之间搬运上下文。</p>
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

      <section className="landing-section landing-workflow" id="workflow">
        <div className="landing-split">
          <div>
            <div className="eyebrow">From intent to artifact</div>
            <h2>把“帮我做”<br />变成“已经做完”。</h2>
            <p className="lead">任务不再停在对话框。智能体在工作区里规划、执行、调用工具，并把结果交付成可继续编辑的文件与记忆。</p>
            <div className="pipeline">
              {PIPELINE.map((step, index) => (
                <div className="pipeline-step" key={step.n}>
                  <span className="pipeline-n">{step.n}</span>
                  <div><b>{step.title}</b><small>{step.desc}</small></div>
                  {index < PIPELINE.length - 1 && <ArrowRight className="pipeline-arrow" size={14} />}
                </div>
              ))}
            </div>
          </div>
          <div className="workflow-panel">
            <div className="workflow-line"><span>目标</span><b>整理 12 份用户访谈，输出产品机会简报</b></div>
            <div className="workflow-trace">
              <div><span className="trace-dot" />读取工作区文件 <em>read_file</em></div>
              <div><span className="trace-dot" />调用研究技能 <em>research-brief</em></div>
              <div><span className="trace-dot" />写入交付文件 <em>brief.md</em></div>
            </div>
            <div className="workflow-result"><CheckCircle2 size={15} /><span>已交付到工作区</span><b>brief.md</b></div>
          </div>
        </div>
      </section>

      <section className="landing-section landing-split" id="models">
        <div>
          <div className="eyebrow">Model freedom</div>
          <h2>你的模型，<br />你的 Key。</h2>
          <p className="lead">在工作区里配置任意 OpenAI 兼容 Provider。API Key 只在服务端加密保存，成员只看到已启用的模型。</p>
          <div className="landing-tags">
            {['DeepSeek', 'OpenAI', 'Qwen', 'OpenRouter', 'Ollama', '自定义网关'].map((name) => <span className="chip" key={name}>{name}</span>)}
          </div>
        </div>
        <div className="provider-panel">
          <div className="provider-panel-head"><Cpu size={15} /><span>Provider 配置</span><span className="badge badge-accent">已启用</span></div>
          <div className="provider-row"><span>Base URL</span><code>https://api.deepseek.com/v1</code></div>
          <div className="provider-row"><span>默认模型</span><code>deepseek-chat</code></div>
          <div className="provider-row"><span>API Key</span><code>••••••••••••</code></div>
          <div className="provider-panel-foot"><ShieldCheck size={12} />AES-256-GCM · 按工作区隔离 · 不返回浏览器</div>
          <div className="provider-panel-note">外部模型请求会将提示内容发送至你配置的 Provider。</div>
        </div>
      </section>

      <section className="landing-section" id="security">
        <div className="landing-security">
          <div>
            <div className="eyebrow">Trust by design</div>
            <h2>多人协作，<br />边界清晰。</h2>
            <p>每个请求都在服务端校验身份，每个查询都带工作区条件；会话只对创建者可见。连接器与模型密钥加密保存，关键动作进入审计。</p>
            <div className="landing-tags">
              {['HttpOnly 会话', 'RBAC + 对象授权', 'AES-256-GCM', '审计日志', 'CSP / Origin', '无网络沙箱'].map((item) => (
                <span key={item} className="chip"><ShieldCheck size={11} />{item}</span>
              ))}
            </div>
          </div>
          <div className="security-grid">
            {[
              { icon: Fingerprint, label: '身份与成员' },
              { icon: Layers3, label: '工作区隔离' },
              { icon: LockKeyhole, label: '密钥加密' },
              { icon: ShieldCheck, label: '审核与下架' },
            ].map(({ icon: ItemIcon, label }) => (
              <div key={label} className="security-tile"><ItemIcon size={18} color="var(--accent)" /><span>{label}</span></div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-final">
        <div className="landing-final-inner">
          <div className="eyebrow">Ready when you are</div>
          <h2>把下一个想法，<br />交给一支会使用工具的智能体团队。</h2>
          <div className="landing-cta">
            {loading ? <span className="btn btn-primary btn-lg" aria-busy="true">开始创作</span> : <Link to={startPath} className="btn btn-primary btn-lg">开始创作 <ArrowRight size={16} /></Link>}
            {!loading && !user && <Link to="/login" className="btn btn-lg">已有账号？登录</Link>}
          </div>
          <p className="landing-fine">自托管 · Docker-first · 兼容 OpenAI / DeepSeek / Qwen</p>
        </div>
      </section>

      <footer className="landing-footer">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><LogoMark size={15} /> OrbitWork · AI Workbench</div>
        <div>为真实工作而设计 · Docker-first · 支持私有化部署</div>
      </footer>
    </div>
  );
}
