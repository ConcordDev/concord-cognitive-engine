'use client';

import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { CodebaseScanner } from '@/components/legacy/CodebaseScanner';
import { PortfolioAssessment } from '@/components/legacy/PortfolioAssessment';
import { useLensNav } from '@/hooks/useLensNav';
import { FolderSearch } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';

export default function LegacyLensPage() {
  useLensNav('legacy');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('legacy');

  return (
    <LensShell lensId="legacy" asMain={false}>
      <FirstRunTour lensId="legacy" />      <DepthBadge lensId="legacy" size="sm" className="ml-2" />
      <LensVerticalHero lensId="legacy" className="mx-6 mt-4" />
    <div data-lens-theme="legacy" className="p-6 space-y-6">
      <header className="flex items-center gap-3 flex-wrap">
        <span className="text-2xl">🏛️</span>
        <div>
          <h1 className="text-xl font-bold">Legacy Lens</h1>
          <p className="text-sm text-gray-400">
            Legacy code modernization — technical debt, dependency graphs, migration roadmaps and
            cloud-readiness for real, aging systems (SonarQube / CAST Highlight parity).
          </p>
        </div>

        {/* Real-time Enhancement Toolbar */}
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="legacy" data={realtimeData || {}} compact />
          {realtimeAlerts.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
              {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </header>

      {/* Code Modernization Workbench — real scan-driven analysis */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-1 flex items-center gap-2">
          <FolderSearch className="w-4 h-4 text-neon-cyan" />
          Legacy Code Modernization
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Scan a real codebase to derive technical debt, dependency cycles, churn hotspots, a sequenced
          migration roadmap, rewrite-vs-refactor ROI, and cloud-readiness — every figure below is computed
          from the source you ingest.
        </p>
        <CodebaseScanner />
      </div>

      {/* Portfolio Risk Assessment — the technicalDebt/migrationReadiness/riskMap
          formulas, for systems reviewed without full source access. */}
      <div className="panel p-4">
        <PortfolioAssessment />
      </div>

      {realtimeData && (
        <div className="panel p-4">
          <RealtimeDataPanel
            domain="legacy"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        </div>
      )}

      <ConnectiveTissueBar lensId="legacy" />
    </div>

      <a href="#legacy-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to legacy content</a>          <CrossLensRecentsPanel lensId="legacy" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
