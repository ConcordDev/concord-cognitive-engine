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
import { GitBranch, PenLine, Plus, Radio, Workflow } from 'lucide-react';
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { ThreadMapPanel } from '@/components/thread/ThreadMapPanel';
import { ComposerPanel } from '@/components/thread/ComposerPanel';
import { StudioPanel } from '@/components/thread/StudioPanel';
import { FeedPanel } from '@/components/thread/FeedPanel';

type ThreadView = 'map' | 'composer' | 'studio' | 'feed';

const VIEWS: { id: ThreadView; label: string; keys: string; title: string; hint: string; icon: typeof GitBranch }[] = [
  { id: 'map', title: 'How the conversation branches', label: 'Map', keys: '1', hint: 'Branching tree', icon: GitBranch },
  { id: 'composer', title: 'What to say next', label: 'Composer', keys: '2', hint: 'Write a post', icon: PenLine },
  { id: 'studio', title: 'Shape the thread', label: 'Studio', keys: '3', hint: 'Thread studio', icon: Workflow },
  { id: 'feed', title: 'What is being said', label: 'Feed', keys: '4', hint: 'Live feed', icon: Radio },
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
  const current = VIEWS.find((v) => v.id === active)!;
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
      <div data-lens-theme="thread" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Thread</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'map' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-1 text-[12px] text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="thread" data={realtimeData || {}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Thread views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
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

        <CrossLensRecentsPanel lensId="thread" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        {active !== 'composer' && (
          <button
            type="button"
            onClick={() => setActive('composer')}
            title="Write a post (2)"
            className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
          >
            <Plus className="h-4 w-4" />
            New post
          </button>
        )}
      </div>
    </LensShell>
  );
}
