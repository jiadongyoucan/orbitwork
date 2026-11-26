/**
 * AI Workforce OS — pure domain model for the first vertical slice:
 * goal → plan (SOP) → workforce → evidence → verification → acceptance.
 *
 * Execution is deliberately deterministic in the MVP. This makes the workflow
 * testable and gives the verifier a real evidence contract; connector-backed
 * evidence can replace `buildReleaseSnapshot` later without changing the state
 * machine or UI contracts.
 */

export type WorkforceRole = {
  id: string;
  name: string;
  title: string;
  responsibility: string;
  skills: string[];
};

export const WORKFORCE_ROLES: WorkforceRole[] = [
  { id: 'release-coordinator', name: 'Release Coordinator', title: '发布协调员', responsibility: '收敛版本范围、依赖与交付目标', skills: ['release', 'coordination'] },
  { id: 'requirement-analyst', name: 'Requirement Analyst', title: '需求分析师', responsibility: '梳理需求变更与闭环状态', skills: ['requirements', 'traceability'] },
  { id: 'build-analyst', name: 'Build Analyst', title: '构建分析师', responsibility: '检查基线一致性与构建健康度', skills: ['baseline', 'ci'] },
  { id: 'quality-analyst', name: 'Quality Analyst', title: '质量分析师', responsibility: '分析测试覆盖、缺陷与回归风险', skills: ['quality', 'defects'] },
  { id: 'quality-evaluator', name: 'Quality Evaluator', title: '质量评估员', responsibility: '按业务规则生成可追溯的风险判断', skills: ['risk', 'evaluation'] },
  { id: 'report-writer', name: 'Report Writer', title: '报告撰写员', responsibility: '把证据与判断整理为评审材料', skills: ['writing', 'reporting'] },
  { id: 'independent-verifier', name: 'Verification Agent', title: '验证员', responsibility: '检查证据、结论与验收标准', skills: ['verification', 'evidence'] },
];

export function roleById(id: string): WorkforceRole {
  return WORKFORCE_ROLES.find((role) => role.id === id) ?? WORKFORCE_ROLES[0];
}

export type GoalUnderstanding = {
  objective: string;
  version: string;
  platform: string;
  scope: string;
  desiredOutcome: string;
  assumptions: string[];
};

export type PlanTask = {
  id: string;
  seq: number;
  title: string;
  roleId: string;
  roleName: string;
  kind: 'profile' | 'requirements' | 'build' | 'quality' | 'risk' | 'report' | 'verification';
  dependsOn: string[];
  outputContract: string;
  evidence: string[];
};

export type WorkPlan = {
  version: 1;
  kind: 'release-readiness';
  objective: string;
  versionName: string;
  platform: string;
  scope: string;
  desiredOutcome: string;
  assumptions: string[];
  successCriteria: string[];
  tasks: PlanTask[];
};

export type PlanIssue = { taskId: string; message: string };

export function understandGoal(objective: string): GoalUnderstanding {
  const text = objective.trim();
  const version = text.match(/(?:版本|version|release)\s*[:：]?\s*([A-Za-z0-9._-]+)/i)?.[1]
    ?? text.match(/\b(V?\d+(?:\.\d+){1,3})\b/)?.[1]
    ?? 'V2.4';
  const platform = (text.match(/([A-Za-z\u4e00-\u9fa5]+平台)/)?.[1]
    ?? text.match(/平台\s*[:：]?\s*([^\s，,。；;]+)/)?.[1]
    ?? '星图平台').replace(/^(分析|评估|检查|帮我|请|针对)/, '');
  return {
    objective: text,
    version,
    platform,
    scope: `${platform} ${version} 本周期发布范围`,
    desiredOutcome: '发布准入建议、风险清单与管理评审报告',
    assumptions: ['使用本地示例发布证据包；接入 Jira / Git / CI 后替换为真实数据', '风险阈值由业务负责人确认'],
  };
}

