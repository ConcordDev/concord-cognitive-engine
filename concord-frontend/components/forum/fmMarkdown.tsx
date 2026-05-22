'use client';

/**
 * fmMarkdown — a tiny, dependency-free markdown renderer for forum
 * posts. Supports bold, italic, inline code, links, headings, bullet
 * lists and fenced code blocks. Plain text passes through untouched.
 */

import { Fragment, type ReactNode } from 'react';

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Order matters: code first so its contents are not re-parsed.
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={`${keyBase}-t${i}`}>{text.slice(last, m.index)}</Fragment>);
    const tok = m[0];
    if (tok.startsWith('`')) {
      out.push(<code key={`${keyBase}-c${i}`} className="px-1 py-0.5 rounded bg-zinc-800 text-orange-300 text-[11px]">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**')) {
      out.push(<strong key={`${keyBase}-b${i}`} className="font-bold text-zinc-100">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('*') || tok.startsWith('_')) {
      out.push(<em key={`${keyBase}-i${i}`} className="italic">{tok.slice(1, -1)}</em>);
    } else {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      if (lm) {
        out.push(
          <a key={`${keyBase}-l${i}`} href={lm[2]} target="_blank" rel="noopener noreferrer"
            className="text-orange-400 underline hover:text-orange-300">{lm[1]}</a>,
        );
      }
    }
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) out.push(<Fragment key={`${keyBase}-tEnd`}>{text.slice(last)}</Fragment>);
  return out;
}

export function FmMarkdown({ text, format }: { text: string; format?: string }) {
  if (!text) return null;
  if (format !== 'markdown') {
    return <p className="text-xs text-zinc-200 whitespace-pre-wrap leading-relaxed">{text}</p>;
  }
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let listBuf: string[] = [];
  let codeBuf: string[] = [];
  let inCode = false;

  const flushList = (k: string) => {
    if (listBuf.length === 0) return;
    const items = listBuf.slice();
    listBuf = [];
    blocks.push(
      <ul key={`ul-${k}`} className="list-disc list-inside space-y-0.5 text-xs text-zinc-200">
        {items.map((li, idx) => <li key={idx}>{renderInline(li, `${k}-${idx}`)}</li>)}
      </ul>,
    );
  };

  lines.forEach((raw, idx) => {
    const line = raw;
    if (line.trim().startsWith('```')) {
      if (inCode) {
        blocks.push(
          <pre key={`pre-${idx}`} className="bg-zinc-800/80 border border-zinc-700 rounded-lg p-2 overflow-x-auto">
            <code className="text-[11px] text-orange-200 whitespace-pre">{codeBuf.join('\n')}</code>
          </pre>,
        );
        codeBuf = [];
      }
      inCode = !inCode;
      return;
    }
    if (inCode) { codeBuf.push(line); return; }
    const heading = /^(#{1,3})\s+(.*)/.exec(line);
    if (heading) {
      flushList(`h${idx}`);
      const level = heading[1].length;
      const cls = level === 1 ? 'text-sm font-bold text-zinc-100'
        : level === 2 ? 'text-xs font-bold text-zinc-100' : 'text-xs font-semibold text-zinc-200';
      blocks.push(<p key={`h-${idx}`} className={cls}>{renderInline(heading[2], `h${idx}`)}</p>);
      return;
    }
    const bullet = /^\s*[-*]\s+(.*)/.exec(line);
    if (bullet) { listBuf.push(bullet[1]); return; }
    flushList(`p${idx}`);
    if (line.trim() === '') return;
    blocks.push(
      <p key={`p-${idx}`} className="text-xs text-zinc-200 leading-relaxed">{renderInline(line, `p${idx}`)}</p>,
    );
  });
  flushList('end');
  if (inCode && codeBuf.length) {
    blocks.push(
      <pre key="pre-end" className="bg-zinc-800/80 border border-zinc-700 rounded-lg p-2 overflow-x-auto">
        <code className="text-[11px] text-orange-200 whitespace-pre">{codeBuf.join('\n')}</code>
      </pre>,
    );
  }
  return <div className="space-y-1.5">{blocks}</div>;
}
