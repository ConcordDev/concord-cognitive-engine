'use client';

// Phase DC11 — Vehicle garage lens.
// List vehicles in the current world (filtered to the player's owned).
// Spawn/despawn + mount/dismount actions.

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
  pos_x?: number; pos_z?: number;
}

const VEHICLE_KINDS = ['horse', 'cart', 'carriage', 'boat', 'mig_203', 'glider'];

export default function GarageLensPage() {
  const [worldId, setWorldId] = useState('concordia-hub');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [filterKind, setFilterKind] = useState<string>('all');
  const [spawnKind, setSpawnKind] = useState('horse');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const w = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    if (w) setWorldId(w);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const url = filterKind === 'all'
        ? `/api/garage/world/${worldId}`
        : `/api/garage/world/${worldId}?kind=${filterKind}`;
      const j = await fetch(url, { credentials: 'include' }).then(r => r.json());
      if (j?.ok) setVehicles(j.vehicles || []);
    } catch { /* swallow */ }
  }, [worldId, filterKind]);

  useEffect(() => { refresh(); }, [refresh]);

  // Spawn vehicle (admin/dev — there's no auth-gated spawn route by default,
  // so we POST to a stub if it exists).
  const spawn = useCallback(async () => {
    setPending(true);
    try {
      await fetch('/api/garage/spawn', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldId, kind: spawnKind, ownerKind: 'player' }),
      });
      refresh();
    } finally { setPending(false); }
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

      <div className="flex items-center gap-2">
        <select
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value)}
          className="rounded border border-amber-500/30 bg-zinc-950 px-2 py-1.5 text-xs text-amber-100"
        >
          <option value="all">All kinds ({vehicles.length})</option>
          {VEHICLE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={spawnKind}
            onChange={(e) => setSpawnKind(e.target.value)}
            className="rounded border border-amber-500/30 bg-zinc-950 px-2 py-1.5 text-xs text-amber-100"
          >
            {VEHICLE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
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

      <div className="grid gap-2 md:grid-cols-2">
        {vehicles.length === 0 && <p className="col-span-2 text-center text-xs text-zinc-400">No vehicles.</p>}
        {vehicles.map((v) => (
          <div key={v.id} className="rounded border border-amber-500/20 bg-zinc-900/40 p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-sm text-amber-100">{v.kind}</div>
                <div className="text-[10px] text-amber-300/60">
                  {v.owner_kind}{v.owner_id ? `:${v.owner_id.slice(0, 10)}` : ''} · cap {v.capacity} · fare {v.fare_cc} cc
                </div>
                {v.pos_x != null && (
                  <div className="text-[9px] font-mono text-zinc-400">@ ({v.pos_x.toFixed(1)}, {v.pos_z?.toFixed(1) ?? 0})</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
    </LensShell>
  );
}
