'use client';

import { useState, useEffect, useCallback } from 'react';
import { callDocsMacro } from '@/lib/api/docs';
import { MessageSquare, Check, Loader2 } from 'lucide-react';

interface Comment {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  selection_text?: string | null;
  resolved: number;
  created_at: number;
}

interface Props { documentId: string; }

export function DocCommentsPanel({ documentId }: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await callDocsMacro<{ comments?: Comment[] }>('comments_list', {
        documentId, onlyUnresolved: !showResolved,
      });
      setComments(r?.comments || []);
    } catch (e) { console.error('comments_list', e); }
    finally { setLoading(false); }
  }, [documentId, showResolved]);

  useEffect(() => { load(); }, [load]);

  const submit = useCallback(async () => {
    if (!composing.trim()) return;
    await callDocsMacro('comment_add', { documentId, body: composing.trim() });
    setComposing('');
    load();
  }, [composing, documentId, load]);

  const resolve = useCallback(async (commentId: string) => {
    await callDocsMacro('comment_resolve', { commentId });
    load();
  }, [load]);

  // Group by thread
  const threads = new Map<string, Comment[]>();
  for (const c of comments) {
    if (!threads.has(c.thread_id)) threads.set(c.thread_id, []);
    threads.get(c.thread_id)!.push(c);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-white/5 flex items-center justify-between">
        <button
          onClick={() => setShowResolved((x) => !x)}
          className="text-xs text-white/60 hover:text-white"
        >
          {showResolved ? 'Hide resolved' : 'Show resolved'}
        </button>
        <span className="text-xs text-white/40">{comments.length} comments</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-white/40">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : threads.size === 0 ? (
          <div className="text-center text-white/40 text-sm py-8">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
            No comments yet.
          </div>
        ) : (
          Array.from(threads.entries()).map(([threadId, items]) => (
            <div key={threadId} className="bg-white/5 rounded p-2 space-y-2">
              {items.map((c, idx) => (
                <div key={c.id} className="text-sm">
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <span className="text-cyan-300 font-medium">{c.author_id.slice(0, 8)}</span>
                    <span>{new Date(c.created_at * 1000).toLocaleString()}</span>
                    {c.resolved ? <span className="text-green-400">resolved</span> : null}
                  </div>
                  {c.selection_text && idx === 0 && (
                    <div className="mt-1 text-xs text-white/40 border-l-2 border-cyan-400/40 pl-2 italic">
                      "{c.selection_text}"
                    </div>
                  )}
                  <div className="mt-1 text-white/90 whitespace-pre-wrap">{c.body}</div>
                  {idx === 0 && !c.resolved && (
                    <button
                      onClick={() => resolve(c.id)}
                      className="mt-1 text-xs text-white/40 hover:text-green-400 flex items-center gap-1"
                    >
                      <Check className="w-3 h-3" /> Resolve thread
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      <div className="p-2 border-t border-white/5">
        <textarea
          value={composing}
          onChange={(e) => setComposing(e.target.value)}
          placeholder="Comment…"
          rows={2}
          className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white placeholder-white/40 focus:outline-none focus:border-cyan-400/40 resize-none"
        />
        <button
          onClick={submit}
          disabled={!composing.trim()}
          className="mt-1 w-full py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Comment
        </button>
      </div>
    </div>
  );
}
