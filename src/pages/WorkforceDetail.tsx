import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, Circle, Clock3, FileText, Loader2,
  Play, ShieldCheck, Sparkles, XCircle,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { WorkforceGoal, WorkforceTask } from '@/lib/types';
import { Badge, ErrorState, Modal, Spinner } from '@/components/UI';
import { Markdown } from '@/components/Markdown';
import { cn, formatDate } from '@/lib/utils';

const STATUS: Record<string, { label: string; tone: 'accent' | 'muted' | 'warn' | 'danger' | 'sky' }> = {
  planned: { label: '待审批', tone: 'warn' },
  approved: { label: '待执行', tone: 'sky' },
  running: { label: '执行中', tone: 'sky' },
  review: { label: '待验收', tone: 'warn' },
  accepted: { label: '已验收', tone: 'accent' },
  failed: { label: '失败', tone: 'danger' },
};

function TaskIcon({ status }: { status: string }) {
  if (status === 'done') return <CheckCircle2 size={15} color="var(--accent)" />;
  if (status === 'running') return <Loader2 size={15} color="var(--sky)" className="spin" />;
  if (status === 'failed') return <XCircle size={15} color="var(--danger)" />;
  return <Circle size={15} color="var(--faint)" />;
}

function TaskRow({ task, planned }: { task: WorkforceTask; planned?: boolean }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !planned && (task.output || task.evidence.length > 0);
  return (
    <div className={cn('wf-task', task.status === 'done' && 'done', task.status === 'running' && 'running')}>
      <div className="wf-task-main">
        <span className="wf-task-seq">{String(task.seq).padStart(2, '0')}</span>
        <TaskIcon status={planned ? 'pending' : task.status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="wf-task-title">{task.title}</div>
          <div className="wf-task-meta">{task.roleName}{task.dependsOn.length ? ` · 依赖 ${task.dependsOn.join(', ')}` : ''}</div>
        </div>
        {hasDetail && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setOpen((value) => !value)} aria-label="展开任务输出"><ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : undefined }} /></button>}
      </div>
      {planned && task.outputContract && <div className="wf-task-contract">输出：{task.outputContract}</div>}
      {open && hasDetail && (
        <div className="wf-task-detail">
          {task.error && <div className="wf-task-error">{task.error}</div>}
          {task.output && <Markdown content={task.output} />}
          {task.evidence.length > 0 && <div className="wf-evidence-list">{task.evidence.map((item) => <span key={item.id} className="wf-evidence-chip"><FileText size={10} />{item.title}</span>)}</div>}
        </div>
      )}
    </div>
  );
}

