'use client';

import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LogisticsChatter } from '@/components/logistics/LogisticsChatter';
import ShipmentTracker from '@/components/logistics/ShipmentTracker';
import RouteOptimizer from '@/components/logistics/RouteOptimizer';
import WarehouseInventory from '@/components/logistics/WarehouseInventory';
import ShipmentsPanel from '@/components/logistics/ShipmentsPanel';
import CarriersPanel from '@/components/logistics/CarriersPanel';
import RateQuoter from '@/components/logistics/RateQuoter';
import PickupsPanel from '@/components/logistics/PickupsPanel';
import DockAppointmentsPanel from '@/components/logistics/DockAppointmentsPanel';
import FleetVehiclesPanel from '@/components/logistics/FleetVehiclesPanel';
import LoadBoardPanel from '@/components/logistics/LoadBoardPanel';
import DeliveryProofPanel from '@/components/logistics/DeliveryProofPanel';
import ShipmentEventsTimeline from '@/components/logistics/ShipmentEventsTimeline';
import { ComplianceReportsPanel } from '@/components/logistics/ComplianceReportsPanel';
import { VisibilityTower } from '@/components/logistics/VisibilityTower';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import {
  Truck as MTabTruck, Package as MTabShip,
  Warehouse as MTabWh, MapPin as MTabRoute, ShieldCheck as MTabCompliance,
} from 'lucide-react';
import { useState, useMemo, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { LensPageShell } from '@/components/lens/LensPageShell';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/ui';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import LiveFeed from '@/components/lens/LiveFeed';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import {
  Truck,
  Package,
  Warehouse,
  Route,
  ShieldCheck,
  Navigation,
  AlertTriangle,
  CheckCircle,
  DollarSign,
  Gauge,
  Activity,
  Map,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ModeTab = 'fleet' | 'shipments' | 'tracker' | 'warehouse' | 'routes' | 'compliance' | 'map';

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Truck }[] = [
  { id: 'fleet', label: 'Fleet', icon: Truck },
  { id: 'shipments', label: 'Shipments', icon: Package },
  { id: 'tracker', label: 'Tracker', icon: Navigation },
  { id: 'warehouse', label: 'Warehouse', icon: Warehouse },
  { id: 'routes', label: 'Routes', icon: Route },
  { id: 'compliance', label: 'Compliance', icon: ShieldCheck },
  { id: 'map', label: 'Map', icon: Map },
];

interface DashboardSummary {
  totalShipments: number;
  inTransit: number;
  deliveredToday: number;
  exceptions: number;
  onTimePct: number;
  carrierCount: number;
  vehicles: number;
  vehiclesInUse: number;
  pickupsToday: number;
  dockCount: number;
  loadsAvailable: number;
  loadsBooked: number;
}

const EMPTY_SUMMARY: DashboardSummary = {
  totalShipments: 0,
  inTransit: 0,
  deliveredToday: 0,
  exceptions: 0,
  onTimePct: 100,
  carrierCount: 0,
  vehicles: 0,
  vehiclesInUse: 0,
  pickupsToday: 0,
  dockCount: 0,
  loadsAvailable: 0,
  loadsBooked: 0,
};

