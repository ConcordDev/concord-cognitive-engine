/**
 * PjActivityPanel — the project's activity stream (Review 4,
 * projects.md F15, slice S11).
 *
 * The global Activity surface read "No activity yet" forever: it
 * called `activity-list` with no taskId, and the macro's filter
 * (taskId === "undefined") matched nothing. The macro now serves the
 * stream (enriched with each issue's ref/title), and this tab is the
 * stream's home inside the lens — the same event source the
 * per-issue feeds read, scoped to the open project, grouped by issue
 * so it stays receipts rather than firehose.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { Skeleton, ErrorState } from '@/components/ui';

interface ReceiptMeta {
  sprintName?: string; issuesDone?: number; issuesTotal?: number;
  pointsDone?: number; pointsTotal?: number; carriedOver?: number; settledInFull?: boolean;
}

interface ActivityRow {
  id: string; taskId: string | null; action: string; detail: string | null; at: string;
  taskRef: string | null; taskTitle: string | null; projectId: string | null;
  meta?: ReceiptMeta | null;
}

export function PjActivityPanel({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('projects', 'activity-list', { projectId, limit: 100 });
    if (r.data?.ok === false) {
      setLoadError(r.data?.error || 'Could not load activity.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setRows((r.data?.result as { activity?: ActivityRow[] } | null)?.activity || []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // D1: a sprint settlement is a receipt, not a log line — the
  // project-level sprint_receipt entry (written once per completion,
  // carrying the settlement in meta) renders as its own stamped card
  // and survives reload because it IS the stored record. The rest of
  // the stream groups by issue as before.
  const isReceipt = (r: ActivityRow) => r.action === 'sprint_receipt' && !r.taskId && !!r.meta;
  const streamRows = rows.filter((r) => !isReceipt(r));

  // Group consecutive events by issue, newest first — the stream is
  // receipts grouped by the work they describe, not a firehose.
  const groups: { key: string; ref: string; title: string; events: ActivityRow[] }[] = [];
  for (const row of streamRows) {
    const last = groups[groups.length - 1];
    if (last && last.key === row.taskId) last.events.push(row);
    else groups.push({ key: String(row.taskId), ref: row.taskRef || 'issue', title: row.taskTitle || '', events: [row] });
  }
  const receiptRows = rows.filter(isReceipt);

  if (loadError) return <ErrorState message={loadError} onRetry={refresh} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-300 flex-1">
          <History className="w-3.5 h-3.5 text-indigo-400" /> Activity in this project
        </h3>
        <button type="button" onClick={() => void refresh()}
          className="flex items-center gap-1 text-[11px] px-2 py-1 bg-lattice-elevated hover:bg-lattice-border rounded text-gray-200">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>
      {loading && rows.length === 0 ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton variant="block" height={64} className="rounded-xl" />
          <Skeleton variant="block" height={64} className="rounded-xl" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-gray-400 italic py-6 text-center">
          No activity in this project yet — creates, edits, comments and status changes will appear here.
        </p>
      ) : (
        <div className="space-y-2">
          {receiptRows.map((r) => (
            <section key={r.id} aria-label={`Receipt for ${r.meta?.sprintName || 'sprint'}`}
              className="relative overflow-hidden bg-lattice-surface/70 border-2 border-dashed border-emerald-800/70 rounded-xl p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white">{r.meta?.sprintName} — settled</p>
                  <p className="text-[11px] text-gray-400">
                    {r.meta?.issuesDone}/{r.meta?.issuesTotal} issues · {r.meta?.pointsDone}/{r.meta?.pointsTotal} points
                    {(r.meta?.carriedOver || 0) > 0 && <> · {r.meta?.carriedOver} carried over</>}
                  </p>
                  <p className="text-[10px] text-gray-500 tabular-nums">{new Date(r.at).toLocaleString()}</p>
                </div>
                <span aria-hidden="true" className="shrink-0 border-2 border-emerald-500/70 text-emerald-300 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider -rotate-6">
                  {r.meta?.settledInFull ? 'Settled in full' : 'Settled'}
                </span>
              </div>
            </section>
          ))}
          {groups.map((g) => (
            <section key={`${g.key}-${g.events[0].id}`} className="bg-lattice-surface/70 border border-lattice-border rounded-xl p-3">
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="font-mono text-[11px] text-indigo-300">{g.ref}</span>
                <span className="text-[11px] text-gray-200 truncate">{g.title}</span>
              </div>
              <ul className="space-y-1">
                {g.events.map((e) => (
                  <li key={e.id} className="flex items-baseline gap-2 text-[11px] text-gray-400">
                    <span className="text-gray-500 tabular-nums shrink-0">{new Date(e.at).toLocaleString()}</span>
                    <span className="text-gray-300">{e.action}</span>
                    {e.detail && <span className="truncate">{e.detail}</span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
