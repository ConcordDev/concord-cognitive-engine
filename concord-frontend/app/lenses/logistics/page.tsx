'use client';

/**
 * Logistics — one TMS / fleet ops app.
 * Thin shell + single `active` union. Accordion workbench/visibility folded into tabs.
 */

import { useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { LogisticsChatter } from '@/components/logistics/LogisticsChatter';
import ShipmentTracker from '@/components/logistics/ShipmentTracker';
import RouteOptimizer from '@/components/logistics/RouteOptimizer';
import WarehouseInventory from '@/components/logistics/WarehouseInventory';
import ShipmentsPanel from '@/components/logistics/ShipmentsPanel';
import FleetVehiclesPanel from '@/components/logistics/FleetVehiclesPanel';
import { ComplianceReportsPanel } from '@/components/logistics/ComplianceReportsPanel';
import { DashboardKpisPanel, useDashboardSummary } from '@/components/logistics/DashboardKpisPanel';
import { FleetMapPanel } from '@/components/logistics/FleetMapPanel';
import { ActivityFeedPanel } from '@/components/logistics/ActivityFeedPanel';
import { TmsWorkbenchPanel } from '@/components/logistics/TmsWorkbenchPanel';
import { VisibilityPanel } from '@/components/logistics/VisibilityPanel';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import LiveFeed from '@/components/lens/LiveFeed';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import {
  Truck, Package, Warehouse, Route, ShieldCheck, Navigation, Map, LayoutGrid, TowerControl, Plus,
  Truck as MTabTruck, Package as MTabShip, Warehouse as MTabWh, MapPin as MTabRoute, ShieldCheck as MTabCompliance,
} from 'lucide-react';

type LogView =
  | 'fleet' | 'shipments' | 'tracker' | 'warehouse' | 'routes' | 'compliance' | 'map'
  | 'workbench' | 'visibility';

const TITLES: Record<LogView, string> = {
  fleet: 'Run the fleet',
  shipments: 'Move the freight',
  tracker: 'Track every load',
  warehouse: 'Count the stock',
  routes: 'Plan the routes',
  compliance: 'Stay compliant',
  map: 'See the fleet',
  workbench: 'Work the TMS desk',
  visibility: 'See the whole chain',
};

const VIEWS: { id: LogView; label: string; keys: string; icon: typeof Truck }[] = [
  { id: 'fleet', label: 'Fleet', keys: 'f', icon: Truck },
  { id: 'shipments', label: 'Shipments', keys: 's', icon: Package },
  { id: 'tracker', label: 'Tracker', keys: 't', icon: Navigation },
  { id: 'warehouse', label: 'Warehouse', keys: 'w', icon: Warehouse },
  { id: 'routes', label: 'Routes', keys: 'r', icon: Route },
  { id: 'compliance', label: 'Compliance', keys: 'c', icon: ShieldCheck },
  { id: 'map', label: 'Map', keys: 'm', icon: Map },
  { id: 'workbench', label: 'TMS desk', keys: 'x', icon: LayoutGrid },
  { id: 'visibility', label: 'Visibility', keys: 'v', icon: TowerControl },
];

export default function LogisticsLensPage() {
  useLensNav('logistics');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<LogView>('fleet');
  const { latestData: realtimeData, isLive, lastUpdated } = useRealtimeLens('logistics');
  const { data: summary, isLoading, isError, refetch } = useDashboardSummary();

  useLensCommand(
    VIEWS.map((v) => ({
      id: `tab-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'logistics' },
  );

  return (
    <LensShell lensId="logistics" asMain={false}>
      <FirstRunTour lensId="logistics" />
      <DepthBadge lensId="logistics" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="logistics"
        crumb="Logistics"
        title={`${TITLES[active]}${active === 'fleet' && who ? `, ${who}` : ''}`}
        subtitle="Fleet, shipments, warehouse, routes, and compliance"
        actions={(
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            {isError && (
              <button type="button" onClick={() => void refetch()} className="text-xs text-rose-300 underline">
                Retry KPIs
              </button>
            )}
            <DTUExportButton
              domain="logistics"
              data={realtimeData || {}}
              title="Logistics snapshot"
              tags={['logistics', 'tms', 'export']}
              compact
            />
          </>
        )}
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys }))}
        activeTab={active}
        onTab={(id) => setActive(id as LogView)}
        tabsLabel="Logistics views"
        cta={{ label: 'New shipment', icon: Plus, onClick: () => setActive('shipments'), title: 'Open the shipments desk' }}
      >
        <LiveFeed
          articles={(realtimeData as { articles?: Array<Record<string, unknown>> } | null)?.articles as React.ComponentProps<typeof LiveFeed>['articles']}
          domain="logistics"
          isLive={isLive}
          lastUpdated={lastUpdated}
          limit={10}
          className="mb-4"
        />

        {!isLoading && <DashboardKpisPanel summary={summary} />}

        <div className="pt-4">
          {active === 'fleet' && <FleetVehiclesPanel />}
          {active === 'shipments' && <ShipmentsPanel />}
          {active === 'tracker' && <ShipmentTracker />}
          {active === 'warehouse' && <WarehouseInventory />}
          {active === 'routes' && <RouteOptimizer />}
          {active === 'compliance' && <ComplianceReportsPanel />}
          {active === 'map' && <FleetMapPanel />}
          {active === 'workbench' && <TmsWorkbenchPanel />}
          {active === 'visibility' && <VisibilityPanel />}
        </div>

        <div className="mt-6">
          <ActivityFeedPanel />
        </div>

        <section className="mt-6 rounded-2xl border border-white/10 bg-[#111] p-4">
          <LogisticsChatter />
        </section>
      </NorthStarFrame>

      <MobileTabBar
        tabs={[
          { id: 'fleet', label: 'Fleet', icon: MTabTruck },
          { id: 'shipments', label: 'Ship', icon: MTabShip },
          { id: 'warehouse', label: 'WH', icon: MTabWh },
          { id: 'routes', label: 'Routes', icon: MTabRoute },
          { id: 'compliance', label: 'Comp', icon: MTabCompliance },
        ]}
        active={active}
        onSelect={(id) => setActive(id as LogView)}
      />
    </LensShell>
  );
}
