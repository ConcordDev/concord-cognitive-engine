'use client';

import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManufacturingFeed } from '@/components/manufacturing/ManufacturingFeed';
import { ManufacturingActionPanel } from '@/components/manufacturing/ManufacturingActionPanel';
import { ShopFloorToolsPanel } from '@/components/manufacturing/ShopFloorToolsPanel';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import {
  Gauge as MTabOEE, ClipboardList as MTabWO, ShieldCheck as MTabQC,
  Factory as MTabFloor, Wrench as MTabTools,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { PipingProvider } from '@/components/panel-polish';
import OEEDashboard from '@/components/manufacturing/OEEDashboard';
import WorkOrderBoard from '@/components/manufacturing/WorkOrderBoard';
import QualitySPC from '@/components/manufacturing/QualitySPC';
import ShopFloorSuite from '@/components/manufacturing/ShopFloorSuite';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LensPageShell } from '@/components/lens/LensPageShell';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import LiveFeed from '@/components/lens/LiveFeed';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import {
  Cog,
  Gauge,
  ClipboardList,
  ShieldCheck,
  Factory,
  Wrench,
  Siren,
  AlertOctagon,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ModeTab = 'oeeBoard' | 'woBoard' | 'spc' | 'shopFloor' | 'tools';

const MODE_TABS: { id: ModeTab; label: string; icon: typeof Cog }[] = [
  { id: 'oeeBoard', label: 'OEE Board', icon: Gauge },
  { id: 'woBoard', label: 'Work Orders', icon: ClipboardList },
  { id: 'spc', label: 'Quality / SPC', icon: ShieldCheck },
  { id: 'shopFloor', label: 'Shop Floor', icon: Factory },
  { id: 'tools', label: 'Tools', icon: Wrench },
];

interface MfgKpis {
  machineCount: number;
  runningCount: number;
  workOrderCount: number;
  andonOpenCount: number;
  andonCriticalCount: number;
  ncrOpenCount: number;
}

const EMPTY_KPIS: MfgKpis = {
  machineCount: 0,
  runningCount: 0,
  workOrderCount: 0,
  andonOpenCount: 0,
  andonCriticalCount: 0,
  ncrOpenCount: 0,
};

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'text-neon-purple',
}: {
  icon: typeof Cog;
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
export default function ManufacturingLensPage() {
  const [mode, setMode] = useState<ModeTab>('shopFloor');
  const [showFeed, setShowFeed] = useState(false);
  const [showActionPanel, setShowActionPanel] = useState(false);
  const { latestData: realtimeData, isLive, lastUpdated } = useRealtimeLens('manufacturing');

  useLensCommand(
    [
      { id: 'tab-oee', keys: 'o', description: 'OEE Board', category: 'navigation', action: () => setMode('oeeBoard') },
      { id: 'tab-wo', keys: 'w', description: 'Work Orders', category: 'navigation', action: () => setMode('woBoard') },
      { id: 'tab-spc', keys: 'q', description: 'Quality / SPC', category: 'navigation', action: () => setMode('spc') },
      { id: 'tab-shopfloor', keys: 's', description: 'Shop Floor', category: 'navigation', action: () => setMode('shopFloor') },
      { id: 'tab-tools', keys: 't', description: 'Tools', category: 'navigation', action: () => setMode('tools') },
    ],
    { lensId: 'manufacturing' }
  );

  // Real dashboard KPIs — aggregated client-side from real manufacturing.*
  // macros (there is no single manufacturing.dashboard-summary macro).
  // Previously this page ran a parallel fabricated generic-artifact CRUD
  // store (useLensData/useRunArtifact against WorkOrder/BOM/QCInspection/
  // Schedule/Machine/SafetyItem "artifact types" with no backing macro),
  // duplicating — with fake local data — the real MES surface this lens
  // already mounted alongside it (OEEDashboard/WorkOrderBoard/QualitySPC/
  // ShopFloorSuite). Removed in favor of the real macro-backed panels.
  const { data: kpis, isLoading, isError, error, refetch } = useQuery<MfgKpis>({
    queryKey: ['manufacturing', 'kpis'],
    queryFn: async () => {
      const [oee, wo, andon, ncr] = await Promise.all([
        lensRun('manufacturing', 'oee-status', {}),
        lensRun('manufacturing', 'work-orders', {}),
        lensRun('manufacturing', 'andon-board', {}),
        lensRun('manufacturing', 'ncr-list', {}),
      ]);
      if (oee.data?.ok === false || wo.data?.ok === false || andon.data?.ok === false || ncr.data?.ok === false) {
        throw new Error(
          oee.data?.error || wo.data?.error || andon.data?.error || ncr.data?.error || 'Could not load manufacturing KPIs.'
        );
      }
      const machines = (oee.data?.result?.machines || []) as Array<{ status?: string }>;
      return {
        machineCount: machines.length,
        runningCount: machines.filter((m) => m.status === 'running').length,
        workOrderCount: ((wo.data?.result?.orders || []) as unknown[]).length,
        andonOpenCount: Number(andon.data?.result?.openCount) || 0,
        andonCriticalCount: Number(andon.data?.result?.criticalOpen) || 0,
        ncrOpenCount: Number(ncr.data?.result?.openCount) || 0,
      };
    },
    staleTime: 15000,
  });
  const k = kpis || EMPTY_KPIS;

  return (
    <LensShell lensId="manufacturing" asMain={false}>
      <FirstRunTour lensId="manufacturing" />
      <DepthBadge lensId="manufacturing" size="sm" className="ml-2" />
    <LensPageShell
      domain="manufacturing"
      title="Manufacturing"
      description="OEE, work orders, quality/SPC, and shop-floor execution (MES)"
      headerIcon={<Cog className="w-6 h-6 text-neon-purple" />}
      isLoading={isLoading}
      isError={isError}
      error={error as Error | null}
      onRetry={refetch}
      actions={<LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />}
    >
      {/* Industry Wire — BLS PPI + Federal Reserve G.17 live feed */}
      <LiveFeed
        articles={(realtimeData as { articles?: Array<Record<string, unknown>> } | null)?.articles as React.ComponentProps<typeof LiveFeed>['articles']}
        domain="manufacturing"
        isLive={isLive}
        lastUpdated={lastUpdated}
        limit={10}
        className="mb-4"
      />

      {/* Dashboard KPIs — real manufacturing.* macros, aggregated client-side */}
      <div className={ds.grid4}>
        <StatCard icon={Gauge} label="Machines" value={k.machineCount} sub={`${k.runningCount} running`} />
        <StatCard icon={ClipboardList} label="Work Orders" value={k.workOrderCount} color="text-neon-blue" />
        <StatCard
          icon={Siren}
          label="Andon Alerts"
          value={k.andonOpenCount}
          sub={`${k.andonCriticalCount} critical`}
          color={k.andonOpenCount > 0 ? 'text-red-400' : 'text-green-400'}
        />
        <StatCard
          icon={AlertOctagon}
          label="Open NCRs"
          value={k.ncrOpenCount}
          color={k.ncrOpenCount > 0 ? 'text-amber-400' : 'text-green-400'}
        />
      </div>

      {/* AI Actions */}

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
                  ? 'bg-neon-purple/20 text-neon-purple'
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
        {mode === 'oeeBoard' && <OEEDashboard />}
        {mode === 'woBoard' && <WorkOrderBoard />}
        {mode === 'spc' && <QualitySPC />}
        {mode === 'shopFloor' && <ShopFloorSuite />}
        {mode === 'tools' && <ShopFloorToolsPanel />}
      </div>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <button
          type="button"
          onClick={() => setShowFeed(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>Manufacturing community (Reddit)</span>
          {showFeed ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showFeed && (
          <div className="mt-3">
            <ManufacturingFeed />
          </div>
        )}
      </section>

      <section className="mt-6 max-w-7xl mx-auto px-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <button
          type="button"
          onClick={() => setShowActionPanel(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>More actions</span>
          {showActionPanel ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showActionPanel && (
          <div className="mt-3">
            <PipingProvider>
              <ManufacturingActionPanel />
            </PipingProvider>
          </div>
        )}
      </section>
    </LensPageShell>

      <a href="#manufacturing-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to manufacturing content</a>          <CrossLensRecentsPanel lensId="manufacturing" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
          {/* Phase 12 (Item 5) — mobile thumb-reachable tab bar. */}
          <MobileTabBar
            tabs={[
              { id: 'oeeBoard',   label: 'OEE',   icon: MTabOEE },
              { id: 'woBoard',    label: 'WO',    icon: MTabWO },
              { id: 'spc',        label: 'QC',    icon: MTabQC },
              { id: 'shopFloor',  label: 'Floor', icon: MTabFloor },
              { id: 'tools',      label: 'Tools', icon: MTabTools },
            ]}
            active={mode}
            onSelect={(id) => setMode(id as ModeTab)}
          />
    </LensShell>
  );
}
