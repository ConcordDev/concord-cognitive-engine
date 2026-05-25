'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { QueueRepos } from '@/components/queue/QueueRepos';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useCallback, useState } from 'react';
import {
  Inbox, Play, Clock, Zap, Layers, ChevronDown, RefreshCw,
  BarChart3, ListOrdered, Timer, AlertTriangle, Pause, PlayCircle,
  Trash2, RotateCcw, Server, CalendarClock, ShieldAlert,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { ChartKit } from '@/components/viz';
import { JobList, type QueueJob } from '@/components/queue/JobList';
import { JobDetailDrawer, type QueueEvent } from '@/components/queue/JobDetailDrawer';
import { EnqueueForm, type EnqueueInput } from '@/components/queue/EnqueueForm';

interface QueueRow {
  name: string;
  paused: boolean;
  concurrency: number;
  depth: number;
  counts: {
    pending: number; delayed: number; active: number;
    completed: number; failed: number; dead: number;
  };
}
interface QueueWorker {
  id: string; name: string; queue: string; status: string;
  currentJob: string | null; startedAt: string; lastSeen: string; processed: number;
}
interface ThroughputSlot { slot: string; processed: number; failed: number; latencyMs: number }
interface QueueAlert { level: string; message: string; jobs?: string[] }
interface QueueMetrics {
  totals: { pending: number; delayed: number; active: number; completed: number; failed: number; dead: number; depth: number; all: number };
  byPriority: { high: number; normal: number; low: number };
  throughput: { series: ThroughputSlot[]; completed24h: number; failed24h: number; ratePerMin: number; avgLatencyMs: number };
  alerts: QueueAlert[];
}

type TabKey = 'jobs' | 'scheduled' | 'dead' | 'workers';

export default function QueueLensPage() {
  useLensNav('queue');
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('jobs');
  const [queueFilter, setQueueFilter] = useState<string>('');
  const [showFeatures, setShowFeatures] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ job: QueueJob; history: QueueEvent[] } | null>(null);

  const toast = (type: 'success' | 'error', message: string) =>
    useUIStore.getState().addToast({ type, message });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['queue'] });
  }, [queryClient]);

  // ── Live data: queues, jobs, metrics, workers, events ──────────────────
  const queuesQ = useQuery({
    queryKey: ['queue', 'queues'],
    queryFn: async () => (await lensRun('queue', 'queues', {})).data.result as { queues: QueueRow[] } | null,
    refetchInterval: 5000,
  });
  const queues: QueueRow[] = queuesQ.data?.queues || [];
  const queueNames = queues.map((q) => q.name);

  const jobsQ = useQuery({
    queryKey: ['queue', 'list', queueFilter],
    queryFn: async () =>
      (await lensRun('queue', 'list', queueFilter ? { queue: queueFilter } : {})).data
        .result as { jobs: QueueJob[]; total: number } | null,
    refetchInterval: 4000,
  });
  const jobs: QueueJob[] = jobsQ.data?.jobs || [];

  const scheduledQ = useQuery({
    queryKey: ['queue', 'scheduled'],
    queryFn: async () => (await lensRun('queue', 'scheduled', {})).data.result as { jobs: QueueJob[]; total: number } | null,
    refetchInterval: 6000,
    enabled: tab === 'scheduled',
  });
  const deadQ = useQuery({
    queryKey: ['queue', 'dead-letter'],
    queryFn: async () => (await lensRun('queue', 'dead-letter', {})).data.result as { jobs: QueueJob[]; total: number } | null,
    refetchInterval: 6000,
    enabled: tab === 'dead',
  });
  const workersQ = useQuery({
    queryKey: ['queue', 'workers'],
    queryFn: async () => (await lensRun('queue', 'workers', { action: 'list' })).data.result as { workers: QueueWorker[]; total: number } | null,
    refetchInterval: 5000,
  });
  const workers: QueueWorker[] = workersQ.data?.workers || [];

  const metricsQ = useQuery({
    queryKey: ['queue', 'metrics'],
    queryFn: async () => (await lensRun('queue', 'metrics', {})).data.result as QueueMetrics | null,
    refetchInterval: 5000,
  });
  const metrics = metricsQ.data;

  const eventsQ = useQuery({
    queryKey: ['queue', 'events'],
    queryFn: async () => (await lensRun('queue', 'events', { limit: 20 })).data.result as { events: QueueEvent[] } | null,
    refetchInterval: 5000,
  });
  const events: QueueEvent[] = eventsQ.data?.events || [];

  // ── Mutating actions (every one wired to a real macro) ─────────────────
  const runAction = async (
    action: string,
    input: Record<string, unknown>,
    okMsg: string,
    jobId?: string,
  ) => {
    if (jobId) setBusyId(jobId);
    try {
      const res = await lensRun('queue', action, input);
      if (res.data.ok === false) {
        toast('error', res.data.error || `${action} failed`);
        return null;
      }
      toast('success', okMsg);
      invalidate();
      return res.data.result;
    } catch (e) {
      toast('error', e instanceof Error ? e.message : `${action} failed`);
      return null;
    } finally {
      if (jobId) setBusyId(null);
    }
  };

  const handleEnqueue = (input: EnqueueInput) =>
    runAction('enqueue', input as unknown as Record<string, unknown>, `Enqueued ${input.name}`);
  const handleProcess = (id: string) => runAction('process', { jobId: id }, 'Job processed', id);
  const handleProcessNext = () => runAction('process', queueFilter ? { queue: queueFilter } : {}, 'Picked next job');
  const handleRetry = (id: string) => runAction('retry', { jobId: id }, 'Job requeued', id);
  const handleRemove = async (id: string) => {
    await runAction('remove', { jobId: id }, 'Job removed', id);
    if (detail?.job.id === id) setDetail(null);
  };
  const handleControl = (queue: string, paused: boolean) =>
    runAction('control', { queue, paused }, `${queue} ${paused ? 'paused' : 'resumed'}`);
  const handleConcurrency = (queue: string, concurrency: number) =>
    runAction('control', { queue, concurrency }, `${queue} concurrency → ${concurrency}`);
  const handleDeadBulk = (action: 'retry-all' | 'purge') =>
    runAction('dead-letter', { action }, action === 'purge' ? 'Dead-letter purged' : 'Failed jobs requeued');
  const handleClearCompleted = () => runAction('clear-completed', {}, 'Completed jobs cleared');
  const handleRegisterWorker = () =>
    runAction('workers', { action: 'register', name: `worker-${workers.length + 1}` }, 'Worker registered');
  const handleStopWorker = (id: string) =>
    runAction('workers', { action: 'stop', workerId: id }, 'Worker stopped');

  const openDetail = async (job: QueueJob) => {
    const res = await lensRun('queue', 'job-detail', { jobId: job.id });
    if (res.data.ok && res.data.result) {
      const r = res.data.result as { job: QueueJob; history: QueueEvent[] };
      setDetail({ job: r.job, history: r.history });
    } else {
      setDetail({ job, history: [] });
    }
  };

  // Sidekiq / BullMQ idiom keys.
  useLensCommand(
    [
      { id: 'queue-jobs', keys: 'j', description: 'Jobs tab', category: 'navigation', action: () => setTab('jobs') },
      { id: 'queue-scheduled', keys: 's', description: 'Scheduled tab', category: 'navigation', action: () => setTab('scheduled') },
      { id: 'queue-dead', keys: 'd', description: 'Dead-letter tab', category: 'navigation', action: () => setTab('dead') },
      { id: 'queue-workers', keys: 'w', description: 'Workers tab', category: 'navigation', action: () => setTab('workers') },
      { id: 'queue-next', keys: 'n', description: 'Process next job', category: 'actions', action: handleProcessNext },
    ],
    { lensId: 'queue' },
  );

  const t = metrics?.totals;
  const tp = metrics?.throughput;
  const alerts = metrics?.alerts || [];

  return (
    <LensShell lensId="queue" asMain={false}>
      <FirstRunTour lensId="queue" />
      <ManifestActionBar />
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
          <button
            onClick={handleProcessNext}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/30"
          >
            <Play className="h-4 w-4" /> Process next
          </button>
        </header>

        {/* Alerts — queue depth + stalled jobs + dead-letter */}
        {alerts.length > 0 && (
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  a.level === 'critical'
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                }`}
              >
                {a.level === 'critical' ? (
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                )}
                <span>{a.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Quick stats — live from metrics macro */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="lens-card">
            <ListOrdered className="mb-2 h-5 w-5 text-neon-cyan" />
            <p className="text-2xl font-bold text-neon-cyan">{t?.depth ?? 0}</p>
            <p className="text-sm text-gray-400">Queue Depth</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="lens-card">
            <Timer className="mb-2 h-5 w-5 text-neon-green" />
            <p className="text-2xl font-bold text-neon-green">{tp?.ratePerMin ?? 0}/min</p>
            <p className="text-sm text-gray-400">Processing Rate</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="lens-card">
            <Zap className="mb-2 h-5 w-5 text-neon-purple" />
            <p className="text-2xl font-bold text-neon-purple">{tp?.completed24h ?? 0}</p>
            <p className="text-sm text-gray-400">Completed (24h)</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="lens-card">
            <Clock className="mb-2 h-5 w-5 text-yellow-400" />
            <p className="text-2xl font-bold text-yellow-400">{tp?.avgLatencyMs ?? 0}ms</p>
            <p className="text-sm text-gray-400">Avg Latency</p>
          </motion.div>
        </div>

        {/* Throughput + latency time-series */}
        <div className="panel space-y-3 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4 text-neon-cyan" /> Throughput &amp; Latency (last hour)
          </h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartKit
              kind="bar"
              data={(tp?.series || []) as unknown as Array<Record<string, unknown>>}
              xKey="slot"
              series={[
                { key: 'processed', label: 'Processed', color: '#22c55e' },
                { key: 'failed', label: 'Failed', color: '#ef4444' },
              ]}
              stacked
              height={200}
            />
            <ChartKit
              kind="line"
              data={(tp?.series || []) as unknown as Array<Record<string, unknown>>}
              xKey="slot"
              series={[{ key: 'latencyMs', label: 'Latency (ms)', color: '#06b6d4' }]}
              height={200}
            />
          </div>
        </div>

        {/* Priority lanes — live byPriority */}
        {metrics && (
          <div className="panel space-y-3 p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Zap className="h-4 w-4 text-neon-purple" /> Priority Lanes (waiting)
            </h2>
            {(['high', 'normal', 'low'] as const).map((p) => {
              const count = metrics.byPriority[p];
              const total =
                metrics.byPriority.high + metrics.byPriority.normal + metrics.byPriority.low || 1;
              const pct = Math.round((count / total) * 100);
              const color =
                p === 'high' ? 'bg-rose-500' : p === 'low' ? 'bg-zinc-500' : 'bg-neon-blue';
              return (
                <div key={p} className="flex items-center gap-3">
                  <span className="w-28 text-xs capitalize text-gray-400">{p} priority</span>
                  <div className="h-4 flex-1 overflow-hidden rounded-full bg-lattice-deep">
                    <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-8 text-right font-mono text-xs">{count}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Queue controls — pause/resume + concurrency per queue */}
        <div className="panel space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Server className="h-4 w-4 text-neon-cyan" /> Queues
            </h2>
            <button
              onClick={handleClearCompleted}
              className="flex items-center gap-1 rounded bg-white/5 px-2 py-1 text-xs text-gray-400 hover:bg-white/10"
            >
              <Trash2 className="h-3 w-3" /> Clear completed
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {queues.length === 0 && (
              <p className="col-span-full py-4 text-center text-sm text-gray-400">
                No queues yet. Enqueue a job to create one.
              </p>
            )}
            {queues.map((q) => (
              <div key={q.name} className="rounded-lg border border-white/10 bg-black/30 p-3">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setQueueFilter(queueFilter === q.name ? '' : q.name)}
                    className={`text-sm font-semibold ${
                      queueFilter === q.name ? 'text-neon-cyan' : 'text-white'
                    }`}
                  >
                    {q.name}
                  </button>
                  <button
                    onClick={() => handleControl(q.name, !q.paused)}
                    title={q.paused ? 'Resume' : 'Pause'}
                    className={`rounded p-1.5 ${
                      q.paused
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {q.paused ? <PlayCircle className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  <span className="rounded bg-zinc-700/40 px-1.5 py-0.5 text-zinc-300">
                    depth {q.depth}
                  </span>
                  <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-cyan-300">
                    active {q.counts.active}
                  </span>
                  <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300">
                    done {q.counts.completed}
                  </span>
                  {q.counts.dead > 0 && (
                    <span className="rounded bg-red-700/30 px-1.5 py-0.5 text-red-300">
                      dead {q.counts.dead}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-[10px] text-gray-400">Concurrency</label>
                  <input
                    type="number"
                    min={1}
                    max={64}
                    defaultValue={q.concurrency}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== q.concurrency) handleConcurrency(q.name, v);
                    }}
                    className="w-14 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-xs text-white"
                  />
                  {q.paused && <span className="text-[10px] text-amber-400">paused</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Enqueue form */}
        <EnqueueForm queues={queueNames.length ? queueNames : ['ingest', 'autocrawl', 'terminal']} busy={false} onEnqueue={handleEnqueue} />

        {/* Tabs */}
        <div className="flex flex-wrap gap-2">
          {([
            { key: 'jobs', label: 'Jobs', icon: <Inbox className="h-4 w-4" />, count: t?.all },
            { key: 'scheduled', label: 'Scheduled', icon: <CalendarClock className="h-4 w-4" />, count: t?.delayed },
            { key: 'dead', label: 'Dead-letter', icon: <ShieldAlert className="h-4 w-4" />, count: (t?.failed ?? 0) + (t?.dead ?? 0) },
            { key: 'workers', label: 'Workers', icon: <Server className="h-4 w-4" />, count: workers.length },
          ] as const).map((tabDef) => (
            <button
              key={tabDef.key}
              onClick={() => setTab(tabDef.key)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                tab === tabDef.key
                  ? 'border border-neon-blue/30 bg-neon-blue/20 text-neon-blue'
                  : 'bg-lattice-surface text-gray-400 hover:text-white'
              }`}
            >
              {tabDef.icon}
              <span>{tabDef.label}</span>
              <span className="rounded bg-lattice-elevated px-2 py-0.5 text-xs">
                {tabDef.count ?? 0}
              </span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="panel space-y-3 p-4">
          {tab === 'jobs' && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold">
                  <Inbox className="h-4 w-4 text-neon-blue" />
                  Jobs {queueFilter && <span className="text-xs text-neon-cyan">· {queueFilter}</span>}
                </h2>
                {queueFilter && (
                  <button
                    onClick={() => setQueueFilter('')}
                    className="text-xs text-gray-400 hover:text-gray-300"
                  >
                    Clear filter
                  </button>
                )}
              </div>
              <JobList
                jobs={jobs}
                busyId={busyId}
                onProcess={handleProcess}
                onRetry={handleRetry}
                onRemove={handleRemove}
                onSelect={openDetail}
              />
            </>
          )}

          {tab === 'scheduled' && (
            <>
              <h2 className="flex items-center gap-2 font-semibold">
                <CalendarClock className="h-4 w-4 text-amber-400" /> Scheduled / Delayed Jobs
              </h2>
              <JobList
                jobs={scheduledQ.data?.jobs || []}
                busyId={busyId}
                onProcess={handleProcess}
                onRetry={handleRetry}
                onRemove={handleRemove}
                onSelect={openDetail}
              />
            </>
          )}

          {tab === 'dead' && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold">
                  <ShieldAlert className="h-4 w-4 text-rose-400" /> Dead-letter &amp; Failed
                </h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDeadBulk('retry-all')}
                    className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/30"
                  >
                    <RotateCcw className="h-3 w-3" /> Retry all
                  </button>
                  <button
                    onClick={() => handleDeadBulk('purge')}
                    className="flex items-center gap-1 rounded bg-rose-500/20 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/30"
                  >
                    <Trash2 className="h-3 w-3" /> Purge
                  </button>
                </div>
              </div>
              <JobList
                jobs={deadQ.data?.jobs || []}
                busyId={busyId}
                onProcess={handleProcess}
                onRetry={handleRetry}
                onRemove={handleRemove}
                onSelect={openDetail}
              />
            </>
          )}

          {tab === 'workers' && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-semibold">
                  <Server className="h-4 w-4 text-neon-purple" /> Workers
                </h2>
                <button
                  onClick={handleRegisterWorker}
                  className="flex items-center gap-1 rounded bg-neon-purple/20 px-2 py-1 text-xs text-neon-purple hover:bg-neon-purple/30"
                >
                  <Server className="h-3 w-3" /> Register worker
                </button>
              </div>
              {workers.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-800 py-8 text-center text-sm text-zinc-400">
                  No workers registered. Register one to track who is processing what.
                </p>
              ) : (
                <div className="space-y-2">
                  {workers.map((w) => (
                    <div
                      key={w.id}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 p-3"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            w.status === 'busy'
                              ? 'bg-cyan-400 animate-pulse'
                              : w.status === 'idle'
                                ? 'bg-emerald-400'
                                : w.status === 'offline'
                                  ? 'bg-zinc-600'
                                  : 'bg-rose-400'
                          }`}
                        />
                        <div>
                          <p className="text-sm font-medium text-white">{w.name}</p>
                          <p className="text-[11px] text-zinc-400">
                            {w.status} · queue {w.queue} · {w.processed} processed
                            {w.currentJob && ` · job ${w.currentJob.slice(0, 12)}`}
                          </p>
                        </div>
                      </div>
                      {w.status !== 'stopped' && (
                        <button
                          onClick={() => handleStopWorker(w.id)}
                          className="rounded bg-rose-500/20 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/30"
                        >
                          Stop
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Recent activity feed — live events macro */}
        <div className="panel space-y-3 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <RefreshCw className="h-4 w-4 text-neon-cyan" /> Recent Activity
          </h2>
          {events.length === 0 ? (
            <p className="py-4 text-center text-xs text-gray-400">No activity yet.</p>
          ) : (
            <div className="space-y-1.5">
              {events.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-3 rounded bg-black/30 px-3 py-2 transition-colors hover:bg-white/5"
                >
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase text-zinc-400">
                    {e.kind}
                  </span>
                  <span className="flex-1 text-xs text-gray-300">{e.message}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(e.at).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ConnectiveTissueBar */}
        <ConnectiveTissueBar lensId="queue" />

        {/* Lens Features */}
        <div className="border-t border-white/10">
          <button
            onClick={() => setShowFeatures(!showFeatures)}
            className="flex w-full items-center justify-between rounded-lg bg-white/[0.02] px-4 py-3 text-sm text-gray-300 transition-colors hover:bg-white/[0.04] hover:text-white"
          >
            <span className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Lens Features &amp; Capabilities
            </span>
            <ChevronDown className={`h-4 w-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
          </button>
          {showFeatures && (
            <div className="px-4 pb-4">
              <LensFeaturePanel lensId="queue" />
            </div>
          )}
        </div>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <QueueRepos />
        </section>

        <a
          href="#queue-skip"
          className="sr-only focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          Skip to queue content
        </a>
        <RecentMineCard domain="queue" limit={10} hideWhenEmpty className="mt-4" />
        <AutoActionStrip domain="queue" hideWhenEmpty className="mt-3" />
        <CrossLensRecentsPanel lensId="queue" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>

      <JobDetailDrawer
        job={detail?.job || null}
        history={detail?.history || []}
        onClose={() => setDetail(null)}
        onProcess={handleProcess}
        onRetry={handleRetry}
        onRemove={handleRemove}
      />
    </LensShell>
  );
}
