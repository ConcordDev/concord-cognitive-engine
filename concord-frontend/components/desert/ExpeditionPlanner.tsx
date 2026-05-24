'use client';

/**
 * ExpeditionPlanner — desert route planner. Builds an ordered list of
 * waypoints, computes per-leg distance + water/supply via the
 * desert.routePreview / routeSave / routeList / routeDelete macros,
 * and renders the route on a Leaflet map.
 */

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { lensRun } from '@/lib/api/client';
import { Plus, Trash2, Route, Droplets, Clock, MapPin, Save } from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

const TERRAINS = ['sand', 'dune', 'rocky', 'gravel', 'salt_flat', 'oasis', 'canyon', 'plateau'];

interface Waypoint {
  name: string;
  lat: string;
  lng: string;
  terrain: string;
}

interface Leg {
  index: number;
  from: string;
  to: string;
  terrain: string;
  distanceKm: number;
  travelHours: number;
  waterLiters: number;
  foodKg: number;
}

interface RouteTotals {
  teamSize: number;
  distanceKm: number;
  travelHours: number;
  travelDays: number;
  waterLiters: number;
  waterLitersPerPerson: number;
  foodKg: number;
}

interface SavedRoute {
  id: string;
  name: string;
  waypoints: { name: string; lat: number; lng: number; terrain: string }[];
  legs: Leg[];
  totals: RouteTotals;
  updatedAt: string;
}

const blankWp = (): Waypoint => ({ name: '', lat: '', lng: '', terrain: 'rocky' });

