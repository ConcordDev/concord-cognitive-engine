'use client';

// The vehicle garage — a hybrid lens.
//
// CAPABILITY MAP (server/domains/garage.js, 8 macros — verified by direct
// read of the file, not assumed):
//   garage.list    — DESIGNED here (World Fleet tab). Every vehicle in a
//                     world (mig 177 `world_vehicles`).
//   garage.mine    — DESIGNED here (My Fleet tab). Previously had NO
//                     frontend caller at all — the old page only hit the
//                     REST `/api/garage/world/:worldId` route, never this
//                     macro, so a player had no way to see just their own
//                     vehicles.
//   garage.get     — DESIGNED here (VehicleInspectorPanel). Previously
//                     unsurfaced — no UI ever read a single vehicle's full
//                     row (heading/condition_pct) or live occupant count.
//   garage.spawn   — DESIGNED here (spawn form), now dispatched through the
//                     macro path with real started/running/done/error
//                     lifecycle feedback instead of a bare fetch.
//   garage.create  — ALIAS of spawn (the manifest's generic `create` verb
//                     resolving to the same lib call) — intentionally not
//                     given a second, redundant control.
//   garage.mount   — WORLD-OWNED. Confirmed by
//                     `lib/world-lens/vehicle-renderer.ts` +
//                     `lib/world-lens/vehicle-system.ts` +
//                     `components/concordia/hud/VehicleHUD.tsx`: a player
//                     boards a vehicle by walking up to it in the 3D world
//                     and pressing E — there is no standalone-lens
//                     equivalent action to fake here.
//   garage.dismount — WORLD-OWNED, same evidence as mount.
//   garage.move    — WORLD-OWNED. Continuous, anti-teleport-bounded
//                     position updates driven by real-time keyboard input
//                     in the world (VehicleHUD gauges/gear/horn) — not a
//                     button a standalone page could honestly offer.
//
// So this page is the "dealership/depot" half of the feature (browse,
// inspect, spawn) and is explicit that the "drive it" half lives in the
// world lens, linking there rather than duplicating or faking driving
// controls.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Car, Ship, Sailboat, Plus, RefreshCw, MapPinned, Loader2 } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { lensRun } from '@/lib/api/client';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { useAuth } from '@/hooks/useAuth';
import { ds } from '@/lib/design-system';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SkeletonTableRows } from '@/components/ui/Skeleton';
import { StatusDot } from '@/components/ui/StatusDot';
import { VehicleInspectorPanel } from '@/components/garage/VehicleInspectorPanel';
import { cn } from '@/lib/utils';

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

interface GarageListResult {
  worldId: string;
  vehicles: Vehicle[];
}

interface GarageSpawnResult {
  vehicleId: string;
  kind: string;
  capacity: number;
  fare_cc: number;
}

const VEHICLE_KINDS = ['cart', 'boat', 'canal_taxi'] as const;
// canal_taxi requires an authored route_id (server-enforced) — free-spawn
// only offers the two archetypes that don't.
const SPAWNABLE_KINDS = ['cart', 'boat'] as const;

const KIND_ICON: Record<string, typeof Car> = {
  cart: Car,
  boat: Sailboat,
  canal_taxi: Ship,
};

type FleetTab = 'world' | 'mine';

