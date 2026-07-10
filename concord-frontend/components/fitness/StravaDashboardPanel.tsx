'use client';

/**
 * StravaDashboardPanel — the "at a glance" landing view for the Training
 * Hub. Was a genuine gap (Wave 3 audit): fitness.fitness-dashboard already
 * aggregates this-week totals + training load + goals + gear into one call,
 * but no panel ever surfaced it — a user had to visit Activities, Training,
 * and Goals separately to answer "how's my week going." Hydrates entirely
 * from fitness.fitness-dashboard; no client-side computation or fabrication.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Activity, Ruler, Clock, Mountain, Flame, Gauge, Target, Wrench, TrendingUp,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Dashboard {
  week: { activities: number; distanceKm: number; durationSec: number; elevationGainM: number; relativeEffort: number };
  trainingLoad: { fitness: number; fatigue: number; form: number };
  goals: { total: number; completed: number };
  gear: { tracked: number; needReplacement: number };
  totals: { activities: number; distanceKm: number };
}

function durLabel(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function StravaDashboardPanel() {
  const [d, setD] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('fitness', 'fitness-dashboard', {});
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to load dashboard'); setD(null); }
    else { setError(null); setD((r.data?.result as Dashboard) || null); }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }
  if (error) {
    return (
      <div role="alert" className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2 space-y-2">
        <p>{error}</p>
        <button type="button" onClick={() => void refresh()} className="px-2.5 py-1 rounded bg-rose-500/20 text-rose-200 border border-rose-500/30 hover:bg-rose-500/30">Retry</button>
      </div>
    );
  }
  if (!d || d.totals.activities === 0) {
    return (
      <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
        No activities logged yet. Log or record one on the Activities / GPS tab to see your week here.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-orange-400" /> This week
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Tile icon={Activity} label="Activities" value={String(d.week.activities)} accent="text-orange-400" />
          <Tile icon={Ruler} label="Distance" value={`${d.week.distanceKm} km`} accent="text-sky-400" />
          <Tile icon={Clock} label="Time" value={durLabel(d.week.durationSec)} accent="text-emerald-400" />
          <Tile icon={Mountain} label="Elevation" value={`${d.week.elevationGainM} m`} accent="text-violet-400" />
          <Tile icon={Flame} label="Rel. Effort" value={String(d.week.relativeEffort)} accent="text-amber-400" />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5 text-orange-400" /> Training load
        </h3>
        <div className="grid grid-cols-3 gap-2">
          <Tile icon={TrendingUp} label="Fitness (CTL)" value={String(d.trainingLoad.fitness)} accent="text-sky-400" />
          <Tile icon={Flame} label="Fatigue (ATL)" value={String(d.trainingLoad.fatigue)} accent="text-orange-400" />
          <Tile icon={Gauge} label="Form (TSB)" value={String(d.trainingLoad.form)} accent={d.trainingLoad.form >= 0 ? 'text-emerald-400' : 'text-amber-400'} />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 flex items-center gap-3">
          <Target className="w-4 h-4 text-orange-400 shrink-0" />
          <div>
            <p className="text-sm font-bold text-zinc-100">{d.goals.completed}/{d.goals.total}</p>
            <p className="text-[11px] text-zinc-400">Goals completed</p>
          </div>
        </div>
        <div className={cn(
          'bg-zinc-900/70 border rounded-xl p-3 flex items-center gap-3',
          d.gear.needReplacement > 0 ? 'border-rose-800/60' : 'border-zinc-800',
        )}>
          <Wrench className={cn('w-4 h-4 shrink-0', d.gear.needReplacement > 0 ? 'text-rose-400' : 'text-orange-400')} />
          <div>
            <p className={cn('text-sm font-bold', d.gear.needReplacement > 0 ? 'text-rose-300' : 'text-zinc-100')}>
              {d.gear.tracked} tracked{d.gear.needReplacement > 0 ? ` · ${d.gear.needReplacement} need replacing` : ''}
            </p>
            <p className="text-[11px] text-zinc-400">Gear mileage</p>
          </div>
        </div>
      </div>

      <div className="text-[11px] text-zinc-400 border-t border-zinc-800 pt-2">
        All-time: <span className="text-zinc-200 font-medium">{d.totals.activities}</span> activities ·{' '}
        <span className="text-zinc-200 font-medium">{d.totals.distanceKm}</span> km
      </div>
    </div>
  );
}

function Tile({ icon: Icon, label, value, accent }: {
  icon: typeof Activity; label: string; value: string; accent: string;
}) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2.5">
      <div className="flex items-center gap-1 text-[10px] text-zinc-400 uppercase tracking-wide">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <p className={cn('text-lg font-bold mt-0.5', accent)}>{value}</p>
    </div>
  );
}

export default StravaDashboardPanel;