export default function WorkforceDetailPage() {
  const { workspace, user } = useAuth();
  const toast = useToast();
  const { goalId } = useParams();
  const [goal, setGoal] = useState<WorkforceGoal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [acceptReason, setAcceptReason] = useState('');

  async function load() {
    if (!workspace || !goalId) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.get<{ goal: WorkforceGoal }>(`/api/w/${workspace.id}/workforce/goals/${goalId}`);
      setGoal(data.goal);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [workspace, goalId]);

  async function act(action: 'approve' | 'execute' | 'accept') {
    if (!workspace || !goal || busy) return;
    setBusy(action);
    try {
      const url = action === 'approve'
        ? `/api/w/${workspace.id}/workforce/goals/${goal.id}/approve`
        : `/api/w/${workspace.id}/workforce/runs/${goal.run?.id}/${action}`;
      const data = await api.post<{ goal: WorkforceGoal }>(url, action === 'accept' ? { acceptRisk: run?.verification?.verdict !== 'pass', overrideReason: acceptReason.trim() } : {});
      setGoal(data.goal);
      setAcceptOpen(false);
      setAcceptReason('');
      toast.push(action === 'approve' ? '计划已批准，AI 团队已就绪' : action === 'execute' ? '执行完成，已进入验收' : '工作成果已验收', 'success');
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setBusy('');
    }
  }

  if (loading) return <div className="page-wrap"><div className="skeleton" style={{ height: 320 }} /></div>;
  if (error || !goal) return <div className="page-wrap"><div className="card"><ErrorState message={error || '工作目标不存在'} onRetry={() => void load()} /></div></div>;

  const run = goal.run;
  const canManage = workspace?.role !== 'member' || goal.ownerId === user?.id;
  const canAccept = workspace?.role === 'owner' || workspace?.role === 'admin';
  const status = STATUS[goal.status] ?? STATUS.planned;
  const done = run?.tasks.filter((task) => task.status === 'done').length ?? 0;
  const total = run?.tasks.length ?? goal.plan.tasks.length;
  const risks = run?.tasks.flatMap((task) => task.evidence).find((item) => item.kind === 'risk-assessment')?.payload as Array<{ level: string; title: string; detail: string }> | undefined;

  return (
    <div className="page-wrap fade-in wf-detail">
      <div className="wf-detail-top">
        <Link to="/app/workforce" className="btn btn-ghost btn-sm"><ArrowLeft size={14} />AI Workforce</Link>
        <Badge tone={status.tone}>{status.label}</Badge>{!canManage && <Badge tone="muted">只读</Badge>}
      </div>

      <header className="wf-detail-head">
        <div>
          <div className="eyebrow">AI WORKFORCE OS · {goal.plan.versionName} · {goal.plan.platform}</div>
          <h1>{goal.objective}</h1>
          <p>{goal.plan.scope} · 创建于 {formatDate(goal.createdAt)}</p>
        </div>
        <div className="wf-detail-actions">
          {canManage && goal.status === 'planned' && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void act('approve')}>{busy === 'approve' ? <Spinner size={13} /> : <Check size={14} />}批准计划</button>}
          {canManage && goal.status === 'approved' && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void act('execute')}>{busy === 'execute' ? <Spinner size={13} /> : <Play size={14} />}执行工作流</button>}
          {canAccept && goal.status === 'review' && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => run?.verification?.verdict === 'pass' ? void act('accept') : setAcceptOpen(true)}>{busy === 'accept' ? <Spinner size={13} /> : <ShieldCheck size={14} />}{run?.verification?.verdict === 'pass' ? '验收通过' : '接受风险并验收'}</button>}
          {canManage && (goal.status === 'failed' || run?.status === 'failed') && <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void act('execute')}>{busy === 'execute' ? <Spinner size={13} /> : <Play size={14} />}重新执行</button>}
        </div>
      </header>

      {run?.synthetic && <div className="wf-synthetic"><Sparkles size={14} /><div><b>本地示例证据</b><span>当前快照为固定测试数据，不代表真实 Jira / Git / Jenkins / DPLM 数据，不可直接作为发布决策依据。</span></div></div>}
      {goal.status === 'accepted' && (
        <div className="wf-accepted"><CheckCircle2 size={18} /><div><b>工作成果已验收</b><span>示例报告、证据与验证结果已留在工作区；真实发布仍需连接企业数据源。</span></div><span>{run?.acceptedAt ? formatDate(run.acceptedAt) : ''}</span></div>
      )}

      <div className="wf-detail-grid">
        <div className="wf-detail-main">
          <section className="card wf-section">
            <div className="wf-section-head"><div><span className="eyebrow">Structured plan</span><h2>{run ? '执行进度' : '工作计划（SOP）'}</h2></div>{run && <span className="wf-progress-label">{done}/{total} 步完成</span>}</div>
            {run && <div className="wf-progress wf-progress-lg"><span style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>}
            <div className="wf-tasks">
              {(run?.tasks ?? goal.plan.tasks).map((task) => <TaskRow key={task.id} task={task as WorkforceTask} planned={!run} />)}
            </div>
            {!run && canManage && <div className="wf-plan-foot"><span><Sparkles size={13} />计划可审阅，批准后才会创建执行任务。</span><button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => void act('approve')}>批准并创建执行</button></div>}
            {canManage && run?.status === 'failed' && <div className="wf-plan-foot"><span><XCircle size={13} />执行中断，可重新执行；已完成任务会保留。</span><button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => void act('execute')}>重新执行</button></div>}
            {canManage && run?.status === 'approved' && <div className="wf-plan-foot"><span><Clock3 size={13} />AI 团队已就绪，执行会按依赖顺序完成全部任务。</span><button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => void act('execute')}>执行工作流</button></div>}
          </section>

          {run?.report && (
            <section className="card wf-section">
              <div className="wf-section-head"><div><span className="eyebrow">Deliverable</span><h2>管理评审报告</h2></div><Badge tone="accent">已生成</Badge></div>
              <div className="wf-report"><Markdown content={run.report} /></div>
            </section>
          )}
        </div>

        <aside className="wf-detail-side">
          <section className="card wf-side-card">
            <div className="wf-side-title">目标与约束</div>
            <div className="wf-kv"><span>期望成果</span><b>{goal.plan.desiredOutcome}</b></div>
            <div className="wf-kv"><span>负责人</span><b>AI Manager</b></div>
            <div className="wf-kv"><span>审批模式</span><b>人工审批</b></div>
            <div className="wf-side-sub">假设</div>
            <ul className="wf-assumptions">{goal.plan.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>

          {run?.verification && (
            <section className="card wf-side-card">
              <div className="wf-side-title"><ShieldCheck size={14} />自动校验（模拟独立验证） <span className="wf-score">{run.verification.score}</span></div>
              {run.verification.checks.map((check) => <div className="wf-check" key={check.id}><span className={check.status === 'pass' ? 'ok' : 'warn'}>{check.status === 'pass' ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}</span><div><b>{check.label}</b><small>{check.detail}</small></div></div>)}
              <div className={cn('wf-verdict', run.verification.verdict === 'pass' ? 'pass' : 'warn')}>{run.verification.verdict === 'pass' ? '证据完整，可进入人工验收' : '存在未通过项，请人工判断'}</div>
            </section>
          )}

          {Boolean(risks?.length) && (
            <section className="card wf-side-card">
              <div className="wf-side-title"><XCircle size={14} />关键风险</div>
              {risks!.slice(0, 4).map((risk) => <div className="wf-risk" key={risk.title}><Badge tone={risk.level === '阻断' ? 'danger' : risk.level === '高' ? 'warn' : 'muted'}>{risk.level}</Badge><div><b>{risk.title}</b><small>{risk.detail}</small></div></div>)}
            </section>
          )}

          <section className="card wf-side-card">
            <div className="wf-side-title">工作流</div>
            <div className="wf-flow"><span>目标</span><ArrowRight size={11} /><span>SOP</span><ArrowRight size={11} /><span>执行</span><ArrowRight size={11} /><span>验证</span><ArrowRight size={11} /><span>验收</span></div>
            <div className="wf-side-sub">验证标准</div>
            <ul className="wf-assumptions">{goal.plan.successCriteria.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
        </aside>
      </div>

      <Modal
        open={acceptOpen}
        onClose={() => setAcceptOpen(false)}
        title="接受风险并验收"
        subtitle="自动校验未通过，管理员可以在记录原因后进行风险接受。"
        footer={<><button className="btn" onClick={() => setAcceptOpen(false)}>取消</button><button className="btn btn-primary" disabled={!acceptReason.trim() || Boolean(busy)} onClick={() => void act('accept')}>{busy === 'accept' ? <Spinner size={13} /> : <ShieldCheck size={13} />}确认验收</button></>}
      >
        <label className="field"><span className="label">风险接受原因</span><textarea className="input" style={{ minHeight: 88, resize: 'vertical' }} maxLength={500} value={acceptReason} onChange={(event) => setAcceptReason(event.target.value)} placeholder="说明为什么在存在风险的情况下仍可验收，例如：业务负责人确认发布窗口，阻断项已有回滚方案。" /></label>
      </Modal>
    </div>
  );
}
