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
  Globe2, Users, Bell, TrendingUp, BarChart3,
  Sparkles, Hash, Activity, Loader2,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

import { StoriesBar } from '@/components/social/StoriesBar';
import { Discovery } from '@/components/social/Discovery';
import { NotificationCenter } from '@/components/social/NotificationCenter';
import { UserProfile } from '@/components/social/UserProfile';
import { SuggestedFollows } from '@/components/social/SuggestedFollows';
import { TrendingTopics } from '@/components/social/TrendingTopics';
import { TrendingDomains } from '@/components/social/TrendingDomains';
import { PresenceIndicator } from '@/components/social/PresenceIndicator';
import { DMIndicator } from '@/components/social/DMIndicator';
import { StreakIndicator } from '@/components/social/StreakIndicator';
import { CreatorAnalytics } from '@/components/social/CreatorAnalytics';

type TabId = 'discover' | 'following' | 'notifications' | 'analytics';

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
  const [activeTab, setActiveTab] = useState<TabId>('discover');
  const [profileUserId, setProfileUserId] = useState<string | null>(null);

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

  const TABS: { id: TabId; label: string; icon: typeof Globe2; badge?: number }[] = [
    { id: 'discover',      label: 'For You',       icon: Sparkles },
    { id: 'following',     label: 'Following',     icon: Users },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'analytics',     label: 'Analytics',     icon: BarChart3 },
  ];

  return (
    <LensShell lensId="social" asMain={false}>
      <FirstRunTour lensId="social" />
      <ManifestActionBar />
      <DepthBadge lensId="social" size="sm" className="ml-2" />

      <div className="min-h-screen bg-lattice-void text-zinc-100">
        {/* ── Topbar: streak + DM + notification bell ───────────────── */}
        <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/60">
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Globe2 className="w-5 h-5 text-indigo-300" />
              <h1 className="text-base font-semibold">Social</h1>
              <span className="text-[10px] text-zinc-500 font-mono">pan-social hub</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <StreakIndicator userId={currentUserId} />
              <DMIndicator userId={currentUserId} />
              <button
                type="button"
                onClick={() => setActiveTab('notifications')}
                className={cn(
                  'relative p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/60',
                  activeTab === 'notifications' && 'text-indigo-300 bg-indigo-500/10',
                )}
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
              </button>
            </div>
          </div>
          {/* Stories strip — 24h ephemeral activity from people you follow */}
          <div className="max-w-7xl mx-auto px-4 pb-2">
            <StoriesBar currentUserId={currentUserId} />
          </div>
        </header>

        {/* ── Main column + right rail ─────────────────────────────── */}
        <div className="max-w-7xl mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">

          {/* MAIN COLUMN */}
          <main className="min-w-0 space-y-4">
            {/* Tab nav */}
            <nav className="flex items-center gap-1 border-b border-zinc-800 overflow-x-auto" role="tablist">
              {TABS.map(t => {
                const Icon = t.icon;
                const isActive = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(t.id)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                      isActive
                        ? 'border-indigo-400 text-indigo-200'
                        : 'border-transparent text-zinc-400 hover:text-zinc-200',
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {t.label}
                  </button>
                );
              })}
            </nav>

            {/* Tab content */}
            {activeTab === 'discover' && (
              <Discovery currentUserId={currentUserId} />
            )}

            {activeTab === 'following' && (
              <FollowingTimeline currentUserId={currentUserId} />
            )}

            {activeTab === 'notifications' && (
              <NotificationCenter userId={currentUserId} mode="panel" />
            )}

            {activeTab === 'analytics' && (
              <CreatorAnalytics userId={currentUserId} />
            )}

            {/* Cross-lens narrative — DTUs surfaced INTO social from elsewhere */}
            <CrossLensRecentsPanel lensId="social" sinceDays={14} limit={8} hideWhenEmpty />
          </main>

          {/* RIGHT RAIL */}
          <aside className="space-y-4 lg:sticky lg:top-32 lg:self-start">
            {profileUserId && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 overflow-hidden">
                <UserProfile userId={profileUserId} currentUserId={currentUserId} />
              </div>
            )}
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 overflow-hidden">
              <TrendingTopics onTopicClick={() => setActiveTab('discover')} />
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 overflow-hidden">
              <TrendingDomains />
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 overflow-hidden">
              <SuggestedFollows currentUserId={currentUserId} />
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 overflow-hidden">
              <SocialPresenceRail />
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile tab bar */}
      <MobileTabBar
        tabs={[
          { id: 'discover',      label: 'For You',  icon: Sparkles },
          { id: 'following',     label: 'Follow',   icon: Users },
          { id: 'notifications', label: 'Alerts',   icon: Bell },
          { id: 'analytics',     label: 'Stats',    icon: BarChart3 },
        ]}
        active={activeTab}
        onSelect={(id) => setActiveTab(id as TabId)}
      />
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
      <div className="flex items-center gap-2 px-4 py-8 text-sm text-zinc-500">
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
          {error ? 'Following timeline unavailable' : 'No activity yet'}
        </h3>
        <p className="text-xs text-zinc-500 max-w-md mx-auto">
          {error
            ? 'The /api/social/following-activity endpoint is not reachable.'
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
            <span className="text-sm font-medium text-zinc-100">{item.username}</span>
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              {item.kind}
            </span>
            <span className="text-[10px] text-zinc-500 ml-auto">
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
      <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-wider text-zinc-500 font-mono">
        <Activity className="w-3 h-3 text-emerald-400" />
        Online now ({presenceUsers.length})
      </div>
      {presenceUsers.length === 0 ? (
        <div className="text-xs text-zinc-500 italic">No one in the social lens right now.</div>
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
