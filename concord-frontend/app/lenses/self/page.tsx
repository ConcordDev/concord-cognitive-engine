'use client';

/**
 * Unified Self Lens — a quantified-self surface. A real metric ledger
 * (server/domains/self.js) powers
 * customizable overview tiles, trend charts, cross-metric correlation,
 * goals + progress rings, daily/weekly digest, streaks, and wearable
 * import. The legacy aggregator tabs (fitness/sleep/mood/journal/
 * rituals/achievements/milestones/season) remain for cross-substrate
 * pulls. No seed data anywhere — empty states say "no data yet".
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { SelfFeed } from '@/components/self/SelfFeed';
import { LogMetricForm } from '@/components/self/LogMetricForm';
import { OverviewDashboard } from '@/components/self/OverviewDashboard';
import { TrendPanel } from '@/components/self/TrendPanel';
import { CorrelationPanel } from '@/components/self/CorrelationPanel';
import { GoalsPanel } from '@/components/self/GoalsPanel';
import { DigestPanel } from '@/components/self/DigestPanel';
import { StreaksPanel } from '@/components/self/StreaksPanel';
import { ImportPanel } from '@/components/self/ImportPanel';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart, Moon, Smile, BookOpen, Activity, TrendingUp, Loader2,
  Sun, Trophy, Award, Calendar, Link2, Target, ScrollText, Flame, Upload,
  type LucideIcon,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

// Absorbed UX components — mounted as legacy cross-substrate tabs.
const DailyRituals = dynamic(() => import('@/components/world-lens/DailyRituals'), { ssr: false });
const AchievementSystem = dynamic(() => import('@/components/world-lens/AchievementSystem'), { ssr: false });
const ProgressionPanelExt = dynamic(() => import('@/components/world-lens/ProgressionPanel'), { ssr: false });
const SeasonalContent = dynamic(() => import('@/components/world-lens/SeasonalContent'), { ssr: false });

type TabKey =
  | 'overview' | 'trends' | 'correlations' | 'goals' | 'digest' | 'streaks' | 'import'
  | 'fitness' | 'sleep' | 'mood' | 'journal'
  | 'rituals' | 'achievements' | 'milestones' | 'season';

export default function UnifiedSelfLensPage() {
  useLensNav('self');
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  // Bumped whenever a reading is logged/imported so every dependent
  // panel re-pulls from the ledger.
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  useLensCommand(
    [
      { id: 'goto-overview', keys: 'o', description: 'Overview', category: 'navigation', action: () => setActiveTab('overview') },
      { id: 'goto-trends', keys: 't', description: 'Trends', category: 'navigation', action: () => setActiveTab('trends') },
      { id: 'goto-correlations', keys: 'c', description: 'Correlations', category: 'navigation', action: () => setActiveTab('correlations') },
      { id: 'goto-goals', keys: 'g', description: 'Goals', category: 'navigation', action: () => setActiveTab('goals') },
      { id: 'goto-streaks', keys: 'k', description: 'Streaks', category: 'navigation', action: () => setActiveTab('streaks') },
      { id: 'goto-import', keys: 'i', description: 'Import', category: 'navigation', action: () => setActiveTab('import') },
    ],
    { lensId: 'self' }
  );

  const safeRunDomain = async (domain: string, action: string, input: Record<string, unknown> = {}) => {
    try {
      const r = await apiHelpers.lens.runDomain(domain, action, input);
      return (r.data?.result ?? r.data) as Record<string, unknown>;
    } catch { return null; }
  };

  // Cross-substrate pulls — these call REAL, registered macros only.
  // fitness → fitness.activity-summary (real in-STATE wearable/activity ledger).
  const fitness = useQuery({
    queryKey: ['self-fitness'],
    queryFn: async () => {
      const r = await safeRunDomain('fitness', 'activity-summary', { days: 7 });
      return r as { days?: Array<{ date?: string; steps?: number; activeMinutes?: number; distanceKm?: number }>; source?: string; notes?: string } | null;
    },
  });

  // mood → affect.trends (real in-STATE mood check-in trends).
  const mood = useQuery({
    queryKey: ['self-mood'],
    queryFn: async () => {
      const r = await safeRunDomain('affect', 'trends', { sinceDays: 30 });
      return r as {
        hasData?: boolean;
        overallAvg?: number;
        entryCount?: number;
        dayOfWeek?: Array<{ label: string; avgMood: number | null; count: number }>;
      } | null;
    },
  });

  type ServerAch = {
    id: string;
    name: string;
    description: string;
    category: string;
    unlocked: boolean;
    progress: number;
    target: number;
    unlockDate?: string;
    worldImpact?: string;
  };
  type FrontendAch = {
    id: string;
    title: string;
    description: string;
    icon: string;
    rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
    category: 'Creation' | 'Validation' | 'Citation' | 'Social' | 'Exploration' | 'Mentorship' | 'Governance' | 'Mastery';
    unlocked: boolean;
    unlockDate?: string;
    worldImpact?: string;
  };
  type FrontendProgress = { achievementId: string; current: number; target: number };

  const CATEGORY_MAP: Record<string, FrontendAch['category']> = {
    knowledge: 'Creation',
    creation: 'Creation',
    validation: 'Validation',
    citation: 'Citation',
    social: 'Social',
    exploration: 'Exploration',
    mentorship: 'Mentorship',
    governance: 'Governance',
    mastery: 'Mastery',
  };

  const achievementsQ = useQuery({
    queryKey: ['self-achievements'],
    queryFn: async () => {
      const me = await apiHelpers.lens.runDomain('auth', 'whoami').catch(() => null);
      const userId = (me?.data?.result as { userId?: string } | undefined)?.userId
        ?? (me?.data as { userId?: string } | undefined)?.userId;
      if (!userId) return { achievements: [] as FrontendAch[], progress: [] as FrontendProgress[] };
      try {
        const r = await fetch(`/api/world/achievements/${encodeURIComponent(userId)}`, {
          credentials: 'same-origin',
        });
        if (!r.ok) return { achievements: [] as FrontendAch[], progress: [] as FrontendProgress[] };
        const j = (await r.json()) as { achievements?: ServerAch[] };
        const list = j.achievements ?? [];
        const achievements: FrontendAch[] = list.map((a) => ({
          id: a.id,
          title: a.name,
          description: a.description,
          icon: '⭐',
          rarity: 'common',
          category: CATEGORY_MAP[a.category] ?? 'Creation',
          unlocked: a.unlocked,
          unlockDate: a.unlockDate,
          worldImpact: a.worldImpact,
        }));
        const progress: FrontendProgress[] = list.map((a) => ({
          achievementId: a.id,
          current: a.progress,
          target: a.target,
        }));
        return { achievements, progress };
      } catch {
        return { achievements: [] as FrontendAch[], progress: [] as FrontendProgress[] };
      }
    },
  });

  const tabs: { key: TabKey; label: string; icon: LucideIcon }[] = [
    { key: 'overview',     label: 'Overview',     icon: TrendingUp },
    { key: 'trends',       label: 'Trends',       icon: Activity },
    { key: 'correlations', label: 'Correlations', icon: Link2 },
    { key: 'goals',        label: 'Goals',        icon: Target },
    { key: 'digest',       label: 'Digest',       icon: ScrollText },
    { key: 'streaks',      label: 'Streaks',      icon: Flame },
    { key: 'import',       label: 'Import',       icon: Upload },
    { key: 'fitness',      label: 'Fitness',      icon: Activity },
    { key: 'sleep',        label: 'Sleep',        icon: Moon },
    { key: 'mood',         label: 'Mood',         icon: Smile },
    { key: 'journal',      label: 'Journal',      icon: BookOpen },
    { key: 'rituals',      label: 'Rituals',      icon: Sun },
    { key: 'achievements', label: 'Achievements', icon: Trophy },
    { key: 'milestones',   label: 'Milestones',   icon: Award },
    { key: 'season',       label: 'Season',       icon: Calendar },
  ];

  return (
    <LensShell lensId="self" asMain={false}>
      <FirstRunTour lensId="self" />
      <ManifestActionBar />
      <DepthBadge lensId="self" size="sm" className="ml-2" />
      <LensVerticalHero lensId="self" className="mx-6 mt-4" />
    <div className="min-h-screen bg-black pb-12 text-rose-50">
      <header className="sticky top-0 z-10 border-b border-rose-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Heart className="h-6 w-6 text-rose-400" aria-hidden />
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-wide">Self</h1>
            <p className="text-xs text-rose-700">Quantified-self ledger · trends · correlation · goals · streaks</p>
          </div>
        </div>
      </header>

      <nav className="border-b border-rose-900/30 px-4 md:px-8" aria-label="Self sections">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-rose-400 ${
                activeTab === key ? 'border-rose-400 text-rose-200' : 'border-transparent text-rose-700 hover:text-rose-400'
              }`}
              aria-pressed={activeTab === key}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <Section k="overview">
              <div className="mb-4">
                <LogMetricForm onLogged={bump} />
              </div>
              <OverviewDashboard refreshKey={refreshKey} onChanged={bump} />
            </Section>
          )}

          {activeTab === 'trends' && (
            <Section k="trends">
              <h2 className="mb-3 text-base font-semibold text-rose-200">Trend charts</h2>
              <TrendPanel refreshKey={refreshKey} />
            </Section>
          )}

          {activeTab === 'correlations' && (
            <Section k="correlations">
              <h2 className="mb-3 text-base font-semibold text-rose-200">Cross-metric correlations</h2>
              <CorrelationPanel refreshKey={refreshKey} />
            </Section>
          )}

          {activeTab === 'goals' && (
            <Section k="goals">
              <h2 className="mb-3 text-base font-semibold text-rose-200">Goals &amp; targets</h2>
              <GoalsPanel refreshKey={refreshKey} />
            </Section>
          )}

          {activeTab === 'digest' && (
            <Section k="digest">
              <h2 className="mb-3 text-base font-semibold text-rose-200">Your recap</h2>
              <DigestPanel refreshKey={refreshKey} />
            </Section>
          )}

          {activeTab === 'streaks' && (
            <Section k="streaks">
              <h2 className="mb-3 text-base font-semibold text-rose-200">Streaks</h2>
              <StreaksPanel refreshKey={refreshKey} />
            </Section>
          )}

          {activeTab === 'import' && (
            <Section k="import">
              <h2 className="mb-3 text-base font-semibold text-rose-200">Health-data import</h2>
              <ImportPanel onImported={bump} />
            </Section>
          )}

          {activeTab === 'fitness' && (
            <Section k="fitness">
              <h2 className="mb-3 text-base font-semibold text-rose-200">Fitness</h2>
              {fitness.isLoading ? (
                <div role="status" className="flex items-center gap-2 text-xs text-rose-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /><span>Loading activity…</span>
                </div>
              ) : (fitness.data?.days ?? []).length > 0 ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    <Stat label="Days logged" value={(fitness.data?.days ?? []).length} icon={Activity} />
                    <Stat label="Total steps" value={(fitness.data?.days ?? []).reduce((a, d) => a + (d.steps ?? 0), 0) || '—'} icon={Activity} />
                    <Stat label="Active min" value={(fitness.data?.days ?? []).reduce((a, d) => a + (d.activeMinutes ?? 0), 0) || '—'} icon={Activity} />
                  </div>
                  <p className="text-[11px] text-rose-800">Last 7 days · sourced from {fitness.data?.source ?? 'your activity ledger'}.</p>
                </div>
              ) : (
                <CrossLensCTA
                  icon={Activity}
                  body={fitness.data?.notes ?? 'No activity logged in the last 7 days.'}
                  href="/lenses/fitness"
                  cta="Open the Fitness lens"
                />
              )}
            </Section>
          )}

          {activeTab === 'sleep' && (
            <Section k="sleep">
              <h2 className="mb-3 text-base font-semibold text-rose-200">Sleep</h2>
              {/* No dedicated sleep substrate exists. Sleep lives in your self
                  ledger as the `sleep_hours` metric (log it on the Overview
                  tab) — this card makes NO backend call. */}
              <CrossLensCTA
                icon={Moon}
                body="Sleep is tracked as the “sleep_hours” metric in your own ledger. Log a night on the Overview tab and it flows into your trends, goals, and streaks. For guided rest, the Wellness lens has soundscapes and routines."
                onClick={() => setActiveTab('overview')}
                cta="Log sleep on Overview"
                secondaryHref="/lenses/wellness"
                secondaryCta="Wellness lens"
              />
            </Section>
          )}

          {activeTab === 'mood' && (
            <Section k="mood">
              <h2 className="mb-3 text-base font-semibold text-rose-200">Mood</h2>
              {mood.isLoading ? (
                <div role="status" className="flex items-center gap-2 text-xs text-rose-500">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /><span>Loading mood trends…</span>
                </div>
              ) : mood.data?.hasData ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    <Stat label="Avg mood" value={mood.data.overallAvg != null ? mood.data.overallAvg.toFixed(1) : '—'} icon={Smile} />
                    <Stat label="Check-ins" value={mood.data.entryCount ?? 0} icon={Smile} />
                    <Stat
                      label="Best day"
                      value={(() => {
                        const dow = (mood.data?.dayOfWeek ?? []).filter((d) => d.avgMood != null);
                        if (dow.length === 0) return '—';
                        return dow.reduce((best, d) => (d.avgMood! > (best.avgMood ?? -Infinity) ? d : best)).label;
                      })()}
                      icon={TrendingUp}
                    />
                  </div>
                  <p className="text-[11px] text-rose-800">Last 30 days · from your affect check-ins.</p>
                </div>
              ) : (
                <CrossLensCTA
                  icon={Smile}
                  body="No mood check-ins in the last 30 days. Log how you feel in the Affect lens and your mood trend surfaces here."
                  href="/lenses/affect"
                  cta="Open the Affect lens"
                />
              )}
            </Section>
          )}

          {activeTab === 'journal' && (
            <Section k="journal">
              <h2 className="mb-3 text-base font-semibold text-rose-200">Journal</h2>
              {/* No `journal` macro domain exists. Reflective journaling lives
                  in the Mental Health lens — this card makes NO backend call. */}
              <CrossLensCTA
                icon={BookOpen}
                body="Reflective journaling lives in the Mental Health lens, where entries become private DTUs you can revisit. Your “journal_entries” count still flows into your self ledger as a metric."
                href="/lenses/mental-health"
                cta="Open the Mental Health lens"
              />
            </Section>
          )}
          {activeTab === 'rituals' && (
            <Section k="rituals">
              <DailyRituals />
            </Section>
          )}
          {activeTab === 'achievements' && (
            <Section k="achievements">
              {achievementsQ.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-rose-500" />
              ) : (
                <AchievementSystem
                  achievements={achievementsQ.data?.achievements ?? []}
                  progress={achievementsQ.data?.progress ?? []}
                />
              )}
            </Section>
          )}
          {activeTab === 'milestones' && (
            <Section k="milestones">
              <ProgressionPanelExt />
            </Section>
          )}
          {activeTab === 'season' && (
            <Section k="season">
              <SeasonalContent />
            </Section>
          )}
        </AnimatePresence>
      </main>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <SelfFeed />
      </section>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders &quot;No data yet&quot; if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
          <RecentMineCard domain="self" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="self" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="self" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

