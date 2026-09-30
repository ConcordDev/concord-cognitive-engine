'use client';

/**
 * Goals — one OKR / personal-goal / agent-autonomy app.
 *
 * Single view union (goals | challenges | milestones | okr | analytics |
 * autonomy | feed). Hero/create/list logic lives in panels. Page is a thin
 * shell (paper/agents gold).
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Target, Swords, TrendingUp, Flag, Zap, Users,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { GoalsListPanel } from '@/components/goals/GoalsListPanel';
import { ChallengesPanel } from '@/components/goals/ChallengesPanel';
import { MilestonesPanel } from '@/components/goals/MilestonesPanel';
import { OKRWorkspace } from '@/components/goals/OKRWorkspace';
import { GoalsAnalyticsTools } from '@/components/goals/GoalsAnalyticsTools';
import { AgentAutonomyPanel } from '@/components/goals/AgentAutonomyPanel';
import { ProductivityFeed } from '@/components/goals/ProductivityFeed';
import type { GoalTab } from '@/components/goals/goals-model';

const VIEWS: { id: GoalTab; label: string; keys: string; hint: string; icon: typeof Target }[] = [
  { id: 'goals', label: 'Goals', keys: 'g', hint: 'Personal goal tracker', icon: Target },
  { id: 'challenges', label: 'Challenges', keys: 'c', hint: 'Self-tracked streaks', icon: Swords },
  { id: 'milestones', label: 'Milestones', keys: 'm', hint: 'Completions + badges', icon: TrendingUp },
  { id: 'okr', label: 'OKRs', keys: 'o', hint: 'Alignment · check-ins · teams', icon: Flag },
  { id: 'analytics', label: 'Analytics', keys: 'a', hint: 'Scoring · decompose · forecast', icon: TrendingUp },
  { id: 'autonomy', label: 'Autonomy', keys: 'u', hint: 'Agent goal system', icon: Zap },
  { id: 'feed', label: 'Feed', keys: 'f', hint: 'Productivity community', icon: Users },
];

const PANELS: Record<GoalTab, ComponentType> = {
  goals: GoalsListPanel,
  challenges: ChallengesPanel,
  milestones: MilestonesPanel,
  okr: OKRWorkspace,
  analytics: GoalsAnalyticsTools,
  autonomy: AgentAutonomyPanel,
  feed: ProductivityFeed,
};

export default function GoalsLensPage() {
  useLensNav('goals');
  useLensIdentity('goals');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('goals');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<GoalTab>('goals');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'goals' },
  );

  const Panel = PANELS[active];
  const motionProps = useMemo(
    () => (reduceMotion
      ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -6 },
          transition: { duration: 0.16 },
        }),
    [reduceMotion],
  );

  return (
    <LensShell lensId="goals" asMain={false}>
      <FirstRunTour lensId="goals" />
      <DepthBadge lensId="goals" size="sm" className="ml-2" />
      <div data-lens-theme="goals" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Target className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Goals &amp; OKRs</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="goals" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                Personal goals, team OKRs, and Concord&apos;s own agent goal system
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Goals views"
        >
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on
                    ? 'border-[var(--lens-accent)] text-white'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {v.label}
                <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                  {v.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps} className="pt-4">
            <Panel />
          </motion.div>
        </AnimatePresence>

        {realtimeData && (
          <RealtimeDataPanel
            domain="goals"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}

        <CrossLensRecentsPanel lensId="goals" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
