'use client';

/**
 * FoodYelpSection — Yelp 2026-shape restaurant discovery workbench.
 * Tab chrome owning nav state; each panel hydrates via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Utensils, Search, Trophy, Bookmark, CalendarClock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import { YelpDiscoverPanel } from './YelpDiscoverPanel';
import { YelpTopPanel } from './YelpTopPanel';
import { YelpCollectionsPanel } from './YelpCollectionsPanel';
import { YelpBookingsPanel } from './YelpBookingsPanel';

type TabId = 'discover' | 'top' | 'collections' | 'bookings';

const TABS: { id: TabId; label: string; icon: typeof Search }[] = [
  { id: 'discover', label: 'Discover', icon: Search },
  { id: 'top', label: 'Top Rated', icon: Trophy },
  { id: 'collections', label: 'My Lists', icon: Bookmark },
  { id: 'bookings', label: 'Bookings', icon: CalendarClock },
];

interface DiscoverStats {
  businesses: number;
  cuisines: number;
  myReviews: number;
  myCheckins: number;
  myCollections: number;
  upcomingReservations: number;
  onWaitlists: number;
}

export function FoodYelpSection() {
  const [tab, setTab] = useState<TabId>('discover');
  const [stats, setStats] = useState<DiscoverStats | null>(null);

  // food.food-discover-dashboard — real aggregate of the user's own
  // activity across the directory (not a fabricated summary). Refreshed
  // whenever the user switches tabs, since actions inside each panel
  // (review/check-in/reserve/waitlist) change these counts.
  const loadStats = useCallback(async () => {
    const r = await lensRun<DiscoverStats>('food', 'food-discover-dashboard', {});
    if (r.data?.ok) setStats(r.data.result || null);
  }, []);
  useEffect(() => { void loadStats(); }, [loadStats, tab]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-red-600/15 to-transparent flex-wrap">
        <Utensils className="w-5 h-5 text-red-400" />
        <h2 className="text-sm font-bold text-zinc-100">Restaurant Finder</h2>
        <span className="text-[11px] text-zinc-400">Yelp shape — discover, review, reserve</span>
        {stats && (
          <div className="flex items-center gap-3 ml-auto text-[10px] text-zinc-400">
            <span><span className="text-zinc-200 font-semibold">{stats.businesses}</span> restaurants</span>
            <span><span className="text-zinc-200 font-semibold">{stats.cuisines}</span> cuisines</span>
            <span><span className="text-zinc-200 font-semibold">{stats.myReviews}</span> my reviews</span>
            <span><span className="text-zinc-200 font-semibold">{stats.myCheckins}</span> my check-ins</span>
            {stats.upcomingReservations > 0 && (
              <span className="text-red-300"><span className="font-semibold">{stats.upcomingReservations}</span> upcoming</span>
            )}
            {stats.onWaitlists > 0 && (
              <span className="text-amber-300"><span className="font-semibold">{stats.onWaitlists}</span> on waitlist</span>
            )}
          </div>
        )}
      </header>

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap transition-colors focus:outline-none focus:ring-2 focus:ring-red-500',
                active
                  ? 'bg-zinc-900 text-red-300 border-x border-t border-zinc-800'
                  : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'discover' && <YelpDiscoverPanel />}
        {tab === 'top' && <YelpTopPanel />}
        {tab === 'collections' && <YelpCollectionsPanel />}
        {tab === 'bookings' && <YelpBookingsPanel />}
      </div>
    </div>
  );
}
