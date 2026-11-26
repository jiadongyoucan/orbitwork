import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, CheckCircle2, Clock3, FileText, Loader2, ShieldCheck, Sparkles, UsersRound, Workflow,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { WorkforceOverview } from '@/lib/types';
import { Badge, EmptyState, PageHeader, Spinner } from '@/components/UI';
import { relativeTime } from '@/lib/utils';

const EXAMPLES = [
  '分析星图平台 V2.4 本周发布风险，汇总需求、基线、构建、测试与缺陷，输出管理评审报告',
  '评估 V3.1 交付准备度，给出发布准入建议和风险清单',
  '为本周版本生成一份可验收的管理评审报告',
];

const STATUS: Record<string, { label: string; tone: 'accent' | 'muted' | 'warn' | 'danger' | 'sky' }> = {
  planned: { label: '待审批', tone: 'warn' },
  approved: { label: '待执行', tone: 'sky' },
  running: { label: '执行中', tone: 'sky' },
  review: { label: '待验收', tone: 'warn' },
  accepted: { label: '已验收', tone: 'accent' },
  failed: { label: '失败', tone: 'danger' },
};

export default function WorkforcePage() {
  const { workspace } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<WorkforceOverview | null>(null);
  const [objective, setObjective] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);
    api.get<WorkforceOverview>(`/api/w/${workspace.id}/workforce/overview`)
      .then(setOverview)
      .catch((caught) => toast.push(errorMessage(caught), 'error'))
      .finally(() => setLoading(false));
  }, [workspace, toast]);

  async function createGoal() {
    if (!workspace || !objective.trim() || creating) return;
    setCreating(true);
    try {
      const result = await api.post<{ goal: { id: string } }>(`/api/w/${workspace.id}/workforce/goals`, { objective: objective.trim() });
      navigate(`/app/workforce/${result.goal.id}`);
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
      setCreating(false);
    }
  }

  const stats = overview?.stats;

  return (
    <div className="page-wrap fade-in">
      <PageHeader
        eyebrow="AI WORKFORCE OS"
        title="把目标交给一支 AI 团队"
        subtitle="目标 → 工作计划 → AI 员工 → 证据 → 自动校验（MVP 模拟独立验证）→ 人工验收。MVP 使用本地规则证据包，可通过连接器替换为真实企业数据。"
        actions={<Link to="/app/workforce" className="btn" onClick={(event) => { event.preventDefault(); document.getElementById('wf-goal')?.focus(); }}><Sparkles size={14} />发起工作</Link>}
      />

      <section className="wf-hero card" id="wf-goal">
        <div className="wf-hero-copy">
          <div className="eyebrow">AI Manager · Goal intake</div>
          <h2>描述结果，而不是分配任务。</h2>
          <p>AI Manager 会生成可审阅的 SOP，选择合适的 AI 员工，执行后再由验证器自动检查证据。</p>
        </div>
        <div className="wf-goal-box">
          <textarea
            className="wf-textarea"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void createGoal(); }}
            placeholder="例如：分析星图平台 V2.4 本周发布风险，输出管理评审报告…"
            aria-label="AI Workforce 工作目标"
            maxLength={2000}
          />
          <div className="wf-goal-foot">
            <div className="wf-examples">
              {EXAMPLES.map((example) => <button key={example} className="chip" onClick={() => setObjective(example)} title={example}>{example.slice(0, 22)}…</button>)}
            </div>
            <button className="btn btn-primary" disabled={!objective.trim() || creating} onClick={() => void createGoal()}>
              {creating ? <Spinner size={13} /> : <ArrowRight size={14} />}生成工作计划
            </button>
          </div>
        </div>
      </section>

      <div className="wf-stats">
        {[
          { label: '工作目标', value: stats?.total ?? 0, icon: Workflow },
          { label: '进行中', value: stats?.inProgress ?? 0, icon: Clock3 },
          { label: '已验收', value: stats?.accepted ?? 0, icon: CheckCircle2 },
          { label: '验收率', value: `${stats?.verifiedRate ?? 0}%`, icon: ShieldCheck },
        ].map(({ label, value, icon: StatIcon }) => (
          <div className="card wf-stat" key={label}><StatIcon size={15} /><div><b>{value}</b><span>{label}</span></div></div>
        ))}
      </div>

      <div className="wf-layout">
        <section>
          <div className="section-head">
            <span className="section-title">最近工作</span>
            <span className="badge badge-muted">Workspace</span>
          </div>
          <div className="card">
            {loading ? <div style={{ padding: 18 }}><div className="skeleton" style={{ height: 54 }} /></div> : overview?.goals.length ? overview.goals.map((goal) => {
              const status = STATUS[goal.status] ?? STATUS.planned;
              const progress = goal.taskTotal ? Math.round((goal.taskDone / goal.taskTotal) * 100) : 0;
              return (
                <Link to={`/app/workforce/${goal.id}`} className="wf-goal-row" key={goal.id}>
                  <div className="wf-goal-icon"><FileText size={15} /></div>
                  <div className="wf-goal-main">
                    <div className="wf-goal-title">{goal.objective}</div>
                    <div className="wf-goal-meta"><Badge tone={status.tone}>{status.label}</Badge><span>{relativeTime(goal.createdAt)}</span>{goal.taskTotal > 0 && <span>{goal.taskDone}/{goal.taskTotal} 步 · {progress}%</span>}</div>
                  </div>
                  <div className="wf-progress"><span style={{ width: `${progress}%` }} /></div>
                  <ArrowRight size={14} color="var(--faint)" />
                </Link>
              );
            }) : (
              <EmptyState icon={<Workflow size={20} />} title="还没有 AI 工作" description="从上方输入一个业务目标，AI Manager 会生成可审阅的工作计划。" />
            )}
          </div>
        </section>

        <aside>
          <div className="section-head"><span className="section-title">AI 员工</span><span className="badge badge-muted">{overview?.roles.length ?? 0} 个角色</span></div>
          <div className="card wf-roster">
            {(overview?.roles ?? []).map((role) => (
              <div className="wf-role" key={role.id}>
                <div className="wf-role-avatar">{role.name.slice(0, 1)}</div>
                <div style={{ flex: 1, minWidth: 0 }}><div className="wf-role-name">{role.title}</div><div className="wf-role-desc">{role.name}</div></div>
                <span className="wf-role-ready"><span />就绪</span>
              </div>
            ))}
            {!overview && <div className="skeleton" style={{ height: 120 }} />}
          </div>
          <div className="wf-principles">
            <UsersRound size={14} />
            <span>按需组队，最少资源完成目标。每个任务都有负责人、输出契约和证据要求。</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
