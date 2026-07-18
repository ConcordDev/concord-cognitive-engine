'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ArxivFeed } from '@/components/hypothesis/ArxivFeed';
import { StatsWorkbench } from '@/components/hypothesis/StatsWorkbench';
import { HypothesisLab } from '@/components/hypothesis/HypothesisLab';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useState } from 'react';
import { Layers, ChevronDown, BarChart3 } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

export default function HypothesisLensPage() {
  useLensNav('hypothesis');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('hypothesis');
  const [showFeatures, setShowFeatures] = useState(true);

  return (
    <LensShell lensId="hypothesis" asMain={false}>
      <FirstRunTour lensId="hypothesis" />
      <ManifestActionBar />
      <DepthBadge lensId="hypothesis" size="sm" className="ml-2" />
    <div data-lens-theme="hypothesis" className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <span className="text-2xl">🧪</span>
        <div>
          <h1 className="text-xl font-bold">Hypothesis Lens</h1>
          <p className="text-sm text-gray-400">
            Scientific method — hypothesize, collect evidence, evaluate, experiment
          </p>
        </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="hypothesis" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      </header>

      {/* Hypothesis Lab — the formal propose/evidence/test/predict/confirm-
          reject-refine-archive lifecycle backed by the real hypothesis-engine
          macros. Replaces the previous create/list/detail grid, which read a
          flat {statement,status,confidence,evidence} shape the real handler
          never returns (everything actually lives under
          `machine.hypothesis.*`) — every card rendered blank, "Evaluate" and
          "Add evidence" always failed "not found" against a permanently-empty
          legacy engine, and the top stat tiles were stuck at 0. See
          docs/lens-specs/hypothesis-capability-map.md. */}
      <HypothesisLab />

      {realtimeData && (
        <RealtimeDataPanel
          domain="hypothesis"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}

      {/* Statistical Workbench — full test battery, datasets, assumptions,
          multiple-comparison correction, pre-registration, APA export */}
      <section className="space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-neon-cyan" />
          Statistical Workbench
        </h2>
        <p className="text-xs text-gray-400">
          Run the full classical test battery on hand-entered values or imported CSV
          datasets — t-tests, ANOVA, chi-square, correlation and regression — with
          assumption diagnostics, multiple-comparison correction, pre-registration
          tracking, and APA-formatted reports.
        </p>
        <StatsWorkbench />
      </section>

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="hypothesis" />
          </div>
        )}
      </div>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <ArxivFeed />
      </section>
    </div>

      <a href="#hypothesis-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to hypothesis content</a>
          <RecentMineCard domain="hypothesis" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="hypothesis" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="hypothesis" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
