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

interface ActivityRow {
  id: string; taskId: string; action: string; detail: string | null; at: string;
  taskRef: string | null; taskTitle: string | null; projectId: string | null;
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

  // Group consecutive events by issue, newest first — the stream is
  // receipts grouped by the work they describe, not a firehose.
  const groups: { key: string; ref: string; title: string; events: ActivityRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.key === row.taskId) last.events.push(row);
    else groups.push({ key: row.taskId, ref: row.taskRef || 'issue', title: row.taskTitle || '', events: [row] });
  }

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
