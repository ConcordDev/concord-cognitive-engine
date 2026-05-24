'use client';

/**
 * FitnessStravaSection — Strava + Garmin Connect 2026-shape workbench.
 * Top-level wrapper owning tab nav state; each tab mounts a panel that
 * hydrates from the fitness domain via lensRun().
 */

import { useState } from 'react';
import {
  Activity, TrendingUp, Mountain, Target, Users, MapPin, Watch, Radio, CalendarDays,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StravaActivitiesPanel } from './StravaActivitiesPanel';
import { StravaTrainingPanel } from './StravaTrainingPanel';
import { StravaSegmentsPanel } from './StravaSegmentsPanel';
import { StravaGoalsPanel } from './StravaGoalsPanel';
import { StravaClubsPanel } from './StravaClubsPanel';
import { StravaGpsPanel } from './StravaGpsPanel';
import { StravaWearablePanel } from './StravaWearablePanel';
import { StravaBeaconPanel } from './StravaBeaconPanel';
import { StravaPlanPanel } from './StravaPlanPanel';

type TabId = 'activities' | 'gps' | 'training' | 'plan' | 'segments' | 'goals' | 'wearables' | 'beacon' | 'clubs';

const TABS: { id: TabId; label: string; icon: typeof Activity }[] = [
  { id: 'activities', label: 'Activities', icon: Activity },
  { id: 'gps', label: 'GPS & Heatmap', icon: MapPin },
  { id: 'training', label: 'Training', icon: TrendingUp },
  { id: 'plan', label: 'Plan', icon: CalendarDays },
  { id: 'segments', label: 'Segments', icon: Mountain },
  { id: 'goals', label: 'Goals & Gear', icon: Target },
  { id: 'wearables', label: 'Wearables', icon: Watch },
  { id: 'beacon', label: 'Beacon', icon: Radio },
  { id: 'clubs', label: 'Clubs', icon: Users },
];

export function FitnessStravaSection() {
  const [tab, setTab] = useState<TabId>('activities');

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-orange-600/15 to-transparent">
        <Activity className="w-5 h-5 text-orange-400" />
        <h2 className="text-sm font-bold text-zinc-100">Training Hub</h2>
        <span className="text-[11px] text-zinc-400">Strava + Garmin Connect shape</span>
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
                'flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500',
                active
                  ? 'bg-zinc-900 text-orange-300 border-x border-t border-zinc-800'
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
        {tab === 'activities' && <StravaActivitiesPanel />}
        {tab === 'gps' && <StravaGpsPanel />}
        {tab === 'training' && <StravaTrainingPanel />}
        {tab === 'plan' && <StravaPlanPanel />}
        {tab === 'segments' && <StravaSegmentsPanel />}
        {tab === 'goals' && <StravaGoalsPanel />}
        {tab === 'wearables' && <StravaWearablePanel />}
        {tab === 'beacon' && <StravaBeaconPanel />}
        {tab === 'clubs' && <StravaClubsPanel />}
      </div>
    </div>
  );
}