export function buildReleasePlan(goal: GoalUnderstanding): WorkPlan {
  const task = (id: string, seq: number, title: string, roleId: string, kind: PlanTask['kind'], dependsOn: string[], outputContract: string, evidence: string[]): PlanTask => ({
    id, seq, title, roleId, roleName: roleById(roleId).title, kind, dependsOn, outputContract, evidence,
  });
  return {
    version: 1,
    kind: 'release-readiness',
    objective: goal.objective,
    versionName: goal.version,
    platform: goal.platform,
    scope: goal.scope,
    desiredOutcome: goal.desiredOutcome,
    assumptions: goal.assumptions,
    successCriteria: ['每个风险有等级、依据和来源', '证据覆盖版本、需求、构建、测试与缺陷', '报告给出明确的发布建议', '自动校验通过后才能人工验收'],
    tasks: [
      task('t1', 1, '建立版本档案', 'release-coordinator', 'profile', [], '版本范围、目标与关键对象', ['release-profile']),
      task('t2', 2, '盘点需求变更', 'requirement-analyst', 'requirements', ['t1'], '变更清单与未闭环项', ['requirement-changes']),
      task('t3', 3, '核对基线与构建', 'build-analyst', 'build', ['t1'], '基线一致性与 CI 状态', ['baseline-status', 'build-status']),
      task('t4', 4, '汇总质量状态', 'quality-analyst', 'quality', ['t2', 't3'], '测试、缺陷与覆盖摘要', ['test-status', 'defect-summary']),
      task('t5', 5, '生成风险判断', 'quality-evaluator', 'risk', ['t4'], '按规则生成的风险清单', ['risk-assessment']),
      task('t6', 6, '撰写评审报告', 'report-writer', 'report', ['t5'], '可评审的管理报告', ['risk-report']),
      task('t7', 7, '自动校验证据', 'independent-verifier', 'verification', ['t6'], '证据完整性与结论校验', ['verification-result']),
    ],
  };
}

/** Structural checks used before a plan can be approved. */
export function validatePlan(plan: WorkPlan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const ids = new Set<string>();
  for (const task of plan.tasks) {
    if (ids.has(task.id)) issues.push({ taskId: task.id, message: '任务 ID 重复' });
    ids.add(task.id);
  }
  for (const task of plan.tasks) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) issues.push({ taskId: task.id, message: `依赖的 ${dependency} 不存在` });
    }
  }
  // Kahn's algorithm: a plan with a dependency cycle cannot be executed.
  const indegree = new Map(plan.tasks.map((task) => [task.id, task.dependsOn.length]));
  const queue = plan.tasks.filter((task) => indegree.get(task.id) === 0).map((task) => task.id);
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    visited.add(id);
    for (const next of plan.tasks.filter((task) => task.dependsOn.includes(id))) {
      indegree.set(next.id, (indegree.get(next.id) ?? 1) - 1);
      if (indegree.get(next.id) === 0) queue.push(next.id);
    }
  }
  if (visited.size !== plan.tasks.length) issues.push({ taskId: 'plan', message: '任务依赖存在循环' });
  if (!plan.tasks.length) issues.push({ taskId: 'plan', message: '计划没有任务' });
  return issues;
}

export type ReleaseSnapshot = {
  version: string;
  platform: string;
  requirements: { total: number; changed: number; unclosed: number };
  baselines: { total: number; mismatched: number };
  builds: { total: number; failed: number };
  tests: { total: number; passed: number; failed: number; coverage: number };
  defects: { blocker: number; major: number; minor: number; open: number };
};

/** Deterministic local evidence pack for the MVP; replace with connectors later. */
export function buildReleaseSnapshot(goal: GoalUnderstanding): ReleaseSnapshot {
  const seed = [...goal.version].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return {
    version: goal.version,
    platform: goal.platform,
    requirements: { total: 42, changed: 8 + (seed % 3), unclosed: 2 + (seed % 2) },
    baselines: { total: 4, mismatched: 1 },
    builds: { total: 7, failed: 1 },
    tests: { total: 148, passed: 139, failed: 9, coverage: 84 },
    defects: { blocker: 1, major: 3, minor: 8, open: 4 },
  };
}

