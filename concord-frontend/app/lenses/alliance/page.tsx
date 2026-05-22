'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { SessionRail } from '@/components/lens/SessionRail';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useState } from 'react';
import { Layers, ChevronDown } from 'lucide-react';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { FactionWarIntel } from '@/components/alliance/FactionWarIntel';
import { AllianceWorkspace } from '@/components/alliance/AllianceWorkspace';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

export default function AllianceLensPage() {
  useLensNav('alliance');
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('alliance');
  const [showFeatures, setShowFeatures] = useState(true);

  // Lens-scoped keyboard commands.
  useLensCommand(
    [
      { id: 'reload-alliance', keys: 'r', description: 'Reload workspace', category: 'actions', action: () => window.location.reload() },
    ],
    { lensId: 'alliance' }
  );

  return (
    <LensShell lensId="alliance" asMain={false}>
      <FirstRunTour lensId="alliance" />
      <ManifestActionBar />
      <DepthBadge lensId="alliance" size="sm" className="ml-2" />
      <div data-lens-theme="alliance" className="p-6 space-y-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🤝</span>
            <div>
              <h1 className="text-xl font-bold">Alliance Lens</h1>
              <p className="text-sm text-gray-400">
                Cross-group collaboration — channels, invites, shared proposals, quorum voting
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="alliance" data={realtimeData || {}} compact />
          </div>
        </header>

        {/* AI Actions */}
        <UniversalActions domain="alliance" artifactId={null} compact />

        {/* Cross-org collaboration workspace — all macros wired here */}
        <AllianceWorkspace />

        {/* Real-time Data Panel */}
        {realtimeData && (
          <RealtimeDataPanel
            domain="alliance"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}

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
              <LensFeaturePanel lensId="alliance" />
            </div>
          )}
        </div>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <FactionWarIntel />
        </section>

        <SessionRail lensId="alliance" hideWhenEmpty className="mt-4" />
        <RecentMineCard domain="alliance" limit={10} hideWhenEmpty className="mt-4" />
        <AutoActionStrip domain="alliance" hideWhenEmpty className="mt-3" />
        <CrossLensRecentsPanel lensId="alliance" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
