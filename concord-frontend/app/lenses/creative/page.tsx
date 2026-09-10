'use client';

/**
 * Creative lens — production-management home for the `creative` domain's
 * 62 real macros.
 *
 * Note: a fabricated "Projects/Assets/Revisions/Shot List/Client
 * Proofing/Budget/Distribution" CRUD system (~1,500 LOC) used to live on
 * this page. It was built on `useLensData('creative', <ArtifactType>, ...)`
 * against client-invented artifact types (`Project`/`Asset`/`Revision`/
 * `ShotItem`/`ClientProof`/`BudgetLine`/`DistItem`) that had **zero**
 * corresponding macros in `server/domains/creative.js` — every list was
 * permanently empty and every "Quick Action" button called a real macro
 * (`shotListGenerate`/`assetOrganize`/`budgetTrack`/`distributionChecklist`/
 * `project_summary`) against an id from that same empty store, so the
 * buttons were unreachable in practice. It duplicated, rather than fed,
 * the real production suite below. Removed 2026-07 — see
 * docs/lens-specs/creative-capability-map.md for the full audit.
 *
 * What's real and stays: `CreativeBoardsSection` (Milanote-shape visual
 * boards: the board, card and connection macro families), `ProductionSuite`
 * (StudioBinder + Frame.io parity: review-asset, review-comment,
 * callsheet, breakdown, deliverable, calendar and prooflink macro
 * families), `CreativeActionPanel` (producer bench: shotListGenerate/assetOrganize/
 * budgetTrack/distributionChecklist run directly against real macros),
 * and `RedditCreative` (a live r/Design-family reference feed). The new
 * `CreativeDashboardStrip` sources its tiles from `creative-dashboard` +
 * the same list macros ProductionSuite uses.
 */

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { CreativeDashboardStrip } from '@/components/creative/CreativeDashboardStrip';
import { CreativeBoardsSection } from '@/components/creative/CreativeBoardsSection';
import { ProductionSuite } from '@/components/creative/ProductionSuite';
import { RedditCreative } from '@/components/creative/RedditCreative';
import { CreativeActionPanel } from '@/components/creative/CreativeActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import type { DTU } from '@/lib/api/generated-types';
import { LensContextPanel } from '@/components/lens/LensContextPanel';
import { ArtifactRenderer } from '@/components/artifact/ArtifactRenderer';
import { ArtifactUploader } from '@/components/artifact/ArtifactUploader';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { Palette, ChevronDown, ChevronRight } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { FeedBanner } from '@/components/lens/FeedBanner';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

export default function CreativeLensPage() {
  useLensNav('creative');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('creative');
  const [showRedditCreative, setShowRedditCreative] = useState(false);
  const [showActionPanel, setShowActionPanel] = useState(false);

  // DTU context (v3.0 artifact support) — real substrate, unrelated to the
  // removed CRUD system.
  const {
    contextDTUs: creativeDTUs, hyperDTUs, megaDTUs, regularDTUs,
    tierDistribution, publishToMarketplace: publishDTU,
    refetch: refetchDTUs,
  } = useLensDTUs({ lens: 'creative' });

  const creativeArtifacts = creativeDTUs.filter((d: DTU) => d.artifact);

  return (
    <LensShell lensId="creative" asMain={false}>
      <FirstRunTour lensId="creative" />
      <DepthBadge lensId="creative" size="sm" className="ml-2" />
      <div data-lens-theme="creative" className={ds.pageContainer}>
        {/* Header */}
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3">
            <Palette className="w-7 h-7 text-pink-500" />
            <div>
              <h1 className={ds.heading1}>Creative Production</h1>
              <p className={ds.textMuted}>Boards, production management (StudioBinder + Frame.io parity) and a producer bench — all real macro-backed.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="creative" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </header>

        <FeedBanner domain="creative" />

        {/* Dashboard tile row — sourced from creative-dashboard + the real list macros */}
        <CreativeDashboardStrip />

        {/* Milanote-shape visual boards */}
        <CreativeBoardsSection />

        {/* StudioBinder + Frame.io parity — review, call sheets, breakdown, deliverables, calendar, proof links */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <ProductionSuite />
        </section>

        {/* Live reference feed */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <button
            type="button"
            onClick={() => setShowRedditCreative(v => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>Community reference (Reddit)</span>
            {showRedditCreative ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showRedditCreative && (
            <div className="mt-3">
              <RedditCreative />
            </div>
          )}
        </section>

        {/* Producer bench — shotListGenerate / assetOrganize / budgetTrack / distributionChecklist */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <button
            type="button"
            onClick={() => setShowActionPanel(v => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>Producer bench</span>
            {showActionPanel ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showActionPanel && (
            <div className="mt-3">
              <PipingProvider>
                <CreativeActionPanel />
              </PipingProvider>
            </div>
          )}
        </section>

        {/* AI Actions */}

        {/* DTU Context & Artifacts */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {creativeArtifacts.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-400 uppercase">Creative Artifacts</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {creativeArtifacts.slice(0, 4).map((dtu: DTU) => (
                    <div key={dtu.id} className="p-3 rounded-lg bg-lattice-elevated/50 border border-lattice-border space-y-2">
                      <p className="text-sm font-medium truncate">{dtu.title || dtu.human?.summary || 'Untitled'}</p>
                      <ArtifactRenderer dtuId={dtu.id} artifact={dtu.artifact!} mode="thumbnail" />
                      <FeedbackWidget targetType="dtu" targetId={dtu.id} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <ArtifactUploader lens="creative" acceptTypes="image/*,video/*,audio/*" multi onUploadComplete={() => refetchDTUs()} />
          </div>
          <div>
            <LensContextPanel
              hyperDTUs={hyperDTUs}
              megaDTUs={megaDTUs}
              regularDTUs={regularDTUs}
              tierDistribution={tierDistribution}
              onPublish={(dtu) => publishDTU({ dtuId: dtu.id })}
              title="Creative DTUs"
            />
            <div className="mt-4">
              <FeedbackWidget targetType="lens" targetId="creative" />
            </div>
            {realtimeData && (
              <div className="mt-4">
                <RealtimeDataPanel
                  domain="creative"
                  data={realtimeData}
                  isLive={isLive}
                  lastUpdated={lastUpdated}
                  insights={realtimeInsights}
                  compact
                />
              </div>
            )}
          </div>
        </section>

      </div>      <CrossLensRecentsPanel lensId="creative" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
