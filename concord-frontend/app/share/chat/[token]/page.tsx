'use client';

/**
 * Public chat share viewer — /share/chat/[token]
 *
 * Wires the `chat.share-view` macro to an actual consuming page. Before this
 * page existed, ChatStudioPanel's ShareTab could create a real share link
 * (`chat.share-create`) and showed its URL (`/share/chat/{token}`) with a
 * working "copy link" button — but no route in the app rendered that URL, so
 * every copied link 404'd even though the UI implied the share worked. This
 * mirrors the fix already shipped for `/share/animation/[token]`.
 *
 * Genuinely public (closing the gap the earlier version of this page
 * honestly disclosed): this page now calls the dedicated public REST route
 * `GET /api/chat/share/:token` (server.js) with a plain, unauthenticated
 * `fetch` — no cookie, no Authorization header, no dependency on
 * `useAuth()`. The route invokes the `chat.share-view` LENS_ACTIONS handler
 * directly (bypassing the authenticated `/api/lens/run` surface entirely,
 * the same pattern used for animation shares and the welding client
 * portal), so a genuinely logged-out visitor with the link can view the
 * conversation. The token itself is the only access control — it's an
 * unguessable id scoped server-side to exactly one shared thread; the
 * handler checks token validity + revocation only, never ownership.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, MessageSquare, Eye, AlertTriangle } from 'lucide-react';

interface SharedMessage { role: string; content: string; timestamp?: string }
interface SharedThread {
  title: string; messages: SharedMessage[]; messageCount: number;
  createdAt: string; viewCount: number;
}

export default function ChatSharePage() {
  const params = useParams<{ token: string }>();
  const token = (params?.token as string) || '';
  const [thread, setThread] = useState<SharedThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/chat/share/${encodeURIComponent(token)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'This share link is invalid or has been revoked.');
        setThread(null);
        return;
      }
      setThread(data.result || null);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error || !thread) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-6">
        <div className="max-w-sm text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
          <p className="text-sm text-zinc-300">{error || 'Conversation not found.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="text-center space-y-1">
          <h1 className="text-lg font-semibold text-zinc-100 flex items-center justify-center gap-2">
            <MessageSquare className="w-4 h-4 text-cyan-400" /> {thread.title}
          </h1>
          <p className="text-xs text-zinc-500 flex items-center justify-center gap-3">
            <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {thread.viewCount} views</span>
            <span>{thread.messageCount} messages</span>
            <span>{new Date(thread.createdAt).toLocaleDateString()}</span>
          </p>
        </header>
        <div className="space-y-3">
          {thread.messages.map((m, i) => (
            <div key={i} className={`rounded-lg border p-3 text-sm whitespace-pre-wrap ${
              m.role === 'user' ? 'border-cyan-500/20 bg-cyan-500/5 text-zinc-100' : 'border-white/10 bg-white/[0.03] text-zinc-200'
            }`}>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
                {m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Concord' : m.role}
              </p>
              {m.content}
            </div>
          ))}
        </div>
        <p className="text-center text-[11px] text-zinc-600">Read-only shared snapshot — this conversation cannot be replied to here.</p>
      </div>
    </div>
  );
}
