'use client';

/**
 * Game north star — one quest. XP, streak, and the desk wall stay under More.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { StudioFamilyPill } from '@/components/studio/StudioFamilyChrome';
import GameApp from '@/components/game/GameApp';
import { api } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Challenge = { id?: string; name?: string; description?: string; progress?: number; target?: number };

export function GameNorthStar() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const quests = useLensData<Record<string, unknown>>('game', 'quest', { noSeed: true });
  const { data } = useQuery({
    queryKey: ['game', 'challenges'],
    queryFn: () => api.get('/api/game/challenges').then((r) => r.data as { challenges?: Challenge[] }),
  });
  const [desk, setDesk] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const openChallenge = (data?.challenges || []).find((c) => {
    const progress = Number(c.progress) || 0;
    const target = Number(c.target);
    return !Number.isFinite(target) || progress < target;
  });
  const saved = quests.items.find((item) => item.meta?.status !== 'completed') || quests.items[0];
  const activeName = saved?.title || openChallenge?.name || '';
  const activeDetail = (typeof saved?.data?.description === 'string' && saved.data.description)
    || openChallenge?.description
    || '';

  const start = async () => {
    const title = name.trim();
    if (!title) {
      setNaming(true);
      setError('Name the quest.');
      return;
    }
    setError('');
    try {
      await quests.create({
        title,
        data: { description: title, status: 'accepted' },
        meta: { status: 'active', tags: ['quest'] },
      });
      setName('');
      setNaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the quest.');
    }
  };

  if (desk) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-black">
        <div className="px-6 pt-4">
          <button type="button" onClick={() => setDesk(false)} className="inline-flex items-center gap-1.5 text-[14px] text-zinc-500 hover:text-zinc-200">
            <ArrowLeft className="h-4 w-4" />
            Game
          </button>
        </div>
        <GameApp />
      </div>
    );
  }

  return (
    <LensShell lensId="game" asMain={false} disableAgentFab>
      <div data-lens-theme="game" className="flex min-h-[calc(100vh-4rem)] flex-col px-8 pb-28 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Game" title={who ? `What are you playing, ${who}` : 'What are you playing'} />
            <StudioFamilyPill active="game" />
          </div>
          <QuietMore items={[{ id: 'desk', label: 'Quest desk' }]} onPick={() => setDesk(true)} />
        </div>

        <section className="mt-8 max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
          <p className="inline-flex rounded-full border border-white/10 px-2.5 py-0.5 text-[12px] text-zinc-300">
            {activeName || 'No active quest'}
          </p>
          <p className="mt-3 text-[14px] text-zinc-400">
            {activeDetail || 'One quest at a time. Level, streak, and the desk wall stay out of the way.'}
          </p>
          {naming && (
            <label className="mt-4 block text-[13px] text-zinc-400">
              Quest name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[14px] text-zinc-100"
              />
            </label>
          )}
          {error && <p role="alert" className="mt-3 text-[13px] text-rose-300">{error}</p>}
        </section>

        <button type="button" className={northCtaClass} onClick={() => { void start(); }}>
          Start a quest
        </button>
      </div>
    </LensShell>
  );
}
