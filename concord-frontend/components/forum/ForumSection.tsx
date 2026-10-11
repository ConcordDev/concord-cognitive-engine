'use client';

/**
 * ForumSection — Discourse + Reddit shape community forum. Tabbed
 * panels (topics, communities, trending, inbox, categories,
 * moderation, profile) all hydrate via the `forum` domain macros.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MessagesSquare, MessageCircle, FolderTree, ShieldAlert, Award, Loader2,
  Flame, Bell, Users,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { isForumModerator } from './forumRoles';
import { FmTopicsPanel, FORUM_COMPOSE_EVENT } from './FmTopicsPanel';
import { FmCategoriesPanel } from './FmCategoriesPanel';
import { FmModerationPanel } from './FmModerationPanel';
import { FmProfilePanel } from './FmProfilePanel';
import { FmCommunitiesPanel } from './FmCommunitiesPanel';
import { FmTrendingPanel } from './FmTrendingPanel';
import { FmInboxPanel } from './FmInboxPanel';

interface Dash {
  categories: number; topics: number; replies: number; topicsThisWeek: number;
  pendingFlags: number; subforums: number; subscriptions: number;
  unreadNotifications: number; savedPosts: number;
}
type TabId = 'topics' | 'communities' | 'trending' | 'inbox' | 'categories' | 'moderation' | 'profile';

const TABS: { id: TabId; label: string; icon: typeof MessageCircle }[] = [
  { id: 'topics', label: 'Topics', icon: MessageCircle },
  { id: 'communities', label: 'Communities', icon: Users },
  { id: 'trending', label: 'Trending', icon: Flame },
  { id: 'inbox', label: 'Inbox', icon: Bell },
  { id: 'categories', label: 'Categories', icon: FolderTree },
  { id: 'moderation', label: 'Moderation', icon: ShieldAlert },
  { id: 'profile', label: 'Profile', icon: Award },
];

export function ForumSection() {
  const { user } = useAuth();
  const canModerate = isForumModerator(user?.role);
  const viewerId = user?.id ?? null;
  const tabs = useMemo(
    () => TABS.filter((t) => t.id !== 'moderation' || canModerate),
    [canModerate],
  );
  const [tab, setTab] = useState<TabId>('topics');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingTopic, setPendingTopic] = useState<string | null>(null);
  const topicsKey = useRef(0);

  const refresh = useCallback(async () => {
    const r = await lensRun('forum', 'forum-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeTab: TabId = tab === 'moderation' && !canModerate ? 'topics' : tab;

  useEffect(() => {
    const onCompose = () => setTab('topics');
    window.addEventListener(FORUM_COMPOSE_EVENT, onCompose);
    return () => window.removeEventListener(FORUM_COMPOSE_EVENT, onCompose);
  }, []);

  // Opening a topic from trending/inbox/profile jumps to the Topics tab
  // and tells FmTopicsPanel which thread to auto-open.
  const openTopic = useCallback((id: string) => {
    setPendingTopic(id);
    topicsKey.current += 1;
    setTab('topics');
  }, []);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-orange-600/15 to-transparent">
        <MessagesSquare className="w-5 h-5 text-orange-400" />
        <h2 className="text-sm font-bold text-zinc-100">Community Forum</h2>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className={cn('grid grid-cols-3 gap-2 px-4 py-3 border-b border-zinc-800', canModerate ? 'sm:grid-cols-7' : 'sm:grid-cols-6')}>
          <Stat label="Topics" value={dash.topics} />
          <Stat label="Replies" value={dash.replies} />
          <Stat label="Communities" value={dash.subforums} />
          <Stat label="Categories" value={dash.categories} />
          <Stat label="Watching" value={dash.subscriptions} />
          <Stat label="Saved" value={dash.savedPosts} />
          {canModerate && <Stat label="Flags" value={dash.pendingFlags} />}
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          const badge = t.id === 'inbox' && dash && dash.unreadNotifications > 0 ? dash.unreadNotifications : 0;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-orange-500',
                active ? 'bg-zinc-900 text-orange-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
              {badge > 0 && (
                <span className="text-[9px] font-bold text-white bg-orange-600 rounded-full px-1">{badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {activeTab === 'topics' && (
          <FmTopicsPanel key={topicsKey.current} onChange={refresh}
            initialTopicId={pendingTopic} onTopicConsumed={() => setPendingTopic(null)}
            canModerate={canModerate} viewerId={viewerId} />
        )}
        {activeTab === 'communities' && <FmCommunitiesPanel onChange={refresh} canModerate={canModerate} viewerId={viewerId} />}
        {activeTab === 'trending' && <FmTrendingPanel onOpenTopic={openTopic} />}
        {activeTab === 'inbox' && <FmInboxPanel onChange={refresh} onOpenTopic={openTopic} />}
        {activeTab === 'categories' && <FmCategoriesPanel onChange={refresh} canModerate={canModerate} viewerId={viewerId} />}
        {activeTab === 'moderation' && <FmModerationPanel onChange={refresh} />}
        {activeTab === 'profile' && <FmProfilePanel onOpenTopic={openTopic} />}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <p className="text-base font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
