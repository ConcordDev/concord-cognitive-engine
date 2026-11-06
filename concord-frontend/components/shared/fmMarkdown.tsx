'use client';

/**
 * fmMarkdown — a tiny, dependency-free markdown renderer. Promoted from
 * components/forum/fmMarkdown (build(message) S6, GB-1093 shared-first)
 * so the forum and message lenses render bodies through one renderer;
 * the forum module re-exports it and forum's behaviour is unchanged.
 * Supports bold, italic, inline code, links, headings, bullet lists and
 * fenced code blocks. Plain text passes through untouched.
 *
 * Options beyond the forum contract:
 * - mentions: also tokenise @handles into mention chips (message streams).
 * - textClassName: the body text classes (forum's zinc set by default;
 *   the message stream passes its own size/colour).
 */

import { Fragment, type ReactNode } from 'react';

function renderInline(text: string, keyBase: string, mentions = false): ReactNode[] {
  const out: ReactNode[] = [];
  // Order matters: code first so its contents are not re-parsed.
  const pattern = mentions
    ? /(`[^`]+`)|(\\.)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)]+\))|(@[\w-]+)/g
    : /(`[^`]+`)|(\\.)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={`${keyBase}-t${i}`}>{text.slice(last, m.index)}</Fragment>);
    const tok = m[0];
    if (tok.startsWith('\\')) {
      // Backslash escape: the next character is literal (markdown semantics;
      // the message domain's /shrug output relies on it: ¯\_(ツ)_/¯).
      out.push(<Fragment key={`${keyBase}-e${i}`}>{tok.slice(1)}</Fragment>);
    } else if (tok.startsWith('`')) {
      out.push(<code key={`${keyBase}-c${i}`} className="px-1 py-0.5 rounded bg-zinc-800 text-orange-300 text-[11px]">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**')) {
      out.push(<strong key={`${keyBase}-b${i}`} className="font-bold text-zinc-100">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('*') || tok.startsWith('_')) {
      out.push(<em key={`${keyBase}-i${i}`} className="italic">{tok.slice(1, -1)}</em>);
    } else if (mentions && tok.startsWith('@')) {
      out.push(<span key={`${keyBase}-m${i}`} className="bg-violet-500/15 text-violet-200 px-1 rounded font-semibold">{tok}</span>);
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

export function FmMarkdown({ text, format, mentions = false, textClassName = 'text-xs text-zinc-200' }:
  { text: string; format?: string; mentions?: boolean; textClassName?: string }) {
  if (!text) return null;
  if (format !== 'markdown') {
    return <p className={`${textClassName} whitespace-pre-wrap leading-relaxed`}>{text}</p>;
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
      <ul key={`ul-${k}`} className={`list-disc list-inside space-y-0.5 ${textClassName}`}>
        {items.map((li, idx) => <li key={idx}>{renderInline(li, `${k}-${idx}`, mentions)}</li>)}
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
      blocks.push(<p key={`h-${idx}`} className={cls}>{renderInline(heading[2], `h${idx}`, mentions)}</p>);
      return;
    }
    const bullet = /^\s*[-*]\s+(.*)/.exec(line);
    if (bullet) { listBuf.push(bullet[1]); return; }
    flushList(`p${idx}`);
    if (line.trim() === '') return;
    blocks.push(
      <p key={`p-${idx}`} className={`${textClassName} leading-relaxed`}>{renderInline(line, `p${idx}`, mentions)}</p>,
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
