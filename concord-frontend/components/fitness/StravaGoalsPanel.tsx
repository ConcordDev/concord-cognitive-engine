'use client';

/**
 * StravaGoalsPanel — goals, personal records and gear mileage.
 * fitness.goal-list / goal-create / goal-delete / personal-records /
 * gear-list / gear-add / gear-retire.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Target, Trash2, Award, Footprints } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Goal {
  id: string; metric: string; target: number; period: string; label: string | null;
  progress: { value: number; pct: number; complete: boolean; remaining: number };
}
interface Pr { label: string; display: string; activityName?: string; date?: string }
interface Gear {
  id: string; name: string; kind: string; distanceKm: number; retireAtKm: number;
  wearPct: number; status: string; retired: boolean;
}

const METRICS = ['distance', 'duration', 'activity_count', 'elevation', 'relative_effort'];
const METRIC_UNIT: Record<string, string> = {
  distance: 'km', duration: 'h', activity_count: 'activities', elevation: 'm', relative_effort: 'RE',
};

export function StravaGoalsPanel() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [prs, setPrs] = useState<Pr[]>([]);
  const [gear, setGear] = useState<Gear[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [goalForm, setGoalForm] = useState({ metric: 'distance', target: '', period: 'week' });
  const [gearForm, setGearForm] = useState({ name: '', kind: 'shoes', retireAtKm: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [g, p, ge] = await Promise.all([
      lensRun('fitness', 'goal-list', {}),
      lensRun('fitness', 'personal-records', {}),
      lensRun('fitness', 'gear-list', {}),
    ]);
    setGoals(g.data?.result?.goals || []);
    setPrs(p.data?.result?.records || []);
    setGear(ge.data?.result?.gear || []);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const addGoal = async () => {
    const target = Number(goalForm.target);
    if (!target || target <= 0) { setError('Goal target must be greater than zero.'); return; }
    const r = await lensRun('fitness', 'goal-create', { metric: goalForm.metric, target, period: goalForm.period });
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not create goal'); return; }
    setGoalForm({ metric: 'distance', target: '', period: 'week' });
    await refresh();
  };
  const delGoal = async (id: string) => { await lensRun('fitness', 'goal-delete', { id }); await refresh(); };

  const addGear = async () => {
    if (!gearForm.name.trim()) { setError('Gear name is required.'); return; }
    const r = await lensRun('fitness', 'gear-add', {
      name: gearForm.name.trim(), kind: gearForm.kind,
      retireAtKm: Number(gearForm.retireAtKm) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not add gear'); return; }
    setGearForm({ name: '', kind: 'shoes', retireAtKm: '' });
    await refresh();
  };
  const toggleRetire = async (g: Gear) => {
    await lensRun('fitness', 'gear-retire', { id: g.id, unretire: g.retired });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Goals */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Target className="w-3.5 h-3.5 text-orange-400" /> Goals
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <select value={goalForm.metric} onChange={(e) => setGoalForm({ ...goalForm, metric: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {METRICS.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
          </select>
          <input placeholder="Target" inputMode="decimal" value={goalForm.target}
            onChange={(e) => setGoalForm({ ...goalForm, target: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={goalForm.period} onChange={(e) => setGoalForm({ ...goalForm, period: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['week', 'month', 'year'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button type="button" onClick={addGoal}
            className="flex items-center justify-center gap-1 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {goals.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No goals set.</p>
        ) : (
          <ul className="space-y-2">
            {goals.map((g) => (
              <li key={g.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-200 capitalize">
                    {g.metric.replace(/_/g, ' ')} · {g.target} {METRIC_UNIT[g.metric]} / {g.period}
                  </span>
                  <button aria-label="Delete" type="button" onClick={() => delGoal(g.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className={cn('h-full rounded-full', g.progress.complete ? 'bg-emerald-500' : 'bg-orange-500')}
                    style={{ width: `${g.progress.pct}%` }} />
                </div>
                <p className="text-[10px] text-zinc-400 mt-1">
                  {g.progress.value} / {g.target} ({g.progress.pct}%)
                  {g.progress.complete ? ' · complete' : ` · ${g.progress.remaining} to go`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Personal records */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Award className="w-3.5 h-3.5 text-amber-400" /> Personal records
        </h3>
        {prs.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">Log activities to surface your records.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {prs.map((p) => (
              <div key={p.label} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2.5">
                <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{p.label}</p>
                <p className="text-sm font-bold text-zinc-100">{p.display}</p>
                {p.activityName && <p className="text-[10px] text-zinc-400 truncate">{p.activityName}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Gear */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Footprints className="w-3.5 h-3.5 text-orange-400" /> Gear
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Name" value={gearForm.name} onChange={(e) => setGearForm({ ...gearForm, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={gearForm.kind} onChange={(e) => setGearForm({ ...gearForm, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['shoes', 'bike', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input placeholder="Retire at km" inputMode="numeric" value={gearForm.retireAtKm}
            onChange={(e) => setGearForm({ ...gearForm, retireAtKm: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addGear}
            className="flex items-center justify-center gap-1 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {gear.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No gear tracked.</p>
        ) : (
          <ul className="space-y-2">
            {gear.map((g) => (
              <li key={g.id} className={cn('bg-zinc-900/70 border rounded-xl p-3',
                g.status === 'replace_now' ? 'border-rose-900/60' : 'border-zinc-800')}>
                <div className="flex items-center justify-between">
                  <span className={cn('text-xs', g.retired ? 'text-zinc-400 line-through' : 'text-zinc-200')}>
                    {g.name} <span className="text-zinc-600 capitalize">· {g.kind}</span>
                  </span>
                  <button type="button" onClick={() => toggleRetire(g)}
                    className="text-[10px] text-zinc-400 hover:text-zinc-300">
                    {g.retired ? 'Reactivate' : 'Retire'}
                  </button>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className={cn('h-full rounded-full',
                    g.wearPct >= 100 ? 'bg-rose-500' : g.wearPct >= 85 ? 'bg-amber-500' : 'bg-emerald-500')}
                    style={{ width: `${Math.min(100, g.wearPct)}%` }} />
                </div>
                <p className="text-[10px] text-zinc-400 mt-1">
                  {g.distanceKm} / {g.retireAtKm} km · {g.status.replace(/_/g, ' ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
