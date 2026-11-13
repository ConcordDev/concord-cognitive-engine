'use client';

import { useState } from 'react';
import { X, RotateCcw, Trash2, Play, Pencil } from 'lucide-react';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';
import type { QueueJob } from './JobList';

export interface QueueJobUpdate {
  name: string;
  priority: string;
  maxAttempts: number;
  payload: Record<string, unknown>;
}

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
  onUpdate,
}: {
  job: QueueJob | null;
  history: QueueEvent[];
  onClose: () => void;
  onProcess: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdate?: (id: string, fields: QueueJobUpdate) => void;
}) {
  // Edit state (FIX-queue-004) — keyed by job id so switching jobs
  // re-seeds the form instead of leaking the previous job's draft.
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPriority, setEditPriority] = useState('normal');
  const [editMaxAttempts, setEditMaxAttempts] = useState(3);
  const [editPayload, setEditPayload] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  if (!job) return null;
  const runnable = ['pending', 'delayed', 'failed'].includes(job.status);
  const retryable = ['failed', 'dead', 'completed'].includes(job.status);
  const editing = editJobId === job.id;

  const startEdit = () => {
    setEditJobId(job.id);
    setEditName(job.name);
    setEditPriority(job.priority);
    setEditMaxAttempts(job.maxAttempts);
    setEditPayload(JSON.stringify(job.payload ?? {}, null, 2));
    setEditError(null);
  };

  const saveEdit = () => {
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(editPayload || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setEditError('Payload must be a JSON object.');
        return;
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      setEditError('Payload is not valid JSON.');
      return;
    }
    if (!editName.trim()) { setEditError('Name cannot be empty.'); return; }
    onUpdate?.(job.id, { name: editName.trim(), priority: editPriority, maxAttempts: editMaxAttempts, payload });
    setEditJobId(null);
  };
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
            {(job.result as { manual?: boolean; output?: string })?.manual === true && (
              <p className="mb-1 text-[11px] text-amber-300">
                {(job.result as { output?: string }).output || 'Marked completed manually — no worker executed this job.'}
              </p>
            )}
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

        {editing && (
          <div className="mt-4 space-y-2 rounded-lg border border-cyan-500/25 bg-cyan-500/5 p-3">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300">Edit job</div>
            <input
              aria-label="Job name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white"
            />
            <div className="flex gap-2">
              <select
                aria-label="Priority"
                value={editPriority}
                onChange={(e) => setEditPriority(e.target.value)}
                className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white"
              >
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
              <input
                aria-label="Max attempts"
                type="number"
                min={1}
                max={10}
                value={editMaxAttempts}
                onChange={(e) => setEditMaxAttempts(Number(e.target.value) || 1)}
                className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white"
              />
            </div>
            <textarea
              aria-label="Payload JSON"
              value={editPayload}
              onChange={(e) => setEditPayload(e.target.value)}
              rows={5}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-[11px] text-zinc-200"
            />
            {editError && <p role="alert" className="text-xs text-rose-300">{editError}</p>}
            <div className="flex gap-2">
              <button onClick={saveEdit} className="flex-1 rounded-lg bg-cyan-500/20 py-1.5 text-sm text-cyan-300 hover:bg-cyan-500/30">Save changes</button>
              <button onClick={() => setEditJobId(null)} className="flex-1 rounded-lg bg-zinc-800 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700">Cancel</button>
            </div>
          </div>
        )}

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
              <RotateCcw className="h-4 w-4" /> {job.status === 'completed' ? 'Requeue' : 'Retry'}
            </button>
          )}
          {onUpdate && job.status !== 'active' && !editing && (
            <button
              onClick={startEdit}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-cyan-500/20 py-2 text-sm text-cyan-300 hover:bg-cyan-500/30"
            >
              <Pencil className="h-4 w-4" /> Edit
            </button>
          )}
          <StickyDeleteConfirm
            onConfirm={() => onRemove(job.id)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-rose-500/20 py-2 text-sm text-rose-300 hover:bg-rose-500/30"
            armLabel={<><Trash2 className="h-4 w-4" /> Remove</>}
            armAriaLabel={`Remove job ${job.name}`}
            confirmLabel={`Remove "${job.name}"?`}
            confirmAriaLabel={`Confirm remove job ${job.name}`}
          />
        </div>
      </div>
    </div>
  );
}