export type Evidence = { id: string; title: string; kind: string; source: string; payload: unknown };

export type TaskResult = { output: string; evidence: Omit<Evidence, 'id'>[] };

export function executeTask(kind: PlanTask['kind'], snapshot: ReleaseSnapshot): TaskResult {
  switch (kind) {
    case 'profile':
      return {
        output: `版本 **${snapshot.platform} ${snapshot.version}** 已建档。范围包含 ${snapshot.requirements.total} 条需求、${snapshot.baselines.total} 个基线、${snapshot.builds.total} 次构建。`,
        evidence: [{ title: '版本档案', kind: 'release-profile', source: 'workforce.local/release-profile', payload: snapshot }],
      };
    case 'requirements':
      return {
        output: `需求变更 ${snapshot.requirements.changed} 条，其中 ${snapshot.requirements.unclosed} 条未闭环。未闭环项必须进入发布评审。`,
        evidence: [{ title: '需求变更清单', kind: 'requirement-changes', source: 'workforce.local/requirements', payload: snapshot.requirements }],
      };
    case 'build':
      return {
        output: `基线 ${snapshot.baselines.total} 个，${snapshot.baselines.mismatched} 个不一致；构建 ${snapshot.builds.total} 次，${snapshot.builds.failed} 次失败。`,
        evidence: [
          { title: '基线一致性', kind: 'baseline-status', source: 'workforce.local/baselines', payload: snapshot.baselines },
          { title: '构建状态', kind: 'build-status', source: 'workforce.local/builds', payload: snapshot.builds },
        ],
      };
    case 'quality':
      return {
        output: `测试 ${snapshot.tests.total} 个，通过 ${snapshot.tests.passed} 个，失败 ${snapshot.tests.failed} 个，覆盖率 ${snapshot.tests.coverage}%。开放缺陷：Blocker ${snapshot.defects.blocker} / Major ${snapshot.defects.major} / Minor ${snapshot.defects.minor}。`,
        evidence: [
          { title: '测试结果', kind: 'test-status', source: 'workforce.local/tests', payload: snapshot.tests },
          { title: '缺陷汇总', kind: 'defect-summary', source: 'workforce.local/defects', payload: snapshot.defects },
        ],
      };
    case 'risk': {
      const risks = evaluateRisks(snapshot);
      return {
        output: risks.map((risk) => `- **${risk.level} · ${risk.title}**：${risk.detail}`).join('\n'),
        evidence: [{ title: '风险判断', kind: 'risk-assessment', source: 'workforce.local/rules', payload: risks }],
      };
    }
    case 'report': {
      const risks = evaluateRisks(snapshot);
      const decision = risks.some((risk) => risk.level === '阻断') ? '不建议按期发布' : '有条件发布';
      return {
        output: reportMarkdown(snapshot, risks, decision),
        evidence: [{ title: '管理评审报告', kind: 'risk-report', source: 'workforce.local/report', payload: { decision, riskCount: risks.length } }],
      };
    }
    case 'verification':
      return {
        output: '验证输入已固化：证据覆盖版本、需求、基线、构建、测试、缺陷与风险，报告包含明确发布建议。',
        evidence: [{ title: '验证输入', kind: 'verification-result', source: 'workforce.local/verifier', payload: { status: 'ready' } }],
      };
  }
}

export type Risk = { level: '阻断' | '高' | '中' | '低'; title: string; detail: string; source: string };

