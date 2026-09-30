'use client';

/**
 * Forum — one Reddit/Discourse community app.
 *
 * Single view union (discourse | board | chatter | actions). Former welded
 * pile (ForumSection always-on + inline Reddit board + desk overlays) is
 * folded into panels under components/forum/. Macros preserved.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { MessagesSquare, Flame, MessageCircle, Shield } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { DiscoursePanel } from '@/components/forum/DiscoursePanel';
import { BoardPanel } from '@/components/forum/BoardPanel';
import { ChatterPanel } from '@/components/forum/ChatterPanel';
import { ModToolsPanel } from '@/components/forum/ModToolsPanel';

type ForumView = 'discourse' | 'board' | 'chatter' | 'actions';

const VIEWS: { id: ForumView; label: string; keys: string; hint: string; icon: typeof Flame }[] = [
  { id: 'discourse', label: 'Discourse', keys: '1', hint: 'Topics · communities · inbox', icon: MessagesSquare },
  { id: 'board', label: 'Board', keys: '2', hint: 'Hot · new · top · rising', icon: Flame },
  { id: 'chatter', label: 'Chatter', keys: '3', hint: 'Live discussion', icon: MessageCircle },
  { id: 'actions', label: 'Mod tools', keys: '4', hint: 'Analytics · queue', icon: Shield },
];

const PANELS: Record<ForumView, ComponentType> = {
  discourse: DiscoursePanel,
  board: BoardPanel,
  chatter: ChatterPanel,
  actions: ModToolsPanel,
};

export default function ForumLensPage() {
  useLensNav('forum');
  useLensIdentity('forum');
  const { latestData: realtimeData, alerts: realtimeAlerts, isLive, lastUpdated } = useRealtimeLens('forum');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<ForumView>('discourse');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'forum' },
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
    <LensShell lensId="forum" asMain={false}>
      <FirstRunTour lensId="forum" />
      <DepthBadge lensId="forum" size="sm" className="ml-2" />
      <div data-lens-theme="forum" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Flame className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Forum</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="forum" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                Reddit board + Discourse topics — one community desk.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Forum views"
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
          <motion.div key={active} {...motionProps}>
            <Panel />
          </motion.div>
        </AnimatePresence>

        <section className="mt-3">
          <SessionRail lensId="forum" hideWhenEmpty />
        </section>
        <CrossLensRecentsPanel lensId="forum" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
