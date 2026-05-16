'use client';

/**
 * DistanceMatrixPanel — bespoke point-to-point distance + TSP route
 * optimizer for the atlas lens. Wires atlas.distanceMatrix +
 * atlas.routeOptimize against an editable waypoint table.
 *
 *   • Editable name/lat/lon rows with add/remove
 *   • Compute → side-by-side: matrix heatmap (km) + optimal route order
 *   • Save-as-DTU captures inputs + matrix + route summary
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Map, Loader2, Plus, Trash2, Route } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Waypoint { name: string; lat: string; lon: string }
interface MatrixResult { labels?: string[]; matrix?: number[][]; stats?: { totalPairs?: number; meanKm?: number; medianKm?: number; maxKm?: number; minKm?: number; maxPair?: [string, string]; minPair?: [string, string] } }
interface RouteResult { route?: string[]; order?: number[]; totalDistanceKm?: number; legs?: Array<{ from: string; to: string; km: number }> }

async function callAtlas<T>(action: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('atlas', action, { input });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const result = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (result && typeof result === 'object' && 'ok' in result && 'result' in result) {
      return (result as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

export function DistanceMatrixPanel() {
  const [waypoints, setWaypoints] = useState<Waypoint[]>([
    { name: '', lat: '', lon: '' },
    { name: '', lat: '', lon: '' },
  ]);
  const [matrix, setMatrix] = useState<MatrixResult | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const valid = waypoints.filter((w) => w.lat.trim() && w.lon.trim()).map((w, i) => ({
        name: w.name.trim() || `Point_${i}`,
        lat: parseFloat(w.lat),
        lon: parseFloat(w.lon),
      }));
      if (valid.length < 2) return { m: null, r: null };
      const [m, r] = await Promise.all([
        callAtlas<MatrixResult>('distanceMatrix', { artifact: { data: { points: valid } } }),
        callAtlas<RouteResult>('routeOptimize', { artifact: { data: { waypoints: valid } } }),
      ]);
      setMatrix(m);
      setRoute(r);
      return { m, r };
    },
  });

  const addRow = () => setWaypoints((ws) => [...ws, { name: '', lat: '', lon: '' }]);
  const updateRow = (i: number, key: keyof Waypoint, value: string) =>
    setWaypoints((ws) => ws.map((w, idx) => (idx === i ? { ...w, [key]: value } : w)));
  const removeRow = (i: number) => setWaypoints((ws) => ws.filter((_, idx) => idx !== i));

  const max = matrix?.matrix?.flat().filter((v) => v > 0).reduce((a, b) => Math.max(a, b), 0) || 1;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Map className="h-5 w-5 text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">Distance matrix + route optimizer</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">atlas.distanceMatrix + routeOptimize</span>
        </div>
        {(matrix || route) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-atlas-distance"
            title={`Atlas distance matrix — ${waypoints.length} points`}
            content={`Points:\n${waypoints.map((w, i) => `  ${i + 1}. ${w.name || `Point_${i}`} (${w.lat}, ${w.lon})`).join('\n')}\n\nMatrix stats:\n  Mean: ${matrix?.stats?.meanKm ?? '—'} km\n  Max: ${matrix?.stats?.maxKm ?? '—'} km ${matrix?.stats?.maxPair ? `(${matrix.stats.maxPair[0]} ↔ ${matrix.stats.maxPair[1]})` : ''}\n  Min: ${matrix?.stats?.minKm ?? '—'} km ${matrix?.stats?.minPair ? `(${matrix.stats.minPair[0]} ↔ ${matrix.stats.minPair[1]})` : ''}\n\nOptimal route (${route?.totalDistanceKm ?? '—'} km):\n${route?.route?.map((r, i) => `  ${i + 1}. ${r}`).join('\n') || '—'}`}
            extraTags={['atlas', 'distance', 'routing']}
            rawData={{ waypoints, matrix, route }}
          />
        )}
      </header>

      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_120px_120px_40px] gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
          <span>Name</span><span>Latitude</span><span>Longitude</span><span></span>
        </div>
        {waypoints.map((w, i) => (
          <div key={i} className="grid grid-cols-[1fr_120px_120px_40px] gap-2">
            <input className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" placeholder={`Point_${i}`} value={w.name} onChange={(e) => updateRow(i, 'name', e.target.value)} />
            <input className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" placeholder="40.71" value={w.lat} onChange={(e) => updateRow(i, 'lat', e.target.value)} />
            <input className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white font-mono" placeholder="-74.00" value={w.lon} onChange={(e) => updateRow(i, 'lon', e.target.value)} />
            <button type="button" onClick={() => removeRow(i)} className="rounded border border-zinc-800 bg-zinc-950 text-xs text-zinc-500 hover:text-rose-300" aria-label="Remove"><Trash2 className="mx-auto h-3.5 w-3.5" /></button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <button type="button" onClick={addRow} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-200"><Plus className="h-3 w-3" />Add point</button>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || waypoints.filter((w) => w.lat && w.lon).length < 2} className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-mono text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Route className="h-3.5 w-3.5" />}
            Compute
          </button>
        </div>
      </div>

      {compute.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Compute failed.</div>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">Distance matrix (km)</div>
          {!matrix && <div className="text-[11px] text-zinc-500">Compute to populate.</div>}
          {matrix?.matrix && matrix.labels && (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr>
                    <th></th>
                    {matrix.labels.map((l) => <th key={l} className="px-1 py-0.5 text-zinc-400">{l.slice(0, 6)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {matrix.matrix.map((row, i) => (
                    <tr key={i}>
                      <td className="px-1 py-0.5 text-zinc-400">{matrix.labels?.[i].slice(0, 6)}</td>
                      {row.map((v, j) => {
                        const intensity = v > 0 ? Math.min(1, v / max) : 0;
                        return <td key={j} className="px-1 py-0.5 text-center text-emerald-200" style={{ backgroundColor: v > 0 ? `rgba(16, 185, 129, ${intensity * 0.4})` : 'transparent' }}>{v > 0 ? v.toFixed(0) : '—'}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {matrix.stats && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-zinc-400">
                  <div>Mean: <span className="font-mono text-emerald-200">{matrix.stats.meanKm} km</span></div>
                  <div>Max: <span className="font-mono text-emerald-200">{matrix.stats.maxKm} km</span></div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500">Optimal route (nearest-neighbor TSP)</div>
          {!route && <div className="text-[11px] text-zinc-500">Compute to populate.</div>}
          {route?.route && (
            <div className="space-y-1 text-[11px]">
              <div className="mb-2 rounded border border-sky-500/15 bg-zinc-950/40 px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wider text-zinc-500">Total distance</div>
                <div className="font-mono text-sky-200">{route.totalDistanceKm} km</div>
              </div>
              <ol className="space-y-0.5">
                {route.route.map((r, i) => (
                  <li key={i} className="flex items-center gap-2 rounded border border-sky-500/15 bg-zinc-950/40 px-2 py-1">
                    <span className="font-mono text-[9px] text-zinc-500">{(i + 1).toString().padStart(2, '0')}</span>
                    <span className="text-zinc-100">{r}</span>
                  </li>
                ))}
              </ol>
              {route.legs && route.legs.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] text-zinc-500 hover:text-zinc-300">Legs ({route.legs.length})</summary>
                  <div className="mt-1 space-y-0.5">
                    {route.legs.map((leg, i) => (
                      <div key={i} className="flex items-center justify-between rounded border border-sky-500/10 bg-zinc-950/40 px-2 py-0.5 text-[10px]">
                        <span className="text-zinc-300">{leg.from} → {leg.to}</span>
                        <span className="font-mono text-sky-200">{leg.km} km</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
