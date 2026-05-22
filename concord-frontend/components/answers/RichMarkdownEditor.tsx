'use client';

/**
 * RichMarkdownEditor — a write/preview markdown editor for the answers
 * lens. Supports a toolbar (bold, italic, code, code-block, link, list,
 * quote) and a live preview rendered with react-markdown + syntax
 * highlighting. Emits both the raw body and the bodyFormat ("markdown").
 */

import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Bold, Italic, Code, Code2, Link2, List, Quote, Eye, PencilLine } from 'lucide-react';

interface RichMarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  minLength?: number;
}

type Wrap = { before: string; after: string; block?: boolean; placeholder: string };

const TOOLS: { id: string; label: string; icon: typeof Bold; wrap: Wrap }[] = [
  { id: 'bold', label: 'Bold', icon: Bold, wrap: { before: '**', after: '**', placeholder: 'bold text' } },
  { id: 'italic', label: 'Italic', icon: Italic, wrap: { before: '_', after: '_', placeholder: 'italic text' } },
  { id: 'code', label: 'Inline code', icon: Code, wrap: { before: '`', after: '`', placeholder: 'code' } },
  { id: 'block', label: 'Code block', icon: Code2, wrap: { before: '```\n', after: '\n```', block: true, placeholder: 'code block' } },
  { id: 'link', label: 'Link', icon: Link2, wrap: { before: '[', after: '](https://)', placeholder: 'link text' } },
  { id: 'list', label: 'List item', icon: List, wrap: { before: '- ', after: '', block: true, placeholder: 'list item' } },
  { id: 'quote', label: 'Quote', icon: Quote, wrap: { before: '> ', after: '', block: true, placeholder: 'quoted text' } },
];

export function RichMarkdownEditor({
  value, onChange, placeholder, rows = 6, minLength = 15,
}: RichMarkdownEditorProps) {
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const taRef = useRef<HTMLTextAreaElement>(null);

  function applyWrap(wrap: Wrap) {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end) || wrap.placeholder;
    const prefix = wrap.block && start > 0 && value[start - 1] !== '\n' ? '\n' : '';
    const insert = `${prefix}${wrap.before}${selected}${wrap.after}`;
    const next = value.slice(0, start) + insert + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      const cursor = start + prefix.length + wrap.before.length;
      ta.setSelectionRange(cursor, cursor + selected.length);
    });
  }

  const tooShort = value.trim().length > 0 && value.trim().length < minLength;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-zinc-800 bg-zinc-900/60">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              title={t.label}
              aria-label={t.label}
              disabled={mode === 'preview'}
              onClick={() => applyWrap(t.wrap)}
              className="p-1.5 rounded text-zinc-400 hover:text-orange-300 hover:bg-zinc-800 disabled:opacity-30"
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          );
        })}
        <div className="ml-auto flex gap-0.5">
          <button
            type="button"
            onClick={() => setMode('write')}
            className={`px-2 py-1 text-[11px] rounded inline-flex items-center gap-1 ${
              mode === 'write' ? 'bg-orange-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <PencilLine className="w-3 h-3" />Write
          </button>
          <button
            type="button"
            onClick={() => setMode('preview')}
            className={`px-2 py-1 text-[11px] rounded inline-flex items-center gap-1 ${
              mode === 'preview' ? 'bg-orange-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Eye className="w-3 h-3" />Preview
          </button>
        </div>
      </div>

      {mode === 'write' ? (
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder || 'Write in markdown — **bold**, `code`, ```code blocks```'}
          className="w-full bg-transparent px-3 py-2 text-sm text-zinc-100 font-mono resize-y focus:outline-none"
        />
      ) : (
        <div className="px-3 py-2 min-h-[120px]">
          {value.trim() ? (
            <MarkdownView body={value} />
          ) : (
            <p className="text-xs text-zinc-600 italic">Nothing to preview yet.</p>
          )}
        </div>
      )}

      {tooShort && (
        <p className="px-3 pb-2 text-[11px] text-amber-400">
          {minLength - value.trim().length} more character{minLength - value.trim().length === 1 ? '' : 's'} required.
        </p>
      )}
    </div>
  );
}

/** MarkdownView — renders a markdown body with syntax-highlighted code. */
export function MarkdownView({ body }: { body: string }) {
  return (
    <div className="answers-markdown text-sm text-zinc-300 leading-relaxed space-y-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          pre: ({ children }) => (
            <pre className="bg-black/50 border border-white/10 rounded-lg p-3 overflow-x-auto text-[13px] my-2">
              {children}
            </pre>
          ),
          code: ({ className, children }) =>
            className ? (
              <code className={className}>{children}</code>
            ) : (
              <code className="bg-zinc-800 text-orange-300 rounded px-1 py-0.5 text-[12px]">{children}</code>
            ),
          ul: ({ children }) => <ul className="list-disc pl-5 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 space-y-0.5">{children}</ol>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-orange-500/50 pl-3 text-zinc-400 italic">{children}</blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-orange-400 underline hover:text-orange-300">
              {children}
            </a>
          ),
          h1: ({ children }) => <h1 className="text-base font-bold text-zinc-100">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-bold text-zinc-100">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-zinc-200">{children}</h3>,
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
