import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileText, FolderOpen, Image as ImageIcon, Lock, Search, Trash2, Upload } from 'lucide-react';
import { api, errorMessage, uploadFile } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { WorkspaceFile } from '@/lib/types';
import { Badge, ConfirmModal, EmptyState, ErrorState, Modal, PageHeader, Spinner } from '@/components/UI';
import { formatDate } from '@/lib/utils';

type Usage = { bytes: number; count: number; maxBytes: number; maxCount: number; maxFileBytes: number };

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function FilesPage() {
  const { workspace, user } = useAuth();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [role, setRole] = useState('member');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ file: WorkspaceFile; text?: string; truncated?: boolean } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deleting, setDeleting] = useState<WorkspaceFile | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const filesDisabled = workspace?.settings.filesEnabled === false;
  const isAdmin = workspace?.role === 'owner' || workspace?.role === 'admin';

  async function load() {
    if (!workspace) return;
    if (workspace.settings.filesEnabled === false) { setLoading(false); return; }
    setLoading(true);
    setLoadError('');
    try {
      const data = await api.get<{ files: WorkspaceFile[]; usage: Usage; role: string }>(`/api/w/${workspace.id}/files`);
      setFiles(data.files);
      setUsage(data.usage);
      setRole(data.role);
    } catch (caught) {
      setLoadError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [workspace]);

  async function upload(list: FileList | File[] | null) {
    if (!workspace || !list) return;
    const items = Array.from(list);
    if (!items.length) return;
    const tooBig = items.filter((file) => usage && file.size > usage.maxFileBytes);
    if (tooBig.length) toast.push(`${tooBig.map((file) => file.name).join('、')} 超过单文件上限`, 'error');
    const accepted = items.filter((file) => !usage || file.size <= usage.maxFileBytes);
    if (!accepted.length) return;
    setUploading(accepted.length);
    let failed = 0;
    for (const file of accepted) {
      try { await uploadFile(workspace.id, file); }
      catch (caught) { failed += 1; toast.push(`${file.name}：${errorMessage(caught)}`, 'error'); }
    }
    setUploading(0);
    if (!failed) toast.push(`已上传 ${accepted.length} 个文件`, 'success');
    await load();
  }

  async function openPreview(file: WorkspaceFile) {
    if (!workspace) return;
    setPreview({ file });
    if (file.mime.startsWith('image/') || !file.text) return;
    setPreviewLoading(true);
    try {
      const data = await api.get<{ text: string; truncated: boolean }>(`/api/w/${workspace.id}/files/${file.id}/text`);
      setPreview({ file, text: data.text, truncated: data.truncated });
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function remove() {
    if (!workspace || !deleting) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/api/w/${workspace.id}/files/${deleting.id}`);
      setDeleting(null);
      toast.push('文件已删除', 'success');
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setDeleteLoading(false);
    }
  }

  async function download(file: WorkspaceFile) {
    if (!workspace) return;
    try {
      const response = await fetch(`/api/w/${workspace.id}/files/${file.id}/content?download=1`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(response.status === 403 ? '文件功能已被管理员关闭' : '下载失败，请重试');
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = file.name;
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    }
  }

  const canDelete = (file: WorkspaceFile) => role !== 'member' || file.createdBy === user?.id;
  const filtered = files.filter((file) => !q.trim() || file.name.toLowerCase().includes(q.trim().toLowerCase()));
  const percent = usage && usage.maxBytes > 0 ? Math.min(100, Math.round((usage.bytes / usage.maxBytes) * 100)) : 0;

  if (filesDisabled) {
    return (
      <div className="page-wrap fade-in">
        <PageHeader eyebrow="Workspace files" title="文件" subtitle="工作区文件能力当前已关闭。" />
        <div className="card">
          <EmptyState
            icon={<Lock size={20} />}
            title="管理员已关闭工作区文件"
            description="开启后即可上传资料，智能体也会恢复 list_files / read_file / write_file 工具。"
            action={isAdmin ? <Link className="btn btn-sm btn-primary" to="/app/settings?tab=workspace">前往账号与安全</Link> : <span className="hint">请联系管理员开启</span>}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrap fade-in">
      <PageHeader
        eyebrow="Workspace files"
        title="文件"
        subtitle="上传资料给智能体读，或让它把产出写成文件。文件按工作区隔离，所有成员可见。"
        actions={
          <button className="btn btn-primary" disabled={uploading > 0} onClick={() => inputRef.current?.click()}>
            {uploading > 0 ? <Spinner size={13} /> : <Upload size={14} />}{uploading > 0 ? `上传中 ${uploading}` : '上传文件'}
          </button>
        }
      />

      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(event) => { void upload(event.target.files); event.target.value = ''; }}
      />

      <div
        className="card"
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        style={{
          padding: '20px 16px', marginBottom: 16, textAlign: 'center', cursor: 'pointer',
          borderStyle: 'dashed', borderColor: dragging ? 'var(--accent)' : 'var(--line)',
          background: dragging ? 'rgba(200,247,104,.05)' : 'transparent',
        }}
      >
        <FolderOpen size={20} color="var(--accent)" />
        <div style={{ fontSize: 12.5, marginTop: 8 }}>拖拽文件到这里，或点击选择</div>
        <div className="hint" style={{ marginTop: 4 }}>
          支持文本、代码、CSV、JSON、图片与任意二进制；单文件 ≤ {usage ? humanSize(usage.maxFileBytes) : '5 MB'}。
          上传后智能体可用 <span className="mono">list_files</span> / <span className="mono">read_file</span> 读取。
        </div>
      </div>

      {usage && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--muted)', marginBottom: 7 }}>
            <span>工作区存储 <Badge tone={percent > 85 ? 'warn' : 'muted'}>{humanSize(usage.bytes)} / {humanSize(usage.maxBytes)}</Badge></span>
            <span>{usage.count} / {usage.maxCount} 个文件</span>
          </div>
          <div style={{ height: 5, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}>
            <div style={{ width: `${percent}%`, height: '100%', background: percent > 85 ? 'var(--warning)' : 'var(--accent)' }} />
          </div>
        </div>
      )}

      <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="label">{filtered.length} 个文件</div>
        <div className="search"><Search size={14} /><input className="input" placeholder="搜索文件名…" value={q} onChange={(event) => setQ(event.target.value)} /></div>
      </div>

      {loading ? (
        <div className="card"><div className="skeleton" style={{ height: 140 }} /></div>
      ) : loadError ? (
        <div className="card"><ErrorState message={loadError} onRetry={() => void load()} /></div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FolderOpen size={20} />}
            title={files.length ? '没有匹配的文件' : '还没有文件'}
            description={files.length ? '换个关键词试试。' : '上传一份资料，然后在对话里让智能体读取它、总结它或基于它产出新文件。'}
            action={<button className="btn btn-sm btn-primary" onClick={() => inputRef.current?.click()}><Upload size={13} />上传第一个文件</button>}
          />
        </div>
      ) : (
        <div className="card" style={{ padding: 6 }}>
          {filtered.map((file, index) => (
            <div
              key={file.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px',
                borderTop: index ? '1px solid var(--line)' : 'none',
              }}
            >
              <div className="asset-ico" style={{ width: 30, height: 30, flexShrink: 0 }}>
                {file.mime.startsWith('image/') ? <ImageIcon size={14} /> : <FileText size={14} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <button
                  onClick={() => void openPreview(file)}
                  style={{ background: 'none', border: 0, padding: 0, color: 'var(--text)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', textAlign: 'left', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={file.name}
                >
                  {file.name}
                </button>
                <div style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 2 }}>
                  {humanSize(file.size)} · {formatDate(file.updatedAt)}{file.text ? ' · 可读取' : ' · 仅下载'}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => void openPreview(file)}>预览</button>
              <button className="btn btn-ghost btn-icon btn-sm" style={{ width: 27 }} onClick={() => void download(file)} aria-label={`下载 ${file.name}`}><Download size={12} /></button>
              {canDelete(file) && (
                <button className="btn btn-ghost btn-icon btn-sm" style={{ width: 27 }} onClick={() => setDeleting(file)} aria-label={`删除 ${file.name}`}><Trash2 size={12} /></button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="hint" style={{ marginTop: 14 }}>
        文件内容不会被当作指令执行。智能体写入的文件与上传物共用同一命名空间，同名写入即覆盖。
      </div>

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        large
        title={preview?.file.name ?? ''}
        subtitle={preview ? `${humanSize(preview.file.size)} · ${preview.file.mime} · ${formatDate(preview.file.updatedAt)}` : ''}
        footer={preview ? (
          <>
            <button className="btn" onClick={() => void download(preview.file)}><Download size={13} />下载原文件</button>
            <button className="btn btn-primary" onClick={() => setPreview(null)}>关闭</button>
          </>
        ) : undefined}
      >
        {preview?.file.mime.startsWith('image/') ? (
          <img src={`/api/w/${workspace?.id}/files/${preview.file.id}/content`} alt={preview.file.name} style={{ maxWidth: '100%', borderRadius: 8 }} />
        ) : previewLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--faint)', fontSize: 12 }}><Spinner size={14} />正在读取文本…</div>
        ) : preview?.text !== undefined ? (
          <>
            <pre className="console" style={{ maxHeight: '50vh', overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap', fontSize: 11 }}>{preview.text || '（空文件）'}</pre>
            {preview.truncated && <div className="hint" style={{ marginTop: 8 }}>文件较大，仅显示前 100KB。</div>}
          </>
        ) : (
          <div className="hint">该文件不是文本类型，无法预览。请下载后查看。</div>
        )}
      </Modal>

      <ConfirmModal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove()}
        title="删除文件"
        description={`确定删除「${deleting?.name ?? ''}」吗？智能体将立即无法读取它，此操作不可恢复。`}
        loading={deleteLoading}
      />
    </div>
  );
}
