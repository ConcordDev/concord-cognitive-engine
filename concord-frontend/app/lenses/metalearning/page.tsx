'use client';

/**
 * Metalearning — one Anki / learning-strategy coach app.
 *
 * Single `active` union. Practice panels, strategy desk, analysis engines,
 * and research feed each own a tab. Accordion feed boolean is gone.
 */

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  GraduationCap, Sparkles, Brain, BookOpen, Target, Lightbulb,
  FlaskConical, NotebookPen, BarChart3, Rss, Puzzle,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { cn } from '@/lib/utils';
import { StrategiesDeskPanel } from '@/components/metalearning/StrategiesDeskPanel';
import { SpacedRepetitionPanel } from '@/components/metalearning/SpacedRepetitionPanel';
import { LearningPlanPanel } from '@/components/metalearning/LearningPlanPanel';
import { TechniqueLibraryPanel } from '@/components/metalearning/TechniqueLibraryPanel';
import { ProgressAnalyticsPanel } from '@/components/metalearning/ProgressAnalyticsPanel';
import { GoalTrackerPanel } from '@/components/metalearning/GoalTrackerPanel';
import { StrategyExperimentPanel } from '@/components/metalearning/StrategyExperimentPanel';
import { StudyJournalPanel } from '@/components/metalearning/StudyJournalPanel';
import { AnalysisPanel } from '@/components/metalearning/AnalysisPanel';
import { ResearchFeedPanel } from '@/components/metalearning/ResearchFeedPanel';

export type MlView =
  | 'strategies'
  | 'spaced'
  | 'plan'
  | 'techniques'
  | 'progress'
  | 'goals'
  | 'experiments'
  | 'journal'
  | 'analysis'
  | 'feed';

const TABS: { id: MlView; label: string; icon: typeof Brain; keys: string }[] = [
  { id: 'strategies', label: 'Strategies', icon: Sparkles, keys: '1' },
  { id: 'spaced', label: 'Spaced', icon: Brain, keys: '2' },
  { id: 'plan', label: 'Plan', icon: BookOpen, keys: '3' },
  { id: 'techniques', label: 'Techniques', icon: Lightbulb, keys: '4' },
  { id: 'progress', label: 'Progress', icon: BarChart3, keys: '5' },
  { id: 'goals', label: 'Goals', icon: Target, keys: '6' },
  { id: 'experiments', label: 'Experiments', icon: FlaskConical, keys: '7' },
  { id: 'journal', label: 'Journal', icon: NotebookPen, keys: '8' },
  { id: 'analysis', label: 'Analysis', icon: Puzzle, keys: '9' },
  { id: 'feed', label: 'Research', icon: Rss, keys: '0' },
];

export default function MetalearningLensPage() {
  useLensNav('metalearning');
  useLensIdentity('metalearning');
  const { latestData: realtimeData, alerts: realtimeAlerts, isLive, lastUpdated } = useRealtimeLens('metalearning');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<MlView>('strategies');

  useLensCommand(
    TABS.map((t) => ({
      id: `view-${t.id}`,
      keys: t.keys,
      description: t.label,
      category: 'navigation' as const,
      action: () => setActive(t.id),
    })),
    { lensId: 'metalearning' },
  );

  return (
    <LensShell lensId="metalearning" asMain={false}>
      <FirstRunTour lensId="metalearning" />
      <DepthBadge lensId="metalearning" size="sm" className="ml-2" />
      <div data-lens-theme="metalearning" className="p-6 space-y-6">
        <a href="#metalearning-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
          Skip to metalearning content
        </a>

        <header className="flex items-center gap-3 flex-wrap">
          <GraduationCap className="w-8 h-8 text-neon-purple shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold">Meta-Learning Lens</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
              <DTUExportButton domain="metalearning" data={realtimeData || {}} compact />
              {realtimeAlerts.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                  {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-400">
              Learning to learn — strategies, spaced practice, and adaptation.
            </p>
          </div>
        </header>

        <nav
          className="flex gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Metalearning views"
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on
                    ? 'border-[var(--lens-accent)] text-white'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {t.label}
                <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                  {t.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <main id="metalearning-main">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: reduceMotion ? 0 : 0.16 }}
            >
              {active === 'strategies' && <StrategiesDeskPanel />}
              {active === 'spaced' && <div className="panel p-4"><SpacedRepetitionPanel /></div>}
              {active === 'plan' && <div className="panel p-4"><LearningPlanPanel /></div>}
              {active === 'techniques' && <div className="panel p-4"><TechniqueLibraryPanel /></div>}
              {active === 'progress' && <div className="panel p-4"><ProgressAnalyticsPanel /></div>}
              {active === 'goals' && <div className="panel p-4"><GoalTrackerPanel /></div>}
              {active === 'experiments' && <div className="panel p-4"><StrategyExperimentPanel /></div>}
              {active === 'journal' && <div className="panel p-4"><StudyJournalPanel /></div>}
              {active === 'analysis' && <AnalysisPanel />}
              {active === 'feed' && <ResearchFeedPanel />}
            </motion.div>
          </AnimatePresence>
        </main>

        <ConnectiveTissueBar lensId="metalearning" />
        <CrossLensRecentsPanel lensId="metalearning" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
