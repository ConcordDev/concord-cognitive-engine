'use client';

/** Forum north star — the board. Rank stays in topic-list. */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { ChatFamilyPill } from '@/components/chat/ChatFamilyPill';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Topic = { id: string; title: string; score?: number; replyCount?: number };

export function TheBoard({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('forum');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const topicsQ = useMacro<{ topics?: Topic[]; count?: number }>(
    ['forum-northstar', 'topics'],
    'forum',
    'topic-list',
    {},
    (result) => {
      if (!Array.isArray(result.topics)) throw new Error('The board did not answer.');
      return result;
    },
  );
  const topics = topicsQ.data?.topics ?? [];
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const post = async () => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setError('A post needs a title.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await lensRun('forum', 'topic-create', { title: nextTitle, body: body.trim() });
      if (!res.data.ok) {
        setError(res.data.error || 'The post was not added.');
        return;
      }
      setTitle('');
      setBody('');
      setComposing(false);
      await client.invalidateQueries({ queryKey: ['forum-northstar', 'topics'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The post was not added.');
    } finally {
      setBusy(false);
    }
  };

  const loadError = topicsQ.error instanceof Error ? topicsQ.error.message : '';

  return (
    <LensShell lensId="forum" asMain={false} disableAgentFab>
      <div data-lens-theme="forum" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Forum" title={who ? `What's worth reading, ${who}` : "What's worth reading"} />
          <QuietMore
            items={[
              { id: 'discourse', label: 'Discourse' },
              { id: 'board', label: 'Board' },
              { id: 'chatter', label: 'Chatter' },
              { id: 'actions', label: 'Mod tools' },
            ]}
            onPick={onOpenDesk}
          />
        </div>
        <ChatFamilyPill active="forum" />

        {(loadError || error) && <NorthError message={error || loadError} />}

        {topicsQ.data && topics.length === 0 && (
          <div className="mt-6 max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3" data-testid="forum-empty">
            <span className="inline-flex rounded-full border border-white/10 px-2.5 py-0.5 text-[12px] text-zinc-300">No posts on the board</span>
            <p className="mt-3 text-[14px] text-zinc-400">Live counters on this pass were zero. Rank stays in the engine.</p>
          </div>
        )}

        {topics.length > 0 && (
          <ul className="mt-6 max-w-xl space-y-2" data-testid="forum-topics">
            {topics.map((topic) => (
              <li key={topic.id} className="rounded-xl border border-white/10 px-4 py-3">
                <p className="text-[16px] text-zinc-100">{topic.title}</p>
                {typeof topic.replyCount === 'number' && (
                  <p className="mt-1 text-[13px] text-zinc-500 tabular-nums">{topic.replyCount} {topic.replyCount === 1 ? 'reply' : 'replies'}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {composing && (
          <form className="mt-4 max-w-xl space-y-2" onSubmit={(e) => { e.preventDefault(); void post(); }}>
            <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <textarea aria-label="Post" value={body} onChange={(e) => setBody(e.target.value)} placeholder="What's worth reading" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <button type="submit" disabled={busy} className="rounded-full bg-white/10 px-4 py-2 text-[14px] disabled:opacity-50">Send</button>
          </form>
        )}

        <button type="button" className={northCtaClass} onClick={() => setComposing(true)}>+ New post</button>
      </div>
    </LensShell>
  );
}
