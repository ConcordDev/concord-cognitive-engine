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
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { lensRun } from '@/lib/api/client';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { cn } from '@/lib/utils';
import { onRovingTabsKeyDown, rovingTabIndex } from '@/lib/a11y/roving-tabs';
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

      <DepthBadge lensId="thread" size="sm" className="ml-2" />
      <div data-lens-theme="thread" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Thread</h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-1 text-[12px] text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton
              domain="thread"
              data={realtimeData || {}}
              compact
              prepare={async () => {
                // The export carries the lens's own records: the caller's
                // composer drafts (full detail), their queue, and the
                // dashboard counts. Drafts live in the composer's store,
                // which the generic artifact export cannot see.
                const [dl, q, dash] = await Promise.all([
                  lensRun('thread', 'draft-list', {}),
                  lensRun('thread', 'queue-list', {}),
                  lensRun('thread', 'thread-dashboard', {}),
                ]);
                const metas = (dl.data?.result?.drafts as Array<{ id: string }> | undefined) || [];
                const drafts = await Promise.all(metas.map(async (m) => {
                  const detail = await lensRun('thread', 'draft-detail', { id: m.id });
                  return detail.data?.result?.draft ?? m;
                }));
                if (drafts.length === 0) return {};
                return {
                  source: 'thread-lens',
                  drafts,
                  queue: q.data?.result?.queue ?? [],
                  dashboard: dash.data?.result ?? null,
                };
              }}
            />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto no-scrollbar rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Thread views" onKeyDown={onRovingTabsKeyDown}>
          {VIEWS.map((v, i) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                tabIndex={rovingTabIndex(on, i, true)}
                onClick={() => setActive(v.id)}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            {active === 'map' ? (
              <ThreadMapPanel onOpenComposer={() => setActive('composer')} />
            ) : (
              <Panel />
            )}
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
            className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] right-[4.75rem] z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 min-h-[44px] max-w-[calc(100vw-6.5rem)] px-4 py-2.5 sm:px-6 sm:py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 md:bottom-8 lg:right-8"
          >
            <Plus className="h-4 w-4" />
            New post
          </button>
        )}
      </div>
    </LensShell>
  );
}
