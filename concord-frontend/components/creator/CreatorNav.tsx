'use client';

import {
  Activity, ListChecks, Settings, Users, GitBranch,
  KanbanSquare, CalendarClock, CalendarDays, MessageSquare,
  PieChart, Gauge, LineChart, DollarSign, Crown, Banknote, Megaphone,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CreatorView } from './types';

const GROUPS: { label: string; items: { id: CreatorView; label: string; icon: typeof Activity; keys?: string }[] }[] = [
  {
    label: 'Studio',
    items: [
      { id: 'home', label: 'Home', icon: Activity, keys: 'o' },
      { id: 'pipeline', label: 'Pipeline', icon: KanbanSquare },
      { id: 'listings', label: 'Listings', icon: ListChecks, keys: 'l' },
      { id: 'scheduled', label: 'Scheduled', icon: CalendarClock },
      { id: 'calendar', label: 'Calendar', icon: CalendarDays },
      { id: 'comments', label: 'Comments', icon: MessageSquare },
    ],
  },
  {
    label: 'Audience',
    items: [
      { id: 'followers', label: 'Followers', icon: Users, keys: 'f' },
      { id: 'audience', label: 'Reach', icon: Megaphone },
      { id: 'demographics', label: 'Demographics', icon: PieChart },
      { id: 'performance', label: 'Performance', icon: Gauge },
      { id: 'trends', label: 'Trends', icon: LineChart },
    ],
  },
  {
    label: 'Earn',
    items: [
      { id: 'revenue', label: 'Revenue', icon: DollarSign },
      { id: 'membership', label: 'Membership', icon: Crown },
      { id: 'payouts', label: 'Payouts', icon: Banknote },
      { id: 'cascade', label: 'Cascade', icon: GitBranch, keys: 'c' },
    ],
  },
  {
    label: 'Channel',
    items: [{ id: 'profile', label: 'Profile', icon: Settings, keys: 'p' }],
  },
];

export function CreatorNav({
  view,
  onSelect,
}: {
  view: CreatorView;
  onSelect: (v: CreatorView) => void;
}) {
  return (
    <nav
      aria-label="Creator studio"
      className="w-full lg:w-52 shrink-0 lg:border-r border-lattice-border lg:pr-3 overflow-x-auto lg:overflow-visible"
    >
      <div className="flex lg:flex-col gap-4 min-w-max lg:min-w-0">
        {GROUPS.map((g) => (
          <div key={g.label}>
            <div className="hidden lg:block text-[10px] uppercase tracking-[0.14em] text-white/35 px-2 mb-1">
              {g.label}
            </div>
            <ul className="flex lg:flex-col gap-0.5">
              {g.items.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(item.id)}
                      className={cn(
                        'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
                        active
                          ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30'
                          : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent',
                      )}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      {item.label}
                      {item.keys && (
                        <kbd className="ml-auto hidden lg:inline text-[9px] text-white/30 font-mono">
                          {item.keys}
                        </kbd>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

export const CREATOR_COMMANDS = GROUPS.flatMap((g) =>
  g.items
    .filter((i) => i.keys)
    .map((i) => ({ id: `tab-${i.id}`, keys: i.keys!, view: i.id, description: i.label })),
);
