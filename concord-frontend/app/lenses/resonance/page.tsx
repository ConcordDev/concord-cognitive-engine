'use client';

/**
 * Resonance — one spectrum-analyzer / boundary-detection instrument.
 *
 * Single `active` union. Live field, pairs, history, health, growth,
 * analysis actions, cross-domain workbench, and arXiv are panels under
 * components/resonance/. Accordion booleans removed.
 */

import { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Heart,
  Radio,
  RefreshCw,
  Scan,
  GitBranch,
  Crosshair,
  Download,
  Dna,
  Layers,
  BookOpen,
  Zap,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ErrorState } from '@/components/common/EmptyState';
import { apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  type BoundaryScan,
  type HistoryPoint,
  type LatticeHealth,
  type ThresholdConfig,
  CLASSIFICATION_META,
  DEFAULT_THRESHOLDS,
  SignalMeter,
  exportResonanceData,
} from '@/components/resonance/resonance-ui';
import { LivePanel } from '@/components/resonance/LivePanel';
import { PairsPanel } from '@/components/resonance/PairsPanel';
import { HistoryPanel } from '@/components/resonance/HistoryPanel';
import { HealthPanel } from '@/components/resonance/HealthPanel';
import { GrowthPanel } from '@/components/resonance/GrowthPanel';
import { ActionsPanel } from '@/components/resonance/ActionsPanel';
import { WorkbenchPanel } from '@/components/resonance/WorkbenchPanel';
import { ArxivPanel } from '@/components/resonance/ArxivPanel';

type ResonanceView =
  | 'live'
  | 'pairs'
  | 'history'
  | 'health'
  | 'growth'
  | 'actions'
  | 'workbench'
  | 'arxiv';

const VIEWS: { id: ResonanceView; label: string; keys: string; icon: typeof Radio }[] = [
  { id: 'live', label: 'Live', keys: 'l', icon: Crosshair },
  { id: 'pairs', label: 'Pairs', keys: 'p', icon: GitBranch },
  { id: 'history', label: 'History', keys: 'h', icon: Activity },
  { id: 'health', label: 'Health', keys: 'y', icon: Heart },
  { id: 'growth', label: 'Growth', keys: 'g', icon: Dna },
  { id: 'actions', label: 'Analysis', keys: 'z', icon: Zap },
  { id: 'workbench', label: 'Workbench', keys: 'w', icon: Layers },
  { id: 'arxiv', label: 'arXiv', keys: 'x', icon: BookOpen },
];

