'use client';

// Timeline lens — a Facebook-style personal activity feed built on the
// `timeline` domain macros (server/domains/timeline.js). Posts, reactions
// + breakdown, nested comments, share/repost, media albums, per-post
// privacy, profile, "On this day" memories and notifications are all wired
// to real macros; nothing here is placeholder data.

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { TimelineRoadmap } from '@/components/timeline/TimelineRoadmap';
import { TimelineWiki } from '@/components/timeline/TimelineWiki';
import { PostComposer } from '@/components/timeline/PostComposer';
import { PostCard } from '@/components/timeline/PostCard';
import { AlbumsPanel } from '@/components/timeline/AlbumsPanel';
import { ProfilePanel } from '@/components/timeline/ProfilePanel';
import { MemoriesPanel } from '@/components/timeline/MemoriesPanel';
import { NotificationsPanel } from '@/components/timeline/NotificationsPanel';
import { TimelineView } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  CalendarRange, LayoutList, GitBranch, LayoutGrid, Clock, Bell, UserCircle, Loader2, Globe, Users, Lock, Plus,
} from 'lucide-react';
import type { FeedPost, Privacy } from '@/components/timeline/types';

type Tab = 'roadmap' | 'feed' | 'timeline' | 'albums' | 'memories' | 'notifications' | 'profile';

interface FeedResult {
  posts: FeedPost[];
  total: number;
}

const TAB_IDS: Tab[] = ['feed', 'timeline', 'albums', 'memories', 'notifications', 'roadmap', 'profile'];

// S-TL-1 (F1/F10) + the founder's Roadmap ruling (2026-10-29): Feed is
// Timeline's front door and Roadmap is demoted to a tab. A cold open
// lands on Feed and a reload returns to Feed — the old reset-to-
// Roadmap on every mount was part of the defect. An explicit ?tab=
// deep link is still honoured. (An earlier cut restored the last-
// viewed tab from localStorage; the ruling superseded it.)
function tabFromParam(): Tab | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('tab');
  return TAB_IDS.includes(value as Tab) ? (value as Tab) : null;
}

const TABS: { id: Tab; label: string; keys: string; hint: string; icon: typeof LayoutList }[] = [
  { id: 'feed', label: 'Feed', keys: 'g f', hint: 'Your posts, reactions and comments', icon: LayoutList },
  { id: 'timeline', label: 'Post history', keys: 'g t', hint: 'Every post on an axis, colored by audience', icon: GitBranch },
  { id: 'albums', label: 'Albums', keys: 'g a', hint: 'Media albums', icon: LayoutGrid },
  { id: 'memories', label: 'Memories', keys: 'g m', hint: 'What you posted on this day before', icon: Clock },
  { id: 'notifications', label: 'Alerts', keys: 'g n', hint: 'Reactions, comments and mentions', icon: Bell },
  { id: 'roadmap', label: 'Roadmap', keys: 'g r', hint: 'Milestones and goals on a week ruler', icon: CalendarRange },
  { id: 'profile', label: 'Profile', keys: 'g p', hint: 'Your profile and stats', icon: UserCircle },
];

// Map post privacy to a TimelineView tone so the axis colour-codes audience.
const PRIVACY_TONE: Record<string, TimelineEvent['tone']> = {
  public: 'info',
  friends: 'good',
  private: 'warn',
};

