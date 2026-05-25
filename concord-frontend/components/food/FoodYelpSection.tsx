'use client';

/**
 * FoodYelpSection — Yelp 2026-shape restaurant discovery workbench.
 * Tab chrome owning nav state; each panel hydrates via lensRun().
 */

import { useState } from 'react';
import { Utensils, Search, Trophy, Bookmark, CalendarClock } from 'lucide-react';
import { cn } from '@/lib/utils';
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

export function FoodYelpSection() {
  const [tab, setTab] = useState<TabId>('discover');

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-red-600/15 to-transparent">
        <Utensils className="w-5 h-5 text-red-400" />
        <h2 className="text-sm font-bold text-zinc-100">Restaurant Finder</h2>
        <span className="text-[11px] text-zinc-400">Yelp shape — discover, review, reserve</span>
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
