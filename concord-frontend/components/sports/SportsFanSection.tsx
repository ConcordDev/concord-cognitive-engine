'use client';

/**
 * SportsFanSection — ESPN 2026-shape sports fan hub. Tab chrome owns
 * nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Trophy, Activity, Target, Users, UserRound, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { SportsScoresPanel } from './SportsScoresPanel';
import { SportsPredictionsPanel } from './SportsPredictionsPanel';
import { SportsTeamsPanel } from './SportsTeamsPanel';
import { SportsAthletesPanel } from './SportsAthletesPanel';

interface Dash {
  followedTeams: number; trackedGames: number; liveGames: number;
  watchlist: number; trackedAthletes: number; predictionAccuracy: number | null;
}
type TabId = 'scores' | 'predictions' | 'teams' | 'athletes';
const TABS: { id: TabId; label: string; icon: typeof Activity }[] = [
  { id: 'scores', label: 'Scores', icon: Activity },
  { id: 'predictions', label: 'Pick’em', icon: Target },
  { id: 'teams', label: 'Teams', icon: Users },
  { id: 'athletes', label: 'Athletes', icon: UserRound },
];

export function SportsFanSection() {
  const [tab, setTab] = useState<TabId>('scores');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const r = await lensRun('sports', 'sports-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-red-600/15 to-transparent">
        <Trophy className="w-5 h-5 text-red-400" />
        <h2 className="text-sm font-bold text-zinc-100">Sports Center</h2>
        <span className="text-[11px] text-zinc-500">ESPN shape — scores, predictions, teams</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Teams" value={dash.followedTeams} />
          <Stat label="Games" value={dash.trackedGames} />
          <Stat label="Live" value={dash.liveGames} alert={dash.liveGames > 0} />
          <Stat label="Watchlist" value={dash.watchlist} />
          <Stat label="Athletes" value={dash.trackedAthletes} />
          <Stat label="Pick accuracy" value={dash.predictionAccuracy != null ? `${dash.predictionAccuracy}%` : '—'} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-red-500',
                active ? 'bg-zinc-900 text-red-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'scores' && <SportsScoresPanel onChange={refreshDash} />}
        {tab === 'predictions' && <SportsPredictionsPanel onChange={refreshDash} />}
        {tab === 'teams' && <SportsTeamsPanel onChange={refreshDash} />}
        {tab === 'athletes' && <SportsAthletesPanel onChange={refreshDash} />}
      </div>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className="text-center">
      <p className={cn('text-base font-bold', alert ? 'text-red-400' : 'text-zinc-100')}>{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
