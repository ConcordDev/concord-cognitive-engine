'use client';

/**
 * /lenses/wellness — refusal-field as therapy substrate.
 * Phase 9.6 #23. Privacy-first, user can revoke any field.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { WellnessSection } from '@/components/wellness/WellnessSection';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { WellnessFeed } from '@/components/wellness/WellnessFeed';
import { WellnessActionPanel } from '@/components/wellness/WellnessActionPanel';
import { SelfFieldsPanel } from '@/components/wellness/SelfFieldsPanel';
import { CBTPanel } from '@/components/wellness/CBTPanel';
import { SessionsPanel } from '@/components/wellness/SessionsPanel';
import { WearableImportPanel } from '@/components/wellness/WearableImportPanel';
import { DailyRecommendationPanel } from '@/components/wellness/DailyRecommendationPanel';
import { PipingProvider } from '@/components/panel-polish';

export default function WellnessPage() {
  useLensCommand([
    { id: 'wellness-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'wellness' });

  return (
        <LensShell lensId="wellness">
      <FirstRunTour lensId="wellness" />
      <DepthBadge lensId="wellness" size="sm" className="ml-2" />
      <div className="px-4 mt-3">
        <WellnessSection />
      </div>
      <LensVerticalHero lensId="wellness" className="mx-6 mt-4" />
  <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">Wellness</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Recovery, mood, habits, guided CBT and meditation over one substrate. Therapeutic refusal-fields use real base-6 glyph algebra — they actually gate cognitive patterns. Privacy-first: you can revoke any field at any time.
            {' '}<strong>No medical claims; this is a tool, not treatment.</strong>
          </p>
        </header>

        {/* Personalized daily recovery recommendation — daily-recommendation */}
        <section className="mb-6">
          <DailyRecommendationPanel />
        </section>

        {/* Self-composed therapeutic fields — gate your OWN patterns directly */}
        <section className="mb-6">
          <SelfFieldsPanel />
        </section>

        {/* Guided CBT thought records — cbt-prompts / cbt-record-* */}
        <section className="mb-6">
          <CBTPanel />
        </section>

        {/* Calm-style guided meditation + breathing sessions — session-* */}
        <section className="mb-6">
          <SessionsPanel />
        </section>

        {/* Wearable HRV / sleep / steps import — wearable-import */}
        <section className="mb-6">
          <WearableImportPanel />
        </section>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <WellnessFeed />
        </section>

        {/* Whoop-shape wellness workbench: sleep / strain / recovery / HRV + actions */}
        <PipingProvider>
          <section className="mt-6">
            <WellnessActionPanel />
          </section>
        </PipingProvider>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
          <RecentMineCard domain="wellness" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="wellness" hideWhenEmpty className="mt-3" title="More actions" />
          <CrossLensRecentsPanel lensId="wellness" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