export default function GarageLensPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [worldId, setWorldId] = useState('concordia-hub');
  const [worldIdDraft, setWorldIdDraft] = useState('concordia-hub');
  const [tab, setTab] = useState<FleetTab>('world');
  const [filterKind, setFilterKind] = useState<string>('all');

  const [worldFleet, setWorldFleet] = useState<Vehicle[] | null>(null);
  const [myFleet, setMyFleet] = useState<Vehicle[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [spawnKind, setSpawnKind] = useState<string>('cart');

  const spawnFeedback = useMacroDispatchFeedback<GarageSpawnResult>();

  useEffect(() => {
    const w = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    if (w) {
      setWorldId(w);
      setWorldIdDraft(w);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [worldRes, mineRes] = await Promise.all([
        lensRun<GarageListResult>('garage', 'list', { worldId }),
        isAuthenticated ? lensRun<GarageListResult>('garage', 'mine', { worldId }) : Promise.resolve(null),
      ]);
      if (!worldRes.data.ok) throw new Error(worldRes.data.error || 'failed to load world fleet');
      setWorldFleet(worldRes.data.result?.vehicles ?? []);
      if (mineRes) {
        setMyFleet(mineRes.data.ok ? (mineRes.data.result?.vehicles ?? []) : []);
      } else {
        setMyFleet(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error');
      setWorldFleet([]);
      setMyFleet(null);
    } finally {
      setLoading(false);
    }
  }, [worldId, isAuthenticated]);

  useEffect(() => { refresh(); }, [refresh]);

  const applyWorldId = useCallback(() => {
    const next = worldIdDraft.trim() || 'concordia-hub';
    setWorldId(next);
    if (typeof window !== 'undefined') localStorage.setItem('concordia:activeWorldId', next);
  }, [worldIdDraft]);

  const spawn = useCallback(async () => {
    const result = await spawnFeedback.dispatch('garage', 'spawn', {
      worldId,
      kind: spawnKind,
      ownerKind: 'player',
    });
    if (result) {
      await refresh();
      setTab('mine');
    }
  }, [spawnFeedback, worldId, spawnKind, refresh]);

  const activeFleet = tab === 'world' ? worldFleet : myFleet;
  const filteredFleet = useMemo(() => {
    if (!activeFleet) return [];
    return filterKind === 'all' ? activeFleet : activeFleet.filter((v) => v.kind === filterKind);
  }, [activeFleet, filterKind]);

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = { cart: 0, boat: 0, canal_taxi: 0 };
    (worldFleet ?? []).forEach((v) => { counts[v.kind] = (counts[v.kind] ?? 0) + 1; });
    return counts;
  }, [worldFleet]);

  const columns: DataTableColumn<Vehicle>[] = useMemo(() => [
    {
      id: 'kind',
      header: 'Kind',
      sortable: true,
      accessor: (v) => {
        const Icon = KIND_ICON[v.kind] ?? Car;
        return (
          <span className="inline-flex items-center gap-1.5 capitalize">
            <Icon className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
            {v.kind.replace('_', ' ')}
          </span>
        );
      },
      sortValue: (v) => v.kind,
    },
    {
      id: 'owner',
      header: 'Owner',
      monospace: true,
      accessor: (v) => `${v.owner_kind}${v.owner_id ? `:${v.owner_id.slice(0, 8)}` : ''}`,
      sortValue: (v) => v.owner_kind,
      sortable: true,
    },
    {
      id: 'capacity',
      header: 'Capacity',
      align: 'right',
      monospace: true,
      sortable: true,
      accessor: (v) => v.capacity,
      sortValue: (v) => v.capacity,
    },
    {
      id: 'fare',
      header: 'Fare',
      align: 'right',
      monospace: true,
      sortable: true,
      accessor: (v) => (v.fare_cc > 0 ? `${v.fare_cc} cc` : '—'),
      sortValue: (v) => v.fare_cc,
    },
    {
      id: 'position',
      header: 'Position',
      align: 'right',
      monospace: true,
      accessor: (v) => (v.pos_x != null ? `(${v.pos_x.toFixed(0)}, ${(v.pos_z ?? 0).toFixed(0)})` : '—'),
    },
  ], []);

  const spawnDisabled = spawnFeedback.status === 'dispatched' || spawnFeedback.status === 'running' || !isAuthenticated;

  return (
    <LensShell lensId="garage">
      <div className="mx-auto max-w-5xl space-y-5 p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className={cn(ds.heading1, 'flex items-center gap-2')}>
              <Car className="h-6 w-6 text-amber-300" aria-hidden="true" /> Garage
            </h1>
            <p className={ds.textMuted}>Fleet browser, spawn depot, and inspector for world vehicles.</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusDot state={loading ? 'connecting' : error ? 'error' : 'live'} showLabel label={loading ? 'Loading' : error ? 'Error' : 'Synced'} />
            <button type="button" onClick={refresh} className={cn(ds.btnSecondary, 'p-2')} aria-label="Refresh fleet data">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Honest world-owned bridge — driving lives in the 3D world, not here. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3">
          <p className="text-xs text-amber-100/80 max-w-2xl">
            <MapPinned className="inline h-3.5 w-3.5 -mt-0.5 mr-1" aria-hidden="true" />
            This page manages your fleet — browsing, inspecting, and spawning. Boarding, driving,
            and parking a vehicle happen live in the 3D world: walk up to one and press{' '}
            <kbd className="rounded bg-black/40 px-1 py-0.5 font-mono">E</kbd>.
          </p>
          <Link href="/lenses/world" className={cn(ds.btnSecondary, 'text-xs py-1.5 shrink-0')}>
            Open World Lens →
          </Link>
        </div>

        {/* World selector + stats */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-end gap-2">
            <div>
              <label htmlFor="garage-world-id" className={ds.label}>World</label>
              <input
                id="garage-world-id"
                value={worldIdDraft}
                onChange={(e) => setWorldIdDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyWorldId(); }}
                className={cn(ds.input, 'w-48 py-1.5 text-sm')}
              />
            </div>
            <button type="button" onClick={applyWorldId} className={cn(ds.btnSecondary, 'text-xs py-2')}>
              Go
            </button>
          </div>
          <StatTileGrid columns={4} className="flex-1 max-w-md">
            <StatTile label="Total" value={(worldFleet ?? []).length} size="sm" />
            <StatTile label="Carts" value={kindCounts.cart ?? 0} size="sm" />
            <StatTile label="Boats" value={kindCounts.boat ?? 0} size="sm" />
            <StatTile label="Canal taxis" value={kindCounts.canal_taxi ?? 0} size="sm" />
          </StatTileGrid>
        </div>

        {/* Spawn depot */}
        <div className="rounded-lg border border-lattice-border bg-lattice-surface p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-end gap-2">
              <div>
                <label htmlFor="garage-spawn-kind" className={ds.label}>Spawn a vehicle</label>
                <select
                  id="garage-spawn-kind"
                  value={spawnKind}
                  onChange={(e) => setSpawnKind(e.target.value)}
                  className={cn(ds.select, 'w-40 py-1.5 text-sm')}
                >
                  {SPAWNABLE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <button
                type="button"
                onClick={spawn}
                disabled={spawnDisabled}
                className={cn(ds.btnPrimary, 'py-1.5 text-sm gap-1.5')}
              >
                {spawnFeedback.status === 'dispatched' || spawnFeedback.status === 'running'
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <Plus className="h-4 w-4" aria-hidden="true" />}
                {spawnFeedback.status === 'running' ? 'Spawning…' : 'Spawn'}
              </button>
            </div>
            {!isAuthenticated && !authLoading && (
              <p className={ds.caption}>Sign in to spawn and own vehicles.</p>
            )}
            {spawnFeedback.status === 'done' && spawnFeedback.result && (
              <p className="text-xs text-emerald-300">
                Spawned {spawnFeedback.result.kind} <span className={ds.monoXs}>{spawnFeedback.result.vehicleId.slice(0, 14)}</span>
                {spawnFeedback.ms != null ? ` · ${spawnFeedback.ms}ms` : ''}
              </p>
            )}
          </div>
          {spawnFeedback.status === 'error' && (
            <div className="mt-2">
              <ErrorState message={spawnFeedback.error || 'spawn failed'} variant="inline" />
            </div>
          )}
          <p className={cn(ds.caption, 'mt-2')}>
            canal_taxi needs an authored route and isn&rsquo;t free-spawnable — it&rsquo;s listed in the
            filter below because it can still exist in the world.
          </p>
        </div>

        {/* Fleet tabs */}
        <div>
          <div className={ds.tabBar} role="tablist" aria-label="Fleet scope">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'world'}
              onClick={() => setTab('world')}
              className={tab === 'world' ? ds.tabActive('amber-300') : ds.tabInactive}
            >
              World fleet ({(worldFleet ?? []).length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'mine'}
              onClick={() => setTab('mine')}
              className={tab === 'mine' ? ds.tabActive('amber-300') : ds.tabInactive}
            >
              My fleet {myFleet ? `(${myFleet.length})` : ''}
            </button>
            <select
              value={filterKind}
              onChange={(e) => setFilterKind(e.target.value)}
              aria-label="Filter by vehicle kind"
              className={cn(ds.select, 'ml-auto my-1.5 w-36 py-1 text-xs')}
            >
              <option value="all">All kinds</option>
              {VEHICLE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
        </div>

        {/* Body: table + inspector */}
        <div className={cn('grid gap-4', selectedVehicleId ? 'md:grid-cols-[1fr_20rem]' : 'grid-cols-1')}>
          <div>
            {error && (
              <ErrorState message={error} onRetry={refresh} title="Couldn't load garage data" />
            )}

            {!error && loading && (
              <div className="rounded-lg border border-lattice-border bg-lattice-surface overflow-hidden">
                <SkeletonTableRows rows={5} columns={5} />
              </div>
            )}

            {!error && !loading && tab === 'mine' && !isAuthenticated && (
              <EmptyState
                icon={<Car className="h-5 w-5" aria-hidden="true" />}
                title="Sign in to see your fleet"
                description="Vehicles you spawn are owned by your account and follow you between worlds like the rest of your inventory."
              />
            )}

            {!error && !loading && (tab === 'world' || isAuthenticated) && filteredFleet.length === 0 && (
              <EmptyState
                icon={<Car className="h-5 w-5" aria-hidden="true" />}
                title={tab === 'world' ? 'No vehicles in this world yet' : 'You don’t own any vehicles yet'}
                description={
                  tab === 'world'
                    ? `No ${filterKind === 'all' ? '' : `${filterKind} `}vehicles are spawned in ${worldId}.`
                    : 'Spawn one above to start your fleet.'
                }
              />
            )}

            {!error && !loading && (tab === 'world' || isAuthenticated) && filteredFleet.length > 0 && (
              <DataTable
                columns={columns}
                rows={filteredFleet}
                getRowId={(v) => v.id}
                onRowClick={(v) => setSelectedVehicleId(v.id)}
                onRowActivate={(v) => setSelectedVehicleId(v.id)}
                selectedRowId={selectedVehicleId}
                caption={`${tab === 'world' ? 'World' : 'My'} fleet in ${worldId}`}
              />
            )}
          </div>

          {selectedVehicleId && (
            <VehicleInspectorPanel
              vehicleId={selectedVehicleId}
              onClose={() => setSelectedVehicleId(null)}
            />
          )}
        </div>
      </div>
    </LensShell>
  );
}
