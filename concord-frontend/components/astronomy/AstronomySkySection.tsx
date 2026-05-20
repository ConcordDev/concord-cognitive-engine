'use client';

/**
 * AstronomySkySection — Stellarium + SkySafari 2026-shape observation
 * workbench. Tab chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Star, Moon, Wrench, ListChecks, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { AstroTargetsPanel } from './AstroTargetsPanel';
import { AstroSessionsPanel } from './AstroSessionsPanel';
import { AstroGearPanel } from './AstroGearPanel';
import { AstroPlanPanel } from './AstroPlanPanel';

interface Dash {
  targets: number; observed: number; observations: number; sessions: number;
  equipment: number; wishlistRemaining: number; upcomingEvents: number;
}
type TabId = 'targets' | 'sessions' | 'gear' | 'plan';
const TABS: { id: TabId; label: string; icon: typeof Star }[] = [
  { id: 'targets', label: 'Targets', icon: Star },
  { id: 'sessions', label: 'Sessions', icon: Moon },
  { id: 'gear', label: 'Gear', icon: Wrench },
  { id: 'plan', label: 'Plan', icon: ListChecks },
];

export function AstronomySkySection() {
  const [tab, setTab] = useState<TabId>('targets');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const r = await lensRun('astronomy', 'astro-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-indigo-600/15 to-transparent">
        <Sparkles className="w-5 h-5 text-indigo-400" />
        <h2 className="text-sm font-bold text-zinc-100">Observing Log</h2>
        <span className="text-[11px] text-zinc-500">Stellarium + SkySafari shape</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Targets" value={dash.targets} />
          <Stat label="Observed" value={dash.observed} />
          <Stat label="Observations" value={dash.observations} />
          <Stat label="Sessions" value={dash.sessions} />
          <Stat label="Wishlist" value={dash.wishlistRemaining} />
          <Stat label="Events" value={dash.upcomingEvents} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-indigo-500',
                active ? 'bg-zinc-900 text-indigo-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'targets' && <AstroTargetsPanel onChange={refreshDash} />}
        {tab === 'sessions' && <AstroSessionsPanel onChange={refreshDash} />}
        {tab === 'gear' && <AstroGearPanel />}
        {tab === 'plan' && <AstroPlanPanel onChange={refreshDash} />}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-lg font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
