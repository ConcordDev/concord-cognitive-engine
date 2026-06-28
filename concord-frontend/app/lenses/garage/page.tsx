'use client';

// Phase DC11 — Vehicle garage lens.
// Lists vehicles in the current world (mig 177 `world_vehicles`) and spawns the
// player's own. Backed by the real `/api/garage/*` REST routes (thin wrappers
// over server/lib/world-vehicles.js) AND the registered `garage.*` macros
// (server/domains/garage.js) — same lib, two surfaces.
//
// The canonical vehicle kinds are cart / boat / canal_taxi (mig 177 CHECK).
// canal_taxi requires an authored route, so the player-spawn picker offers only
// the two free-spawn archetypes; the kind filter spans all three.

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { Car, Plus, Loader2 } from 'lucide-react';

interface Vehicle {
  id: string;
  world_id: string;
  kind: string;
  owner_kind: string;
  owner_id?: string;
  capacity: number;
  fare_cc: number;
  pos_x?: number;
  pos_y?: number;
  pos_z?: number;
  heading?: number;
}

// The three real archetypes (mig 177). canal_taxi needs a route_id, so it's
// listed in the filter but not the free-spawn picker.
const VEHICLE_KINDS = ['cart', 'boat', 'canal_taxi'] as const;
const SPAWNABLE_KINDS = ['cart', 'boat'] as const;

export default function GarageLensPage() {
  const [worldId, setWorldId] = useState('concordia-hub');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [filterKind, setFilterKind] = useState<string>('all');
  const [spawnKind, setSpawnKind] = useState<string>('cart');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const w = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    if (w) setWorldId(w);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = filterKind === 'all'
        ? `/api/garage/world/${worldId}`
        : `/api/garage/world/${worldId}?kind=${filterKind}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || 'request failed');
      setVehicles(Array.isArray(j.vehicles) ? j.vehicles : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
      setVehicles([]);
    } finally {
      setLoading(false);
    }
  }, [worldId, filterKind]);

  useEffect(() => { refresh(); }, [refresh]);

  const spawn = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/garage/spawn', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldId, kind: spawnKind, ownerKind: 'player' }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j?.ok === false) {
        throw new Error(j?.reason || j?.error || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'spawn failed');
    } finally {
      setPending(false);
    }
  }, [worldId, spawnKind, refresh]);

  return (
    <LensShell lensId="garage">
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-amber-200">
            <Car size={22} /> Garage
          </h1>
          <p className="text-sm text-zinc-400">{worldId} · vehicles owned + available</p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="garage-filter">Filter by vehicle kind</label>
          <select
            id="garage-filter"
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value)}
            className="rounded border border-amber-500/30 bg-zinc-950 px-2 py-1.5 text-xs text-amber-100"
          >
            <option value="all">All kinds ({vehicles.length})</option>
            {VEHICLE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <div className="ml-auto flex items-center gap-2">
            <label className="sr-only" htmlFor="garage-spawn-kind">Vehicle kind to spawn</label>
            <select
              id="garage-spawn-kind"
              value={spawnKind}
              onChange={(e) => setSpawnKind(e.target.value)}
              className="rounded border border-amber-500/30 bg-zinc-950 px-2 py-1.5 text-xs text-amber-100"
            >
              {SPAWNABLE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button
              onClick={spawn}
              disabled={pending}
              className="flex items-center gap-1 rounded bg-amber-500/30 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-500/50 disabled:opacity-50"
            >
              {pending ? <Loader2 className="animate-spin" size={11} /> : <Plus size={11} />} Spawn
            </button>
          </div>
        </div>

        {/* ERROR */}
        {error && (
          <div
            role="alert"
            className="flex items-center justify-between rounded border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-200"
          >
            <span>Couldn&rsquo;t load garage data: {error}</span>
            <button
              onClick={refresh}
              className="ml-3 rounded bg-red-500/30 px-2 py-1 text-red-100 hover:bg-red-500/50"
            >
              Retry
            </button>
          </div>
        )}

        {/* LOADING */}
        {loading && !error && (
          <div role="status" className="flex items-center gap-2 py-10 text-xs text-amber-300/70">
            <Loader2 className="animate-spin" size={14} /> Loading vehicles&hellip;
          </div>
        )}

        {/* EMPTY */}
        {!loading && !error && vehicles.length === 0 && (
          <div className="rounded border border-amber-500/20 bg-zinc-900/40 py-10 text-center text-xs text-zinc-400">
            <Car className="mx-auto mb-2 text-amber-400/50" size={28} />
            No vehicles in this world yet. Spawn your first one above.
          </div>
        )}

        {/* POPULATED */}
        {!loading && !error && vehicles.length > 0 && (
          <ul className="grid list-none gap-2 p-0 md:grid-cols-2">
            {vehicles.map((v) => (
              <li key={v.id} className="rounded border border-amber-500/20 bg-zinc-900/40 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-mono text-sm text-amber-100">{v.kind}</div>
                    <div className="text-[10px] text-amber-300/60">
                      {v.owner_kind}{v.owner_id ? `:${v.owner_id.slice(0, 10)}` : ''} · cap {v.capacity} · fare {v.fare_cc} cc
                    </div>
                    {v.pos_x != null && (
                      <div className="text-[9px] font-mono text-zinc-500">
                        @ ({v.pos_x.toFixed(1)}, {v.pos_z?.toFixed(1) ?? 0})
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </LensShell>
  );
}
