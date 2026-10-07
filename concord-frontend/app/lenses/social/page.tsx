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

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Globe2, Users, Bell, BarChart3,
  Sparkles, Activity, Loader2, Bookmark, Play, Radio,
  MessageSquare, Shield, Plus,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

import { StoriesBar } from '@/components/social/StoriesBar';
import { QuickPostComposer } from '@/components/social/QuickPostComposer';
import { Discovery } from '@/components/social/Discovery';
import { NotificationBell } from '@/components/social/NotificationBell';
import { NotificationCenter } from '@/components/social/NotificationCenter';
import { UserProfile } from '@/components/social/UserProfile';
import { SuggestedFollows } from '@/components/social/SuggestedFollows';
import { TrendingTopics } from '@/components/social/TrendingTopics';
import { TrendingDomains } from '@/components/social/TrendingDomains';
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
import { FeedView } from '@/components/social/feed/FeedView';

type TabId = 'feed' | 'discover' | 'reels' | 'spaces' | 'following' | 'notifications' | 'analytics' | 'saved' | 'moderation';

interface MeResponse {
  ok: boolean;
  user?: { id: string; username: string; displayName?: string };
}

interface FollowingActivityItem {
  id: string;
  userId: string;
  username: string;
  kind: 'dtu_minted' | 'post' | 'reaction' | 'share' | 'comment';
  content: string;
  createdAt: string;
  dtuId?: string;
}

