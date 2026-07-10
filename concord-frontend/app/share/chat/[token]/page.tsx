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
 * Honest scope limit (same as the animation share page): `share-view` is
 * dispatched through the same cookie-authenticated `lensRun` every other
 * lens macro uses. It works for any signed-in Concord user (the macro checks
 * a valid, non-revoked token only — not ownership), which is real progress.
 * A genuinely logged-out visitor cannot reach it yet, because the `chat`
 * domain's public-read allowlist only covers `timeline`/`summary`, not
 * `share-view`. Widening that allowlist is a permission-system change, not a
 * UI rebuild, so it is intentionally NOT done here — this page renders an
 * honest sign-in prompt for that case instead of failing silently or
 * pretending anonymous access works.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, MessageSquare, Eye, LogIn, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';

interface SharedMessage { role: string; content: string; timestamp?: string }
interface SharedThread {
  title: string; messages: SharedMessage[]; messageCount: number;
  createdAt: string; viewCount: number;
}

export default function ChatSharePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token as string;
  const { user, isLoading: authLoading } = useAuth();
  const [thread, setThread] = useState<SharedThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    if (authLoading || !token) return;
    if (!user) { setNeedsAuth(true); setLoading(false); return; }
    let active = true;
    (async () => {
      const r = await lensRun<SharedThread>('chat', 'share-view', { token });
      if (!active) return;
      if (!r.data.ok) {
        setError(r.data.error || 'This share link is invalid or has been revoked.');
        setLoading(false);
        return;
      }
      setThread(r.data.result || null);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [token, user, authLoading]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (needsAuth) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-6">
        <div className="max-w-sm text-center space-y-4">
          <MessageSquare className="w-10 h-10 text-cyan-400 mx-auto" />
          <h1 className="text-lg font-semibold text-zinc-100">Sign in to view this conversation</h1>
          <p className="text-sm text-zinc-400">
            This shared link works for any Concord account — full anonymous public viewing isn&apos;t wired up yet.
          </p>
          <Link href={`/login?from=${encodeURIComponent(`/share/chat/${token}`)}`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 rounded-lg text-sm hover:bg-cyan-500/30">
            <LogIn className="w-4 h-4" /> Sign in
          </Link>
        </div>
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
          <h1 className="text-lg font-semibold text-zinc-100">{thread.title}</h1>
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
