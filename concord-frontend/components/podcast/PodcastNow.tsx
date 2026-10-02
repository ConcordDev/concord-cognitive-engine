'use client';

/**
 * Podcast north star — the show that is on. Counts come from the podcast macros.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { StudioFamilyPill } from '@/components/studio/StudioFamilyChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Episode = { id?: string; title?: string; audioUrl?: string };
type Show = { id?: string; title?: string; subscribed?: boolean };

export function PodcastNow({ onOpenDesk }: { onOpenDesk: () => void }) {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const qc = useQueryClient();
  const shows = useQuery({
    queryKey: ['podcast-north', 'shows'],
    queryFn: () => lensRun('podcast', 'show-list', { subscribed: true }),
  });
  const listening = useQuery({
    queryKey: ['podcast-north', 'listening'],
    queryFn: () => lensRun('podcast', 'continue-listening', {}),
  });
  const queue = useQuery({
    queryKey: ['podcast-north', 'queue'],
    queryFn: () => lensRun('podcast', 'queue-list', {}),
  });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const showResult = shows.data?.data?.ok ? shows.data.data.result as { count?: number; shows?: Show[] } : null;
  const listenResult = listening.data?.data?.ok ? listening.data.data.result as { count?: number; episodes?: Episode[] } : null;
  const queueResult = queue.data?.data?.ok ? queue.data.data.result as { episodes?: Episode[] } : null;
  const subscribed = showResult ? (typeof showResult.count === 'number' ? showResult.count : (showResult.shows?.length ?? 0)) : null;
  const inProgress = listenResult ? (typeof listenResult.count === 'number' ? listenResult.count : (listenResult.episodes?.length ?? 0)) : null;
  const queued = queueResult?.episodes?.[0] || null;

  const add = async () => {
    const name = title.trim();
    if (!name) {
      setAdding(true);
      setError('Name the show.');
      return;
    }
    setError('');
    const created = await lensRun('podcast', 'show-add', { title: name });
    if (!created.data?.ok) {
      setError(created.data?.error || 'Could not add the show.');
      return;
    }
    const id = (created.data.result as { show?: { id?: string } } | null)?.show?.id;
    if (id) await lensRun('podcast', 'show-subscribe', { id });
    setTitle('');
    setAdding(false);
    await qc.invalidateQueries({ queryKey: ['podcast-north'] });
  };

  const subLabel = subscribed === null ? '—' : String(subscribed);
  const progLabel = inProgress === null ? '—' : String(inProgress);

  return (
    <LensShell lensId="podcast" asMain={false} disableAgentFab>
      <div data-lens-theme="podcast" className="flex min-h-[calc(100vh-4rem)] flex-col px-8 pb-28 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Podcast" title={who ? `What's on, ${who}` : "What's on"} />
            <StudioFamilyPill active="podcast" />
          </div>
          <QuietMore items={[{ id: 'desk', label: 'Show desk' }]} onPick={onOpenDesk} />
        </div>

        <section className="mt-8 max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
          <p className="flex items-center gap-2 text-[15px] text-zinc-100">
            <Play className="h-3.5 w-3.5 fill-teal-400 text-teal-400" aria-hidden />
            {queued?.title || 'Nothing queued'}
          </p>
          <p className="mt-2 text-[13px] text-zinc-500">{subLabel} subscribed · {progLabel} in progress.</p>
          {queued?.audioUrl && (
            <audio className="mt-3 w-full" controls src={queued.audioUrl} preload="none" />
          )}
          {adding && (
            <label className="mt-4 block text-[13px] text-zinc-400">
              Show title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[14px] text-zinc-100"
              />
            </label>
          )}
          {error && <p role="alert" className="mt-3 text-[13px] text-rose-300">{error}</p>}
        </section>

        <button type="button" className={northCtaClass} onClick={() => { void add(); }}>
          + Add a show
        </button>
      </div>
    </LensShell>
  );
}
