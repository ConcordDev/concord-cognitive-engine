'use client';

/**
 * Metalearning — one Anki / learning-strategy coach app.
 *
 * Single `active` union. Practice panels, strategy desk, analysis engines,
 * and research feed each own a tab. Accordion feed boolean is gone.
 */

import { useState } from 'react';
import {
  Sparkles, Brain, BookOpen, Target, Lightbulb,
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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

const TABS: { id: MlView; label: string; icon: typeof Brain; keys: string; title: string }[] = [
  { id: 'strategies', title: 'How you learn best', label: 'Strategies', icon: Sparkles, keys: '1' },
  { id: 'spaced', title: 'What to review today', label: 'Spaced', icon: Brain, keys: '2' },
  { id: 'plan', title: 'The path to the goal', label: 'Plan', icon: BookOpen, keys: '3' },
  { id: 'techniques', title: 'Methods that work', label: 'Techniques', icon: Lightbulb, keys: '4' },
  { id: 'progress', title: 'How far you have come', label: 'Progress', icon: BarChart3, keys: '5' },
  { id: 'goals', title: 'What you are aiming at', label: 'Goals', icon: Target, keys: '6' },
  { id: 'experiments', title: 'Test a strategy', label: 'Experiments', icon: FlaskConical, keys: '7' },
  { id: 'journal', title: 'What you studied', label: 'Journal', icon: NotebookPen, keys: '8' },
  { id: 'analysis', title: 'What the data says', label: 'Analysis', icon: Puzzle, keys: '9' },
  { id: 'feed', title: 'What the research says', label: 'Research', icon: Rss, keys: '0' },
];

export default function MetalearningLensPage() {
  useLensNav('metalearning');
  useLensIdentity('metalearning');
  const { latestData: realtimeData, alerts: realtimeAlerts, isLive, lastUpdated } = useRealtimeLens('metalearning');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<MlView>('strategies');
  const current = TABS.find((t) => t.id === active)!;

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
      <div data-lens-theme="metalearning" className="relative min-h-full px-8 pb-28 pt-6">
        <a href="#metalearning-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
          Skip to metalearning content
        </a>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Meta-learning</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'strategies' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-[11px] text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <DTUExportButton domain="metalearning" data={realtimeData || {}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Metalearning views">
          {TABS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <main id="metalearning-main">
          <div key={active}>
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
          </div>
        </main>

        <ConnectiveTissueBar lensId="metalearning" />
        <CrossLensRecentsPanel lensId="metalearning" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={() => setActive('spaced')}
          title="Start spaced practice"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Brain className="h-4 w-4" />
          Start practice
        </button>
      </div>
    </LensShell>
  );
}
