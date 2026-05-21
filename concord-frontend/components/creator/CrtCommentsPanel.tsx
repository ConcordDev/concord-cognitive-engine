'use client';

/**
 * CrtCommentsPanel — comment / community management surface. The creator
 * logs audience comments, replies, pins, hides and resolves them. Every
 * comment and reply is real user input — nothing seeded.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, MessageSquare, Pin, EyeOff, CheckCircle2, Trash2, CornerDownRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Comment {
  id: string;
  contentId: string | null;
  author: string;
  body: string;
  status: 'open' | 'replied' | 'hidden' | 'resolved';
  pinned: boolean;
  reply: string | null;
  at: string;
  updatedAt: string;
}
interface CommentResult {
  comments: Comment[];
  count: number;
  byStatus: { open: number; replied: number; hidden: number; resolved: number };
}

const STATUS_FILTERS: { id: 'all' | 'open' | 'replied' | 'hidden' | 'resolved'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'replied', label: 'Replied' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'hidden', label: 'Hidden' },
];

export function CrtCommentsPanel() {
  const [result, setResult] = useState<CommentResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'replied' | 'hidden' | 'resolved'>('all');
  const [form, setForm] = useState({ author: '', body: '' });
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('creator', 'comment-list', { status: filter });
    if (r.data?.ok) setResult(r.data.result as CommentResult);
    else setResult(null);
    setLoading(false);
  }, [filter]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addComment = async () => {
    if (!form.author.trim()) { setError('Author is required.'); return; }
    if (!form.body.trim()) { setError('Comment body is required.'); return; }
    const r = await lensRun('creator', 'comment-add', {
      author: form.author.trim(),
      body: form.body.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ author: '', body: '' });
    setError(null);
    await refresh();
  };

  const update = async (id: string, patch: Record<string, unknown>) => {
    const r = await lensRun('creator', 'comment-update', { id, ...patch });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await refresh();
  };

  const sendReply = async (id: string) => {
    const reply = (replyDraft[id] ?? '').trim();
    if (!reply) { setError('Reply cannot be empty.'); return; }
    await update(id, { reply });
    setReplyDraft({ ...replyDraft, [id]: '' });
  };

  const del = async (id: string) => {
    const r = await lensRun('creator', 'comment-delete', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const comments = result?.comments ?? [];

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {result && (
        <div className="grid grid-cols-4 gap-2">
          <Stat label="Open" value={result.byStatus.open} accent="text-amber-300" />
          <Stat label="Replied" value={result.byStatus.replied} accent="text-sky-300" />
          <Stat label="Resolved" value={result.byStatus.resolved} accent="text-emerald-300" />
          <Stat label="Hidden" value={result.byStatus.hidden} accent="text-zinc-400" />
        </div>
      )}

      {/* Log an audience comment. */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-red-400" /> Log a comment
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            placeholder="Commenter name / handle"
            value={form.author}
            onChange={(e) => setForm({ ...form, author: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
          />
          <input
            placeholder="Comment body"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
          />
          <button
            type="button"
            onClick={addComment}
            className="flex items-center justify-center gap-1 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </section>

      {/* Filter. */}
      <div className="flex rounded-lg border border-zinc-700 overflow-hidden w-fit">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              'px-2.5 py-1 text-[11px] font-medium',
              filter === f.id ? 'bg-red-600 text-white' : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {comments.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic">No comments yet.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li
              key={c.id}
              className={cn(
                'bg-zinc-900/70 border rounded-xl p-3',
                c.pinned ? 'border-amber-700/60' : 'border-zinc-800'
              )}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-zinc-200 flex items-center gap-1">
                    {c.pinned && <Pin className="w-3 h-3 text-amber-400" />}
                    {c.author}
                    <span className={cn(
                      'text-[10px] uppercase font-normal',
                      c.status === 'open' && 'text-amber-400',
                      c.status === 'replied' && 'text-sky-400',
                      c.status === 'resolved' && 'text-emerald-400',
                      c.status === 'hidden' && 'text-zinc-500'
                    )}>· {c.status}</span>
                  </p>
                  <p className="text-xs text-zinc-300 mt-0.5">{c.body}</p>
                  {c.reply && (
                    <p className="text-[11px] text-zinc-400 mt-1.5 flex items-start gap-1 pl-2 border-l-2 border-sky-700/50">
                      <CornerDownRight className="w-3 h-3 text-sky-500 shrink-0 mt-0.5" /> {c.reply}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => update(c.id, { pinned: !c.pinned })}
                    title={c.pinned ? 'Unpin' : 'Pin'}
                    className={cn('hover:text-amber-400', c.pinned ? 'text-amber-400' : 'text-zinc-600')}
                  >
                    <Pin className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => update(c.id, { status: c.status === 'hidden' ? 'open' : 'hidden' })}
                    title={c.status === 'hidden' ? 'Unhide' : 'Hide'}
                    className="text-zinc-600 hover:text-zinc-300"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => update(c.id, { status: 'resolved' })}
                    title="Mark resolved"
                    className="text-zinc-600 hover:text-emerald-400"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => del(c.id)}
                    title="Delete"
                    className="text-zinc-600 hover:text-rose-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {/* Reply box. */}
              <div className="flex items-center gap-2 mt-2">
                <input
                  placeholder="Write a reply…"
                  value={replyDraft[c.id] ?? ''}
                  onChange={(e) => setReplyDraft({ ...replyDraft, [c.id]: e.target.value })}
                  className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100"
                />
                <button
                  type="button"
                  onClick={() => sendReply(c.id)}
                  className="text-[11px] px-2 py-1 bg-sky-700 hover:bg-sky-600 text-white rounded-lg"
                >
                  Reply
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
      <p className={cn('text-lg font-bold', accent)}>{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase">{label}</p>
    </div>
  );
}
