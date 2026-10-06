'use client';

/**
 * /lenses/wellness — refusal-field as therapy substrate.
 * Phase 9.6 #23. Privacy-first, user can revoke any field.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { WellnessSection } from '@/components/wellness/WellnessSection';
import { WellnessFeed } from '@/components/wellness/WellnessFeed';
import { WellnessActionPanel } from '@/components/wellness/WellnessActionPanel';
import { SelfFieldsPanel } from '@/components/wellness/SelfFieldsPanel';
import { CBTPanel } from '@/components/wellness/CBTPanel';
import { SessionsPanel } from '@/components/wellness/SessionsPanel';
import { WearableImportPanel } from '@/components/wellness/WearableImportPanel';
import { DailyRecommendationPanel } from '@/components/wellness/DailyRecommendationPanel';
import { PipingProvider } from '@/components/panel-polish';
import { Activity, Brain, Heart, Moon, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

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

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    lensRun({ domain: 'wellness', action: 'wellness-dashboard-summary', input: {} })
      .then((r) => {
        if (cancelled) return;
        if (!r.data?.ok || !r.data.result) {
          setError(r.data?.error || 'Could not load your wellness overview.');
          setSummary(null);
        } else {
          setError(null);
          setSummary(r.data.result as DashboardSummary);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError('Could not load your wellness overview.');
        setSummary(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  if (loading) {
    return (
      <div role="status" aria-live="polite" aria-busy="true"
        className="rounded-2xl border border-white/10 bg-[#111] p-4 text-sm text-zinc-400">
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
        <button type="button" onClick={() => { setLoading(true); setReloadKey((k) => k + 1); }}
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
      <div className="rounded-2xl border border-white/10 bg-[#111] p-4 text-sm text-zinc-400">
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

type WellnessView = 'today' | 'mind' | 'body' | 'community';

const VIEWS: { id: WellnessView; label: string; keys: string; title: string; hint: string; icon: typeof Heart }[] = [
  { id: 'today', label: 'Today', keys: '1', title: 'How you are doing', hint: 'Overview, daily recommendation and metrics', icon: Heart },
  { id: 'mind', label: 'Mind', keys: '2', title: 'Slow things down', hint: 'Therapeutic fields, CBT records and guided sessions', icon: Brain },
  { id: 'body', label: 'Body', keys: '3', title: 'What your body is saying', hint: 'Wearable import and sleep / strain / recovery / HRV', icon: Moon },
  { id: 'community', label: 'Community', keys: '4', title: 'You are not doing this alone', hint: 'Wellness community feed', icon: Users },
];

export default function WellnessPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<WellnessView>('today');
  useLensCommand([
    ...VIEWS.map((v) => ({
      id: `wellness-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setView(v.id),
    })),
  ], { lensId: 'wellness' });

  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <LensShell lensId="wellness" asMain={false}>
      <FirstRunTour lensId="wellness" />
      <DepthBadge lensId="wellness" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="wellness"
        crumb="Wellness"
        title={`${current.title}${view === 'today' && who ? `, ${who}` : ''}`}
        subtitle="Recovery, mood, habits, guided CBT and meditation. No medical claims; this is a tool, not treatment. You can revoke any therapeutic field at any time."
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={view}
        onTab={(id) => setView(id as WellnessView)}
        tabsLabel="Wellness views"
        cta={{ label: 'Log a thought record', icon: Activity, onClick: () => setView('mind'), title: 'Open guided CBT thought records' }}
      >
        <div className="space-y-5">
          {view === 'today' && (
            <>
              <WellnessSection />
              <WellnessOverview />
              <DailyRecommendationPanel />
            </>
          )}
          {view === 'mind' && (
            <>
              <SelfFieldsPanel />
              <CBTPanel />
              <SessionsPanel />
            </>
          )}
          {view === 'body' && (
            <>
              <WearableImportPanel />
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <h2 className="mb-3 text-sm font-semibold text-white">Sleep / strain / recovery / HRV workbench</h2>
                <PipingProvider>
                  <WellnessActionPanel />
                </PipingProvider>
              </section>
            </>
          )}
          {view === 'community' && (
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <WellnessFeed />
            </section>
          )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
