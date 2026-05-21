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
import { useAuth } from '@/hooks/useAuth';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
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
  LayoutList, GitBranch, LayoutGrid, Clock, Bell, UserCircle, Loader2, Globe, Users, Lock,
} from 'lucide-react';
import type { FeedPost } from '@/components/timeline/types';

type Tab = 'feed' | 'timeline' | 'albums' | 'memories' | 'notifications' | 'profile';

interface FeedResult {
  posts: FeedPost[];
  total: number;
}

const TABS: { id: Tab; label: string; icon: typeof LayoutList }[] = [
  { id: 'feed', label: 'Feed', icon: LayoutList },
  { id: 'timeline', label: 'Timeline', icon: GitBranch },
  { id: 'albums', label: 'Albums', icon: LayoutGrid },
  { id: 'memories', label: 'Memories', icon: Clock },
  { id: 'notifications', label: 'Alerts', icon: Bell },
  { id: 'profile', label: 'Profile', icon: UserCircle },
];

// Map post privacy to a TimelineView tone so the axis colour-codes audience.
const PRIVACY_TONE: Record<string, TimelineEvent['tone']> = {
  public: 'info',
  friends: 'good',
  private: 'warn',
};

export default function TimelineLensPage() {
  useLensNav('timeline');
  const { user } = useAuth();
  const viewerId = user?.id || 'anon';

  const [tab, setTab] = useState<Tab>('feed');
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

  useLensCommand(
    [
      { id: 'goto-feed', keys: 'g f', description: 'Go to Feed', category: 'navigation', action: () => setTab('feed') },
      { id: 'goto-timeline', keys: 'g t', description: 'Go to Timeline', category: 'navigation', action: () => setTab('timeline') },
      { id: 'goto-albums', keys: 'g a', description: 'Go to Albums', category: 'navigation', action: () => setTab('albums') },
      { id: 'goto-memories', keys: 'g m', description: 'Go to Memories', category: 'navigation', action: () => setTab('memories') },
      { id: 'goto-alerts', keys: 'g n', description: 'Go to Notifications', category: 'navigation', action: () => setTab('notifications') },
      { id: 'load-more', keys: 'm', description: 'Load 30 more posts', category: 'actions', action: loadMore },
    ],
    { lensId: 'timeline' },
  );

  return (
    <LensShell lensId="timeline" asMain={false}>
      <FirstRunTour lensId="timeline" />
      <ManifestActionBar />
      <DepthBadge lensId="timeline" size="sm" className="ml-2" />

      <div data-lens-theme="timeline" className="min-h-full bg-[#18191a]">
        {/* Header */}
        <header className="sticky top-0 z-20 bg-[#242526] shadow-lg">
          <div className="max-w-3xl mx-auto px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📅</span>
              <span className="text-xl font-bold text-blue-500">Timeline</span>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      'relative px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors',
                      tab === t.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-[#3a3b3c]',
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {t.label}
                    {t.id === 'notifications' && (unread ?? 0) > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                        {unread}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </header>

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
                <div className="bg-[#242526] rounded-lg p-8 text-center text-sm text-gray-500">
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
                  <div className="bg-[#242526] rounded-lg p-8 text-center text-gray-500">
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
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {search ? `${visiblePosts.length} match` : `${posts.length} loaded`}
                    </span>
                  </div>

                  {visiblePosts.length === 0 ? (
                    <div className="bg-[#242526] rounded-lg p-8 text-center text-gray-500">
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

          <RecentMineCard domain="timeline" limit={10} hideWhenEmpty />
          <AutoActionStrip domain="timeline" hideWhenEmpty />
          <CrossLensRecentsPanel lensId="timeline" sinceDays={7} limit={6} hideWhenEmpty />
        </div>
      </div>
    </LensShell>
  );
}
