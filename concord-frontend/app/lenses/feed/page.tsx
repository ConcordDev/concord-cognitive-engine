'use client';

/**
 * Feed lens: the north-star look (serif title, pill views, teal floating CTA)
 * over the full timeline, profile, tools and HN front page. Every view is the
 * existing real workbench; the CTA focuses the compose box.
 */

import { useCallback, useState } from 'react';
import { Home, Newspaper, Plus, Rss, Search, User, Wrench } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { HnFrontPage } from '@/components/feed/HnFrontPage';
import { FeedTimelinePanel, requestFeedCompose } from '@/components/feed/FeedTimelinePanel';
import { FeedProfilePanel } from '@/components/feed/FeedProfilePanel';
import { FeedToolsView } from '@/components/feed/FeedToolsView';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import type { FeedTab } from '@/components/feed/useFeedPosts';

type FeedView = FeedTab | 'profile' | 'tools' | 'hn';

const TIMELINE: FeedTab[] = ['for-you', 'following', 'releases', 'trending'];
const isTimeline = (v: FeedView): v is FeedTab => (TIMELINE as string[]).includes(v);

const VIEWS: { id: FeedView; label: string; keys: string; title: string; hint: string; icon: typeof Home }[] = [
  { id: 'for-you', label: 'For you', keys: 'f', title: 'The next thing', hint: 'Ranked posts and DTUs for you', icon: Home },
  { id: 'following', label: 'Following', keys: 'l', title: 'Who you follow', hint: 'Posts from people you follow', icon: Rss },
  { id: 'trending', label: 'Explore', keys: 't', title: 'What is catching on', hint: 'Trending posts and people to follow', icon: Search },
  { id: 'releases', label: 'Releases', keys: 'r', title: 'What just shipped', hint: 'New releases from the substrate', icon: Newspaper },
  { id: 'profile', label: 'Profile', keys: 'p', title: 'Your profile', hint: 'Your posts, followers and stats', icon: User },
  { id: 'tools', label: 'Tools', keys: 'g', title: 'Tune your feed', hint: 'Ranking, threads, lists, polls, saved and spaces', icon: Wrench },
  { id: 'hn', label: 'HN', keys: 'h', title: 'The front page of Hacker News', hint: 'Live Hacker News front page', icon: Newspaper },
];

export default function FeedLensPage() {
  useLensNav('feed');
  useLensIdentity('feed');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<FeedView>('for-you');

  const compose = useCallback(() => {
    setView((v) => (isTimeline(v) ? v : 'for-you'));
    requestFeedCompose();
  }, []);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `goto-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setView(v.id),
      })),
      {
        id: 'compose',
        keys: 'c',
        description: 'Compose post',
        category: 'actions' as const,
        action: compose,
      },
    ],
    { lensId: 'feed' },
  );

  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <LensShell lensId="feed" asMain={false}>
      <FirstRunTour lensId="feed" />
      <DepthBadge lensId="feed" size="sm" className="ml-2" />
      <div className="lens-feed relative min-h-full px-8 pb-28 pt-6" data-lens-theme="feed">
        <p className="text-[14px] text-zinc-500">Feed</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          {current.title}{view === 'for-you' && who ? `, ${who}` : ''}
        </h1>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Feed views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <div className="flex min-w-0">
          {isTimeline(view) && <FeedTimelinePanel tab={view} onDiscover={() => setView('trending')} />}
          {view === 'profile' && <FeedProfilePanel onNavigateToUser={() => setView('trending')} />}
          {view === 'tools' && <FeedToolsView />}
          {view === 'hn' && (
            <div className="min-w-0 max-w-3xl flex-1">
              <HnFrontPage />
            </div>
          )}
        </div>

        <CrossLensRecentsPanel lensId="feed" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={compose}
          title="Compose post (C)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New post
        </button>
      </div>
    </LensShell>
  );
}