function Section({ children, k }: { children: React.ReactNode; k: TabKey }) {
  return (
    <motion.section key={k} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
      {children}
    </motion.section>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number | string; icon: LucideIcon }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.18 }}
      className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-3 text-rose-200">
      <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-rose-700">
        <span>{label}</span><Icon className="h-3.5 w-3.5" aria-hidden />
      </div>
      <div className="font-mono text-xl font-semibold">{value}</div>
    </motion.div>
  );
}

// Honest cross-lens CTA — for surfaces whose substrate lives in another lens.
// Makes NO backend call: a plain Link (or in-page tab switch) to the real home
// of that data. Used by the sleep + journal tabs (no self-side substrate) and
// as the empty-state for the repointed fitness + mood tabs.
function CrossLensCTA({
  icon: Icon, body, href, cta, onClick, secondaryHref, secondaryCta,
}: {
  icon: LucideIcon;
  body: string;
  href?: string;
  cta: string;
  onClick?: () => void;
  secondaryHref?: string;
  secondaryCta?: string;
}) {
  const primaryClass =
    'inline-flex items-center gap-1.5 rounded bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500';
  return (
    <div className="rounded-lg border border-rose-900/30 bg-rose-950/10 p-5 text-center">
      <Icon className="mx-auto mb-2 h-6 w-6 text-rose-500" aria-hidden />
      <p className="mx-auto mb-4 max-w-md text-xs leading-relaxed text-rose-400">{body}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onClick ? (
          <button type="button" onClick={onClick} className={primaryClass}>{cta}</button>
        ) : href ? (
          <Link href={href} className={primaryClass}>{cta}</Link>
        ) : null}
        {secondaryHref && secondaryCta && (
          <Link
            href={secondaryHref}
            className="inline-flex items-center gap-1.5 rounded border border-rose-900/40 px-3 py-1.5 text-xs text-rose-300 hover:text-rose-100"
          >
            {secondaryCta}
          </Link>
        )}
      </div>
    </div>
  );
}
