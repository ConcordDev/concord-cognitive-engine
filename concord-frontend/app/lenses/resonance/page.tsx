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
      <div data-lens-theme="resonance" className="h-[calc(100vh-4rem)] flex flex-col bg-[#050510]">
        <header
          className="flex items-center justify-between px-6 py-3 border-b border-white/5"
          style={{ background: 'rgba(5, 5, 16, 0.95)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <Radio className="w-5 h-5 shrink-0" style={{ color: meta.color }} />
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                Resonance Interface
              </h1>
              <p className="text-[11px] text-gray-400">
                x&sup2; &minus; x = 0 &middot; boundary detection &middot; constraint alignment
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
              <DTUExportButton domain="resonance" data={realtimeData || {}} compact />
              {realtimeAlerts.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                  {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <nav className="flex items-center gap-0.5 bg-white/[0.03] rounded-lg p-0.5" aria-label="Resonance views">
              {VIEWS.map((tab) => {
                const Icon = tab.icon;
                const on = active === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActive(tab.id)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all',
                      on ? 'text-white bg-white/[0.08]' : 'text-gray-600 hover:text-gray-400',
                    )}
                    aria-current={on ? 'page' : undefined}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>

            <div className="relative">
              <button
                type="button"
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-300 border border-white/5 hover:border-white/10 transition-all"
                title="Export resonance data"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </button>
              {exportMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 z-50 border border-white/10 rounded-lg overflow-hidden shadow-xl"
                  style={{ background: 'rgba(10,10,20,0.98)' }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      exportResonanceData(scan, history, 'json');
                      setExportMenuOpen(false);
                    }}
                    className="block w-full text-left px-4 py-2 text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    Export as JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      exportResonanceData(scan, history, 'csv');
                      setExportMenuOpen(false);
                    }}
                    className="block w-full text-left px-4 py-2 text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    Export as CSV
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={runScan}
              disabled={isScanning}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all border"
              style={{
                borderColor: isScanning ? 'rgba(255,255,255,0.05)' : meta.color + '40',
                color: isScanning ? '#666' : meta.color,
                background: isScanning ? 'rgba(255,255,255,0.02)' : meta.glow.replace(')', ',0.08)'),
              }}
            >
              <Scan className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              {isScanning ? 'Scanning...' : 'Scan Boundary'}
            </button>

            <button
              type="button"
              onClick={() => setAutoScan(!autoScan)}
              className={cn(
                'p-2 rounded-lg transition-all',
                autoScan ? 'bg-[#00ffc8]/10 text-[#00ffc8]' : 'bg-white/[0.02] text-gray-600',
              )}
              title={autoScan ? 'Auto-scan ON (15s)' : 'Auto-scan OFF'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${autoScan ? 'animate-spin' : ''}`} style={{ animationDuration: '3s' }} />
            </button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <aside
            className="w-20 border-r border-white/5 flex flex-col items-center py-4 gap-3"
            style={{ background: 'rgba(5, 5, 16, 0.98)' }}
          >
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

        <CrossLensRecentsPanel lensId="resonance" sinceDays={7} limit={6} hideWhenEmpty className="mt-3 px-4" />
      </div>
    </LensShell>
  );
}
