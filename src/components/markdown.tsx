import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeMarkdownUrl } from '../lib/markdown-url';
import { cn } from '../lib/utils';

export function MarkdownRenderer({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn('markdown-body', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeMarkdownUrl}
        components={{
          a: ({ href, children }) => {
            const external = /^https?:\/\//i.test(href ?? '');
            return (
              <a
                href={href}
                {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
              >
                {children}
              </a>
            );
          },
          table: ({ children }) => (
            <div className="markdown-table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

interface MarkdownEditorFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  required?: boolean;
  placeholder?: string;
}

/** Markdown textarea with a live, sanitized preview tab. */
export function MarkdownEditorField({
  label = 'Content (Markdown)',
  value,
  onChange,
  rows = 10,
  required = false,
  placeholder,
}: MarkdownEditorFieldProps) {
  const [previewing, setPreviewing] = useState(false);

  return (
    <div className="field markdown-editor">
      <div className="markdown-editor-header">
        <span>{label}</span>
        <div className="markdown-editor-tabs" role="tablist" aria-label="Markdown editor mode">
          <button
            type="button"
            role="tab"
            aria-selected={!previewing}
            className={previewing ? '' : 'is-active'}
            onClick={() => setPreviewing(false)}
          >
            Write
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={previewing}
            className={previewing ? 'is-active' : ''}
            onClick={() => setPreviewing(true)}
          >
            Preview
          </button>
        </div>
      </div>

      {previewing ? (
        <div className="markdown-preview" aria-live="polite">
          {value.trim()
            ? <MarkdownRenderer content={value} />
            : <p className="markdown-preview-empty">Nothing to preview yet.</p>}
        </div>
      ) : (
        <textarea
          rows={rows}
          required={required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          style={{
            width: '100%',
            padding: '10px',
            background: 'var(--color-surface-subtle)',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
          }}
        />
      )}
    </div>
  );
}
