'use client';

/**
 * Thread — one branching-conversation desk.
 *
 * Reference: GitHub PR conversation / Linear issue thread (tree + timeline).
 * Single `active` union (map | composer | studio | feed). Tree/timeline/linear
 * viewMode lives inside ThreadMapPanel. Accordion-style desk stacking is gone.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { GitBranch, MessageSquare, PenLine, Radio, Workflow } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { ThreadMapPanel } from '@/components/thread/ThreadMapPanel';
import { ComposerPanel } from '@/components/thread/ComposerPanel';
import { StudioPanel } from '@/components/thread/StudioPanel';
import { FeedPanel } from '@/components/thread/FeedPanel';

type ThreadView = 'map' | 'composer' | 'studio' | 'feed';

const VIEWS: { id: ThreadView; label: string; keys: string; hint: string; icon: typeof GitBranch }[] = [
  { id: 'map', label: 'Map', keys: '1', hint: 'Branching tree', icon: GitBranch },
  { id: 'composer', label: 'Composer', keys: '2', hint: 'Write a post', icon: PenLine },
  { id: 'studio', label: 'Studio', keys: '3', hint: 'Thread studio', icon: Workflow },
  { id: 'feed', label: 'Feed', keys: '4', hint: 'Live feed', icon: Radio },
];


const PANELS: Record<ThreadView, ComponentType> = {
  map: ThreadMapPanel,
  composer: ComposerPanel,
  studio: StudioPanel,
  feed: FeedPanel,
};

export default function ThreadLensPage() {
  useLensNav('thread');
  useLensIdentity('thread');
  const reduceMotion = useReducedMotion();
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } =
    useRealtimeLens('thread');
  const [active, setActive] = useState<ThreadView>('map');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'thread' },
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
    <LensShell lensId="thread" asMain={false}>
      <FirstRunTour lensId="thread" />
      <DepthBadge lensId="thread" size="sm" className="ml-2" />
      <div data-lens-theme="thread" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <MessageSquare className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Thread</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="thread" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>Branching conversation threads with lineage tracking</p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Thread views"
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

        {realtimeData && (
          <RealtimeDataPanel
            domain="thread"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}

        <CrossLensRecentsPanel lensId="thread" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
