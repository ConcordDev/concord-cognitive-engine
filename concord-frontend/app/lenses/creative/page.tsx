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
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { CreativeDashboardStrip } from '@/components/creative/CreativeDashboardStrip';
import { CreativeBoardsSection } from '@/components/creative/CreativeBoardsSection';
import { ProductionSuite } from '@/components/creative/ProductionSuite';
import { RedditCreative } from '@/components/creative/RedditCreative';
import { CreativeActionPanel } from '@/components/creative/CreativeActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import type { DTU } from '@/lib/api/generated-types';
import { LensContextPanel } from '@/components/lens/LensContextPanel';
import { ArtifactRenderer } from '@/components/artifact/ArtifactRenderer';
import { ArtifactUploader } from '@/components/artifact/ArtifactUploader';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { Clapperboard, Library, MessagesSquare, Upload, Wrench } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { FeedBanner } from '@/components/lens/FeedBanner';

type CreativeView = 'studio' | 'bench' | 'library' | 'community';

const VIEWS: { id: CreativeView; label: string; keys: string; icon: typeof Clapperboard; hint: string }[] = [
  { id: 'studio', label: 'Studio', keys: '1', icon: Clapperboard, hint: 'Boards, review, call sheets, deliverables' },
  { id: 'bench', label: 'Producer bench', keys: '2', icon: Wrench, hint: 'Shot lists, asset organizing, budget, distribution' },
  { id: 'library', label: 'Library', keys: '3', icon: Library, hint: 'Artifacts, uploads and Creative DTUs' },
  { id: 'community', label: 'Community', keys: '4', icon: MessagesSquare, hint: 'Live design reference feed' },
];

export default function CreativeLensPage() {
  useLensNav('creative');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('creative');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<CreativeView>('studio');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setView(v.id),
    })),
    { lensId: 'creative' },
  );

  // DTU context (v3.0 artifact support) — real substrate, unrelated to the
  // removed CRUD system.
  const {
    contextDTUs: creativeDTUs, hyperDTUs, megaDTUs, regularDTUs,
    tierDistribution, publishToMarketplace: publishDTU,
    refetch: refetchDTUs,
  } = useLensDTUs({ lens: 'creative' });

  const creativeArtifacts = creativeDTUs.filter((d: DTU) => d.artifact);

  const titles: Record<CreativeView, string> = {
    studio: `Run the production${who ? `, ${who}` : ''}`,
    bench: 'Work the producer bench',
    library: 'Shape your library',
    community: 'Steal like an artist',
  };

  return (
    <LensShell lensId="creative" asMain={false}>
      <FirstRunTour lensId="creative" />
      <DepthBadge lensId="creative" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="creative"
        crumb="Creative"
        title={titles[view]}
        subtitle="Boards, production management and a producer bench."
        actions={(
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="creative" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        )}
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={view}
        onTab={(id) => setView(id as CreativeView)}
        tabsLabel="Creative views"
        cta={{ label: 'Upload an asset', icon: Upload, onClick: () => setView('library'), title: 'Open the library uploader' }}
      >
        <div className="space-y-6">
          <FeedBanner domain="creative" />

          {view === 'studio' && (
            <>
              {/* Dashboard tile row — sourced from creative-dashboard + the real list macros */}
              <CreativeDashboardStrip />

              {/* Milanote-shape visual boards */}
              <CreativeBoardsSection />

              {/* StudioBinder + Frame.io parity — review, call sheets, breakdown, deliverables, calendar, proof links */}
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <ProductionSuite />
              </section>
            </>
          )}

          {view === 'bench' && (
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <PipingProvider>
                <CreativeActionPanel />
              </PipingProvider>
            </section>
          )}

          {view === 'library' && (
            <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                {creativeArtifacts.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold uppercase text-gray-400">Creative Artifacts</h3>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {creativeArtifacts.slice(0, 4).map((dtu: DTU) => (
                        <div key={dtu.id} className="space-y-2 rounded-2xl border border-white/10 bg-[#111] p-3">
                          <p className="truncate text-sm font-medium">{dtu.title || dtu.human?.summary || 'Untitled'}</p>
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
          )}

          {view === 'community' && (
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <RedditCreative />
            </section>
          )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
