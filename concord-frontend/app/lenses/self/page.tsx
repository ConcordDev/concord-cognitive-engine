'use client';

/**
 * Unified Self Lens — quantified-self surface.
 * Thin shell + one `active` union; panels own substrate pulls.
 */

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
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
import { FitnessSubstratePanel } from '@/components/self/FitnessSubstratePanel';
import { MoodSubstratePanel } from '@/components/self/MoodSubstratePanel';
import { SleepRedirectPanel } from '@/components/self/SleepRedirectPanel';
import { JournalRedirectPanel } from '@/components/self/JournalRedirectPanel';
import { RitualsTabPanel } from '@/components/self/RitualsTabPanel';
import { AchievementsTabPanel } from '@/components/self/AchievementsTabPanel';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart, Moon, Smile, BookOpen, Activity, TrendingUp,
  Sun, Trophy, Award, Calendar, Link2, Target, ScrollText, Flame, Upload,
  type LucideIcon,
} from 'lucide-react';
import dynamic from 'next/dynamic';

const ProgressionPanelExt = dynamic(() => import('@/components/world-lens/ProgressionPanel'), { ssr: false });
const SeasonalContent = dynamic(() => import('@/components/world-lens/SeasonalContent'), { ssr: false });

type TabKey =
  | 'overview' | 'trends' | 'correlations' | 'goals' | 'digest' | 'streaks' | 'import'
  | 'fitness' | 'sleep' | 'mood' | 'journal'
  | 'rituals' | 'achievements' | 'milestones' | 'season';

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
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

export default function UnifiedSelfLensPage() {
  useLensNav('self');
  const [active, setActive] = useState<TabKey>('overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  useLensCommand(
    [
      { id: 'goto-overview', keys: 'o', description: 'Overview', category: 'navigation', action: () => setActive('overview') },
      { id: 'goto-trends', keys: 't', description: 'Trends', category: 'navigation', action: () => setActive('trends') },
      { id: 'goto-correlations', keys: 'c', description: 'Correlations', category: 'navigation', action: () => setActive('correlations') },
      { id: 'goto-goals', keys: 'g', description: 'Goals', category: 'navigation', action: () => setActive('goals') },
      { id: 'goto-streaks', keys: 'k', description: 'Streaks', category: 'navigation', action: () => setActive('streaks') },
      { id: 'goto-import', keys: 'i', description: 'Import', category: 'navigation', action: () => setActive('import') },
    ],
    { lensId: 'self' }
  );

  return (
    <LensShell lensId="self" asMain={false}>
      <FirstRunTour lensId="self" />
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
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActive(key)}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-rose-400 ${
                  active === key ? 'border-rose-400 text-rose-200' : 'border-transparent text-rose-700 hover:text-rose-400'
                }`}
                aria-pressed={active === key}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              </button>
            ))}
          </div>
        </nav>

        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
          <AnimatePresence mode="wait">
            <motion.section
              key={active}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {active === 'overview' && (
                <>
                  <div className="mb-4"><LogMetricForm onLogged={bump} /></div>
                  <OverviewDashboard refreshKey={refreshKey} onChanged={bump} />
                </>
              )}
              {active === 'trends' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Trend charts</h2><TrendPanel refreshKey={refreshKey} /></>)}
              {active === 'correlations' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Cross-metric correlations</h2><CorrelationPanel refreshKey={refreshKey} /></>)}
              {active === 'goals' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Goals &amp; targets</h2><GoalsPanel refreshKey={refreshKey} /></>)}
              {active === 'digest' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Your recap</h2><DigestPanel refreshKey={refreshKey} /></>)}
              {active === 'streaks' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Streaks</h2><StreaksPanel refreshKey={refreshKey} /></>)}
              {active === 'import' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Health-data import</h2><ImportPanel onImported={bump} /></>)}
              {active === 'fitness' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Fitness</h2><FitnessSubstratePanel /></>)}
              {active === 'sleep' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Sleep</h2><SleepRedirectPanel onLogSleep={() => setActive('overview')} /></>)}
              {active === 'mood' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Mood</h2><MoodSubstratePanel /></>)}
              {active === 'journal' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Journal</h2><JournalRedirectPanel /></>)}
              {active === 'rituals' && <RitualsTabPanel refreshKey={refreshKey} />}
              {active === 'achievements' && <AchievementsTabPanel />}
              {active === 'milestones' && <ProgressionPanelExt />}
              {active === 'season' && <SeasonalContent />}
            </motion.section>
          </AnimatePresence>
        </main>

        {/* Native details — no second view-state machine */}
        <details className="mx-4 mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 md:mx-8">
          <summary className="cursor-pointer text-sm font-semibold text-white">Self-improvement discussion (external reference)</summary>
          <div className="mt-3"><SelfFeed /></div>
        </details>
      </div>
      <CrossLensRecentsPanel lensId="self" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
