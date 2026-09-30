'use client';

/**
 * Logistics — one TMS / fleet ops app.
 * Thin shell + single `active` union. Accordion workbench/visibility folded into tabs.
 */

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ShellPreview } from '@/components/lens/ShellPreview';
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
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Truck, Package, Warehouse, Route, ShieldCheck, Navigation, Map, LayoutGrid, TowerControl,
  Truck as MTabTruck, Package as MTabShip, Warehouse as MTabWh, MapPin as MTabRoute, ShieldCheck as MTabCompliance,
} from 'lucide-react';

type LogView =
  | 'fleet' | 'shipments' | 'tracker' | 'warehouse' | 'routes' | 'compliance' | 'map'
  | 'workbench' | 'visibility';

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
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<LogView>('fleet');
  const { latestData: realtimeData, isLive, lastUpdated } = useRealtimeLens('logistics');
  const { data: summary, isLoading, isError, error, refetch } = useDashboardSummary();

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
      <div data-lens-theme="logistics" className={cn(ds.pageContainer, 'pb-20 lg:pb-6')}>
        <ShellPreview lensId="logistics" defaultOpen={true} />

        <header className={cn(ds.sectionHeader, 'gap-3 flex-wrap')}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-md bg-[var(--lens-accent)]/20 flex items-center justify-center shrink-0">
              <Truck className="w-5 h-5 text-neon-cyan" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Transportation &amp; Logistics</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              </div>
              <p className={ds.textMuted}>Fleet, shipments, warehouse, routes, and compliance</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
          </div>
        </header>

        <LiveFeed
          articles={(realtimeData as { articles?: Array<Record<string, unknown>> } | null)?.articles as React.ComponentProps<typeof LiveFeed>['articles']}
          domain="logistics"
          isLive={isLive}
          lastUpdated={lastUpdated}
          limit={10}
          className="mb-4"
        />

        {!isLoading && <DashboardKpisPanel summary={summary} />}

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto mt-4"
          aria-label="Logistics views"
        >
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on
                    ? 'border-[var(--lens-accent)] text-white'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {v.label}
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
            className="pt-4"
          >
            {active === 'fleet' && <FleetVehiclesPanel />}
            {active === 'shipments' && <ShipmentsPanel />}
            {active === 'tracker' && <ShipmentTracker />}
            {active === 'warehouse' && <WarehouseInventory />}
            {active === 'routes' && <RouteOptimizer />}
            {active === 'compliance' && <ComplianceReportsPanel />}
            {active === 'map' && <FleetMapPanel />}
            {active === 'workbench' && <TmsWorkbenchPanel />}
            {active === 'visibility' && <VisibilityPanel />}
          </motion.div>
        </AnimatePresence>

        <div className="mt-6">
          <ActivityFeedPanel />
        </div>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <LogisticsChatter />
        </section>

        <CrossLensRecentsPanel lensId="logistics" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>

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
