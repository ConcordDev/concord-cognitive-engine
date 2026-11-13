'use client';
import { useState } from 'react';
import { useCockpitRun } from '@/lib/cockpit/useCockpitRun';
import { TERMINAL, type PublicRun, type PublicStep } from '@/lib/cockpit/run-client';
import { ConfirmCard } from './ConfirmCard';
import { ReceiptLink } from './ReceiptLink';

const STATUS_WORD: Record<string, string> = {
  planned: 'Working', running: 'Working', verifying: 'Working', awaiting_confirm: 'Needs your OK',
  paused: 'Paused', done: 'Finished', failed: 'Stopped', cancelled: 'Cancelled',
};
const MARK: Record<string, string> = { done: '✓', failed: '✗', skipped: '–', running: '…', awaiting_confirm: '?' };

export function RunCard({ runId, onFinished }: { runId: string; onFinished?: (run: PublicRun, steps: PublicStep[]) => void }) {
  const r = useCockpitRun(runId, { onFinished });
  const [showAll, setShowAll] = useState(false);

  if (r.loading && !r.run && !r.error) {
    return <div className="mt-2 h-10 animate-pulse rounded bg-lattice-border/30" aria-busy="true" aria-label="Loading task" />;
  }
  if (!r.run) {
    return <p role="alert" className="mt-2 text-sm text-red-400">{r.error || 'This task could not be loaded.'}</p>;
  }

  const total = r.steps.length;
  const done = r.steps.filter((s) => s.status === 'done').length;
  const terminal = TERMINAL.includes(r.run.status);
  const current = Math.max(0, r.steps.findIndex((s) => s.status !== 'done' && s.status !== 'skipped'));
  const collapsed = !showAll && total > 6;
  const visible = collapsed ? r.steps.filter((_, i) => i === current || i >= total - 2 || i === current - 1) : r.steps;

  return (
    <div className="mt-2 rounded border border-lattice-border p-2 text-sm" data-testid="run-card">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{r.run.goal}</span>
        <span className="text-xs">{STATUS_WORD[r.run.status] ?? r.run.status}</span>
        <span className="text-xs opacity-70">{done} of {total}</span>
      </div>
      <div className="mt-1 h-1 rounded bg-lattice-border/40" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <div className="h-1 rounded bg-neon-blue" style={{ width: total ? `${Math.round((done / total) * 100)}%` : '0%' }} />
      </div>
      {total === 0 ? (
        <p className="mt-2 text-xs opacity-70">This task has no steps.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {visible.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-2">
              <span aria-hidden="true" className="w-4 text-center">{MARK[s.status] ?? '·'}</span>
              <span className="flex-1">{s.label}</span>
              {s.status === 'done' && s.hasReceipt && <ReceiptLink runId={r.run!.id} stepId={s.id} />}
              {(s.status === 'failed' || s.status === 'skipped') && s.error && <span className="basis-full pl-6 text-xs text-red-300">{s.error}</span>}
            </li>
          ))}
        </ul>
      )}
      {collapsed && <button type="button" onClick={() => setShowAll(true)} className="mt-1 text-xs underline">Show all {total} steps</button>}
      {r.decided && !r.confirm && <p className="mt-2 text-xs opacity-70">{r.decided}</p>}
      {r.confirm && (
        <ConfirmCard card={r.confirm} busy={r.busy} onApprove={r.approve} onReject={r.reject} onAnswer={r.answer} onMaybeDone={r.maybeDone} />
      )}
      {!terminal && (
        <div className="mt-2 flex gap-2">
          {r.run.status === 'paused'
            ? <button type="button" disabled={r.busy} onClick={r.resume} className="rounded border border-lattice-border px-2 py-0.5 text-xs disabled:opacity-50">Resume</button>
            : <button type="button" disabled={r.busy} onClick={r.pause} className="rounded border border-lattice-border px-2 py-0.5 text-xs disabled:opacity-50">Pause</button>}
          <button type="button" disabled={r.busy} onClick={r.cancel} className="rounded border border-lattice-border px-2 py-0.5 text-xs disabled:opacity-50">Cancel</button>
        </div>
      )}
      {r.error && <p role="alert" className="mt-2 text-xs text-red-300">{r.error}</p>}
    </div>
  );
}
