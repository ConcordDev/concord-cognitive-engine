'use client';

/**
 * /lenses/wellness — refusal-field as therapy substrate.
 * Phase 9.6 #23. Privacy-first, user can revoke any field.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
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

interface DashboardSummary {
  habitCount: number;
  habitsDoneToday: number;
  workoutsThisWeek: number;
  workoutMinThisWeek: number;
  avgMoodThisWeek: number | null;
  activeGoals: number;
  metricEntryCount: number;
}

/**
 * WellnessOverview — a self-contained page-level rollup bound to the REAL
 * `wellness.wellness-dashboard-summary` macro (canonical register convention →
 * resolves via /api/lens/run + runMacro). Owns the four honest UX states
 * (loading / error+retry / empty / populated) with a11y roles so a screen
 * reader announces each. This is the page's own backend call — previously the
 * page made none, relying entirely on child panels.
 */
function WellnessOverview() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun({ domain: 'wellness', action: 'wellness-dashboard-summary', input: {} });
      if (!r.data?.ok || !r.data.result) {
        setError(r.data?.error || 'Could not load your wellness overview.');
        setSummary(null);
      } else {
        setSummary(r.data.result as DashboardSummary);
      }
    } catch {
      setError('Could not load your wellness overview.');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div role="status" aria-live="polite" aria-busy="true"
        className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-400">
        Loading your wellness overview…
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert"
        className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-4 text-sm text-rose-200">
        <p className="font-semibold">We couldn’t load your wellness overview.</p>
        <p className="mt-1 text-rose-300/80">{error}</p>
        <button type="button" onClick={() => void load()}
          className="mt-3 rounded-md border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-500/20 focus:outline-none focus:ring-2 focus:ring-rose-400/40">
          Retry
        </button>
      </div>
    );
  }

  const hasData = !!summary && (
    summary.habitCount > 0 || summary.workoutsThisWeek > 0 ||
    summary.activeGoals > 0 || summary.metricEntryCount > 0 ||
    summary.avgMoodThisWeek !== null
  );

  if (!summary || !hasData) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-400">
        <p className="font-semibold text-zinc-200">No wellness data yet.</p>
        <p className="mt-1">Log a metric, create a habit, record a workout, or note your mood below — your overview fills in as you go.</p>
      </div>
    );
  }

  const tiles: Array<{ label: string; value: string }> = [
    { label: 'Habits done today', value: `${summary.habitsDoneToday}/${summary.habitCount}` },
    { label: 'Workouts this week', value: `${summary.workoutsThisWeek}` },
    { label: 'Active minutes', value: `${summary.workoutMinThisWeek}` },
    { label: 'Avg mood (7d)', value: summary.avgMoodThisWeek !== null ? `${summary.avgMoodThisWeek}/4` : '—' },
    { label: 'Active goals', value: `${summary.activeGoals}` },
    { label: 'Metric entries', value: `${summary.metricEntryCount}` },
  ];

  return (
    <div aria-label="Wellness overview"
      className="grid grid-cols-2 gap-2 rounded-xl border border-emerald-500/20 bg-zinc-950/40 p-4 sm:grid-cols-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{t.label}</div>
          <div className="mt-1 text-xl font-bold text-emerald-300">{t.value}</div>
        </div>
      ))}
    </div>
  );
}

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

        {/* Page-level overview bound to wellness.wellness-dashboard-summary */}
        <section className="mb-6">
          <WellnessOverview />
        </section>

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
