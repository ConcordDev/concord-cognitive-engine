'use client';

/** News north star — headlines the pull actually returns. */

import { useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { FamilyPill, NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Headline = { id?: string; title?: string; source?: string; url?: string };

export function WhatChanged({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('news');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const pullQ = useMacro<{ headlines?: Headline[]; count?: number }>(
    ['news-northstar', 'headlines'],
    'news',
    'headlines',
    { category: 'top', limit: 12 },
    (result) => {
      if (!Array.isArray(result.headlines)) throw new Error('The pull did not answer.');
      return result;
    },
  );
  const headlines = pullQ.data?.headlines ?? [];
  const sources = new Set(headlines.map((h) => h.source).filter(Boolean)).size;
  const loadError = pullQ.error instanceof Error ? pullQ.error.message : '';

  return (
    <LensShell lensId="news" asMain={false} disableAgentFab>
      <div data-lens-theme="news" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="News" title={who ? `What changed, ${who}` : 'What changed'} />
          <QuietMore items={[{ id: 'desk', label: 'Live desk' }]} onPick={onOpenDesk} />
        </div>
        <FamilyPill
          label="News"
          active="news"
          items={[
            { id: 'chat', label: 'Chat', href: '/lenses/chat' },
            { id: 'news', label: 'News', href: '/lenses/news' },
            { id: 'feed', label: 'Feed', href: '/lenses/feed' },
          ]}
        />

        {loadError && <NorthError message={loadError} />}

        {pullQ.isLoading && (
          <div className="mt-6 max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4" data-testid="news-fetching">
            <span className="inline-flex rounded-full border border-teal-400/30 px-2.5 py-0.5 text-[12px] text-teal-300">Fetching</span>
          </div>
        )}

        {pullQ.data && headlines.length === 0 && (
          <div className="mt-6 max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
            <p className="text-[14px] text-zinc-400">Headlines 0 · sources 0. The desk fills when the pull returns.</p>
          </div>
        )}

        {headlines.length > 0 && (
          <div className="mt-6 max-w-xl" data-testid="news-headlines">
            <p className="text-[13px] text-zinc-500 tabular-nums">{headlines.length} {headlines.length === 1 ? 'headline' : 'headlines'} · {sources} {sources === 1 ? 'source' : 'sources'}</p>
            <ul className="mt-3 space-y-2">
              {headlines.map((h, i) => (
                <li key={h.id || h.url || `${i}`} className="rounded-xl border border-white/10 px-4 py-3">
                  <p className="text-[16px] text-zinc-100">{h.title}</p>
                  {h.source && <p className="mt-1 text-[13px] text-zinc-500">{h.source}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          className={northCtaClass}
          onClick={() => void client.invalidateQueries({ queryKey: ['news-northstar', 'headlines'] })}
        >
          Refresh
        </button>
      </div>
    </LensShell>
  );
}
