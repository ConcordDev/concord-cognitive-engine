'use client';

/**
 * VersionHistoryPanel — page snapshot timeline. Lists docs.version-list
 * snapshots and restores a chosen one via docs.version-restore (which
 * auto-snapshots the current state first, so restore is reversible).
 */

import { useCallback, useEffect, useState } from 'react';
import { History, Loader2, RotateCcw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { TimelineView, type TimelineEvent } from '@/components/viz';
import type { Snapshot } from './types';

export function VersionHistoryPanel({ pageId, onRestored }: {
  pageId: string;
  onRestored: () => void;
}) {
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await lensRun('docs', 'version-list', { pageId });
    setSnaps((r.data?.result?.snapshots as Snapshot[]) || []);
    setLoading(false);
  }, [pageId]);
  useEffect(() => { setLoading(true); void load(); }, [load]);

  async function restore(id: string) {
    setRestoring(id);
    await lensRun('docs', 'version-restore', { pageId, snapshotId: id });
    setRestoring(null);
    await load();
    onRestored();
  }

  const events: TimelineEvent[] = snaps.map(s => ({
    id: s.id,
    time: s.createdAt,
    label: s.label,
    detail: `${s.blockCount} blocks · ${s.wordCount} words`,
    tone: s.label === 'Before restore' ? 'warn' : 'info',
  }));

  return (
    <div>
      <h4 className="flex items-center gap-1.5 text-xs font-bold text-zinc-100 mb-2">
        <History className="w-3.5 h-3.5" /> Version history
      </h4>
      {loading ? (
        <div className="flex items-center justify-center py-4 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : snaps.length === 0 ? (
        <p className="text-[11px] text-zinc-600 italic">No snapshots yet — use &ldquo;Save version&rdquo;.</p>
      ) : (
        <div className="space-y-2">
          <TimelineView events={events} height={90} />
          <div className="space-y-1">
            {snaps.map(s => (
              <div key={s.id} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-zinc-200 truncate">{s.icon} {s.label}</p>
                  <p className="text-[10px] text-zinc-500">{new Date(s.createdAt).toLocaleString()}</p>
                </div>
                <button onClick={() => restore(s.id)} disabled={restoring !== null}
                  className="flex items-center gap-1 text-[10px] text-indigo-300 border border-indigo-800 rounded px-1.5 py-0.5 hover:bg-indigo-900/40 disabled:opacity-50">
                  {restoring === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
