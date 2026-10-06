'use client';

/**
 * Queue — one Sidekiq/BullMQ console.
 * Thin shell: single `active` union → panels. Macros live in useQueueData /
 * useQueueActions + child panels.
 */

import { useState } from 'react';
import {
  Inbox, Activity, CalendarClock, ShieldAlert, Server, LayoutDashboard, Code2 as Github, Play,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { JobDetailDrawer } from '@/components/queue/JobDetailDrawer';
import { QueueRepos } from '@/components/queue/QueueRepos';
import { OverviewPanel } from '@/components/queue/OverviewPanel';
import {
  JobsPanel, ScheduledPanel, DeadLetterPanel, WorkersPanel, AnalyticsTabPanel,
  type QueueTab,
} from '@/components/queue/QueueTabPanels';
import { useQueueActions, useQueueData } from '@/components/queue/useQueueData';

const VIEWS: { id: QueueTab; label: string; keys: string; title: string; icon: typeof Inbox }[] = [
  { id: 'overview', label: 'Overview', keys: 'o', title: 'Your queues at a glance', icon: LayoutDashboard },
  { id: 'jobs', label: 'Jobs', keys: 'j', title: 'Every job in flight', icon: Inbox },
  { id: 'scheduled', label: 'Scheduled', keys: 's', title: 'What runs later', icon: CalendarClock },
  { id: 'dead', label: 'Dead-letter', keys: 'd', title: 'What gave up', icon: ShieldAlert },
  { id: 'workers', label: 'Workers', keys: 'w', title: 'Who is doing the work', icon: Server },
  { id: 'analytics', label: 'Analytics', keys: 'a', title: 'How the queue performs', icon: Activity },
  { id: 'repos', label: 'Repos', keys: 'g', title: 'Queue tooling to learn from', icon: Github },
];

export default function QueueLensPage() {
  useLensNav('queue');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
  const current = VIEWS.find((v) => v.id === active)!;
  const countFor = (id: QueueTab) =>
    id === 'jobs' ? t?.all
    : id === 'scheduled' ? t?.delayed
    : id === 'dead' ? (t?.failed ?? 0) + (t?.dead ?? 0)
    : id === 'workers' ? data.workers.length
    : undefined;

  return (
    <LensShell lensId="queue" asMain={false}>
      <FirstRunTour lensId="queue" />
      <DepthBadge lensId="queue" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="queue"
        crumb="Queue"
        title={`${current.title}${active === 'overview' && who ? `, ${who}` : ''}`}
        subtitle="Enqueue, process, retry, dead-letter and schedule jobs."
        tabs={VIEWS.map((v) => {
          const n = countFor(v.id);
          return { id: v.id, label: n != null ? `${v.label} · ${n}` : v.label, icon: v.icon, keys: v.keys };
        })}
        activeTab={active}
        onTab={(id) => setActive(id as QueueTab)}
        tabsLabel="Queue views"
        cta={{ label: 'Process next job', icon: Play, onClick: actions.handleProcessNext, title: 'Process next job (N)' }}
      >
        <div className="space-y-6">
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
          <ConnectiveTissueBar lensId="queue" />
        </div>
      </NorthStarFrame>

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
