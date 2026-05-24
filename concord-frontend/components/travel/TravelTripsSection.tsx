'use client';

/**
 * TravelTripsSection — TripAdvisor + Hopper 2026-shape trip-planning
 * workbench. Tab chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Plane, Map, Compass, TrendingDown, FileText, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { TravelTripsPanel } from './TravelTripsPanel';
import { TravelExplorePanel } from './TravelExplorePanel';
import { TravelWatchesPanel } from './TravelWatchesPanel';
import { TravelDocsPanel } from './TravelDocsPanel';

interface Dash {
  trips: number; upcomingTrips: number;
  nextTrip: { name: string; destination: string; startDate: string } | null;
  priceWatches: number; watchesTriggered: number; savedPlaces: number; totalBooked: number;
}
type TabId = 'trips' | 'explore' | 'watches' | 'docs';
const TABS: { id: TabId; label: string; icon: typeof Map }[] = [
  { id: 'trips', label: 'My Trips', icon: Map },
  { id: 'explore', label: 'Explore', icon: Compass },
  { id: 'watches', label: 'Price Watch', icon: TrendingDown },
  { id: 'docs', label: 'Documents', icon: FileText },
];

export function TravelTripsSection() {
  const [tab, setTab] = useState<TabId>('trips');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const r = await lensRun('travel', 'travel-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-sky-600/15 to-transparent">
        <Plane className="w-5 h-5 text-sky-400" />
        <h2 className="text-sm font-bold text-zinc-100">Trip Planner</h2>
        <span className="text-[11px] text-zinc-400">TripAdvisor + Hopper shape</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Trips" value={dash.trips} />
          <Stat label="Upcoming" value={dash.upcomingTrips} />
          <Stat label="Watches" value={dash.priceWatches} alert={dash.watchesTriggered > 0} />
          <Stat label="Saved places" value={dash.savedPlaces} />
          <Stat label="Booked" value={`$${dash.totalBooked}`} />
        </div>
      )}

      {dash?.nextTrip && (
        <div className="px-4 py-2 border-b border-zinc-800 text-[11px] text-sky-300">
          Next up: <span className="font-semibold">{dash.nextTrip.name}</span> — {dash.nextTrip.destination} · {dash.nextTrip.startDate}
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-sky-500',
                active ? 'bg-zinc-900 text-sky-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'trips' && <TravelTripsPanel onChange={refreshDash} />}
        {tab === 'explore' && <TravelExplorePanel />}
        {tab === 'watches' && <TravelWatchesPanel onChange={refreshDash} />}
        {tab === 'docs' && <TravelDocsPanel />}
      </div>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className="text-center">
      <p className={cn('text-lg font-bold', alert ? 'text-amber-400' : 'text-zinc-100')}>{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
