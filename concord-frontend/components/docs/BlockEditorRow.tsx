'use client';

/**
 * BlockEditorRow — renders and edits a single document block. Covers
 * every rich block type the docs domain supports: paragraph, headings,
 * lists, to-do, syntax-highlighted code, quote, callout, toggle,
 * table and embed. Live presence cursors of co-editors are shown.
 */

import { useEffect, useState } from 'react';
import { ChevronUp, ChevronDown, Trash2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Block, BlockData, Cursor } from './types';
import { highlightCode } from './syntax';

const CODE_LANGUAGES = [
  'plain', 'javascript', 'typescript', 'python', 'rust', 'go',
  'json', 'sql', 'bash', 'html', 'css', 'markdown', 'yaml',
];
const CALLOUT_TONES: { id: string; cls: string }[] = [
  { id: 'info', cls: 'bg-sky-900/20 border-sky-900/50 text-sky-100' },
  { id: 'warning', cls: 'bg-amber-900/20 border-amber-900/50 text-amber-100' },
  { id: 'success', cls: 'bg-emerald-900/20 border-emerald-900/50 text-emerald-100' },
  { id: 'danger', cls: 'bg-rose-900/20 border-rose-900/50 text-rose-100' },
  { id: 'note', cls: 'bg-zinc-800/40 border-zinc-700 text-zinc-200' },
];

