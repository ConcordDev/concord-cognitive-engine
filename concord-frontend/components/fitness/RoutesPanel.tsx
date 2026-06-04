'use client';

/**
 * RoutesPanel — surfaces the fitness lens's saved routes (the fitness.route-*
 * macros existed backend-side but had no UI). Save a named route with distance,
 * elevation, and activity type; list; delete. A Strava-style route library.
 */

import { useCallback, useEffect, useState } from 'react';
import { Route as RouteIcon, Plus, Trash2, Loader2, AlertTriangle, Mountain } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Route {
  id: string;
  name: string;
  distanceKm?: number;
  elevationGainM?: number;
  activityType?: string;
  createdAt?: string;
}

const ACTIVITIES = ['run', 'ride', 'walk', 'hike', 'swim'];

export function RoutesPanel({ className }: { className?: string }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [elevationGainM, setElevationGainM] = useState('');
  const [activityType, setActivityType] = useState(ACTIVITIES[0]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await lensRun('fitness', 'route-list', {});
      const list = (r?.data?.result?.routes || []) as Route[];
      setRoutes(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load routes');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true); setError(null);
    try {
      const r = await lensRun('fitness', 'route-create', {
        name: name.trim(),
        distanceKm: Number(distanceKm) || 0,
        elevationGainM: Number(elevationGainM) || 0,
        activityType,
      });
      if (r?.data?.error) setError(String(r.data.error));
      else {
        const route = r?.data?.result?.route as Route | undefined;
        setName(''); setDistanceKm(''); setElevationGainM('');
        if (route) setRoutes((prev) => [...prev, route]); else await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save route');
    } finally { setSaving(false); }
  }, [name, distanceKm, elevationGainM, activityType, load]);

  const remove = useCallback(async (id: string) => {
    setRoutes((prev) => prev.filter((r) => r.id !== id));
    try { await lensRun('fitness', 'route-delete', { id }); } catch { void load(); }
  }, [load]);

  return (
    <div className={cn('rounded-xl border border-zinc-800 bg-zinc-950/40 p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        <RouteIcon className="w-4 h-4 text-orange-400" />
        <h3 className="text-sm font-semibold text-zinc-100">Routes</h3>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 text-xs text-rose-300">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      <div className="space-y-1.5 mb-3">
        {routes.length === 0 && !loading && <p className="text-xs text-zinc-500">No saved routes yet.</p>}
        {routes.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-xs group">
            <span className="text-[10px] uppercase tracking-wider text-orange-300/80 w-10 shrink-0">{r.activityType || 'run'}</span>
            <span className="text-zinc-100 font-medium flex-1 truncate">{r.name}</span>
            {r.distanceKm != null && <span className="text-zinc-400 font-mono">{r.distanceKm} km</span>}
            {!!r.elevationGainM && <span className="text-zinc-500 inline-flex items-center gap-0.5"><Mountain className="w-3 h-3" />{r.elevationGainM} m</span>}
            <button type="button" onClick={() => void remove(r.id)} aria-label="Delete route"
              className="opacity-0 group-hover:opacity-100 p-1 text-rose-300 hover:bg-rose-500/20 rounded"><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Route name" maxLength={60}
          className="flex-1 min-w-[8rem] bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:border-orange-500 focus:outline-none" />
        <input value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} placeholder="km" type="number" min="0" step="0.1"
          className="w-16 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none" />
        <input value={elevationGainM} onChange={(e) => setElevationGainM(e.target.value)} placeholder="elev m" type="number" min="0"
          className="w-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none" />
        <select value={activityType} onChange={(e) => setActivityType(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none">
          {ACTIVITIES.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <button type="submit" disabled={saving || !name.trim()}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-orange-500/20 border border-orange-500/40 text-orange-300 text-xs font-medium hover:bg-orange-500/30 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Save
        </button>
      </form>
    </div>
  );
}

export default RoutesPanel;
