import { useEffect, useRef, useState } from 'react';
import { BrainCircuit, ChevronDown } from 'lucide-react';
import { CopyButton } from '@/components/UI';
import { cn } from '@/lib/utils';

/**
 * Reasoning is collapsed by default. While thoughts are arriving the header
 * shows a live indicator; after completion it shows the measured duration.
 */
export function ReasoningBlock({ text, streaming, durationMs }: { text: string; streaming?: boolean; durationMs?: number }) {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const firstTextAt = useRef<number>(text ? Date.now() : 0);
  const lastTextAt = useRef(Date.now());
  const previous = useRef(text);
  if (text !== previous.current) {
    previous.current = text;
    lastTextAt.current = Date.now();
    if (!firstTextAt.current) firstTextAt.current = Date.now();
  }

  // Re-render shortly after the last thought so the "thinking" state cannot
  // stick during a long tool call. One timer per burst of reasoning text.
  useEffect(() => {
    if (!streaming) return;
    const timer = window.setTimeout(() => setTick((value) => value + 1), 1700);
    return () => window.clearTimeout(timer);
  }, [text, streaming]);

  const live = Boolean(streaming) && Date.now() - lastTextAt.current < 1500;
  const seconds = durationMs && durationMs > 0
    ? durationMs / 1000
    : streaming && firstTextAt.current
      ? (Date.now() - firstTextAt.current) / 1000
      : 0;
  const meta = live
    ? '思考中…'
    : seconds > 0.05
      ? `已思考 ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
      : '思考过程';
  const panelId = `reasoning-${Math.abs(hash(text))}`;

  return (
    <div className={cn('reasoning', open && 'open')} data-tick={tick}>
      <button className="reasoning-head" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={panelId}>
        <BrainCircuit size={12} />
        <span className="reasoning-title">思考过程</span>
        <span className="reasoning-meta">{meta}{text.length ? ` · ${text.length} 字` : ''}</span>
        {live && <span className="reasoning-pulse" aria-hidden />}
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
      </button>
      {open && (
        <div className="reasoning-body" id={panelId} role="region" aria-label="思考过程">
          <pre>{text}</pre>
          {!streaming && text && <div style={{ marginTop: 8 }}><CopyButton value={text} label="复制推理" /></div>}
        </div>
      )}
    </div>
  );
}

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = (result * 31 + value.charCodeAt(index)) | 0;
  return result;
}