export function BlockEditorRow({ block, cursors, onChange, onDelete, onUp, onDown, onFocus }: {
  block: Block;
  cursors: Cursor[];
  onChange: (patch: Partial<Block> & { data?: BlockData }) => void;
  onDelete: () => void;
  onUp: () => void;
  onDown: () => void;
  onFocus: () => void;
}) {
  const [text, setText] = useState(block.text);
  useEffect(() => { setText(block.text); }, [block.text]);
  const commit = () => { if (text !== block.text) onChange({ text }); };

  const presenceRail = cursors.length > 0 && (
    <span className="absolute -left-2 top-0 bottom-0 flex flex-col gap-0.5">
      {cursors.map(c => (
        <span key={c.sessionId} title={`${c.name} editing`}
          className="w-1 flex-1 rounded" style={{ background: c.color }} />
      ))}
    </span>
  );

  if (block.type === 'divider') {
    return (
      <div className="group relative flex items-center gap-1">
        {presenceRail}
        <hr className="flex-1 border-zinc-700" />
        <RowControls onDelete={onDelete} onUp={onUp} onDown={onDown} />
      </div>
    );
  }

  if (block.type === 'code') {
    const lang = block.data?.language || 'plain';
    return (
      <div className="group relative">
        {presenceRail}
        <div className="flex items-center gap-1 mb-0.5">
          <select value={lang} onChange={e => onChange({ data: { ...block.data, language: e.target.value } })}
            className="bg-zinc-950 border border-zinc-800 rounded text-[10px] text-zinc-300 px-1 py-0.5">
            {CODE_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <RowControls onDelete={onDelete} onUp={onUp} onDown={onDown} inline />
        </div>
        <div className="relative font-mono text-xs bg-zinc-950 rounded border border-zinc-800">
          <pre aria-hidden className="px-2 py-1.5 whitespace-pre-wrap break-words pointer-events-none"
            dangerouslySetInnerHTML={{ __html: highlightCode(text, lang) || '&nbsp;' }} />
          <textarea value={text} onFocus={onFocus} onChange={e => setText(e.target.value)} onBlur={commit}
            spellCheck={false}
            className="absolute inset-0 w-full h-full bg-transparent text-transparent caret-emerald-300 resize-none px-2 py-1.5 focus:outline-none" />
        </div>
      </div>
    );
  }

  if (block.type === 'callout') {
    const tone = CALLOUT_TONES.find(t => t.id === (block.data?.tone || 'info')) || CALLOUT_TONES[0];
    return (
      <div className={cn('group relative flex items-start gap-2 rounded border px-2 py-1.5', tone.cls)}>
        {presenceRail}
        <input value={block.data?.emoji || '💡'} maxLength={4}
          onChange={e => onChange({ data: { ...block.data, emoji: e.target.value } })}
          className="w-7 text-center bg-transparent text-base" />
        <textarea value={text} onFocus={onFocus} onChange={e => setText(e.target.value)} onBlur={commit} rows={1}
          placeholder="Callout text…" className="flex-1 bg-transparent resize-none focus:outline-none text-sm" />
        <select value={block.data?.tone || 'info'}
          onChange={e => onChange({ data: { ...block.data, tone: e.target.value } })}
          className="bg-zinc-950/60 border border-zinc-700 rounded text-[10px] px-1 py-0.5 self-start">
          {CALLOUT_TONES.map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
        </select>
        <RowControls onDelete={onDelete} onUp={onUp} onDown={onDown} />
      </div>
    );
  }

  if (block.type === 'toggle') {
    const open = block.data?.open === true;
    return (
      <div className="group relative">
        {presenceRail}
        <div className="flex items-start gap-1">
          <button onClick={() => onChange({ data: { ...block.data, open: !open } })}
            className="text-zinc-400 hover:text-zinc-100 mt-1">
            <ChevronRight className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-90')} />
          </button>
          <textarea value={text} onFocus={onFocus} onChange={e => setText(e.target.value)} onBlur={commit} rows={1}
            placeholder="Toggle summary…" className="flex-1 bg-transparent resize-none focus:outline-none text-sm font-medium text-zinc-200" />
          <RowControls onDelete={onDelete} onUp={onUp} onDown={onDown} />
        </div>
        {open && (
          <div className="ml-5 mt-1 pl-2 border-l border-zinc-800 text-[11px] text-zinc-400">
            Add child blocks below the toggle to fill it.
          </div>
        )}
      </div>
    );
  }

  if (block.type === 'embed') {
    const url = block.data?.url || '';
    const kind = block.data?.kind || 'link';
    return (
      <div className="group relative rounded border border-zinc-800 bg-zinc-950/40 p-2">
        {presenceRail}
        <div className="flex items-center gap-1 mb-1">
          <select value={kind} onChange={e => onChange({ data: { ...block.data, kind: e.target.value } })}
            className="bg-zinc-950 border border-zinc-800 rounded text-[10px] text-zinc-300 px-1 py-0.5">
            <option value="link">link</option>
            <option value="video">video</option>
            <option value="image">image</option>
          </select>
          <input value={url} onChange={e => onChange({ data: { ...block.data, url: e.target.value } })}
            onFocus={onFocus} placeholder="https://…"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-200 px-1.5 py-0.5" />
          <RowControls onDelete={onDelete} onUp={onUp} onDown={onDown} inline />
        </div>
        {url && kind === 'image' && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={url} alt={text || 'embed'} className="max-h-48 rounded" />
        )}
        {url && kind === 'video' && (
          <video src={url} controls className="max-h-48 rounded w-full" />
        )}
        {url && kind === 'link' && (
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="text-xs text-sky-300 underline break-all">{text || url}</a>
        )}
        <input value={text} onFocus={onFocus} onChange={e => setText(e.target.value)} onBlur={commit}
          placeholder="Caption" className="mt-1 w-full bg-transparent text-[11px] text-zinc-400 focus:outline-none" />
      </div>
    );
  }

  if (block.type === 'table') {
    const rows: string[][] = block.data?.rows && block.data.rows.length
      ? block.data.rows : [['', ''], ['', '']];
    const setCell = (ri: number, ci: number, v: string) => {
      const next = rows.map(r => [...r]);
      next[ri][ci] = v;
      onChange({ data: { ...block.data, rows: next } });
    };
    const addRow = () => onChange({ data: { ...block.data, rows: [...rows, rows[0].map(() => '')] } });
    const addCol = () => onChange({ data: { ...block.data, rows: rows.map(r => [...r, '']) } });
    const delRow = (ri: number) => {
      if (rows.length <= 1) return;
      onChange({ data: { ...block.data, rows: rows.filter((_, i) => i !== ri) } });
    };
    return (
      <div className="group relative" onFocus={onFocus}>
        {presenceRail}
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[10px] text-zinc-400">Table</span>
          <div className="flex items-center gap-1">
            <button onClick={addRow} className="text-[10px] text-zinc-400 hover:text-zinc-100 border border-zinc-800 rounded px-1">+ row</button>
            <button onClick={addCol} className="text-[10px] text-zinc-400 hover:text-zinc-100 border border-zinc-800 rounded px-1">+ col</button>
            <RowControls onDelete={onDelete} onUp={onUp} onDown={onDown} inline />
          </div>
        </div>
        <table className="w-full text-xs border-collapse">
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci} className="border border-zinc-800 p-0">
                    <input value={c} onChange={e => setCell(ri, ci, e.target.value)}
                      className={cn('w-full bg-transparent px-1.5 py-1 focus:outline-none focus:bg-zinc-800/50',
                        ri === 0 ? 'font-semibold text-zinc-100' : 'text-zinc-300')} />
                  </td>
                ))}
                <td className="pl-1">
                  <button aria-label="Delete" onClick={() => delRow(ri)} className="text-zinc-700 hover:text-rose-400">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // text-bearing blocks: paragraph, headings, lists, todo, quote
  const cls: Record<string, string> = {
    heading1: 'text-lg font-bold text-zinc-100',
    heading2: 'text-base font-bold text-zinc-100',
    heading3: 'text-sm font-semibold text-zinc-200',
    quote: 'border-l-2 border-zinc-600 pl-2 italic text-zinc-400',
    paragraph: 'text-sm text-zinc-200',
    bulleted_list: 'text-sm text-zinc-200',
    numbered_list: 'text-sm text-zinc-200',
    todo: 'text-sm text-zinc-200',
  };

  return (
    <div className="group relative flex items-start gap-1">
      {presenceRail}
      {block.type === 'todo' && (
        <input type="checkbox" checked={block.checked} onChange={e => onChange({ checked: e.target.checked })}
          className="mt-1.5 accent-emerald-500" />
      )}
      {block.type === 'bulleted_list' && <span className="text-zinc-400 mt-1">•</span>}
      {block.type === 'numbered_list' && <span className="text-zinc-400 mt-1 text-xs">#</span>}
      <textarea value={text} onFocus={onFocus} onChange={e => setText(e.target.value)} onBlur={commit} rows={1}
        placeholder={`Type ${block.type.replace('_', ' ')}…`}
        className={cn('flex-1 bg-transparent resize-none focus:outline-none focus:bg-zinc-800/40 rounded px-1',
          cls[block.type] || cls.paragraph, block.type === 'todo' && block.checked && 'line-through text-zinc-400')} />
      <RowControls onDelete={onDelete} onUp={onUp} onDown={onDown} />
    </div>
  );
}

function RowControls({ onDelete, onUp, onDown, inline }: {
  onDelete: () => void; onUp: () => void; onDown: () => void; inline?: boolean;
}) {
  return (
    <div className={cn('flex items-center', !inline && 'opacity-0 group-hover:opacity-100')}>
      <button onClick={onUp} title="Move up" className="text-zinc-600 hover:text-zinc-300"><ChevronUp className="w-3 h-3" /></button>
      <button onClick={onDown} title="Move down" className="text-zinc-600 hover:text-zinc-300"><ChevronDown className="w-3 h-3" /></button>
      <button onClick={onDelete} title="Delete block" className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
    </div>
  );
}