interface MapVehicle {
  id: string;
  number: string;
  status: string;
  lat: number | null;
  lng: number | null;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Stat card for dashboard */
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'text-neon-cyan',
}: {
  icon: typeof Truck;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className={ds.panel}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn('w-4 h-4', color)} />
        <span className={ds.textMuted}>{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className={cn(ds.textMuted, 'text-xs mt-0.5')}>{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function LogisticsLensPage() {
  const [mode, setMode] = useState<ModeTab>('fleet');
  // Live BTS + DOT transit feed.
  const { latestData: realtimeData, isLive, lastUpdated } = useRealtimeLens('logistics');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-fleet', keys: 'f', description: 'Fleet', category: 'navigation', action: () => setMode('fleet') },
      { id: 'tab-shipments', keys: 's', description: 'Shipments', category: 'navigation', action: () => setMode('shipments') },
      { id: 'tab-tracker', keys: 't', description: 'Tracker', category: 'navigation', action: () => setMode('tracker') },
      { id: 'tab-warehouse', keys: 'w', description: 'Warehouse', category: 'navigation', action: () => setMode('warehouse') },
      { id: 'tab-routes', keys: 'r', description: 'Routes', category: 'navigation', action: () => setMode('routes') },
      { id: 'tab-compliance', keys: 'c', description: 'Compliance', category: 'navigation', action: () => setMode('compliance') },
      { id: 'tab-map', keys: 'm', description: 'Map', category: 'navigation', action: () => setMode('map') },
    ],
    { lensId: 'logistics' }
  );

  // Real dashboard KPIs — server-computed via logistics.dashboard-summary.
  // Previously this whole page ran a parallel fabricated generic-artifact
  // CRUD store (useLensData/useRunArtifact against Vehicle/Driver/Shipment/
  // WarehouseItem/Route/ComplianceLog "artifact types" with no backing
  // macro), which duplicated — with fake local data — everything the real
  // logistics.* macros below already do for real. Removed in favor of the
  // real macro-backed panels this page already mounted alongside it.
  const {
    data: summary,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<DashboardSummary>({
    queryKey: ['logistics', 'dashboard-summary'],
    queryFn: async () => {
      const res = await lensRun('logistics', 'dashboard-summary', {});
      if (!res.data?.ok) throw new Error(res.data?.error || 'Failed to load dashboard summary');
      return res.data.result as DashboardSummary;
    },
    staleTime: 15000,
  });
  const s = summary || EMPTY_SUMMARY;

  // Fleet vehicle geolocation for the Map tab — real fleet-vehicles-list
  // (each vehicle carries an optional lat/lng set via fleet-vehicles-update-status).
  const {
    data: mapVehicles,
    isError: isMapError,
    error: mapError,
    refetch: refetchMap,
  } = useQuery<MapVehicle[]>({
    queryKey: ['logistics', 'map-vehicles'],
    queryFn: async () => {
      const res = await lensRun('logistics', 'fleet-vehicles-list', {});
      if (res.data?.ok === false) throw new Error(res.data?.error || 'Could not load fleet vehicles.');
      return (res.data?.result?.vehicles || []) as MapVehicle[];
    },
    enabled: mode === 'map',
    staleTime: 15000,
  });

  return (
    <LensShell lensId="logistics" asMain={false}>
      <FirstRunTour lensId="logistics" />
      <DepthBadge lensId="logistics" size="sm" className="ml-2" />
      <div className="px-4 mt-2">
        <ShellPreview lensId="logistics" defaultOpen={true} />
        <TmsWorkbenchSection />
        <VisibilityTower />
      </div>
    <LensPageShell
      domain="logistics"
      title="Transportation &amp; Logistics"
      description="Fleet, shipments, warehouse, routes, and compliance management"
      headerIcon={<Truck className="w-6 h-6 text-neon-cyan" />}
      isLoading={isLoading}
      isError={isError}
      error={error as Error | null}
      onRetry={refetch}
      actions={<LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />}
    >
      {/* Transit Wire — BTS + DOT live press feed */}
      <LiveFeed
        articles={(realtimeData as { articles?: Array<Record<string, unknown>> } | null)?.articles as React.ComponentProps<typeof LiveFeed>['articles']}
        domain="logistics"
        isLive={isLive}
        lastUpdated={lastUpdated}
        limit={10}
        className="mb-4"
      />

      {/* Dashboard KPIs — logistics.dashboard-summary, real */}
      <div className={ds.grid4}>
        <StatCard icon={Package} label="Total Shipments" value={s.totalShipments} />
        <StatCard
          icon={Truck}
          label="In Transit"
          value={s.inTransit}
          color="text-neon-purple"
        />
        <StatCard icon={CheckCircle} label="On-Time Rate" value={`${s.onTimePct}%`} color="text-green-400" />
        <StatCard
          icon={Warehouse}
          label="Fleet Vehicles"
          value={`${s.vehiclesInUse}/${s.vehicles}`}
          sub="in use / total"
          color="text-amber-400"
        />
      </div>
      <div className={ds.grid4}>
        <StatCard icon={AlertTriangle} label="Exceptions" value={s.exceptions} color="text-red-400" />
        <StatCard icon={Gauge} label="Delivered Today" value={s.deliveredToday} />
        <StatCard icon={DollarSign} label="Loads Available" value={s.loadsAvailable} sub={`${s.loadsBooked} booked`} />
        <StatCard icon={ShieldCheck} label="Dock Locations" value={s.dockCount} />
      </div>

      {/* AI Actions */}
      <UniversalActions domain="logistics" artifactId={undefined} compact />

      {/* Mode Tabs */}
      <nav className="flex items-center gap-1 border-b border-lattice-border pb-3 flex-wrap">
        {MODE_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setMode(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                mode === tab.id
                  ? 'bg-neon-cyan/20 text-neon-cyan'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Tab Content — every tab mounts a real macro-backed component */}
      <div className="pt-2">
        {mode === 'fleet' && <FleetVehiclesPanel />}
        {mode === 'shipments' && <ShipmentsPanel />}
        {mode === 'tracker' && <ShipmentTracker />}
        {mode === 'warehouse' && <WarehouseInventory />}
        {mode === 'routes' && <RouteOptimizer />}
        {mode === 'compliance' && <ComplianceReportsPanel />}
        {mode === 'map' && (
          <div className={ds.panel}>
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Map className="w-4 h-4 text-neon-cyan" /> Fleet Map
            </h3>
            {isMapError ? (
              <ErrorState message={(mapError as Error | null)?.message || 'Could not load fleet vehicles.'} onRetry={() => void refetchMap()} />
            ) : (
              <>
            <MapView
              markers={(mapVehicles || [])
                .filter((v) => v.lat != null && v.lng != null)
                .map((v) => ({
                  lat: v.lat as number,
                  lng: v.lng as number,
                  label: v.number,
                  popup: v.status,
                }))}
              className="h-[500px]"
            />
            {(mapVehicles || []).filter((v) => v.lat != null && v.lng != null).length === 0 && (
              <p className={cn(ds.textMuted, 'text-center py-4')}>
                No vehicle GPS positions yet — positions are set via fleet dispatch status updates.
              </p>
            )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Recent Activity Feed — driven by real shipment events */}
      <LogisticsActivityFeed />

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <LogisticsChatter />
      </section>
    </LensPageShell>

      <a href="#logistics-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to logistics content</a>
          <RecentMineCard domain="logistics" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="logistics" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="logistics" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
          {/* Phase 12 (Item 5) — mobile thumb-reachable tab bar. */}
          <MobileTabBar
            tabs={[
              { id: 'fleet',      label: 'Fleet',  icon: MTabTruck },
              { id: 'shipments',  label: 'Ship',   icon: MTabShip },
              { id: 'warehouse',  label: 'WH',     icon: MTabWh },
              { id: 'routes',     label: 'Routes', icon: MTabRoute },
              { id: 'compliance', label: 'Comp',   icon: MTabCompliance },
            ]}
            active={mode}
            onSelect={(id) => setMode(id as ModeTab)}
          />
    </LensShell>
  );
}

/* ------------------------------------------------------------------ */
/*  FedEx / Project44 / SAP TMS-parity workbench section                */
/* ------------------------------------------------------------------ */

function TmsWorkbenchSection() {
  const [active, setActive] = useState<'shipments' | 'carriers' | 'rates' | 'pickups' | 'docks' | 'fleet' | 'loads' | 'pod' | 'events'>('shipments');
  const TABS = [
    { id: 'shipments', label: 'Shipments' },
    { id: 'carriers', label: 'Carriers' },
    { id: 'rates', label: 'Rate quoter' },
    { id: 'pickups', label: 'Pickups' },
    { id: 'docks', label: 'Dock appts' },
    { id: 'fleet', label: 'Fleet' },
    { id: 'loads', label: 'Load board' },
    { id: 'pod', label: 'POD' },
    { id: 'events', label: 'EDI events' },
  ] as const;
  return (
    <section className="mt-6 space-y-3">
      <h2 className="text-sm font-semibold text-cyan-300 uppercase tracking-wider">FedEx/Project44-parity workbench</h2>
      <nav className="flex items-center gap-1 border-b border-cyan-900/30 pb-2 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={
              'px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition ' +
              (active === t.id
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/20'
                : 'text-gray-400 hover:text-cyan-300 hover:bg-cyan-900/10 border border-transparent')
            }
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div>
        {active === 'shipments' && <ShipmentsPanel />}
        {active === 'carriers' && <CarriersPanel />}
        {active === 'rates' && <RateQuoter />}
        {active === 'pickups' && <PickupsPanel />}
        {active === 'docks' && <DockAppointmentsPanel />}
        {active === 'fleet' && <FleetVehiclesPanel />}
        {active === 'loads' && <LoadBoardPanel />}
        {active === 'pod' && <DeliveryProofPanel />}
        {active === 'events' && <ShipmentEventsTimeline />}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Recent Activity — real shipment-event + milestone stream          */
/* ------------------------------------------------------------------ */

interface ActivityEvent {
  id: string;
  kind: string;
  shipmentId: string;
  timestamp: string;
  location?: string;
}

function LogisticsActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [milestones, setMilestones] = useState<
    Array<{ id: string; kind: string; shipmentId: string; geofenceName: string; at: string }>
  >([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { lensRun } = await import('@/lib/api/client');
      const [ev, ms] = await Promise.all([
        lensRun('logistics', 'shipment-events', {}),
        lensRun('logistics', 'milestones-list', {}),
      ]);
      if (ev.data?.ok) setEvents((ev.data.result?.events || []) as ActivityEvent[]);
      if (ms.data?.ok)
        setMilestones(
          (ms.data.result?.milestones || []) as Array<{
            id: string;
            kind: string;
            shipmentId: string;
            geofenceName: string;
            at: string;
          }>
        );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const merged = useMemo(() => {
    const rows = [
      ...events.map((e) => ({
        id: e.id,
        at: e.timestamp,
        text: `Shipment ${e.shipmentId} — ${e.kind.replace(/_/g, ' ')}${e.location ? ` at ${e.location}` : ''}`,
      })),
      ...milestones.map((m) => ({
        id: m.id,
        at: m.at,
        text: `Shipment ${m.shipmentId} ${m.kind} ${m.geofenceName}`,
      })),
    ];
    return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 12);
  }, [events, milestones]);

  return (
    <section>
      <h2 className={cn(ds.heading2, 'mb-3')}>Recent Activity</h2>
      <div className={ds.panel}>
        {loading ? (
          <p className={cn(ds.textMuted, 'text-center py-6')}>Loading activity…</p>
        ) : merged.length === 0 ? (
          <p className={cn(ds.textMuted, 'text-center py-6')}>
            No activity yet — shipment status changes and geofence milestones appear here.
          </p>
        ) : (
          <div className="divide-y divide-lattice-border">
            {merged.map((row) => (
              <div key={row.id} data-lens-theme="logistics" className="flex items-center gap-3 py-3 px-2">
                <Activity className="w-4 h-4 shrink-0 text-neon-cyan" />
                <span className="flex-1 text-sm text-gray-200">{row.text}</span>
                <span className={cn(ds.textMuted, 'shrink-0')}>
                  {new Date(row.at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
