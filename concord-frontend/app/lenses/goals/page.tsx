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
  Target, Swords, TrendingUp, Flag, Zap, Users, Sparkles,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { GoalsListPanel, GOALS_NEW_EVENT } from '@/components/goals/GoalsListPanel';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('goals');
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const chip = 'inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[14px] text-zinc-300 transition-colors hover:border-white/20 hover:text-zinc-100';
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
      <DepthBadge lensId="goals" size="sm" className="ml-2" />
      <div data-lens-theme="goals" className="px-8 pt-4 pb-6">
        {/* North star (docs/lens-northstar/07-goals): serif greeting, two
            starter chips, quiet view links; the list follows. */}
        <h1 className="font-vault text-[2.75rem] leading-tight text-zinc-100">
          {who ? `What matters this quarter, ${who}` : 'What matters this quarter'}
        </h1>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setActive('okr')} className={chip}>
            <Sparkles className="h-4 w-4 text-violet-400" /> Review OKRs
          </button>
          <button
            type="button"
            onClick={() => { setActive('goals'); window.dispatchEvent(new CustomEvent(GOALS_NEW_EVENT, { detail: { weekly: true } })); }}
            className={chip}
          >
            <Target className="h-4 w-4 text-violet-400" /> Set a weekly focus
          </button>
        </div>
        <nav className="mt-6 mb-2 flex flex-wrap gap-4 text-[13px]" aria-label="Goals views">
          {VIEWS.map((v) => {
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={on ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
              >
                {v.label}
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
