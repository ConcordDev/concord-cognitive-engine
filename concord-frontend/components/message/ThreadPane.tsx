'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, X, Send, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Reply { id: string; rootId: string; channelId: string; senderName: string; body: string; ts: string }
interface RootMsg { id: string; body: string; senderName: string; ts: string }

export function ThreadPane({
  channelId, rootId, root, onClose, onActivity,
}: {
  channelId: string;
  rootId: string;
  root: RootMsg | null;
  onClose: () => void;
  onActivity?: () => void;
}) {
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [rootId]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'message', action: 'thread-list', input: { rootId } });
      setReplies((r.data?.result?.replies || []) as Reply[]);
    } catch (e) { console.error('[Thread] failed', e); }
    finally { setLoading(false); }
  }

  async function send() {
    if (!body.trim()) return;
    setSending(true);
    try {
      await lensRun({ domain: 'message', action: 'thread-reply', input: { channelId, rootId, body: body.trim() } });
      setBody('');
      await refresh();
      onActivity?.();
    } catch (e) { console.error('[Thread] reply', e); }
    finally { setSending(false); }
  }

  return (
    <>
      <header className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <MessageSquare className="w-3.5 h-3.5 text-violet-400" />
        <span className="text-xs font-semibold text-gray-200 flex-1">Thread</span>
        <button aria-label="Close" onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-3.5 h-3.5" /></button>
      </header>
      {root && (
        <div className="px-3 py-2 border-b border-white/10 bg-violet-500/[0.04]">
          <div className="text-[10px] text-violet-300 font-mono">{root.senderName} · {new Date(root.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <div className="text-xs text-white mt-0.5 whitespace-pre-wrap">{root.body}</div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="text-xs text-gray-400 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Loading…</div>
        ) : replies.length === 0 ? (
          <div className="text-xs text-gray-400 italic">Start a thread.</div>
        ) : replies.map(r => (
          <div key={r.id} className="flex items-start gap-2">
            <div className="w-6 h-6 rounded bg-violet-500/15 text-violet-200 flex items-center justify-center text-[10px] font-bold flex-shrink-0">{r.senderName.slice(0, 2).toUpperCase()}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[10px]">
                <span className="font-semibold text-white">{r.senderName}</span>
                <span className="text-gray-400 font-mono">{new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="text-xs text-white whitespace-pre-wrap">{r.body}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 p-2 flex items-end gap-1">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          rows={2}
          placeholder="Reply in thread…"
          className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white resize-none"
        />
        <button onClick={send} disabled={sending || !body.trim()} className="px-2 py-1 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400 disabled:opacity-40">
          {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
        </button>
      </div>
    </>
  );
}

export default ThreadPane;
