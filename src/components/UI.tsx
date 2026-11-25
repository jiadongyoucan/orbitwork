import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, Copy, Loader2, RefreshCw, X } from 'lucide-react';
import { cn, copyText, initials } from '@/lib/utils';
import { LogoMark } from './Icon';
export { LogoMark } from './Icon';

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="加载中" />;
}

export function PageLoader() {
  return (
    <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--faint)', fontSize: 12 }}>
        <Spinner size={22} />
        正在载入工作台…
      </div>
    </div>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" style={compact ? { padding: 0 } : undefined}>
      <div className="brand-mark"><LogoMark size={18} /></div>
      {!compact && (
        <div>
          <div className="brand-word">OrbitWork</div>
          <div className="brand-sub">AI Workbench</div>
        </div>
      )}
    </div>
  );
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.max(9, size * 0.36) }} title={name}>
      {initials(name)}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow" style={{ marginBottom: 8 }}>{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="toolbar" style={{ flexShrink: 0 }}>{actions}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="empty">
      <div className="empty-icon" style={{ color: 'var(--danger)' }}><AlertTriangle size={20} /></div>
      <div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>加载失败</div>
      <div style={{ marginTop: 6, maxWidth: 420, marginInline: 'auto', lineHeight: 1.6 }}>{message}</div>
      <div style={{ marginTop: 16 }}><button className="btn btn-sm" onClick={onRetry}><RefreshCw size={12} />重试</button></div>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon ?? <LogoMark size={20} />}</div>
      <div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>{title}</div>
      {description && <div style={{ marginTop: 6, maxWidth: 380, marginInline: 'auto', lineHeight: 1.6 }}>{description}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function Modal({
  open, onClose, title, subtitle, children, footer, large = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  large?: boolean;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => modalRef.current?.focus(), 20);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { closeRef.current(); return; }
      if (event.key !== 'Tab' || !modalRef.current) return;
      const focusable = [...modalRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={modalRef} tabIndex={-1} className={cn('modal', large && 'modal-lg')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h2 className="modal-title">{title}</h2>
            {subtitle && <p className="modal-sub">{subtitle}</p>}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({
  open, onClose, onConfirm, title, description, confirmText = '确认删除', loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={loading}>
            {loading && <Loader2 size={14} className="spin" />}{confirmText}
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.7, margin: 0 }}>{description}</p>
    </Modal>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}>
      <span style={{ fontSize: 12.5 }}>{label}</span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className={cn('toggle', checked && 'on')} onClick={() => onChange(!checked)} />
    </label>
  );
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'accent' | 'muted' | 'warn' | 'danger' | 'sky' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function CopyButton({ value, label = '复制' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-sm btn-ghost"
      onClick={async () => {
        await copyText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? '已复制' : label}
    </button>
  );
}

export function Dropdown({ label, children, align = 'left' }: { label: ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-sm" onClick={() => setOpen((value) => !value)}>{label}<ChevronDown size={13} /></button>
      {open && (
        <div
          className="card fade-in"
          style={{ position: 'absolute', top: 'calc(100% + 6px)', [align]: 0, minWidth: 190, zIndex: 60, padding: 5, boxShadow: '0 18px 50px rgba(0,0,0,.5)' }}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
