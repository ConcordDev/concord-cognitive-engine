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
      className="w-full shrink-0 self-start overflow-x-auto rounded-2xl border border-white/10 bg-[#111] p-3 lg:w-56 lg:overflow-visible"
    >
      <div className="flex lg:flex-col gap-4 min-w-max lg:min-w-0">
        {GROUPS.map((g) => (
          <div key={g.label}>
            <div className="hidden lg:block text-[11px] uppercase tracking-wider text-zinc-600 px-2 mb-1">
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
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'w-full flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors',
                        active ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
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

export const CREATOR_VIEW_LABELS: Record<string, string> = Object.fromEntries(
  GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label])),
);
