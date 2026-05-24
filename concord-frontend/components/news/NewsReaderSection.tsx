'use client';

/**
 * NewsReaderSection — Apple News 2026-shape personalized reader.
 * Tab chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Newspaper, Sun, Sparkles, Rss, Bookmark, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { NewsTodayPanel } from './NewsTodayPanel';
import { NewsForYouPanel } from './NewsForYouPanel';
import { NewsFollowingPanel } from './NewsFollowingPanel';
import { NewsSavedPanel } from './NewsSavedPanel';

interface Dash {
  articles: number; followedChannels: number; followedTopics: number;
  feedUnread: number; saved: number; read: number;
}
type TabId = 'today' | 'foryou' | 'following' | 'saved';
const TABS: { id: TabId; label: string; icon: typeof Sun }[] = [
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'foryou', label: 'For You', icon: Sparkles },
  { id: 'following', label: 'Following', icon: Rss },
  { id: 'saved', label: 'Saved', icon: Bookmark },
];

export function NewsReaderSection() {
  const [tab, setTab] = useState<TabId>('today');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const r = await lensRun('news', 'news-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-rose-600/15 to-transparent">
        <Newspaper className="w-5 h-5 text-rose-400" />
        <h2 className="text-sm font-bold text-zinc-100">News</h2>
        <span className="text-[11px] text-zinc-400">Apple News shape — personalized reader</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Articles" value={dash.articles} />
          <Stat label="Unread feed" value={dash.feedUnread} alert={dash.feedUnread > 0} />
          <Stat label="Channels" value={dash.followedChannels} />
          <Stat label="Topics" value={dash.followedTopics} />
          <Stat label="Read" value={dash.read} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-rose-500',
                active ? 'bg-zinc-900 text-rose-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'today' && <NewsTodayPanel onChange={refreshDash} />}
        {tab === 'foryou' && <NewsForYouPanel onChange={refreshDash} />}
        {tab === 'following' && <NewsFollowingPanel onChange={refreshDash} />}
        {tab === 'saved' && <NewsSavedPanel onChange={refreshDash} />}
      </div>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="text-center">
      <p className={cn('text-lg font-bold', alert ? 'text-rose-400' : 'text-zinc-100')}>{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
