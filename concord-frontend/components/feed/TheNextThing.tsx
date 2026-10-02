'use client';

/** Feed north star — the next ranked posts. No invented cards. */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { FamilyPill, NorthError, northPage } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type FeedItem = {
  id?: string;
  content?: string;
  title?: string;
  authorId?: string;
  linkedDTUs?: { dtuId?: string; title?: string }[];
};

function readItems(result: unknown): FeedItem[] {
  if (!result || typeof result !== 'object') throw new Error('The feed did not answer.');
  const node = result as { items?: FeedItem[]; result?: { items?: FeedItem[] } };
  const items = Array.isArray(node.items) ? node.items : node.result?.items;
  if (!Array.isArray(items)) throw new Error('The feed did not answer.');
  return items;
}

export function TheNextThing({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('feed');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const feedQ = useQuery({
    queryKey: ['feed-northstar', 'home'],
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await lensRun('feed', 'home', { limit: 8 });
      if (!res.data.ok || res.data.result == null) throw new Error(res.data.error || 'The feed did not answer.');
      return readItems(res.data.result);
    },
  });
  const items = feedQ.data ?? [];
  const loadError = feedQ.error instanceof Error ? feedQ.error.message : '';

  return (
    <LensShell lensId="feed" asMain={false} disableAgentFab>
      <div data-lens-theme="feed" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Feed" title={who ? `The next thing, ${who}` : 'The next thing'} />
          <QuietMore
            items={[
              { id: 'for-you', label: 'For you' },
              { id: 'following', label: 'Following' },
              { id: 'tools', label: 'Tools' },
            ]}
            onPick={onOpenDesk}
          />
        </div>
        <FamilyPill
          label="Feed"
          active="feed"
          items={[
            { id: 'chat', label: 'Chat', href: '/lenses/chat' },
            { id: 'feed', label: 'Feed', href: '/lenses/feed' },
            { id: 'news', label: 'News', href: '/lenses/news' },
          ]}
        />

        {loadError && <NorthError message={loadError} />}

        {feedQ.data && items.length === 0 && (
          <div className="mt-6 max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[14px] text-zinc-400" data-testid="feed-empty">
            Nothing ranked for you yet. A post shows up here when the feed returns one — citations included, no invented cards.
          </div>
        )}

        {items.length > 0 && (
          <ul className="mt-6 max-w-xl space-y-2" data-testid="feed-column">
            {items.map((item, i) => {
              const text = (item.content || item.title || '').trim();
              if (!text) return null;
              return (
                <li key={item.id || `${i}`} className="rounded-xl border border-white/10 px-4 py-3">
                  <p className="text-[16px] text-zinc-100">{text}</p>
                  {item.linkedDTUs?.filter((d) => d.title || d.dtuId).map((d) => (
                    <p key={d.dtuId || d.title} className="mt-1 text-[13px] text-zinc-500">{d.title || d.dtuId}</p>
                  ))}
                </li>
              );
            })}
          </ul>
        )}

        <button
          type="button"
          className={northCtaClass}
          onClick={() => void client.invalidateQueries({ queryKey: ['feed-northstar', 'home'] })}
        >
          Refresh
        </button>
      </div>
    </LensShell>
  );
}