export default function TimelineLensPage() {
  useLensNav('timeline');
  useLensIdentity('timeline');
  const { isLive, lastUpdated } = useRealtimeLens('timeline');
  const { user } = useAuth();
  const viewerId = user?.id || 'anon';

  const [tab, setTab] = useState<Tab>('feed');
  useEffect(() => {
    const fromParam = tabFromParam();
    if (fromParam) setTab(fromParam);
  }, []);
  const [limit, setLimit] = useState(30);
  const [search, setSearch] = useState('');
  // S-TL-10 (F13/F17): the audience filter and search run server-side
  // over the whole visible set, so the counts describe the filtered
  // set — not the loaded page. Search input is debounced into the query.
  const [audience, setAudience] = useState<'all' | Privacy>('all');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Friends-only visibility is decided by the server friend graph.
  // Sending persona ids as friendIds only hides real friends, because that
  // list can narrow the feed and cannot grant access.
  const {
    data: feed,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['timeline-feed', limit, audience, debouncedSearch],
    queryFn: async () => {
      const r = await lensRun<FeedResult>('timeline', 'feed-list', {
        limit,
        offset: 0,
        ...(audience !== 'all' ? { audience } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      });
      if (!r.data.ok) throw new Error(r.data.error || 'Could not load feed');
      return r.data.result ?? { posts: [], total: 0 };
    },
    enabled: tab !== 'roadmap',
  });

  // Unread notification badge.
  const { data: unread } = useQuery({
    queryKey: ['timeline-unread'],
    queryFn: async () => {
      const r = await lensRun<{ unread: number }>('timeline', 'notifications-list', { limit: 1 });
      return r.data.result?.unread ?? 0;
    },
    refetchInterval: 30000,
  });

  const posts = useMemo(() => feed?.posts ?? [], [feed]);

  // S-TL-10: filtering/searching already happened server-side — what
  // arrived IS the visible set (the old client filter searched author
  // UUIDs over one loaded page and called the page count a match count).
  const visiblePosts = posts;
  const filtering = audience !== 'all' || debouncedSearch.length > 0;

  // Timeline-view events derived from real feed posts.
  const timelineEvents: TimelineEvent[] = useMemo(
    () =>
      posts.map((p) => ({
        id: p.id,
        time: p.createdAt,
        label: p.authorId,
        detail: p.content.slice(0, 80) || '(media post)',
        tone: PRIVACY_TONE[p.privacy] ?? 'info',
      })),
    [posts],
  );

  const loadMore = useCallback(() => setLimit((n) => n + 30), []);

  const compose = useCallback(() => {
    setTab((t) => (t === 'feed' || t === 'timeline' ? t : 'feed'));
    let tries = 0;
    const focus = () => {
      const el = document.querySelector<HTMLTextAreaElement>('[data-lens-theme="timeline"] textarea');
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); return; }
      if (++tries < 20) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }, []);

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `goto-${t.id}`,
        keys: t.keys,
        description: `${t.label} — ${t.hint}`,
        category: 'navigation' as const,
        action: () => setTab(t.id),
      })),
      { id: 'compose', keys: 'c', description: 'New post', category: 'actions' as const, action: compose },
      { id: 'load-more', keys: 'm', description: 'Load 30 more posts', category: 'actions' as const, action: loadMore },
    ],
    { lensId: 'timeline' },
  );


  return (
    <LensShell lensId="timeline" asMain={false}>

      <DepthBadge lensId="timeline" size="sm" className="ml-2" />
      <div data-lens-theme="timeline" className="relative min-h-full">
        <div className="px-8 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Timeline</h1>
            </div>
            <div className="flex shrink-0 items-center gap-3 pt-2">
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            </div>
          </div>

          <nav className="mb-2 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Timeline views">
            {TABS.map((t) => {
              const Icon = t.icon;
              const on = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={on ? 'page' : undefined}
                  title={`${t.hint} (${t.keys})`}
                  className={cn(
                    'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                    on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                  {t.id === 'notifications' && (unread ?? 0) > 0 && (
                    <span className="rounded-full bg-teal-400 px-1.5 text-[11px] font-medium text-black">{unread}</span>
                  )}
                  <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.keys}</kbd>
                </button>
              );
            })}
          </nav>
        </div>

        {tab === 'roadmap' ? (
          <TimelineRoadmap />
        ) : (
        <>
        <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
          {tab === 'profile' && <ProfilePanel viewerId={viewerId} />}
          {tab === 'albums' && <AlbumsPanel />}
          {tab === 'memories' && <MemoriesPanel />}
          {tab === 'notifications' && <NotificationsPanel />}

          {(tab === 'feed' || tab === 'timeline') && (
            <>
              <PostComposer onPosted={() => setTab('feed')} />

              {/* S-TL-10: the audience filter row — every chip shows
                  exactly its tier, and the count is that tier's total. */}
              <div className="bg-[#242526] rounded-lg px-4 py-2 flex items-center gap-2 text-xs text-gray-400">
                {([
                  { id: 'all', label: 'All', icon: LayoutList },
                  { id: 'public', label: 'Public', icon: Globe },
                  { id: 'friends', label: 'Friends', icon: Users },
                  { id: 'private', label: 'Only me', icon: Lock },
                ] as const).map((f) => {
                  const Icon = f.icon;
                  const active = audience === f.id;
                  return (
                    <button
                      key={f.id}
                      onClick={() => setAudience(f.id)}
                      aria-pressed={active}
                      className={cn(
                        'inline-flex items-center gap-1 px-2.5 py-1 rounded-full',
                        active ? 'bg-blue-600 text-white' : 'hover:bg-[#3a3b3c] text-gray-300',
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" /> {f.label}
                    </button>
                  );
                })}
                <span className="ml-auto">{feed?.total ?? 0} posts{filtering ? ' in this view' : ''}</span>
              </div>

              {isLoading ? (
                <div className="bg-[#242526] rounded-lg p-8 text-center text-sm text-gray-400">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading your timeline…
                </div>
              ) : isError ? (
                <div className="bg-[#242526] rounded-lg p-8 text-center text-sm text-red-400">
                  <p>{error instanceof Error ? error.message : 'Failed to load'}</p>
                  <button
                    onClick={() => refetch()}
                    className="mt-3 px-4 py-1.5 rounded bg-blue-600 text-white text-xs"
                  >
                    Retry
                  </button>
                </div>
              ) : tab === 'timeline' ? (
                timelineEvents.length > 0 ? (
                  <div className="bg-[#242526] rounded-lg p-4">
                    <TimelineView events={timelineEvents} height={360} />
                  </div>
                ) : (
                  <div className="bg-[#242526] rounded-lg p-8 text-center text-gray-400">
                    <GitBranch className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">No posts yet — create one above to populate the timeline.</p>
                  </div>
                )
              ) : (
                <>
                  <div className="bg-[#242526] rounded-lg p-3 flex items-center gap-2">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search feed by author or content…"
                      className="flex-1 bg-[#3a3b3c] rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {debouncedSearch
                        ? `${feed?.total ?? 0} match${(feed?.total ?? 0) === 1 ? '' : 'es'}`
                        : `${posts.length} loaded`}
                    </span>
                  </div>

                  {visiblePosts.length === 0 ? (
                    <div className="bg-[#242526] rounded-lg p-8 text-center text-gray-400">
                      <LayoutList className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      <p className="text-sm">
                        {debouncedSearch
                          ? 'No posts match your search.'
                          : audience !== 'all'
                            ? 'No posts with this audience in your feed.'
                            : 'Your feed is empty. Share your first post above.'}
                      </p>
                    </div>
                  ) : (
                    visiblePosts.map((post) => (
                      <PostCard key={post.id} post={post} viewerId={viewerId} />
                    ))
                  )}

                  {posts.length < (feed?.total ?? 0) && (
                    <button
                      onClick={loadMore}
                      className="w-full py-2.5 rounded-lg bg-[#242526] text-blue-400 text-sm font-medium hover:bg-[#3a3b3c]"
                    >
                      Load more posts
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {/* Wikipedia "On this day" historical context */}
          {(tab === 'feed' || tab === 'memories') && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <TimelineWiki />
            </section>
          )}
        </div>
        </>
        )}

        <div className="px-8 pb-28">
          <CrossLensRecentsPanel lensId="timeline" sinceDays={7} limit={6} hideWhenEmpty className="mt-4" />
        </div>

        {tab !== 'roadmap' && (
          <button
            type="button"
            onClick={compose}
            title="New post (C)"
            className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
          >
            <Plus className="h-4 w-4" />
            New post
          </button>
        )}
      </div>
    </LensShell>
  );
}
