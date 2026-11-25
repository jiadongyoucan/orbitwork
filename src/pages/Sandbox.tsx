import { useState } from 'react';
import { Code2, Play, RotateCcw, ShieldCheck, Terminal, Timer } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { PageHeader, Spinner } from '@/components/UI';

const TEMPLATES: Record<string, { label: string; code: string }> = {
  data: {
    label: '数据聚合',
    code: `// 计算一组订阅数据的 ARR 与流失影响
const customers = [
  { name: 'A', mrr: 1200, churned: false },
  { name: 'B', mrr: 800, churned: true },
  { name: 'C', mrr: 2400, churned: false },
  { name: 'D', mrr: 600, churned: true },
];

const arr = customers.reduce((sum, c) => sum + c.mrr * 12, 0);
const churned = customers.filter((c) => c.churned);
const lostArr = churned.reduce((sum, c) => sum + c.mrr * 12, 0);
console.log(JSON.stringify({ arr, lostArr, logoChurn: churned.length / customers.length }, null, 2));`,
  },
  text: {
    label: '文本处理',
    code: `const notes = \`用户说：我们团队最痛的是每周花 4 小时整理周报。
另一个用户：模板很多，但不知道选哪个，最后又回到 Excel。\`;
const insights = notes.split('\\n').map((line, i) => ({ id: i + 1, text: line.trim() }));
console.log(JSON.stringify(insights, null, 2));`,
  },
  algorithm: {
    label: '算法验证',
    code: `function fibonacci(n) {
  let a = 0, b = 1;
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return a;
}
console.log(Array.from({ length: 12 }, (_, i) => fibonacci(i)).join(', '));`,
  },
};

export default function SandboxPage() {
  const { workspace } = useAuth();
  const toast = useToast();
  const [code, setCode] = useState(TEMPLATES.data.code);
  const [output, setOutput] = useState('');
  const [meta, setMeta] = useState<{ ok: boolean; durationMs: number; mode: string } | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    if (!workspace) return;
    setRunning(true);
    setOutput('');
    setMeta(null);
    try {
      const data = await api.post<{ result: { ok: boolean; stdout: string; stderr: string; durationMs: number; mode: string } }>(`/api/w/${workspace.id}/sandbox/run`, { code });
      setOutput([data.result.stdout, data.result.stderr].filter(Boolean).join('\n') || '(无输出)');
      setMeta({ ok: data.result.ok, durationMs: data.result.durationMs, mode: data.result.mode });
    } catch (caught) {
      setOutput(errorMessage(caught));
      setMeta({ ok: false, durationMs: 0, mode: 'error' });
      toast.push(errorMessage(caught), 'error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="page-wrap fade-in">
      <PageHeader
        eyebrow="Sandbox"
        title="代码沙箱"
        subtitle="在独立 sandbox worker 中验证 JavaScript；Docker 部署下无网络、只读、资源受限。"
        actions={<button className="btn btn-primary" onClick={() => void run()} disabled={running}>{running ? <Spinner size={13} /> : <Play size={14} />}{running ? '执行中…' : '运行代码'}</button>}
      />

      <div className="grid-2" style={{ alignItems: 'stretch' }}>
        <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5 }}><Code2 size={14} color="var(--accent)" /><span className="mono">main.mjs</span></div>
            <div style={{ display: 'flex', gap: 5 }}>
              {Object.entries(TEMPLATES).map(([key, template]) => (
                <button key={key} className="chip" style={{ height: 24, fontSize: 10 }} onClick={() => { setCode(template.code); setOutput(''); setMeta(null); }}>{template.label}</button>
              ))}
              <button className="btn btn-ghost btn-sm" style={{ height: 24 }} onClick={() => { setCode(''); setOutput(''); setMeta(null); }}><RotateCcw size={11} />清空</button>
            </div>
          </div>
          <textarea className="code-editor" style={{ border: 0, borderRadius: 0, flex: 1, minHeight: 390 }} spellCheck={false} value={code} onChange={(event) => setCode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void run(); } }} />
          <div style={{ borderTop: '1px solid var(--line)', padding: '9px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: 'var(--faint)' }}>
            <span>Ctrl / ⌘ + Enter 运行</span>
            <span>{code.length} chars</span>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5 }}><Terminal size={14} color="var(--accent)" />输出</div>
            {meta && (
              <div style={{ display: 'flex', gap: 6 }}>
                <span className={`badge ${meta.ok ? 'badge-accent' : 'badge-danger'}`}>{meta.ok ? '成功' : '失败'}</span>
                <span className="badge badge-muted"><Timer size={9} />{meta.durationMs}ms</span>
              </div>
            )}
          </div>
          <div className="console" style={{ border: 0, borderRadius: 0, flex: 1, minHeight: 390, margin: 0 }}>
            {output || <span style={{ color: 'var(--faint)' }}>{running ? '执行中…' : '运行后在这里查看 stdout / stderr。'}</span>}
          </div>
          <div style={{ borderTop: '1px solid var(--line)', padding: '9px 14px', fontSize: 10, color: 'var(--faint)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldCheck size={11} color="var(--accent)" />Docker：无网络 / 只读；开发 worker：本机受限进程 · 6 秒超时
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 16, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div className="feature-icon" style={{ width: 32, height: 32 }}><ShieldCheck size={15} /></div>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>沙箱边界</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7, marginTop: 4 }}>
            代码通过独立 sandbox worker 执行：独立容器、非 root、无外网、只读根文件系统、tmpfs、CPU / 内存 / PID 限制、串行执行与 6 秒超时。
            沙箱不持有数据库、APP_SECRET 或任何连接器密钥。此处只支持 JavaScript，不支持安装 npm 包。
          </div>
        </div>
      </div>
    </div>
  );
}
