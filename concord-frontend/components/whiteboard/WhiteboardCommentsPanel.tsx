'use client';

/**
 * WhiteboardCommentsPanel — Whiteboard Sprint A #5.
 *
 * Lists + adds comments for a DB-backed board. Real macro calls via
 * /api/lens/run → domain whiteboard. Realtime updates flow through
 * the existing socket; we subscribe to `whiteboard:comment-added` +
 * `whiteboard:comment-resolved` + `whiteboard:comment-reaction`.
 */

import { useEffect, useState, useCallback } from 'react';
import { MessageSquare, Send, Check, Smile, Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { getSocket } from '@/lib/realtime/socket';

interface CommentRow {
  id: string;
  board_id: string;
  element_id: string | null;
  thread_id: string;
  author_id: string;
  body: string;
  reactions: Record<string, string[]>;
  resolved: 0 | 1;
  resolved_by: string | null;
  created_at: number;
  updated_at: number;
}

interface WhiteboardCommentsPanelProps {
  boardId: string;
  selectedElementId?: string | null;
}

const QUICK_EMOJIS = ['🚀', '👍', '❤️', '🎯', '🤔', '🎉'];

async function callMacro<T>(name: string, input: Record<string, unknown>): Promise<{ ok: boolean } & T & { reason?: string }> {
  const r = await api.post('/api/lens/run', { domain: 'whiteboard', name, input });
  return (r.data?.result ?? r.data) as { ok: boolean } & T;
}

export function WhiteboardCommentsPanel({ boardId, selectedElementId }: WhiteboardCommentsPanelProps) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [onlyUnresolved, setOnlyUnresolved] = useState(false);

  const refresh = useCallback(async () => {
    if (!boardId) return;
    setBusy('list');
    try {
      const r = await callMacro<{ comments?: CommentRow[]; reason?: string }>('comment_list', { boardId, onlyUnresolved });
      if (r?.ok && r.comments) setComments(r.comments);
      else if (r?.reason) setErr(r.reason);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'list failed');
    } finally {
      setBusy(null);
    }
  }, [boardId, onlyUnresolved]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const sock = getSocket();
    if (!sock) return;
    const handler = () => refresh();
    sock.on('whiteboard:comment-added', handler);
    sock.on('whiteboard:comment-resolved', handler);
    sock.on('whiteboard:comment-reaction', handler);
    return () => {
      sock.off('whiteboard:comment-added', handler);
      sock.off('whiteboard:comment-resolved', handler);
      sock.off('whiteboard:comment-reaction', handler);
    };
  }, [refresh]);

  async function handleAdd() {
    if (!body.trim()) return;
    setBusy('add'); setErr(null);
    try {
      const r = await callMacro<{ id?: string; reason?: string }>('comment_add', {
        boardId, body: body.trim(),
        elementId: selectedElementId || undefined,
      });
      if (r?.ok) { setBody(''); await refresh(); }
      else setErr(r?.reason || 'add failed');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'add failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleResolve(id: string) {
    setBusy(`resolve-${id}`); setErr(null);
    try {
      const r = await callMacro<{ reason?: string }>('comment_resolve', { id });
      if (r?.ok) await refresh();
      else setErr(r?.reason || 'resolve failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleReact(id: string, emoji: string) {
    setBusy(`react-${id}-${emoji}`); setErr(null);
    try {
      const r = await callMacro<{ reason?: string }>('comment_react', { id, emoji });
      if (r?.ok) await refresh();
      else setErr(r?.reason || 'react failed');
    } finally {
      setBusy(null);
    }
  }

  if (!boardId) {
    return (
      <div className="p-3 text-[10px] text-gray-500">
        Save the board to the Concord DB to enable comments.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-lattice-deep border-l border-lattice-border text-sm">
      <header className="px-3 py-2 border-b border-lattice-border flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Comments</span>
        <span className="ml-auto text-[10px] text-gray-500">{comments.length}</span>
      </header>
      {err && (
        <div className="m-2 px-2 py-1 text-[10px] text-red-300 bg-red-500/10 rounded flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {err}
          <button onClick={() => setErr(null)} className="ml-auto">×</button>
        </div>
      )}
      <div className="px-3 py-2 border-b border-lattice-border space-y-1.5">
        <label className="flex items-center gap-1 text-[10px] text-gray-400">
          <input type="checkbox" checked={onlyUnresolved} onChange={(e) => setOnlyUnresolved(e.target.checked)} className="accent-cyan-400" />
          show only unresolved
        </label>
        <textarea
          value={body} onChange={(e) => setBody(e.target.value)}
          placeholder={selectedElementId ? `Comment on element ${selectedElementId.slice(0, 12)}…` : 'Comment on this board…'}
          rows={2}
          className="w-full px-2 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white resize-none"
        />
        <button
          onClick={handleAdd} disabled={busy !== null || !body.trim()}
          className="text-[10px] px-3 py-1 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50 inline-flex items-center gap-1"
        >
          {busy === 'add' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          Send
        </button>
      </div>
      <ul className="flex-1 min-h-0 overflow-y-auto">
        {comments.length === 0 ? (
          <li className="px-3 py-3 text-[10px] text-gray-500">No comments yet.</li>
        ) : (
          comments.map((c) => (
            <li key={c.id} className={cn('px-3 py-2 border-b border-white/5 text-xs', c.resolved && 'opacity-60')}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-gray-500">
                    <span className="text-cyan-300">{c.author_id.slice(0, 8)}</span>
                    {c.element_id && <span className="ml-1 text-amber-300">@ {c.element_id.slice(0, 8)}</span>}
                  </div>
                  <div className="text-[11px] text-gray-200 mt-0.5 whitespace-pre-wrap">{c.body}</div>
                  {Object.entries(c.reactions || {}).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {Object.entries(c.reactions).map(([emoji, users]) => (
                        <button
                          key={emoji}
                          onClick={() => handleReact(c.id, emoji)}
                          className="text-[10px] px-1.5 py-0.5 bg-lattice-surface rounded hover:bg-lattice-elevated"
                        >
                          {emoji} {users.length}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1 mt-1">
                    {QUICK_EMOJIS.map((e) => (
                      <button
                        key={e} onClick={() => handleReact(c.id, e)}
                        className="text-[10px] opacity-50 hover:opacity-100"
                        title={`React ${e}`}
                      >{e}</button>
                    ))}
                    <Smile className="w-3 h-3 text-gray-500 ml-1" />
                    {!c.resolved && (
                      <button
                        onClick={() => handleResolve(c.id)} disabled={busy !== null}
                        className="ml-auto text-[10px] text-emerald-400 hover:text-emerald-300"
                      >
                        <Check className="w-3 h-3 inline" /> Resolve
                      </button>
                    )}
                    {c.resolved === 1 && (
                      <span className="ml-auto text-[9px] text-emerald-500">resolved by {c.resolved_by?.slice(0, 8)}</span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export default WhiteboardCommentsPanel;
