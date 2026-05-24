'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Play, RotateCcw, Trash2, Loader2, ChevronRight } from 'lucide-react';

export interface QueueJob {
  id: string;
  queue: string;
  name: string;
  status: string;
  priority: 'high' | 'normal' | 'low';
  payload: Record<string, any>;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  result: any;
  createdAt: string;
  updatedAt: string;
  runAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  workerId: string | null;
  durationMs: number | null;
  etaMs?: number;
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-zinc-500/20 text-zinc-300',
  delayed: 'bg-amber-500/20 text-amber-300',
  active: 'bg-cyan-500/20 text-cyan-300 animate-pulse',
  completed: 'bg-emerald-500/20 text-emerald-300',
  failed: 'bg-rose-500/20 text-rose-300',
  dead: 'bg-red-700/30 text-red-300',
};

const PRIORITY_STYLE: Record<string, string> = {
  high: 'bg-rose-500/20 text-rose-300',
  normal: 'bg-indigo-500/20 text-indigo-300',
  low: 'bg-zinc-600/30 text-zinc-400',
};

export function JobList({
  jobs,
  busyId,
  onProcess,
  onRetry,
  onRemove,
  onSelect,
}: {
  jobs: QueueJob[];
  busyId: string | null;
  onProcess: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onSelect: (job: QueueJob) => void;
}) {
  if (jobs.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-800 py-8 text-center text-sm text-zinc-400">
        No jobs. Enqueue one above to get started.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {jobs.map((j) => {
        const runnable = ['pending', 'delayed', 'failed'].includes(j.status);
        const retryable = ['failed', 'dead'].includes(j.status);
        const busy = busyId === j.id;
        return (
          <div
            key={j.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 p-3"
          >
            <button
              onClick={() => onSelect(j)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span
                className={`shrink-0 w-2 h-2 rounded-full ${
                  j.status === 'active'
                    ? 'bg-cyan-400 animate-pulse'
                    : j.status === 'completed'
                      ? 'bg-emerald-400'
                      : j.status === 'failed' || j.status === 'dead'
                        ? 'bg-rose-400'
                        : 'bg-zinc-500'
                }`}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{j.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                    {j.queue}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_STYLE[j.status] || 'bg-zinc-700 text-zinc-300'}`}>
                    {j.status}
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${PRIORITY_STYLE[j.priority]}`}>
                    {j.priority}
                  </span>
                  <span className="text-[10px] text-zinc-400">
                    {j.attempts}/{j.maxAttempts} attempts
                  </span>
                  {typeof j.etaMs === 'number' && (
                    <span className="text-[10px] text-amber-400">
                      ETA {Math.round(j.etaMs / 1000)}s
                    </span>
                  )}
                  {j.durationMs != null && (
                    <span className="text-[10px] text-zinc-400">{j.durationMs}ms</span>
                  )}
                </div>
                {j.error && (
                  <p className="mt-1 truncate text-[10px] text-rose-400">⚠ {j.error}</p>
                )}
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-1.5">
              {runnable && (
                <button
                  onClick={() => onProcess(j.id)}
                  disabled={busy}
                  title="Process now"
                  className="rounded-lg bg-emerald-500/20 p-2 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                </button>
              )}
              {retryable && (
                <button
                  onClick={() => onRetry(j.id)}
                  disabled={busy}
                  title="Retry"
                  className="rounded-lg bg-amber-500/20 p-2 text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => onRemove(j.id)}
                disabled={busy}
                title="Remove"
                className="rounded-lg bg-rose-500/20 p-2 text-rose-300 hover:bg-rose-500/30 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <ChevronRight className="h-4 w-4 text-zinc-600" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