export function evaluateRisks(snapshot: ReleaseSnapshot): Risk[] {
  const risks: Risk[] = [];
  if (snapshot.defects.blocker > 0) risks.push({ level: '阻断', title: '存在 Blocker 缺陷', detail: `${snapshot.defects.blocker} 个 Blocker 未关闭，不满足发布准入。`, source: 'defect-summary' });
  if (snapshot.builds.failed > 0) risks.push({ level: '高', title: '构建失败', detail: `${snapshot.builds.failed} 次构建失败，需要修复后重新验证。`, source: 'build-status' });
  if (snapshot.requirements.unclosed > 0) risks.push({ level: '高', title: '需求未闭环', detail: `${snapshot.requirements.unclosed} 条变更未闭环，可能影响交付范围。`, source: 'requirement-changes' });
  if (snapshot.baselines.mismatched > 0) risks.push({ level: '中', title: '基线不一致', detail: `${snapshot.baselines.mismatched} 个基线需要核对。`, source: 'baseline-status' });
  if (snapshot.tests.coverage < 85) risks.push({ level: '中', title: '测试覆盖率不足', detail: `当前覆盖率 ${snapshot.tests.coverage}%，低于 85% 目标。`, source: 'test-status' });
  if (snapshot.defects.major >= 3) risks.push({ level: '中', title: 'Major 缺陷偏高', detail: `${snapshot.defects.major} 个 Major 缺陷需要评估影响范围。`, source: 'defect-summary' });
  if (!risks.length) risks.push({ level: '低', title: '未发现阻断风险', detail: '证据未触发风险规则。', source: 'rules' });
  return risks;
}

function reportMarkdown(snapshot: ReleaseSnapshot, risks: Risk[], decision: string): string {
  return `# 发布准备度评审\n\n**范围：** ${snapshot.platform} ${snapshot.version}\n\n**结论：** ${decision}\n\n## 风险摘要\n\n${risks.map((risk) => `### ${risk.level} · ${risk.title}\n${risk.detail}\n\n来源：\`${risk.source}\``).join('\n\n')}\n\n## 建议\n\n1. 关闭 Blocker 并重新执行回归。\n2. 完成未闭环需求的影响评估。\n3. 基线与构建负责人确认最终交付物。\n\n> 本报告由本地证据包生成；接入企业系统后应替换为真实数据。`;
}

export type VerificationCheck = { id: string; label: string; status: 'pass' | 'warn'; detail: string };
export type Verification = { verdict: 'pass' | 'conditional'; score: number; checks: VerificationCheck[]; riskLevel: Risk['level'] };

export function verifyTasks(tasks: Array<{ status: string; evidence: Evidence[]; kind: string }>): Verification {
  const riskEvidence = tasks.flatMap((task) => task.evidence).find((item) => item.kind === 'risk-assessment')?.payload;
  const riskRank: Record<string, number> = { '低': 0, '中': 1, '高': 2, '阻断': 3 };
  const riskLevel = (Array.isArray(riskEvidence) ? riskEvidence as Risk[] : [])
    .reduce<Risk['level']>((highest, risk) => riskRank[risk.level] > riskRank[highest] ? risk.level : highest, '低');
  const checks: VerificationCheck[] = [
    { id: 'tasks', label: '全部任务完成', status: tasks.every((task) => task.status === 'done') ? 'pass' : 'warn', detail: `${tasks.filter((task) => task.status === 'done').length}/${tasks.length} 个任务完成` },
    { id: 'evidence', label: '证据覆盖', status: tasks.every((task) => task.evidence.length > 0) ? 'pass' : 'warn', detail: `${tasks.reduce((sum, task) => sum + task.evidence.length, 0)} 条证据` },
    { id: 'report', label: '报告包含发布建议', status: tasks.find((task) => task.kind === 'report')?.evidence.length ? 'pass' : 'warn', detail: '报告与风险判断已生成' },
    { id: 'independence', label: '自动校验（模拟独立验证）', status: tasks.some((task) => task.kind === 'verification') ? 'pass' : 'warn', detail: '由同一执行流程自动检查，尚未接入独立 Runtime/模型' },
    { id: 'blockers', label: '阻断风险已关闭', status: riskLevel === '阻断' ? 'warn' : 'pass', detail: riskLevel === '阻断' ? '存在阻断级风险，需人工风险接受' : '未发现阻断级风险' },
  ];
  const passed = checks.filter((check) => check.status === 'pass').length;
  return { verdict: passed === checks.length ? 'pass' : 'conditional', score: Math.round((passed / checks.length) * 100), checks, riskLevel };
}
