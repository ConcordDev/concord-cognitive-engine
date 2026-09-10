'use client';

import { Inbox, CalendarClock, ShieldAlert, Server, Activity, RotateCcw, Trash2 } from 'lucide-react';
import { JobList, type QueueJob } from '@/components/queue/JobList';
import { QueueAnalyticsPanel } from '@/components/queue/QueueAnalyticsPanel';
import type { QueueWorker } from '@/components/queue/useQueueData';

export type QueueTab = 'overview' | 'jobs' | 'scheduled' | 'dead' | 'workers' | 'analytics' | 'repos';

export function JobsPanel({
  jobs, busyId, queueFilter, setQueueFilter,
  onProcess, onRetry, onRemove, onSelect,
}: {
  jobs: QueueJob[];
  busyId: string | null;
  queueFilter: string;
  setQueueFilter: (v: string) => void;
  onProcess: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onSelect: (job: QueueJob) => void;
}) {
  return (
    <div className="panel space-y-3 p-4">
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
        onProcess={onProcess}
        onRetry={onRetry}
        onRemove={onRemove}
        onSelect={onSelect}
      />
    </div>
  );
}

export function ScheduledPanel({
  jobs, busyId, onProcess, onRetry, onRemove, onSelect,
}: {
  jobs: QueueJob[];
  busyId: string | null;
  onProcess: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onSelect: (job: QueueJob) => void;
}) {
  return (
    <div className="panel space-y-3 p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <CalendarClock className="h-4 w-4 text-amber-400" /> Scheduled / Delayed Jobs
      </h2>
      <JobList
        jobs={jobs}
        busyId={busyId}
        onProcess={onProcess}
        onRetry={onRetry}
        onRemove={onRemove}
        onSelect={onSelect}
      />
    </div>
  );
}

export function DeadLetterPanel({
  jobs, busyId, onProcess, onRetry, onRemove, onSelect, onDeadBulk,
}: {
  jobs: QueueJob[];
  busyId: string | null;
  onProcess: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onSelect: (job: QueueJob) => void;
  onDeadBulk: (action: 'retry-all' | 'purge') => void;
}) {
  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="h-4 w-4 text-rose-400" /> Dead-letter &amp; Failed
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => onDeadBulk('retry-all')}
            className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/30"
          >
            <RotateCcw className="h-3 w-3" /> Retry all
          </button>
          <button
            onClick={() => onDeadBulk('purge')}
            className="flex items-center gap-1 rounded bg-rose-500/20 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/30"
          >
            <Trash2 className="h-3 w-3" /> Purge
          </button>
        </div>
      </div>
      <JobList
        jobs={jobs}
        busyId={busyId}
        onProcess={onProcess}
        onRetry={onRetry}
        onRemove={onRemove}
        onSelect={onSelect}
      />
    </div>
  );
}

export function WorkersPanel({
  workers, onRegister, onStop,
}: {
  workers: QueueWorker[];
  onRegister: () => void;
  onStop: (id: string) => void;
}) {
  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <Server className="h-4 w-4 text-neon-purple" /> Workers
        </h2>
        <button
          onClick={onRegister}
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
                  onClick={() => onStop(w.id)}
                  className="rounded bg-rose-500/20 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/30"
                >
                  Stop
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AnalyticsTabPanel({
  allJobs, servers,
}: {
  allJobs: QueueJob[];
  servers: number;
}) {
  return (
    <div className="panel space-y-3 p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <Activity className="h-4 w-4 text-neon-cyan" /> Analytics
      </h2>
      <QueueAnalyticsPanel allJobs={allJobs} servers={servers} />
    </div>
  );
}

