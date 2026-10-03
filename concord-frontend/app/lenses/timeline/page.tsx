'use client';

// Timeline lens — a Facebook-style personal activity feed built on the
// `timeline` domain macros (server/domains/timeline.js). Posts, reactions
// + breakdown, nested comments, share/repost, media albums, per-post
// privacy, profile, "On this day" memories and notifications are all wired
// to real macros; nothing here is placeholder data.

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
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
import { apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  CalendarRange, LayoutList, GitBranch, LayoutGrid, Clock, Bell, UserCircle, Loader2, Globe, Users, Lock, Plus,
} from 'lucide-react';
import type { FeedPost } from '@/components/timeline/types';

type Tab = 'roadmap' | 'feed' | 'timeline' | 'albums' | 'memories' | 'notifications' | 'profile';

interface FeedResult {
  posts: FeedPost[];
  total: number;
}

const TABS: { id: Tab; label: string; keys: string; title: string; hint: string; icon: typeof LayoutList }[] = [
  { id: 'roadmap', label: 'Roadmap', keys: 'g r', title: 'When it lands', hint: 'Milestones and goals on a week ruler', icon: CalendarRange },
  { id: 'feed', label: 'Feed', keys: 'g f', title: 'What you have shared', hint: 'Your posts, reactions and comments', icon: LayoutList },
  { id: 'timeline', label: 'Post history', keys: 'g t', title: 'Your posts over time', hint: 'Every post on an axis, colored by audience', icon: GitBranch },
  { id: 'albums', label: 'Albums', keys: 'g a', title: 'Your albums', hint: 'Media albums', icon: LayoutGrid },
  { id: 'memories', label: 'Memories', keys: 'g m', title: 'On this day', hint: 'What you posted on this day before', icon: Clock },
  { id: 'notifications', label: 'Alerts', keys: 'g n', title: 'What you missed', hint: 'Reactions, comments and mentions', icon: Bell },
  { id: 'profile', label: 'Profile', keys: 'g p', title: 'Your profile', hint: 'Your profile and stats', icon: UserCircle },
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
  const who = titleCaseDisplayName(user?.username);
  const viewerId = user?.id || 'anon';

  const [tab, setTab] = useState<Tab>('roadmap');
  const [limit, setLimit] = useState(30);
  const [search, setSearch] = useState('');

  // Friends list — used to make the privacy-aware feed-list macro show
  // friends-only posts from people the viewer follows.
  const { data: friendIds } = useQuery({
    queryKey: ['timeline-friend-ids'],
    queryFn: async () => {
      try {
        const res = await apiHelpers.personas.list();
        const personas = res.data?.personas || [];
        return personas
          .map((p: Record<string, unknown>) => String(p.id || ''))
          .filter(Boolean) as string[];
      } catch {
        return [] as string[];
      }
    },
    enabled: tab !== 'roadmap',
  });

  // The personal feed — privacy-aware, real macro.
  const {
    data: feed,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['timeline-feed', limit, friendIds],
    queryFn: async () => {
      const r = await lensRun<FeedResult>('timeline', 'feed-list', {
        limit,
        offset: 0,
        friendIds: friendIds ?? [],
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

  const visiblePosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return posts;
    return posts.filter(
      (p) =>
        p.content.toLowerCase().includes(q) ||
        p.authorId.toLowerCase().includes(q),
    );
  }, [posts, search]);

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

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <LensShell lensId="timeline" asMain={false}>
      <FirstRunTour lensId="timeline" />
      <DepthBadge lensId="timeline" size="sm" className="ml-2" />
      <div data-lens-theme="timeline" className="relative min-h-full">
        <div className="px-8 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[14px] text-zinc-500">Timeline</p>
              <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
                {current.title}{tab === 'roadmap' && who ? `, ${who}` : ''}
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-3 pt-2">
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
              <DTUExportButton domain="timeline" data={{}} compact />
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
                  <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.keys}</kbd>
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

              {/* Privacy legend */}
              <div className="bg-[#242526] rounded-lg px-4 py-2 flex items-center gap-4 text-xs text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5 text-blue-500" /> Public
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-green-500" /> Friends
                </span>
                <span className="inline-flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5 text-purple-500" /> Only me
                </span>
                <span className="ml-auto">{feed?.total ?? 0} posts</span>
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
                      {search ? `${visiblePosts.length} match` : `${posts.length} loaded`}
                    </span>
                  </div>

                  {visiblePosts.length === 0 ? (
                    <div className="bg-[#242526] rounded-lg p-8 text-center text-gray-400">
                      <LayoutList className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      <p className="text-sm">
                        {search ? 'No posts match your search.' : 'Your feed is empty. Share your first post above.'}
                      </p>
                    </div>
                  ) : (
                    visiblePosts.map((post) => (
                      <PostCard key={post.id} post={post} viewerId={viewerId} />
                    ))
                  )}

                  {!search && posts.length < (feed?.total ?? 0) && (
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