export function ExpeditionPlanner() {
  const [name, setName] = useState('');
  const [teamSize, setTeamSize] = useState('2');
  const [waypoints, setWaypoints] = useState<Waypoint[]>([blankWp(), blankWp()]);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [totals, setTotals] = useState<RouteTotals | null>(null);
  const [saved, setSaved] = useState<SavedRoute[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadSaved = useCallback(async () => {
    const r = await lensRun<{ routes: SavedRoute[] }>('desert', 'routeList', {});
    if (r.data?.ok && r.data.result) setSaved(r.data.result.routes);
  }, []);

  useEffect(() => {
    loadSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cleanWaypoints = useCallback(
    () =>
      waypoints
        .map((w) => ({
          name: w.name,
          lat: Number(w.lat),
          lng: Number(w.lng),
          terrain: w.terrain,
        }))
        .filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng) && (w.lat !== 0 || w.lng !== 0)),
    [waypoints],
  );

  const preview = useCallback(async () => {
    setErr(null);
    const wp = cleanWaypoints();
    if (wp.length < 2) {
      setErr('Add at least 2 waypoints with coordinates');
      return;
    }
    setBusy(true);
    const r = await lensRun<{ legs: Leg[]; totals: RouteTotals }>('desert', 'routePreview', {
      waypoints: wp,
      teamSize: Number(teamSize) || 1,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setLegs(r.data.result.legs);
      setTotals(r.data.result.totals);
    } else {
      setErr(r.data?.error || 'Preview failed');
    }
  }, [cleanWaypoints, teamSize]);

  const save = useCallback(async () => {
    setErr(null);
    const wp = cleanWaypoints();
    if (wp.length < 2) {
      setErr('Add at least 2 waypoints with coordinates');
      return;
    }
    setBusy(true);
    const r = await lensRun<SavedRoute>('desert', 'routeSave', {
      name: name || 'Untitled route',
      waypoints: wp,
      teamSize: Number(teamSize) || 1,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setLegs(r.data.result.legs);
      setTotals(r.data.result.totals);
      loadSaved();
    } else {
      setErr(r.data?.error || 'Save failed');
    }
  }, [cleanWaypoints, name, teamSize, loadSaved]);

  const remove = useCallback(
    async (id: string) => {
      await lensRun('desert', 'routeDelete', { id });
      loadSaved();
    },
    [loadSaved],
  );

  const loadRoute = useCallback((rt: SavedRoute) => {
    setName(rt.name);
    setTeamSize(String(rt.totals.teamSize));
    setWaypoints(
      rt.waypoints.map((w) => ({
        name: w.name,
        lat: String(w.lat),
        lng: String(w.lng),
        terrain: w.terrain,
      })),
    );
    setLegs(rt.legs);
    setTotals(rt.totals);
  }, []);

  const updateWp = (i: number, patch: Partial<Waypoint>) => {
    setWaypoints((ws) => ws.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  };

  const markers = cleanWaypoints().map((w, i) => ({
    lat: w.lat,
    lng: w.lng,
    label: w.name || `WP${i}`,
    popup: `${w.name || `Waypoint ${i + 1}`} · ${w.terrain}`,
  }));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Route className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Expedition route planner</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Route name"
            className="flex-1 min-w-[160px] rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={teamSize}
            onChange={(e) => setTeamSize(e.target.value)}
            type="number"
            min={1}
            placeholder="Team"
            className="w-24 rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
        </div>

        <div className="space-y-2">
          {waypoints.map((w, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-amber-300 w-8">{i + 1}</span>
              <input
                value={w.name}
                onChange={(e) => updateWp(i, { name: e.target.value })}
                placeholder="Waypoint name"
                className="flex-1 min-w-[120px] rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm text-white"
              />
              <input
                value={w.lat}
                onChange={(e) => updateWp(i, { lat: e.target.value })}
                placeholder="lat"
                className="w-24 rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm text-white"
              />
              <input
                value={w.lng}
                onChange={(e) => updateWp(i, { lng: e.target.value })}
                placeholder="lng"
                className="w-24 rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm text-white"
              />
              <select
                value={w.terrain}
                onChange={(e) => updateWp(i, { terrain: e.target.value })}
                className="rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-sm text-white"
              >
                {TERRAINS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {waypoints.length > 2 && (
                <button
                  onClick={() => setWaypoints((ws) => ws.filter((_, j) => j !== i))}
                  className="p-1 text-zinc-400 hover:text-red-400"
                  aria-label="Remove waypoint"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setWaypoints((ws) => [...ws, blankWp()])}
            className="flex items-center gap-1 rounded bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1.5 text-xs text-white"
          >
            <Plus className="h-3.5 w-3.5" /> Add waypoint
          </button>
          <button
            onClick={preview}
            disabled={busy}
            className="flex items-center gap-1 rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-50 px-2.5 py-1.5 text-xs text-white"
          >
            <Route className="h-3.5 w-3.5" /> Compute legs
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="flex items-center gap-1 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-2.5 py-1.5 text-xs text-white"
          >
            <Save className="h-3.5 w-3.5" /> Save route
          </button>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
      </div>

      {totals && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric icon={<MapPin className="h-4 w-4 text-amber-400" />} label="Distance" value={`${totals.distanceKm} km`} />
            <Metric icon={<Clock className="h-4 w-4 text-cyan-400" />} label="Travel" value={`${totals.travelDays} d`} />
            <Metric icon={<Droplets className="h-4 w-4 text-blue-400" />} label="Water" value={`${totals.waterLiters} L`} />
            <Metric icon={<Droplets className="h-4 w-4 text-green-400" />} label="Per person" value={`${totals.waterLitersPerPerson} L`} />
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-400 text-left">
                <th className="py-1">Leg</th>
                <th>Terrain</th>
                <th>Dist</th>
                <th>Hours</th>
                <th>Water</th>
                <th>Food</th>
              </tr>
            </thead>
            <tbody>
              {legs.map((l) => (
                <tr key={l.index} className="border-t border-zinc-800 text-zinc-200">
                  <td className="py-1">
                    {l.from} → {l.to}
                  </td>
                  <td>{l.terrain}</td>
                  <td>{l.distanceKm} km</td>
                  <td>{l.travelHours} h</td>
                  <td>{l.waterLiters} L</td>
                  <td>{l.foodKg} kg</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {markers.length >= 2 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <MapView markers={markers} className="h-[340px]" center={[markers[0].lat, markers[0].lng]} zoom={6} />
        </div>
      )}

      {saved.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-2">
          <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Saved routes</h4>
          {saved.map((rt) => (
            <div key={rt.id} className="flex items-center justify-between rounded bg-zinc-950 border border-zinc-800 px-3 py-2">
              <button onClick={() => loadRoute(rt)} className="text-left">
                <span className="text-sm text-white">{rt.name}</span>
                <span className="ml-2 text-xs text-zinc-400">
                  {rt.totals.distanceKm} km · {rt.totals.waterLiters} L · {rt.waypoints.length} WP
                </span>
              </button>
              <button onClick={() => remove(rt.id)} className="p-1 text-zinc-400 hover:text-red-400" aria-label="Delete route">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</span>
      </div>
      <div className="mt-0.5 font-mono text-base text-white">{value}</div>
    </div>
  );
}