export default function ResonanceBoundaryPage() {
  useLensNav('resonance');
  useLensIdentity('resonance');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } =
    useRealtimeLens('resonance');

  const queryClient = useQueryClient();
  const [active, setActive] = useState<ResonanceView>('live');
  const [autoScan, setAutoScan] = useState(false);
  const [thresholds, setThresholds] = useState<ThresholdConfig>({ ...DEFAULT_THRESHOLDS });
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} view`,
        category: 'view' as const,
        action: () => setActive(v.id),
      })),
      {
        id: 'toggle-scan',
        keys: 'a',
        description: 'Toggle auto-scan',
        category: 'actions' as const,
        action: () => setAutoScan((v) => !v),
      },
    ],
    { lensId: 'resonance' },
  );

  const { data: scan, isLoading: scanLoading, isError: scanError, error: scanErrorObj, refetch: refetchScan } =
    useQuery<BoundaryScan>({
      queryKey: ['resonance-boundary'],
      queryFn: () => apiHelpers.resonance.boundary().then((r) => r.data),
      refetchInterval: autoScan ? 15000 : false,
    });

  const { data: historyData } = useQuery<{ readings: HistoryPoint[] }>({
    queryKey: ['resonance-history'],
    queryFn: () => apiHelpers.resonance.history({ limit: 200 }).then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: growth } = useQuery<LatticeHealth>({
    queryKey: ['resonance-lattice-health'],
    queryFn: () => apiHelpers.resonance.latticeHealth().then((r) => r.data),
    refetchInterval: 10000,
  });

  const scanMutation = useMutation({
    mutationFn: () => apiHelpers.resonance.scan().then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resonance-boundary'] });
      queryClient.invalidateQueries({ queryKey: ['resonance-history'] });
    },
    onError: (err) => {
      console.error('Resonance scan failed:', err instanceof Error ? err.message : err);
    },
  });

  const runScan = useCallback(() => {
    scanMutation.mutate();
  }, [scanMutation]);

  const signal = scan?.signal ?? 0;
  const classification = scan?.classification ?? 'noise_floor';
  const meta = CLASSIFICATION_META[classification] || CLASSIFICATION_META.noise_floor;
  const history = historyData?.readings ?? [];
  const isScanning = scanMutation.isPending || scanLoading;
  const homeostasis = growth?.resonance?.homeostasis ?? 0;
  const repairRate = growth?.resonance?.repairRate ?? 0.5;

  const classifyPairSignal = (resonance: number): string => {
    if (resonance >= thresholds.strongResonance) return 'strong_resonance';
    if (resonance >= thresholds.moderateResonance) return 'moderate_resonance';
    if (resonance >= thresholds.weakSignal) return 'weak_signal';
    return 'noise_floor';
  };

  const allPairs = scan?.crossDomainAlignment?.topPairs ?? [];
  const pairsByClass = {
    strong: allPairs.filter((p) => classifyPairSignal(p.resonance) === 'strong_resonance').length,
    moderate: allPairs.filter((p) => classifyPairSignal(p.resonance) === 'moderate_resonance').length,
    weak: allPairs.filter((p) => classifyPairSignal(p.resonance) === 'weak_signal').length,
    noise: allPairs.filter((p) => classifyPairSignal(p.resonance) === 'noise_floor').length,
  };

  if (scanError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={scanErrorObj?.message} onRetry={refetchScan} />
      </div>
    );
  }

  return (
    <LensShell lensId="resonance" asMain={false}>
      <FirstRunTour lensId="resonance" />
      <DepthBadge lensId="resonance" size="sm" className="ml-2" />
      <div data-lens-theme="resonance" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Resonance</p>
            <h1 className="mb-1 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              What still resonates{who ? `, ${who}` : ''}
            </h1>
            <p className="mb-5 text-[13px] text-zinc-500">
              x&sup2; &minus; x = 0 &middot; boundary detection &middot; constraint alignment &middot;{' '}
              <span style={{ color: meta.color }}>{meta.label}</span>
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="resonance" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                className="flex items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-1.5 text-xs text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-200"
                title="Export resonance data"
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </button>
              {exportMenuOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-white/10 bg-[#111] shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      exportResonanceData(scan, history, 'json');
                      setExportMenuOpen(false);
                    }}
                    className="block w-full px-4 py-2 text-left text-xs text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    Export as JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      exportResonanceData(scan, history, 'csv');
                      setExportMenuOpen(false);
                    }}
                    className="block w-full px-4 py-2 text-left text-xs text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    Export as CSV
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setAutoScan(!autoScan)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs transition-colors',
                autoScan ? 'border-teal-400/40 bg-teal-400/10 text-teal-300' : 'border-white/10 text-zinc-500 hover:text-zinc-200',
              )}
              title={autoScan ? 'Auto-scan ON (15s)' : 'Auto-scan OFF'}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${autoScan ? 'animate-spin' : ''}`} style={{ animationDuration: '3s' }} />
              Auto-scan
              <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30">a</kbd>
            </button>
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Resonance views">
          {VIEWS.map((tab) => {
            const Icon = tab.icon;
            const on = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActive(tab.id)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{tab.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <div className="flex h-[calc(100vh-19rem)] min-h-[520px] overflow-hidden rounded-2xl border border-white/10 bg-[#050510]">
          <aside className="flex w-20 shrink-0 flex-col items-center gap-3 border-r border-white/5 py-4">
            <SignalMeter value={signal} label="signal" />
            <SignalMeter value={scan?.gradient ?? 0} label="∇C" />
            <SignalMeter value={Math.max(0, scan?.coherenceDirection ?? 0)} label="coher" />
            <SignalMeter value={scan?.frontier?.density ?? 0} label="front" />
            <div className="flex-1" />
            <SignalMeter value={homeostasis} label="homeo" />
            <SignalMeter value={repairRate} label="repair" />
          </aside>

          <main className="flex-1 overflow-y-auto">
            {active === 'live' && (
              <LivePanel
                scan={scan}
                signal={signal}
                classification={classification}
                isScanning={isScanning}
                history={history}
              />
            )}
            {active === 'pairs' && (
              <PairsPanel
                scan={scan}
                allPairs={allPairs}
                pairsByClass={pairsByClass}
                thresholds={thresholds}
                onThresholdsChange={setThresholds}
              />
            )}
            {active === 'history' && <HistoryPanel history={history} />}
            {active === 'health' && (
              <HealthPanel scan={scan} signal={signal} homeostasis={homeostasis} repairRate={repairRate} />
            )}
            {active === 'growth' && <GrowthPanel />}
            {active === 'actions' && (
              <div className="p-6">
                <ActionsPanel />
              </div>
            )}
            {active === 'workbench' && <WorkbenchPanel />}
            {active === 'arxiv' && <ArxivPanel />}
          </main>
        </div>

        {realtimeData && (
          <RealtimeDataPanel
            domain="resonance"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}

        <CrossLensRecentsPanel lensId="resonance" sinceDays={7} limit={6} hideWhenEmpty className="mt-6" />

        <button
          type="button"
          onClick={runScan}
          disabled={isScanning}
          title="Scan the boundary now"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          <Scan className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`} />
          {isScanning ? 'Scanning…' : 'Scan boundary'}
        </button>
      </div>
    </LensShell>
  );
}
