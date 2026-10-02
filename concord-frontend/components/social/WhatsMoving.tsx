'use client';

/** Social north star — the next real post. Nothing is invented into the feed. */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Post = { id?: string; username?: string; body?: string };

export function WhatsMoving({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('social');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const feedQ = useMacro<{ posts?: Post[] }>(
    ['social-northstar', 'feed'],
    'social',
    'feed',
    { limit: 1 },
    (result) => {
      if (!Array.isArray(result.posts)) throw new Error('The feed did not answer.');
      return result;
    },
  );
  const post = feedQ.data?.posts?.[0] ?? null;
  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const postIt = async () => {
    if (!body.trim()) {
      setError('A post needs words.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await lensRun('social', 'createPost', { body: body.trim() });
      if (!res.data.ok) {
        setError(res.data.error || 'The post was not sent.');
        return;
      }
      setBody('');
      setComposing(false);
      await client.invalidateQueries({ queryKey: ['social-northstar', 'feed'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The post was not sent.');
    } finally {
      setBusy(false);
    }
  };

  const loadError = feedQ.error instanceof Error ? feedQ.error.message : '';

  return (
    <LensShell lensId="social" asMain={false} disableAgentFab>
      <div data-lens-theme="social" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Social" title={who ? `What's moving, ${who}` : "What's moving"} />
          <QuietMore items={[{ id: 'desk', label: 'Hub' }]} onPick={onOpenDesk} />
        </div>

        {(loadError || error) && <NorthError message={error || loadError} />}

        {feedQ.data && !post && <p className="mt-8 text-[15px] text-zinc-500">Nothing posted.</p>}
        {post && (
          <article className="mt-8 max-w-xl rounded-xl border border-white/10 px-4 py-4" data-testid="social-post">
            {post.username && <p className="text-[13px] text-zinc-500">{post.username}</p>}
            {post.body && <p className="mt-1 text-[16px] text-zinc-100">{post.body}</p>}
          </article>
        )}

        {composing && (
          <form className="mt-4 max-w-xl space-y-2" onSubmit={(e) => { e.preventDefault(); void postIt(); }}>
            <textarea aria-label="Post" value={body} onChange={(e) => setBody(e.target.value)} placeholder="What's moving" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <button type="submit" disabled={busy} className="rounded-full bg-white/10 px-4 py-2 text-[14px] disabled:opacity-50">Send</button>
          </form>
        )}

        <button type="button" className={northCtaClass} onClick={() => setComposing(true)}>Post</button>
      </div>
    </LensShell>
  );
}
