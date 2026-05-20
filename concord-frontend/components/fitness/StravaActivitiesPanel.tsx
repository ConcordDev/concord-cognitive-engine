'use client';

/**
 * StravaActivitiesPanel — activity feed + logger. Hydrates from
 * fitness.activity-list; logs via fitness.activity-create.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Heart, Trash2, Flame, Clock, Ruler, TrendingUp, Mountain } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Activity {
  id: string;
  type: string;
  name: string;
  distanceKm: number;
  durationSec: number;
  elevationGainM: number;
  avgHr: number;
  relativeEffort: number;
  paceSecPerKm: number | null;
  date: string;
  kudos: string[];
}

const TYPES = ['run', 'ride', 'swim', 'walk', 'hike', 'row', 'workout', 'yoga'];

function paceLabel(secPerKm: number | null): string {
  if (!secPerKm || secPerKm <= 0) return '—';
  return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')}/km`;
}
function durLabel(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function StravaActivitiesPanel() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [totalKm, setTotalKm] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'run', name: '', distanceKm: '', durationMin: '', elevationGainM: '', avgHr: '', calories: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('fitness', 'activity-list', {});
    if (r.data?.ok === false) setError(r.data?.error || 'Failed to load activities');
    else {
      setActivities(r.data?.result?.activities || []);
      setTotalKm(r.data?.result?.totalDistanceKm || 0);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async () => {
    const durationSec = Math.round((Number(form.durationMin) || 0) * 60);
    if (durationSec <= 0) { setError('Duration must be greater than zero.'); return; }
    setBusy(true);
    const r = await lensRun('fitness', 'activity-create', {
      type: form.type,
      name: form.name.trim(),
      distanceKm: Number(form.distanceKm) || 0,
      durationSec,
      elevationGainM: Number(form.elevationGainM) || 0,
      avgHr: Number(form.avgHr) || 0,
      calories: Number(form.calories) || 0,
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not log activity'); return; }
    setForm({ type: 'run', name: '', distanceKm: '', durationMin: '', elevationGainM: '', avgHr: '', calories: '' });
    setShowForm(false);
    await refresh();
  };

  const kudos = async (a: Activity) => {
    await lensRun('fitness', 'activity-kudos', { id: a.id });
    await refresh();
  };
  const remove = async (a: Activity) => {
    await lensRun('fitness', 'activity-delete', { id: a.id });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-zinc-400">
          <span className="text-zinc-100 font-semibold">{activities.length}</span> activities ·{' '}
          <span className="text-zinc-100 font-semibold">{totalKm}</span> km logged
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
        >
          <Plus className="w-3.5 h-3.5" /> Log activity
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showForm && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
          >
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input placeholder="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Distance (km)" inputMode="decimal" value={form.distanceKm} onChange={(e) => setForm({ ...form, distanceKm: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Duration (min)" inputMode="decimal" value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Elevation (m)" inputMode="numeric" value={form.elevationGainM} onChange={(e) => setForm({ ...form, elevationGainM: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Avg HR (bpm)" inputMode="numeric" value={form.avgHr} onChange={(e) => setForm({ ...form, avgHr: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Calories" inputMode="numeric" value={form.calories} onChange={(e) => setForm({ ...form, calories: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={submit} disabled={busy}
            className="flex items-center justify-center gap-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg px-2 py-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save activity'}
          </button>
        </div>
      )}

      {activities.length === 0 ? (
        <div className="text-center text-zinc-500 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No activities yet. Log your first run, ride or swim.
        </div>
      ) : (
        <ul className="space-y-2">
          {activities.map((a) => (
            <li key={a.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{a.name}</p>
                  <p className="text-[11px] text-zinc-500 capitalize">{a.type} · {a.date}</p>
                </div>
                <button type="button" onClick={() => remove(a)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-zinc-400">
                <span className="flex items-center gap-1"><Ruler className="w-3 h-3 text-orange-400" />{a.distanceKm} km</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-orange-400" />{durLabel(a.durationSec)}</span>
                <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3 text-orange-400" />{paceLabel(a.paceSecPerKm)}</span>
                {a.elevationGainM > 0 && <span className="flex items-center gap-1"><Mountain className="w-3 h-3 text-orange-400" />{a.elevationGainM} m</span>}
                {a.avgHr > 0 && <span className="flex items-center gap-1"><Heart className="w-3 h-3 text-rose-400" />{a.avgHr} bpm</span>}
                <span className="flex items-center gap-1"><Flame className="w-3 h-3 text-amber-400" />RE {a.relativeEffort}</span>
              </div>
              <button
                type="button"
                onClick={() => kudos(a)}
                className={cn(
                  'mt-2 flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border transition-colors',
                  (a.kudos?.length || 0) > 0
                    ? 'border-orange-700/50 bg-orange-950/40 text-orange-300'
                    : 'border-zinc-800 text-zinc-400 hover:text-orange-300',
                )}
              >
                <Heart className="w-3 h-3" /> {a.kudos?.length || 0} kudos
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
