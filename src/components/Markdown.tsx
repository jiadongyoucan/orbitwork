import { useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, ImageOff } from 'lucide-react';
import { copyText } from '@/lib/utils';

function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <pre ref={ref}>{children}</pre>
      <button
        className="btn btn-sm btn-ghost"
        style={{ position: 'absolute', top: 6, right: 6, height: 24, padding: '0 7px', background: 'rgba(8,9,10,.75)' }}
        onClick={async () => {
          await copyText(ref.current?.innerText ?? '');
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}{copied ? '已复制' : '复制'}
      </button>
    </div>
  );
}

export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          table: ({ children }) => (
            <div className="table-scroll">
              <div className="table-hint">横向滑动查看完整表格 →</div>
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
          ),
          img: () => (
            <span className="badge badge-muted" style={{ height: 28 }}>
              <ImageOff size={12} /> 外部图片已阻止
            </span>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
