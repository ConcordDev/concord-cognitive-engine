'use client';

import { X, RotateCcw, Trash2, Play } from 'lucide-react';
import type { QueueJob } from './JobList';

export interface QueueEvent {
  id: string;
  kind: string;
  message: string;
  jobId: string | null;
  at: string;
}

export function JobDetailDrawer({
  job,
  history,
  onClose,
  onProcess,
  onRetry,
  onRemove,
}: {
  job: QueueJob | null;
  history: QueueEvent[];
  onClose: () => void;
  onProcess: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (!job) return null;
  const runnable = ['pending', 'delayed', 'failed'].includes(job.status);
  const retryable = ['failed', 'dead'].includes(job.status);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        aria-label="Close job detail"
        onClick={onClose}
        className="flex-1 bg-black/60"
      />
      <div className="flex w-full max-w-md flex-col overflow-y-auto border-l border-white/10 bg-zinc-950 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">{job.name}</h2>
            <p className="font-mono text-[11px] text-zinc-400">{job.id}</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          {[
            ['Queue', job.queue],
            ['Status', job.status],
            ['Priority', job.priority],
            ['Attempts', `${job.attempts}/${job.maxAttempts}`],
            ['Worker', job.workerId || '—'],
            ['Duration', job.durationMs != null ? `${job.durationMs}ms` : '—'],
            ['Created', new Date(job.createdAt).toLocaleString()],
            ['Run at', new Date(job.runAt).toLocaleString()],
          ].map(([k, v]) => (
            <div key={k} className="rounded border border-zinc-800 bg-black/30 px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">{k}</div>
              <div className="mt-0.5 truncate text-zinc-200">{v}</div>
            </div>
          ))}
        </div>

        {job.error && (
          <div className="mt-3 rounded border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-300">
            <div className="font-semibold">Error</div>
            <div className="mt-0.5">{job.error}</div>
          </div>
        )}

        <div className="mt-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Payload</div>
          <pre className="max-h-40 overflow-auto rounded border border-zinc-800 bg-black/40 p-2 text-[11px] text-zinc-300">
            {JSON.stringify(job.payload, null, 2)}
          </pre>
        </div>

        {job.result != null && (
          <div className="mt-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Result</div>
            <pre className="max-h-32 overflow-auto rounded border border-zinc-800 bg-black/40 p-2 text-[11px] text-emerald-300">
              {JSON.stringify(job.result, null, 2)}
            </pre>
          </div>
        )}

        <div className="mt-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">
            Attempt / event history
          </div>
          <div className="space-y-1">
            {history.length === 0 ? (
              <p className="text-xs text-zinc-400">No events recorded.</p>
            ) : (
              history
                .slice()
                .reverse()
                .map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-2 rounded border border-zinc-800 bg-black/30 px-2 py-1 text-[11px]"
                  >
                    <span className="rounded bg-zinc-800 px-1 text-[9px] uppercase text-zinc-400">
                      {e.kind}
                    </span>
                    <span className="flex-1 text-zinc-300">{e.message}</span>
                    <span className="text-zinc-600">{new Date(e.at).toLocaleTimeString()}</span>
                  </div>
                ))
            )}
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          {runnable && (
            <button
              onClick={() => onProcess(job.id)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/20 py-2 text-sm text-emerald-300 hover:bg-emerald-500/30"
            >
              <Play className="h-4 w-4" /> Process
            </button>
          )}
          {retryable && (
            <button
              onClick={() => onRetry(job.id)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-500/20 py-2 text-sm text-amber-300 hover:bg-amber-500/30"
            >
              <RotateCcw className="h-4 w-4" /> Retry
            </button>
          )}
          <button
            onClick={() => onRemove(job.id)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-rose-500/20 py-2 text-sm text-rose-300 hover:bg-rose-500/30"
          >
            <Trash2 className="h-4 w-4" /> Remove
          </button>
        </div>
      </div>
    </div>
  );
}