export default function SocialHubPage() {
  useLensNav('social');
  useLensIdentity('social');
  const { isLive, lastUpdated } = useRealtimeLens('social');
  const [activeTab, setActiveTab] = useState<TabId>('feed');
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  // Phase 12 — Spaces stage modal target. RoomList sets this when the
  // user clicks Join; the modal mounts <RoomStage> which owns the
  // WebRTC mesh (mic, hand, leave).
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  const { data: me } = useQuery<MeResponse | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try { const r = await api.get<MeResponse>('/api/auth/me'); return r?.data; }
      catch { return null; }
    },
    staleTime: 60 * 1000,
  });

  const currentUserId = me?.user?.id || 'current-user';

  // Default the right-rail profile preview to the current user.
  useEffect(() => {
    if (me?.user?.id && !profileUserId) setProfileUserId(me.user.id);
  }, [me?.user?.id, profileUserId]);

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
    enabled: !!currentUserId,
  });
  const unreadCount = unreadData?.count ?? 0;

  const TABS: { id: TabId; label: string; keys: string; title: string; icon: typeof Globe2; badge?: number }[] = [
    { id: 'feed',          label: 'Feed',          keys: '1', title: "What's moving",          icon: MessageSquare },
    { id: 'discover',      label: 'For You',       keys: '2', title: 'What you might like',    icon: Sparkles },
    { id: 'reels',         label: 'Reels',         keys: '3', title: 'Watch something short', icon: Play },
    { id: 'spaces',        label: 'Spaces',        keys: '4', title: 'Who is talking live',    icon: Radio },
    { id: 'following',     label: 'Following',     keys: '5', title: 'What your people did',   icon: Users },
    { id: 'notifications', label: 'Notifications', keys: '6', title: 'What you missed',        icon: Bell, badge: unreadCount },
    { id: 'saved',         label: 'Saved',         keys: '7', title: 'What you kept',          icon: Bookmark },
    { id: 'analytics',     label: 'Analytics',     keys: '8', title: 'How your posts land',    icon: BarChart3 },
    { id: 'moderation',    label: 'Moderation',    keys: '9', title: 'What needs a look',      icon: Shield },
  ];

  const who = titleCaseDisplayName(me?.user?.username || me?.user?.displayName);
  const currentTab = TABS.find((t) => t.id === activeTab)!;

  const startPost = () => {
    setActiveTab('feed');
    requestAnimationFrame(() => {
      const box = document.querySelector<HTMLElement>('#social-main textarea, #social-main [contenteditable="true"]');
      box?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      box?.focus();
    });
  };

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `tab-${t.id}`,
        keys: t.keys,
        description: t.label,
        category: 'navigation' as const,
        action: () => setActiveTab(t.id),
      })),
      { id: 'social-post', keys: 'n', description: 'New post', category: 'actions' as const, action: startPost },
    ],
    { lensId: 'social' },
  );

  return (
    <LensShell lensId="social" asMain={false}>
      <FirstRunTour lensId="social" />
      <DepthBadge lensId="social" size="sm" className="ml-2" />

      <div data-lens-theme="social" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Social</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {currentTab.title}{activeTab === 'feed' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <StreakIndicator userId={currentUserId} />
            <DMIndicator userId={currentUserId} />
            <NotificationBell userId={currentUserId} />
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="social" data={{}} compact />
          </div>
        </div>

        <nav className="mb-5 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" role="tablist" aria-label="Social views">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActiveTab(t.id)}
                title={`${t.label} (${t.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                {!!t.badge && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white">
                    {t.badge > 99 ? '99+' : t.badge}
                  </span>
                )}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <div className="mb-5 rounded-2xl border border-white/10 bg-[#111] px-4 py-2.5">
          <StoriesBar currentUserId={currentUserId} />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
          <main id="social-main" className="min-w-0 space-y-4">
            {activeTab !== 'feed' && <QuickPostComposer currentUserId={currentUserId} />}

            {/* Tab content */}
            {activeTab === 'feed' && (
              <FeedView
                currentUserId={currentUserId}
                username={me?.user?.username || me?.user?.displayName || currentUserId}
              />
            )}

            {activeTab === 'discover' && (
              <Discovery currentUserId={currentUserId} />
            )}

            {activeTab === 'following' && (
              <FollowingTimeline currentUserId={currentUserId} />
            )}

            {activeTab === 'notifications' && (
              <NotificationCenter userId={currentUserId} mode="panel" />
            )}

            {activeTab === 'reels' && (
              <ReelsFeed />
            )}

            {activeTab === 'spaces' && (
              <RoomList
                currentUserId={me?.user?.id || null}
                onJoin={(roomId) => setActiveRoomId(roomId)}
              />
            )}

            {activeTab === 'saved' && (
              <BookmarksList currentUserId={currentUserId} />
            )}

            {activeTab === 'analytics' && (
              <CreatorAnalytics userId={currentUserId} />
            )}

            {activeTab === 'moderation' && (
              <ModerationPanel />
            )}

            {/* Cross-lens narrative — DTUs surfaced INTO social from elsewhere */}
            <CrossLensRecentsPanel lensId="social" sinceDays={14} limit={8} hideWhenEmpty />
          </main>

          {/* RIGHT RAIL */}
          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            {profileUserId && (
              <div className="rounded-2xl border border-white/10 bg-[#111] overflow-hidden">
                <UserProfile userId={profileUserId} currentUserId={currentUserId} />
              </div>
            )}
            <div className="rounded-2xl border border-white/10 bg-[#111] overflow-hidden">
              <TrendingTopics onTopicClick={() => setActiveTab('discover')} />
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#111] overflow-hidden">
              <TrendingDomains />
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#111] overflow-hidden">
              <SuggestedFollows currentUserId={currentUserId} />
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#111] overflow-hidden">
              <SocialPresenceRail />
            </div>
          </aside>
        </div>

        <button
          type="button"
          onClick={startPost}
          title="New post (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Post
        </button>
      </div>

      {/* Mobile tab bar */}
      <MobileTabBar
        tabs={[
          { id: 'feed',          label: 'Feed',     icon: MessageSquare },
          { id: 'discover',      label: 'For You',  icon: Sparkles },
          { id: 'reels',         label: 'Reels',    icon: Play },
          { id: 'spaces',        label: 'Spaces',   icon: Radio },
          { id: 'following',     label: 'Follow',   icon: Users },
          { id: 'notifications', label: 'Alerts',   icon: Bell, badgeCount: unreadCount },
        ]}
        active={activeTab}
        onSelect={(id) => setActiveTab(id as TabId)}
      />

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
function FollowingTimeline({ currentUserId }: { currentUserId: string }) {
  const { data, isLoading, error } = useQuery<{ items?: FollowingActivityItem[] } | null>({
    queryKey: ['social-following-activity', currentUserId],
    queryFn: async () => {
      try {
        const r = await api.get<{ items?: FollowingActivityItem[] }>(
          `/api/social/following-activity?userId=${encodeURIComponent(currentUserId)}&limit=40`,
        );
        return r?.data;
      } catch {
        return null;
      }
    },
    staleTime: 30 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-sm text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading following timeline…
      </div>
    );
  }

  const items = data?.items || [];

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-12 text-center">
        <Users className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
        <h3 className="text-sm font-medium text-zinc-300 mb-1">
          {error ? 'Couldn’t load your timeline' : 'No activity yet'}
        </h3>
        <p className="text-xs text-zinc-400 max-w-md mx-auto">
          {error
            ? 'We couldn’t reach your following timeline just now. Check your connection and try again in a moment.'
            : 'Follow some creators — their DTUs, posts, and reactions will surface here in reverse-chronological order.'}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map(item => (
        <li
          key={item.id}
          className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 hover:border-indigo-500/30 transition-colors"
        >
          <div className="flex items-baseline gap-2 mb-1">
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
          </div>
          <p className="text-sm text-zinc-300 leading-snug">{item.content}</p>
        </li>
      ))}
    </ul>
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
