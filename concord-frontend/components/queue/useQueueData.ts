'use client';

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import type { QueueJob } from '@/components/queue/JobList';
import type { QueueEvent } from '@/components/queue/JobDetailDrawer';
import type { EnqueueInput } from '@/components/queue/EnqueueForm';

export interface QueueRow {
  name: string;
  paused: boolean;
  concurrency: number;
  depth: number;
  counts: {
    pending: number; delayed: number; active: number;
    completed: number; failed: number; dead: number;
  };
}
export interface QueueWorker {
  id: string; name: string; queue: string; status: string;
  currentJob: string | null; startedAt: string; lastSeen: string; processed: number;
}
export interface ThroughputSlot { slot: string; processed: number; failed: number; latencyMs: number }
export interface QueueAlert { level: string; message: string; jobs?: string[] }
export interface QueueMetrics {
  totals: { pending: number; delayed: number; active: number; completed: number; failed: number; dead: number; depth: number; all: number };
  byPriority: { high: number; normal: number; low: number };
  throughput: { series: ThroughputSlot[]; completed24h: number; failed24h: number; ratePerMin: number; avgLatencyMs: number };
  alerts: QueueAlert[];
}

export function useQueueActions() {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ job: QueueJob; history: QueueEvent[] } | null>(null);
  const [queueFilter, setQueueFilter] = useState<string>('');

  const toast = (type: 'success' | 'error', message: string) =>
    useUIStore.getState().addToast({ type, message });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['queue'] });
  }, [queryClient]);

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
  const handleRegisterWorker = (workerCount: number) =>
    runAction('workers', { action: 'register', name: `worker-${workerCount + 1}` }, 'Worker registered');
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

  return {
    busyId, detail, setDetail, queueFilter, setQueueFilter,
    handleEnqueue, handleProcess, handleProcessNext, handleRetry, handleRemove,
    handleControl, handleConcurrency, handleDeadBulk, handleClearCompleted,
    handleRegisterWorker, handleStopWorker, openDetail,
  };
}

export function useQueueData(tab: string, queueFilter: string) {
  const queuesQ = useQuery({
    queryKey: ['queue', 'queues'],
    queryFn: async () => (await lensRun('queue', 'queues', {})).data.result as { queues: QueueRow[] } | null,
    refetchInterval: 5000,
  });
  const queues: QueueRow[] = queuesQ.data?.queues || [];

  const jobsQ = useQuery({
    queryKey: ['queue', 'list', queueFilter],
    queryFn: async () =>
      (await lensRun('queue', 'list', queueFilter ? { queue: queueFilter } : {})).data
        .result as { jobs: QueueJob[]; total: number } | null,
    refetchInterval: 4000,
  });
  const jobs: QueueJob[] = jobsQ.data?.jobs || [];

  const allJobsQ = useQuery({
    queryKey: ['queue', 'list', 'all'],
    queryFn: async () => (await lensRun('queue', 'list', { limit: 1000 })).data.result as { jobs: QueueJob[]; total: number } | null,
    refetchInterval: 8000,
    enabled: tab === 'analytics',
  });
  const allJobs: QueueJob[] = allJobsQ.data?.jobs || [];

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

  return { queues, jobs, allJobs, scheduledQ, deadQ, workers, metrics, events };
}
