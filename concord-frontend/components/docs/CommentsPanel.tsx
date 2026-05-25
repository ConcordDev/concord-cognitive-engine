'use client';

/**
 * CommentsPanel — inline comments & suggestions on a page or a specific
 * block. Wires docs.comment-add / comment-list / comment-resolve /
 * comment-delete and docs.suggestion-accept (a suggestion carries a
 * proposed replacement text that, once accepted, overwrites its block).
 */

import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Loader2, Check, Trash2, CornerDownRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { Comment, Page } from './types';

export function CommentsPanel({ page, onChanged }: {
  page: Page;
  onChanged: () => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [openOnly, setOpenOnly] = useState(true);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'comment' | 'suggestion'>('comment');
  const [blockId, setBlockId] = useState('');
  const [suggestedText, setSuggestedText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await lensRun('docs', 'comment-list', { pageId: page.id, openOnly });
    setComments((r.data?.result?.comments as Comment[]) || []);
    setLoading(false);
  }, [page.id, openOnly]);
  useEffect(() => { setLoading(true); void load(); }, [load]);

  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    await lensRun('docs', 'comment-add', {
      pageId: page.id,
      blockId: blockId || undefined,
      kind,
      text: text.trim(),
      suggestedText: kind === 'suggestion' ? suggestedText : undefined,
    });
    setText(''); setSuggestedText('');
    setBusy(false);
    await load();
    onChanged();
  }
  async function resolve(c: Comment) {
    await lensRun('docs', 'comment-resolve', { pageId: page.id, commentId: c.id, resolved: !c.resolved });
    await load();
    onChanged();
  }
  async function remove(c: Comment) {
    await lensRun('docs', 'comment-delete', { pageId: page.id, commentId: c.id });
    await load();
    onChanged();
  }
  async function accept(c: Comment) {
    await lensRun('docs', 'suggestion-accept', { pageId: page.id, commentId: c.id });
    await load();
    onChanged();
  }

  const blockLabel = (id: string | null) => {
    if (!id) return 'whole page';
    const b = page.blocks.find(x => x.id === id);
    return b ? `${b.type}: ${(b.text || '').slice(0, 28) || '(empty)'}` : 'block';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
          <MessageSquare className="w-3.5 h-3.5" /> Comments
        </h4>
        <label className="flex items-center gap-1 text-[10px] text-zinc-400">
          <input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} className="accent-indigo-500" />
          open only
        </label>
      </div>

      {/* composer */}
      <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 mb-2 space-y-1.5">
        <div className="flex items-center gap-1">
          <select value={kind} onChange={e => setKind(e.target.value as 'comment' | 'suggestion')}
            className="bg-zinc-950 border border-zinc-800 rounded text-[10px] text-zinc-300 px-1 py-0.5">
            <option value="comment">comment</option>
            <option value="suggestion">suggestion</option>
          </select>
          <select value={blockId} onChange={e => setBlockId(e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded text-[10px] text-zinc-300 px-1 py-0.5">
            <option value="">whole page</option>
            {page.blocks.map(b => (
              <option key={b.id} value={b.id}>{b.type}: {(b.text || '(empty)').slice(0, 24)}</option>
            ))}
          </select>
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
          placeholder={kind === 'suggestion' ? 'Why this change…' : 'Add a comment…'}
          className="w-full bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-200 px-1.5 py-1 resize-none" />
        {kind === 'suggestion' && (
          <textarea value={suggestedText} onChange={e => setSuggestedText(e.target.value)} rows={2}
            placeholder="Proposed replacement text for the block…"
            className="w-full bg-zinc-950 border border-emerald-900/50 rounded text-xs text-emerald-100 px-1.5 py-1 resize-none" />
        )}
        <button onClick={add} disabled={busy || !text.trim()}
          className="w-full text-[11px] rounded bg-indigo-700 hover:bg-indigo-600 text-white py-1 disabled:opacity-50">
          {busy ? 'Posting…' : `Post ${kind}`}
        </button>
      </div>

      {/* list */}
      {loading ? (
        <div className="flex items-center justify-center py-4 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : comments.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic">No {openOnly ? 'open ' : ''}comments.</p>
      ) : (
        <div className="space-y-1.5">
          {comments.map(c => (
            <div key={c.id} className={cn('rounded border px-2 py-1.5',
              c.resolved ? 'border-zinc-800 bg-zinc-900/20 opacity-70' : 'border-zinc-700 bg-zinc-900/50')}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={cn('text-[9px] uppercase rounded px-1',
                  c.kind === 'suggestion' ? 'bg-emerald-900/50 text-emerald-200' : 'bg-zinc-800 text-zinc-400')}>
                  {c.kind}
                </span>
                <span className="text-[10px] text-zinc-400 truncate flex-1">{blockLabel(c.blockId)}</span>
                {c.resolved && <span className="text-[9px] text-emerald-400">resolved</span>}
              </div>
              <p className="text-xs text-zinc-200">{c.text}</p>
              {c.kind === 'suggestion' && c.suggestedText && (
                <p className="mt-1 flex items-start gap-1 text-[11px] text-emerald-200 bg-emerald-950/30 rounded px-1.5 py-1">
                  <CornerDownRight className="w-3 h-3 mt-0.5 shrink-0" /> {c.suggestedText}
                </p>
              )}
              <div className="mt-1 flex items-center gap-2">
                <button onClick={() => resolve(c)} className="text-[10px] text-zinc-400 hover:text-zinc-100 flex items-center gap-0.5">
                  <Check className="w-3 h-3" /> {c.resolved ? 'reopen' : 'resolve'}
                </button>
                {c.kind === 'suggestion' && !c.resolved && c.blockId && (
                  <button onClick={() => accept(c)} className="text-[10px] text-emerald-300 hover:text-emerald-200">
                    accept suggestion
                  </button>
                )}
                <button onClick={() => remove(c)} className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center gap-0.5 ml-auto">
                  <Trash2 className="w-3 h-3" /> delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
