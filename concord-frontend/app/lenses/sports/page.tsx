'use client';

/**
 * Sports lens — one ESPN/FotMob scores app.
 *
 * Single view union. Accordion booleans for activity/scoreboard/spectator
 * are folded into `active`. Duplicate analysis macros live only in
 * ActivityActionPanel. Each view is a panel that owns its hooks.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  BarChart3,
  Radio,
  Swords,
  Target,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LiveScoreboard } from '@/components/sports/LiveScoreboard';
import { SportsFanSection } from '@/components/sports/SportsFanSection';
import { SportsSpectatorHub } from '@/components/sports/SportsSpectatorHub';
import { SportsMatchesPanel } from '@/components/sports/SportsMatchesPanel';
import { SportsStatsPanel } from '@/components/sports/SportsStatsPanel';
import { SportsTrainingPanel } from '@/components/sports/SportsTrainingPanel';
import { SportsLeaguesPanel } from '@/components/sports/SportsLeaguesPanel';
import { SportsActivityView } from '@/components/sports/SportsActivityView';

type SportsView =
  | 'scores'
  | 'club'
  | 'matches'
  | 'stats'
  | 'training'
  | 'leagues'
  | 'spectator'
  | 'activity';

const VIEWS: { id: SportsView; label: string; keys: string; hint: string; icon: typeof Trophy }[] = [
  { id: 'scores', label: 'Scores', keys: '1', hint: 'Live ESPN scoreboard', icon: Radio },
  { id: 'club', label: 'My ESPN', keys: '2', hint: 'Watchlist · pick’em · teams', icon: Users },
  { id: 'matches', label: 'Matches', keys: '3', hint: 'Personal fixtures', icon: Trophy },
  { id: 'stats', label: 'Record', keys: '4', hint: 'W-D-L and form', icon: BarChart3 },
  { id: 'training', label: 'Training', keys: '5', hint: 'Session log', icon: Target },
  { id: 'leagues', label: 'Leagues', keys: '6', hint: 'Live engine', icon: Swords },
  { id: 'spectator', label: 'Spectator', keys: '7', hint: 'PBP · news · brackets', icon: Zap },
  { id: 'activity', label: 'Workbench', keys: '8', hint: 'Fantasy / Strava macros', icon: Activity },
];

const PANELS: Record<SportsView, ComponentType> = {
  scores: LiveScoreboard,
  club: SportsFanSection,
  matches: SportsMatchesPanel,
  stats: SportsStatsPanel,
  training: SportsTrainingPanel,
  leagues: SportsLeaguesPanel,
  spectator: SportsSpectatorHub,
  activity: SportsActivityView,
};

export default function SportsLensPage() {
  useLensNav('sports');
  useLensIdentity('sports');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('sports');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<SportsView>('scores');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'sports' },
  );

  const Panel = PANELS[active];
  const motionProps = useMemo(
    () =>
      reduceMotion
        ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
        : {
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: -6 },
            transition: { duration: 0.16 },
          },
    [reduceMotion],
  );

  return (
    <LensShell lensId="sports" asMain={false}>
      <FirstRunTour lensId="sports" />
      <DepthBadge lensId="sports" size="sm" className="ml-2" />
      <div data-lens-theme="sports" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Trophy className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Sports</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="sports" data={realtimeData || {}} compact />
              </div>
              <p className={ds.textMuted}>
                ESPN scores + FotMob fixtures — live board, personal matches, leagues.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Sports views"
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
            {active === 'scores' && (
              <div className="space-y-4">
                <LiveScoreboard />
                <LensFeedPanel lensId="sports" />
              </div>
            )}
            {active !== 'scores' && <Panel />}
          </motion.div>
        </AnimatePresence>

        <RealtimeDataPanel
          domain="sports"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={insights}
          compact
        />
        <section className="mt-4">
          <LensFeedButton domain="sports" label="Live fixtures feed" />
        </section>
        <SessionRail lensId="sports" hideWhenEmpty />
        <CrossLensRecentsPanel lensId="sports" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
