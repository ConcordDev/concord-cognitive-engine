'use client';

/**
 * Queue — one Sidekiq/BullMQ console.
 * Thin shell: single `active` union → panels. Macros live in useQueueData /
 * useQueueActions + child panels.
 */

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Inbox, Activity, CalendarClock, ShieldAlert, Server, LayoutDashboard, Code2 as Github,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { JobDetailDrawer } from '@/components/queue/JobDetailDrawer';
import { QueueRepos } from '@/components/queue/QueueRepos';
import { OverviewPanel } from '@/components/queue/OverviewPanel';
import {
  JobsPanel, ScheduledPanel, DeadLetterPanel, WorkersPanel, AnalyticsTabPanel,
  type QueueTab,
} from '@/components/queue/QueueTabPanels';
import { useQueueActions, useQueueData } from '@/components/queue/useQueueData';

const VIEWS: { id: QueueTab; label: string; keys: string; icon: typeof Inbox }[] = [
  { id: 'overview', label: 'Overview', keys: 'o', icon: LayoutDashboard },
  { id: 'jobs', label: 'Jobs', keys: 'j', icon: Inbox },
  { id: 'scheduled', label: 'Scheduled', keys: 's', icon: CalendarClock },
  { id: 'dead', label: 'Dead-letter', keys: 'd', icon: ShieldAlert },
  { id: 'workers', label: 'Workers', keys: 'w', icon: Server },
  { id: 'analytics', label: 'Analytics', keys: 'a', icon: Activity },
  { id: 'repos', label: 'Repos', keys: 'g', icon: Github },
];

export default function QueueLensPage() {
  useLensNav('queue');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<QueueTab>('overview');
  const actions = useQueueActions();
  const data = useQueueData(active, actions.queueFilter);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `queue-${v.id}`,
        keys: v.keys,
        description: `${v.label} tab`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      {
        id: 'queue-next',
        keys: 'n',
        description: 'Process next job',
        category: 'actions' as const,
        action: actions.handleProcessNext,
      },
    ],
    { lensId: 'queue' },
  );

  const t = data.metrics?.totals;

  return (
    <LensShell lensId="queue" asMain={false}>
      <FirstRunTour lensId="queue" />
      <DepthBadge lensId="queue" size="sm" className="ml-2" />
      <div data-lens-theme="queue" className="space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📥</span>
            <div>
              <h1 className="text-xl font-bold">Queue Console</h1>
              <p className="text-sm text-gray-400">
                Job queue management — enqueue, process, retry, dead-letter, schedule
              </p>
            </div>
          </div>
        </header>

        <nav className="flex flex-wrap gap-2" aria-label="Queue views">
          {VIEWS.map((tabDef) => {
            const count =
              tabDef.id === 'jobs' ? t?.all
              : tabDef.id === 'scheduled' ? t?.delayed
              : tabDef.id === 'dead' ? (t?.failed ?? 0) + (t?.dead ?? 0)
              : tabDef.id === 'workers' ? data.workers.length
              : undefined;
            const Icon = tabDef.icon;
            const on = active === tabDef.id;
            return (
              <button
                key={tabDef.id}
                type="button"
                onClick={() => setActive(tabDef.id)}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-4 py-2 transition-colors',
                  on
                    ? 'border border-neon-blue/30 bg-neon-blue/20 text-neon-blue'
                    : 'bg-lattice-surface text-gray-400 hover:text-white',
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{tabDef.label}</span>
                {count != null && (
                  <span className="rounded bg-lattice-elevated px-2 py-0.5 text-xs">{count}</span>
                )}
                <kbd className="hidden sm:inline-block text-[10px] text-white/30 font-mono">
                  {tabDef.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
          >
            {active === 'overview' && (
              <OverviewPanel
                metrics={data.metrics}
                queues={data.queues}
                events={data.events}
                queueFilter={actions.queueFilter}
                setQueueFilter={actions.setQueueFilter}
                onProcessNext={actions.handleProcessNext}
                onControl={actions.handleControl}
                onConcurrency={actions.handleConcurrency}
                onClearCompleted={actions.handleClearCompleted}
                onEnqueue={actions.handleEnqueue}
              />
            )}
            {active === 'jobs' && (
              <JobsPanel
                jobs={data.jobs}
                busyId={actions.busyId}
                queueFilter={actions.queueFilter}
                setQueueFilter={actions.setQueueFilter}
                onProcess={actions.handleProcess}
                onRetry={actions.handleRetry}
                onRemove={actions.handleRemove}
                onSelect={actions.openDetail}
              />
            )}
            {active === 'scheduled' && (
              <ScheduledPanel
                jobs={data.scheduledQ.data?.jobs || []}
                busyId={actions.busyId}
                onProcess={actions.handleProcess}
                onRetry={actions.handleRetry}
                onRemove={actions.handleRemove}
                onSelect={actions.openDetail}
              />
            )}
            {active === 'dead' && (
              <DeadLetterPanel
                jobs={data.deadQ.data?.jobs || []}
                busyId={actions.busyId}
                onProcess={actions.handleProcess}
                onRetry={actions.handleRetry}
                onRemove={actions.handleRemove}
                onSelect={actions.openDetail}
                onDeadBulk={actions.handleDeadBulk}
              />
            )}
            {active === 'workers' && (
              <WorkersPanel
                workers={data.workers}
                onRegister={() => actions.handleRegisterWorker(data.workers.length)}
                onStop={actions.handleStopWorker}
              />
            )}
            {active === 'analytics' && (
              <AnalyticsTabPanel allJobs={data.allJobs} servers={data.workers.length || 1} />
            )}
            {active === 'repos' && (
              <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                <h2 className="mb-3 text-sm font-semibold text-white">
                  Queue tooling (external reference)
                </h2>
                <QueueRepos />
              </section>
            )}
          </motion.div>
        </AnimatePresence>

        <ConnectiveTissueBar lensId="queue" />
        <CrossLensRecentsPanel lensId="queue" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>

      <JobDetailDrawer
        job={actions.detail?.job || null}
        history={actions.detail?.history || []}
        onClose={() => actions.setDetail(null)}
        onProcess={actions.handleProcess}
        onRetry={actions.handleRetry}
        onRemove={actions.handleRemove}
      />
    </LensShell>
  );
}
