'use client';

/**
 * Social Hub — the pan-social dashboard.
 *
 * Phase 10: brings Concord's existing 18-component social library
 * (StoriesBar, Discovery, NotificationCenter, UserProfile,
 * SuggestedFollows, TrendingTopics, TrendingDomains, PresenceIndicator,
 * DMIndicator, StreakIndicator, CreatorAnalytics, etc. — 5706 LOC)
 * together into one Twitter/Instagram/Facebook-style hub.  Previously
 * scattered across /lenses/feed only.
 *
 * IA:
 *   ┌───────────────────────────┬────────────────┐
 *   │  TopBar: streak · dm · 🔔 │                │
 *   ├───────────────────────────┤   RIGHT RAIL:  │
 *   │  Stories bar (24h)        │   - Profile    │
 *   ├───────────────────────────┤   - Trending   │
 *   │  Tabs:                    │   - Suggested  │
 *   │   • For You (Discovery)   │   - Presence   │
 *   │   • Following (timeline)  │                │
 *   │   • Notifications         │                │
 *   │   • Analytics             │                │
 *   │                           │                │
 *   │  [content per tab]        │                │
 *   └───────────────────────────┴────────────────┘
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useReducedMotion } from 'framer-motion';
import {
  Activity, Loader2, Plus, Home, Compass, Inbox, User,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ErrorState } from '@/components/ui/ErrorState';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useCurrentUser } from '@/hooks/use-current-user';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

import { StoriesBar } from '@/components/social/StoriesBar';
import { QuickPostComposer } from '@/components/social/QuickPostComposer';
import { OwnPostDelete } from '@/components/social/OwnPostDelete';
import { invalidatePostSurfaces } from '@/components/social/invalidate-post-surfaces';
import { Discovery } from '@/components/social/Discovery';
import { NotificationBell } from '@/components/social/NotificationBell';
import { NotificationCenter } from '@/components/social/NotificationCenter';
import { UserProfile } from '@/components/social/UserProfile';
import { SuggestedFollows } from '@/components/social/SuggestedFollows';
import { TrendingTopics } from '@/components/social/TrendingTopics';
import { FindPeople } from '@/components/social/FindPeople';
import { SocialPreferencesForm } from '@/components/social/SocialPreferencesForm';
import { PushEnableButton } from '@/components/social/PushEnableButton';
import { PresenceIndicator } from '@/components/social/PresenceIndicator';
import { DMIndicator } from '@/components/social/DMIndicator';
import { StreakIndicator } from '@/components/social/StreakIndicator';
import { CreatorAnalytics } from '@/components/social/CreatorAnalytics';
import { UserLink } from '@/components/social/UserLink';
import { BookmarksList } from '@/components/social/BookmarksList';
import { ModerationPanel } from '@/components/social/ModerationPanel';
import { ReelsFeed } from '@/components/reels/ReelsFeed';
import { RoomList } from '@/components/audio-rooms/RoomList';
import RoomStage from '@/components/audio-rooms/RoomStage';
import { DMInbox } from '@/components/social/feed/DMInbox';
import { RankedFeed } from '@/components/social/RankedFeed';
import { SocialLists } from '@/components/social/SocialLists';
import { SocialGroups } from '@/components/social/SocialGroups';
import { AdminModerationQueue } from '@/components/social/AdminModerationQueue';
import { PeopleToFollow } from '@/components/social/PeopleToFollow';
import { WelcomeChecklist } from '@/components/social/WelcomeChecklist';
import { PostMediaCard } from '@/components/social/PostMediaCard';
import { PublicFallbackFeed } from '@/components/social/PublicFallbackFeed';

import { parseSocialPlace, type SocialPlaceId } from '@/lib/social-places';
import { useOpenPostInPlace } from '@/hooks/use-open-post-in-place';
import { PostDetailInPlace, socialPostViewTransitionName } from '@/components/social/PostDetailInPlace';

type PlaceId = SocialPlaceId;
type HomeFeed = 'following' | 'forYou';
type InboxTab = 'messages' | 'notifications';
type YouTab = 'posts' | 'saved' | 'analytics' | 'muted';

interface FollowingActivityItem {
  id: string;
  userId: string;
  username: string;
  kind: 'dtu_minted' | 'post' | 'reaction' | 'share' | 'comment';
  content: string;
  createdAt: string;
  dtuId?: string;
  mediaType?: string;
  mediaUrl?: string | null;
  sensitiveHidden?: boolean;
  listing?: {
    id: string;
    title?: string | null;
    price?: number;
    priceCents?: number;
    currency?: string;
    transferRate?: number;
    marketplaceRate?: number;
  } | null;
}

export default function SocialHubPage() {
  useLensNav('social');
  useLensIdentity('social');
  const { isLive, lastUpdated } = useRealtimeLens('social');
  const router = useRouter();
  const pathname = usePathname() || '/lenses/social';
  const searchParams = useSearchParams();
  const view = parseSocialPlace(searchParams?.get('view') ?? null);
  const setView = useCallback((next: PlaceId) => {
    const sp = new URLSearchParams(searchParams?.toString() || '');
    if (next === 'home') sp.delete('view');
    else sp.set('view', next);
    // A place switch replaces the URL, which closes any open in-place
    // post (useOpenPostInPlace syncs with the router's searchParams).
    sp.delete('post');
    const q = sp.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);
  // JOB 7: posts open in place. The `post` URL param is the shareable
  // shallow-routed state; a reload at ?post=<id> re-opens the post here.
  const { openPostId, openPost, closePost } = useOpenPostInPlace();
  const [homeFeed, setHomeFeed] = useState<HomeFeed>('following');
  const [inboxTab, setInboxTab] = useState<InboxTab>('notifications');
  const [youTab, setYouTab] = useState<YouTab>('posts');
  // Live audio Room stage. RoomList sets this when the user clicks Join.
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [storyRequest, setStoryRequest] = useState(0);
  // Create-tap focus request. A counter (not a boolean) so tapping Create
  // again always re-requests, and so the focus can run AFTER the Home
  // view commits — the old requestAnimationFrame inside startPost raced
  // React's commit when coming from Explore/Inbox/You, so the DOM query
  // found no composer and the tap did nothing visible.
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const handledFocusRequest = useRef(0);
  const reduceMotion = useReducedMotion();

  // Shared session query (hooks/use-current-user): one ['me'] declaration
  // for every Social surface — a failed fetch keeps the previous data and
  // self-heals instead of caching "anonymous" and blanking the composer.
  const { data: me } = useCurrentUser();

  const currentUserId = me?.user?.id || '';
  const railUserId = me?.user?.id || null;
  // The moderation queue route is admin-only server-side
  // (requireRole("admin", "sovereign") in routes/moderation.js — the gate
  // also passes role 'sovereign' and any scopes containing '*'). Mirror
  // exactly that check on the client so members never see the 403
  // "could not load" message, and admins/owners still see the queue.
  const role = me?.user?.role;
  const scopes = me?.user?.scopes;
  const isAdminViewer = role === 'admin' || role === 'sovereign' || (Array.isArray(scopes) && scopes.includes('*'));

  useEffect(() => {
    const open = () => {
      setInboxTab('notifications');
      setView('inbox');
    };
    window.addEventListener('notifications:open-all', open);
    return () => window.removeEventListener('notifications:open-all', open);
  }, [setView]);

  useEffect(() => {
    const id = me?.user?.id;
    if (!id) return;
    let cancel = false;
    (async () => {
      try {
        const existing = await api.get(`/api/social/profile/${encodeURIComponent(id)}`);
        if (existing?.data?.ok && existing.data.profile) {
          if (existing.data.profile.feedDefault === 'forYou') setHomeFeed('forYou');
          return;
        }
      } catch { /* no profile yet */ }
      if (cancel) return;
      try {
        await api.post('/api/social/profile', {
          displayName: me?.user?.displayName || me?.user?.username || id,
          isPublic: true,
        });
      } catch { /* the edit dialog reports a failed save */ }
    })();
    return () => { cancel = true; };
  }, [me?.user?.id, me?.user?.displayName, me?.user?.username]);

  // Shared unread-notification count — same query key `NotificationBell`
  // uses internally, so both the topbar bell's badge and the Notifications
  // tab's badge below read one cached number instead of drifting out of
  // sync. Real count from /api/social/notifications/count (with the same
  // full-list-count fallback NotificationBell uses), invalidated on the
  // real `queue:notifications:new` socket event — never a fabricated value.
  const { data: unreadData } = useQuery({
    queryKey: ['notification-count', currentUserId],
    queryFn: async () => {
      try {
        const res = await api.get<{ count: number }>('/api/social/notifications/count', { params: { userId: currentUserId } });
        return res.data;
      } catch {
        try {
          const res = await api.get<{ notifications?: unknown[] }>('/api/social/notifications', { params: { userId: currentUserId, limit: 50, unreadOnly: true } });
          return { count: (res.data?.notifications || []).length };
        } catch { return { count: 0 }; }
      }
    },
    refetchInterval: 30_000,
    enabled: Boolean(currentUserId),
  });
  const unreadCount = unreadData?.count ?? 0;

  const PLACES: { id: PlaceId | 'create'; label: string; keys: string; icon: typeof Home; badge?: number }[] = [
    { id: 'home', label: 'Home', keys: '1', icon: Home },
    { id: 'explore', label: 'Explore', keys: '2', icon: Compass },
    { id: 'create', label: 'Create', keys: 'n', icon: Plus },
    { id: 'inbox', label: 'Inbox', keys: '3', icon: Inbox, badge: unreadCount },
    { id: 'you', label: 'You', keys: '4', icon: User },
  ];

  const startPost = useCallback(() => {
    setView('home');
    setComposerFocusRequest((n) => n + 1);
  }, [setView]);

  // Focus the Home composer after a Create tap, once the request and the
  // Home view have both committed. The composer's form gets a visible
  // focus-within ring, so this is something you SEE, not a silent focus.
  // currentUserId is a dependency so a tap that lands while the session
  // query is still loading focuses as soon as the composer mounts.
  useEffect(() => {
    if (composerFocusRequest === 0 || composerFocusRequest === handledFocusRequest.current) return;
    if (view !== 'home') return; // request stays pending; Home commits soon
    const box = document.querySelector<HTMLElement>('#social-quick-post textarea');
    if (!box) return; // not mounted yet (session still loading) — stays pending
    handledFocusRequest.current = composerFocusRequest;
    if (typeof box.scrollIntoView === 'function') {
      box.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    }
    box.focus();
  }, [composerFocusRequest, view, reduceMotion, currentUserId]);

  const onPlace = (id: PlaceId | 'create') => {
    if (id === 'create') {
      startPost();
      return;
    }
    setView(id);
  };

  // One 'n' binding: place-create. The old second "social-post" entry
  // bound the same key again (PR #1451 nit).
  useLensCommand(
    PLACES.map((t) => ({
      id: `place-${t.id}`,
      keys: t.keys,
      description: t.label,
      category: 'navigation' as const,
      action: () => onPlace(t.id),
    })),
    { lensId: 'social' },
  );

  const subTabClass = (on: boolean) => cn(
    'inline-flex min-h-[44px] items-center rounded-full px-4 text-[14px] transition-colors',
    on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
  );

  return (
    <LensShell lensId="social" asMain={false}>
      <DepthBadge lensId="social" size="sm" className="ml-2" />

      <div data-lens-theme="social" className="relative min-h-full px-4 overflow-x-clip lg:px-8 pb-28 pt-6">
        <div className="mx-auto flex max-w-[1120px] gap-5">
          <nav className="hidden lg:flex w-44 shrink-0 flex-col gap-1 sticky top-6 self-start" aria-label="Social places">
            {PLACES.map((t) => {
              const Icon = t.icon;
              const on = t.id === 'create' ? false : view === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onPlace(t.id)}
                  aria-label={t.label}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-[44px] items-center gap-3 rounded-full px-3 text-[15px] transition-colors',
                    t.id === 'create'
                      ? 'border border-teal-400/40 font-medium text-teal-300 hover:bg-teal-400/10'
                      : on ? 'bg-white/10 text-zinc-50' : 'text-zinc-400 hover:text-zinc-100',
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {t.label}
                  {!!t.badge && t.id !== 'create' && (
                    <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                      {t.badge > 99 ? '99+' : t.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0 flex-1">
            {/* Phone nav for the five places. The old fixed-bottom bar sat
                under the global bottom bar (both fixed bottom-0) — Explore/
                Create/Inbox/You were unreachable on phones. This top bar
                reuses the desktop nav's PLACES + onPlace, so it reads and
                writes the same ?view= URL state. */}
            <nav
              data-testid="social-mobile-places"
              aria-label="Social places"
              className="mb-3 grid grid-cols-5 gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-1 lg:hidden"
            >
              {PLACES.map((t) => {
                const Icon = t.icon;
                const on = t.id === 'create' ? false : view === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onPlace(t.id)}
                    aria-label={t.label}
                    aria-current={on ? 'page' : undefined}
                    className={cn(
                      'relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] transition-colors',
                      t.id === 'create'
                        ? 'border border-teal-400/40 font-medium text-teal-300'
                        : on ? 'bg-white/10 text-zinc-50' : 'text-zinc-400 hover:text-zinc-100',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {t.label}
                    {!!t.badge && t.id !== 'create' && (
                      <span className="absolute right-2 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                        {t.badge > 99 ? '99+' : t.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <h1 className="mb-3 mt-1 font-vault text-3xl leading-tight text-zinc-100 sm:mb-5 sm:text-5xl">Social</h1>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 pt-2 sm:gap-3">
                <PushEnableButton />
                {currentUserId ? <StreakIndicator userId={currentUserId} /> : null}
                {currentUserId ? <DMIndicator userId={currentUserId} /> : null}
                {currentUserId ? (
                  <NotificationBell
                    userId={currentUserId}
                    onViewAll={() => { setInboxTab('notifications'); setView('inbox'); }}
                  />
                ) : null}
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,640px)_320px]">
              <main id="social-main" className="min-w-0 max-w-[640px] space-y-4">
                {/* JOB 7: the tapped post's detail view, opened IN PLACE.
                    The feed below stays mounted but hidden — Back/Escape/
                    close returns to the exact scroll position without a
                    refetch or reset (react-query cache + list state are
                    untouched by the round trip). */}
                {openPostId ? (
                  <PostDetailInPlace
                    postId={openPostId}
                    username={me?.user?.username || me?.user?.displayName || currentUserId || 'current-user'}
                    currentUserId={currentUserId || undefined}
                    onClose={closePost}
                    onOpenPost={openPost}
                    onOpenHashtag={(tag) => router.push(`/lenses/social?tag=${encodeURIComponent(tag)}`)}
                    onQuote={closePost}
                  />
                ) : null}
                <div hidden={openPostId ? true : undefined} className="space-y-4">
                {view === 'home' && (
                  <>
                    <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1" role="tablist" aria-label="Home feed">
                      <button type="button" role="tab" aria-selected={homeFeed === 'following'} className={subTabClass(homeFeed === 'following')} onClick={() => setHomeFeed('following')}>Following</button>
                      <button type="button" role="tab" aria-selected={homeFeed === 'forYou'} className={subTabClass(homeFeed === 'forYou')} onClick={() => setHomeFeed('forYou')}>For You</button>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-[#111] px-4 py-2.5">
                      <StoriesBar
                        currentUserId={currentUserId || 'anon'}
                        onCreateStory={() => {
                          setStoryRequest((n) => n + 1);
                          startPost();
                        }}
                      />
                    </div>
                    <p className="text-sm text-zinc-500">Share something you made...</p>
                    {currentUserId ? (
                      <QuickPostComposer
                        currentUserId={currentUserId}
                        username={me?.user?.username || me?.user?.displayName || null}
                        storyRequest={storyRequest}
                      />
                    ) : null}
                    {currentUserId ? (
                      <WelcomeChecklist
                        currentUserId={currentUserId}
                        fallbackDisplayName={me?.user?.username || me?.user?.displayName || null}
                        onStartPost={startPost}
                      />
                    ) : null}
                    {currentUserId ? (
                      <PeopleToFollow
                        currentUserId={currentUserId}
                        onOpenProfile={(userId) => router.push(`/lenses/social/u/${encodeURIComponent(userId)}`)}
                      />
                    ) : null}
                    {homeFeed === 'following' ? (
                      <FollowingTimeline
                        currentUserId={currentUserId}
                        onFindPeople={() => setView('explore')}
                        onOpenPost={openPost}
                      />
                    ) : (
                      currentUserId ? <RankedFeed currentUserId={currentUserId} onOpenPost={openPost} /> : null
                    )}
                  </>
                )}

                {view === 'explore' && (
                  <>
                    {currentUserId ? <FindPeople /> : null}
                    <Discovery currentUserId={currentUserId || ''} onOpenPost={openPost} />
                    <SocialLists />
                    <SocialGroups currentUserId={currentUserId} />
                    <div className="rounded-2xl border border-white/10 bg-[#111] p-3">
                      <h2 className="mb-2 font-vault text-lg text-zinc-100">Clips</h2>
                      <ReelsFeed />
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-[#111] p-3">
                      <h2 className="mb-2 font-vault text-lg text-zinc-100">Rooms</h2>
                      <RoomList
                        currentUserId={me?.user?.id || null}
                        onJoin={(roomId) => setActiveRoomId(roomId)}
                      />
                    </div>
                  </>
                )}

                {view === 'inbox' && (
                  <>
                    <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1" role="tablist" aria-label="Inbox">
                      <button type="button" role="tab" aria-selected={inboxTab === 'messages'} className={subTabClass(inboxTab === 'messages')} onClick={() => setInboxTab('messages')}>Messages</button>
                      <button type="button" role="tab" aria-selected={inboxTab === 'notifications'} className={subTabClass(inboxTab === 'notifications')} onClick={() => setInboxTab('notifications')}>
                        Notifications
                        {unreadCount > 0 ? (
                          <span className="ml-2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>
                        ) : null}
                      </button>
                    </div>
                    {inboxTab === 'messages' && currentUserId ? (
                      <DMInbox currentUserId={currentUserId} />
                    ) : null}
                    {inboxTab === 'notifications' && currentUserId ? (
                      <NotificationCenter userId={currentUserId} mode="panel" onViewAll={() => setInboxTab('notifications')} />
                    ) : null}
                  </>
                )}

                {view === 'you' && (
                  <>
                    <div className="inline-flex flex-wrap rounded-full border border-white/10 bg-white/[0.03] p-1" role="tablist" aria-label="You">
                      {([
                        ['posts', 'Posts'],
                        ['saved', 'Saved'],
                        ['analytics', 'Analytics'],
                        ['muted', 'Muted & blocked'],
                      ] as const).map(([id, label]) => (
                        <button key={id} type="button" role="tab" aria-selected={youTab === id} className={subTabClass(youTab === id)} onClick={() => setYouTab(id)}>{label}</button>
                      ))}
                    </div>
                    {youTab === 'posts' && railUserId ? (
                      <>
                        <UserProfile userId={railUserId} currentUserId={currentUserId} onOpenPost={openPost} />
                        <SocialPresenceRail />
                      </>
                    ) : null}
                    {youTab === 'saved' && currentUserId ? <BookmarksList currentUserId={currentUserId} /> : null}
                    {youTab === 'analytics' && currentUserId ? <CreatorAnalytics userId={currentUserId} /> : null}
                    {youTab === 'muted' ? (
                      <>
                        {isAdminViewer ? <AdminModerationQueue /> : null}
                        <ModerationPanel />
                        <SocialPreferencesForm />
                      </>
                    ) : null}
                  </>
                )}
                </div>
              </main>

              <aside className="hidden lg:block space-y-4 lg:sticky lg:top-6 lg:self-start">
                <div className="rounded-2xl border border-white/10 bg-[#111] p-3">
                  <h2 className="mb-2 text-sm font-medium text-zinc-200">Live Rooms now</h2>
                  <RoomList
                    currentUserId={me?.user?.id || null}
                    onJoin={(roomId) => setActiveRoomId(roomId)}
                  />
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#111] overflow-hidden">
                  <h2 className="px-3 pt-3 text-sm font-medium text-zinc-200">Who to follow</h2>
                  <SuggestedFollows currentUserId={currentUserId} />
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#111] overflow-hidden">
                  <TrendingTopics onTopicClick={() => setView('explore')} />
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#111] overflow-hidden">
                  <h2 className="px-3 pt-3 text-sm font-medium text-zinc-200">Follow packs</h2>
                  <SocialLists />
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>

      {/* Spaces — WebRTC room stage modal */}
      {activeRoomId && me?.user?.id && (
        <RoomStage
          roomId={activeRoomId}
          selfUserId={me.user.id}
          onClose={() => setActiveRoomId(null)}
        />
      )}
    </LensShell>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * FollowingTimeline — reverse-chronological feed of activity from
 * accounts the user follows.  Pulls from /api/social/following-activity
 * (no fake data — empty state when the user follows nobody yet).
 * ───────────────────────────────────────────────────────────────────── */
function FollowingTimeline({ currentUserId, onFindPeople, onOpenPost }: { currentUserId: string; onFindPeople?: () => void; onOpenPost?: (postId: string) => void }) {
  const queryClient = useQueryClient();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [seenHead, setSeenHead] = useState<string | null>(() => {
    if (typeof window === 'undefined' || !currentUserId || currentUserId === 'current-user') return null;
    try { return localStorage.getItem(`social-following-cursor:${currentUserId}`); } catch { return null; }
  });
  useEffect(() => {
    if (!seenHead || !currentUserId || currentUserId === 'current-user') return;
    try { localStorage.setItem(`social-following-cursor:${currentUserId}`, seenHead); } catch { /* private mode */ }
  }, [seenHead, currentUserId]);
  const { data, isLoading, error } = useQuery<{ items?: FollowingActivityItem[] } | null>({
    queryKey: ['social-following-activity', currentUserId],
    queryFn: async () => {
      const r = await api.get<{ posts?: FollowingActivityItem[]; error?: string }>(
        `/api/social/feed/following?limit=40`,
      );
      if (r?.data && (r.data as { ok?: boolean }).ok === false) {
        throw new Error(r.data.error || 'Couldn’t load your timeline');
      }
      const posts = r?.data?.posts || [];
      return { items: posts.map((post) => ({ ...post, kind: 'post', content: post.content || '' })) };
    },
    staleTime: 30 * 1000,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-sm text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading following timeline…
      </div>
    );
  }

  const items = data?.items || [];
  const headId = items[0]?.id || null;
  if (headId && seenHead === null) setSeenHead(headId);
  // The cursor is the newest post the viewer had already seen; anything
  // above it is "new". The viewer's OWN posts are never buffered behind
  // the "Show N new posts" button (oc-social-3afix item 5): your
  // just-published post appears at the top of Home immediately, and the
  // button counts only OTHER people's posts.
  let newer = 0;
  let cursorIndex = items.length;
  if (seenHead) {
    const found = items.findIndex((item) => item.id === seenHead);
    cursorIndex = found === -1 ? items.length : found;
    for (let i = 0; i < cursorIndex; i++) {
      if (items[i].userId !== currentUserId) newer += 1;
    }
  }
  const visible = items
    .filter((item, idx) => idx >= cursorIndex || item.userId === currentUserId)
    .filter((item) => !removed.has(item.id));

  if (error) {
    return (
      <ErrorState
        title="Couldn’t load your timeline"
        message={error instanceof Error ? error.message : 'We couldn’t reach your following timeline just now.'}
      />
    );
  }

  if (items.length === 0) {
    // Never an empty first screen (oc-social-3b item a): with nothing to
    // show from the people the viewer follows, Home fills with real recent
    // PUBLIC posts from across the site (privacy held by the server-side
    // explore route) plus a clear "Follow people to fill this feed" prompt.
    return (
      <PublicFallbackFeed
        currentUserId={currentUserId}
        onFindPeople={() => onFindPeople?.()}
      />
    );
  }

  return (
    <div className="space-y-2">
      {newer > 0 && (
        <button
          type="button"
          onClick={() => setSeenHead(headId)}
          className="w-full rounded-lg border border-teal-400/40 bg-teal-400/10 px-3 py-2 text-sm text-teal-200"
        >
          Show {newer} new {newer === 1 ? 'post' : 'posts'}
        </button>
      )}
    <ul className="social-reveal-items space-y-2">
      {visible.map(item => (
        <li
          key={item.id}
          className="relative rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 hover:border-indigo-500/30 transition-colors"
          style={{ viewTransitionName: socialPostViewTransitionName(item.id) }}
        >
          {onOpenPost && (
            <button
              type="button"
              className="absolute inset-0 rounded-lg"
              aria-label={`Open post${item.content ? ` — ${item.content.slice(0, 80)}` : ''}`}
              onClick={() => onOpenPost(item.id)}
            />
          )}
          <div className="relative flex items-baseline gap-2 mb-1">
            <UserLink
              username={item.username}
              userId={item.userId}
              className="text-sm"
              showFollow
              currentUserId={currentUserId}
            />
            <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
              {item.kind}
            </span>
            <span className="text-[10px] text-zinc-400 ml-auto">
              {new Date(item.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
            </span>
            {item.kind === 'post' && item.userId === currentUserId && (
              <OwnPostDelete
                postId={item.id}
                onDeleted={() => {
                  setRemoved((prev) => new Set(prev).add(item.id));
                  // The row is gone here; reconcile every other surface —
                  // You > Posts, the profile post count, For You — with the
                  // server, so no place keeps the deleted post.
                  void invalidatePostSurfaces(queryClient);
                }}
              />
            )}
          </div>
          <p className="text-sm text-zinc-300 leading-snug">{item.content}</p>
          {item.sensitiveHidden && <p className="mt-1 text-xs text-zinc-500">Sensitive media hidden</p>}
          {/* Attached Studio track or Marketplace item → real media card
              (play button, never autoplay) instead of a bare text line.
              `relative` keeps its controls above the open-post overlay. */}
          <PostMediaCard className="relative" mediaType={item.mediaType} mediaUrl={item.mediaUrl} listing={item.listing} />
        </li>
      ))}
    </ul>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * SocialPresenceRail — wraps PresenceIndicator with the live
 * /api/presence/active feed.  Empty state when no one's online.
 * ───────────────────────────────────────────────────────────────────── */
function SocialPresenceRail() {
  const { data } = useQuery<{ users?: Array<{ userId: string; displayName: string; status: 'active' | 'idle' }> } | null>({
    queryKey: ['social-presence'],
    queryFn: async () => {
      try {
        const r = await api.get<{ users?: Array<{ userId: string; displayName: string; status: 'active' | 'idle' }> }>(
          '/api/presence/active?lens=social&windowMs=300000&limit=12',
        );
        return r?.data;
      } catch { return null; }
    },
    refetchInterval: 30_000,
  });
  const presenceUsers = data?.users || [];
  const PALETTE = ['#06b6d4', '#8b5cf6', '#22c55e', '#f59e0b', '#ec4899'];
  return (
    <div className="p-3">
      <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-wider text-zinc-400 font-mono">
        <Activity className="w-3 h-3 text-emerald-400" />
        Online now ({presenceUsers.length})
      </div>
      {presenceUsers.length === 0 ? (
        <div className="text-xs text-zinc-400 italic">No one in the social lens right now.</div>
      ) : (
        <PresenceIndicator
          users={presenceUsers.map((u, i) => ({
            id: u.userId,
            name: u.displayName || 'Citizen',
            color: PALETTE[i % PALETTE.length],
            status: u.status || 'active',
            location: 'social',
          }))}
          maxVisible={8}
        />
      )}
    </div>
  );
}