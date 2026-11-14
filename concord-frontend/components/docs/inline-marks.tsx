// components/docs/inline-marks.tsx
//
// FIX-docs-003 — inline rich text for Docs blocks. Docs blocks store
// plain `text`; this module is the markdown-lite mark layer over it:
//
//   **bold** · *italic* · ~~strike~~ · `code` · [label](https://…)
//
// Storage stays the block's text string (no migration; existing plain
// text renders identically). Rendering is escape-first by construction:
// segments become React elements, never innerHTML, and link hrefs pass
// the platform allowlist (lib/safe-url) — an unsafe URL renders as
// plain label text. Unbalanced markers render literally, and code
// spans are exempt from mark parsing inside them.

import type { ReactNode } from 'react';
import { safeLinkUrl } from '@/lib/safe-url';

export interface InlineSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
}

type Marks = Omit<InlineSegment, 'text' | 'href'>;

const LINK_RE = /^\[([^\]]+)\]\(([^)\s]+)\)/;

function parseInto(src: string, marks: Marks, out: InlineSegment[]): void {
  let buf = '';
  const flush = () => {
    if (buf) { out.push({ text: buf, ...marks }); buf = ''; }
  };
  let i = 0;
  while (i < src.length) {
    // code span — content is literal, no marks inside
    if (src[i] === '`') {
      const close = src.indexOf('`', i + 1);
      if (close > i + 1) {
        flush();
        out.push({ text: src.slice(i + 1, close), ...marks, code: true });
        i = close + 1;
        continue;
      }
      buf += src[i]; i += 1; continue;
    }
    // bold
    if (src.startsWith('**', i)) {
      const close = src.indexOf('**', i + 2);
      if (close > i + 2) {
        flush();
        parseInto(src.slice(i + 2, close), { ...marks, bold: true }, out);
        i = close + 2;
        continue;
      }
      buf += '*'; i += 1; continue;
    }
    // strike
    if (src.startsWith('~~', i)) {
      const close = src.indexOf('~~', i + 2);
      if (close > i + 2) {
        flush();
        parseInto(src.slice(i + 2, close), { ...marks, strike: true }, out);
        i = close + 2;
        continue;
      }
      buf += '~'; i += 1; continue;
    }
    // italic (single *)
    if (src[i] === '*') {
      const close = src.indexOf('*', i + 1);
      if (close > i + 1) {
        flush();
        parseInto(src.slice(i + 1, close), { ...marks, italic: true }, out);
        i = close + 1;
        continue;
      }
      buf += '*'; i += 1; continue;
    }
    // link — href must pass the allowlist or the whole thing is literal
    if (src[i] === '[') {
      const m = LINK_RE.exec(src.slice(i));
      if (m) {
        const href = safeLinkUrl(m[2]);
        if (href) {
          flush();
          out.push({ text: m[1], ...marks, href });
          i += m[0].length;
          continue;
        }
      }
      buf += src[i]; i += 1; continue;
    }
    buf += src[i]; i += 1;
  }
  flush();
}

export function parseInlineMarks(text: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  parseInto(String(text ?? ''), {}, out);
  return out;
}

export function hasInlineMarks(text: string): boolean {
  return /(\*\*|~~|`|\[[^\]]+\]\([^)\s]+\))/.test(String(text ?? '')) || /(^|[^*])\*[^*]+\*/.test(String(text ?? ''));
}

/** Render block text with its marks applied. Safe for any user text. */
export function renderInlineMarks(text: string): ReactNode {
  const segments = parseInlineMarks(text);
  return segments.map((seg, idx) => {
    let node: ReactNode = seg.text;
    if (seg.code) node = <code key={`c${idx}`} className="rounded bg-zinc-800/80 px-1 font-mono text-[0.85em] text-emerald-200">{node}</code>;
    if (seg.bold) node = <strong key={`b${idx}`} className="font-semibold text-zinc-50">{node}</strong>;
    if (seg.italic) node = <em key={`i${idx}`}>{node}</em>;
    if (seg.strike) node = <s key={`s${idx}`}>{node}</s>;
    if (seg.href) {
      node = (
        <a key={`a${idx}`} href={seg.href} target="_blank" rel="noopener noreferrer"
          className="text-sky-300 underline decoration-sky-300/40 hover:decoration-sky-300">
          {node}
        </a>
      );
    }
    return <span key={idx}>{node}</span>;
  });
}

export interface MarkEdit { value: string; selStart: number; selEnd: number }

/**
 * Toggle a symmetric mark (** / * / ~~ / `) around the selection.
 * Wrapped selection unwraps (markers outside or inside the selection);
 * an empty selection inserts a marker pair with the caret between.
 */
export function toggleMark(value: string, selStart: number, selEnd: number, marker: string): MarkEdit {
  const m = marker.length;
  if (selStart > selEnd) [selStart, selEnd] = [selEnd, selStart];
  if (selStart === selEnd) {
    return { value: value.slice(0, selStart) + marker + marker + value.slice(selStart), selStart: selStart + m, selEnd: selStart + m };
  }
  const before = value.slice(Math.max(0, selStart - m), selStart);
  const after = value.slice(selEnd, selEnd + m);
  if (before === marker && after === marker && selStart >= m) {
    return {
      value: value.slice(0, selStart - m) + value.slice(selStart, selEnd) + value.slice(selEnd + m),
      selStart: selStart - m, selEnd: selEnd - m,
    };
  }
  const sel = value.slice(selStart, selEnd);
  if (sel.length > 2 * m && sel.startsWith(marker) && sel.endsWith(marker)) {
    const inner = sel.slice(m, sel.length - m);
    return { value: value.slice(0, selStart) + inner + value.slice(selEnd), selStart, selEnd: selStart + inner.length };
  }
  return {
    value: value.slice(0, selStart) + marker + sel + marker + value.slice(selEnd),
    selStart: selStart + m, selEnd: selEnd + m,
  };
}

/** Wrap the selection as a link, leaving the URL portion selected. */
export function applyLinkMark(value: string, selStart: number, selEnd: number): MarkEdit {
  if (selStart > selEnd) [selStart, selEnd] = [selEnd, selStart];
  const sel = value.slice(selStart, selEnd) || 'link text';
  const url = 'https://';
  const next = `${value.slice(0, selStart)}[${sel}](${url})${value.slice(selEnd)}`;
  const urlStart = selStart + 1 + sel.length + 2;
  return { value: next, selStart: urlStart, selEnd: urlStart + url.length };
}

/** The Docs mark shortcuts: Ctrl/Cmd+B, +I, +E (code), +K (link), Ctrl+Shift+X (strike). */
export function markForShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): string | 'link' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === 'b') return '**';
  if (k === 'i') return '*';
  if (k === 'e') return '`';
  if (k === 'k') return 'link';
  if (k === 'x' && e.shiftKey) return '~~';
  return null;
}
