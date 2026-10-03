'use client';

import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManufacturingFeed } from '@/components/manufacturing/ManufacturingFeed';
import { ManufacturingActionPanel } from '@/components/manufacturing/ManufacturingActionPanel';
import { ShopFloorToolsPanel } from '@/components/manufacturing/ShopFloorToolsPanel';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import {
  Gauge as MTabOEE, ClipboardList as MTabWO, ShieldCheck as MTabQC,
  Factory as MTabFloor, Wrench as MTabTools,
  MessagesSquare, Zap,
} from 'lucide-react';
import { PipingProvider } from '@/components/panel-polish';
import OEEDashboard from '@/components/manufacturing/OEEDashboard';
import WorkOrderBoard from '@/components/manufacturing/WorkOrderBoard';
import QualitySPC from '@/components/manufacturing/QualitySPC';
import ShopFloorSuite from '@/components/manufacturing/ShopFloorSuite';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
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
type ModeTab = 'oeeBoard' | 'woBoard' | 'spc' | 'shopFloor' | 'tools' | 'actions' | 'community';

const MODE_TABS: { id: ModeTab; label: string; title: string; keys?: string; icon: typeof Cog }[] = [
  { id: 'shopFloor', label: 'Shop Floor', title: 'What the floor is doing', keys: 's', icon: Factory },
  { id: 'oeeBoard', label: 'OEE Board', title: 'How well the machines run', keys: 'o', icon: Gauge },
  { id: 'woBoard', label: 'Work Orders', title: 'What is in the queue', keys: 'w', icon: ClipboardList },
  { id: 'spc', label: 'Quality / SPC', title: 'Whether the process holds', keys: 'q', icon: ShieldCheck },
  { id: 'tools', label: 'Tools', title: 'Shop-floor calculators', keys: 't', icon: Wrench },
  { id: 'actions', label: 'Actions', title: 'Every manufacturing action', icon: Zap },
  { id: 'community', label: 'Community', title: 'What other makers are saying', icon: MessagesSquare },
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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

  const current = MODE_TABS.find((t) => t.id === mode)!;

  return (
    <LensShell lensId="manufacturing" asMain={false}>
      <FirstRunTour lensId="manufacturing" />
      <DepthBadge lensId="manufacturing" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="manufacturing"
        theme="dashboard"
        crumb="Manufacturing"
        title={`${current.title}${mode === 'shopFloor' && who ? `, ${who}` : ''}`}
        subtitle="OEE, work orders, quality/SPC and shop-floor execution (MES)."
        actions={(
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="manufacturing" data={{}} compact />
          </>
        )}
        tabs={MODE_TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, keys: t.keys }))}
        activeTab={mode}
        onTab={(id) => setMode(id as ModeTab)}
        tabsLabel="Manufacturing views"
        cta={{ label: 'Open work orders', icon: ClipboardList, onClick: () => setMode('woBoard'), title: 'Jump to the work-order board (W)' }}
      >
        <div className="space-y-5">
          {isError && (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/5 p-4 text-sm text-rose-200">
              <span>{(error as Error | null)?.message || 'Could not load manufacturing KPIs.'}</span>
              <button type="button" onClick={() => void refetch()} className="rounded-md border border-rose-400/40 px-3 py-1 text-xs hover:bg-rose-500/10">Retry</button>
            </div>
          )}

          {/* Industry Wire — BLS PPI + Federal Reserve G.17 live feed */}
          <LiveFeed
            articles={(realtimeData as { articles?: Array<Record<string, unknown>> } | null)?.articles as React.ComponentProps<typeof LiveFeed>['articles']}
            domain="manufacturing"
            isLive={isLive}
            lastUpdated={lastUpdated}
            limit={10}
          />

          {/* Dashboard KPIs — real manufacturing.* macros, aggregated client-side */}
          <div className={ds.grid4} aria-busy={isLoading}>
            <StatCard icon={Gauge} label="Machines" value={isLoading ? '…' : k.machineCount} sub={`${k.runningCount} running`} />
            <StatCard icon={ClipboardList} label="Work Orders" value={isLoading ? '…' : k.workOrderCount} color="text-neon-blue" />
            <StatCard
              icon={Siren}
              label="Andon Alerts"
              value={isLoading ? '…' : k.andonOpenCount}
              sub={`${k.andonCriticalCount} critical`}
              color={k.andonOpenCount > 0 ? 'text-red-400' : 'text-green-400'}
            />
            <StatCard
              icon={AlertOctagon}
              label="Open NCRs"
              value={isLoading ? '…' : k.ncrOpenCount}
              color={k.ncrOpenCount > 0 ? 'text-amber-400' : 'text-green-400'}
            />
          </div>

          <div id="manufacturing-skip" className="pt-1">
            {mode === 'oeeBoard' && <OEEDashboard />}
            {mode === 'woBoard' && <WorkOrderBoard />}
            {mode === 'spc' && <QualitySPC />}
            {mode === 'shopFloor' && <ShopFloorSuite />}
            {mode === 'tools' && <ShopFloorToolsPanel />}
            {mode === 'actions' && (
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <PipingProvider>
                  <ManufacturingActionPanel />
                </PipingProvider>
              </section>
            )}
            {mode === 'community' && (
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <ManufacturingFeed />
              </section>
            )}
          </div>
        </div>
      </NorthStarFrame>
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
