'use client';

/**
 * VersionHistory — snapshot + rollback timeline for a maker project.
 * Backed by `app-maker` version.* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { History, Camera, RotateCcw, Loader2 } from 'lucide-react';
import { TimelineView, type TimelineEvent } from '@/components/viz';

interface Version {
  id: string; label: string; createdAt: string;
  deployUrl?: string | null; pageCount: number; tableCount: number;
}

export function VersionHistory({
  projectId,
  onRestored,
}: {
  projectId: string;
  onRestored: () => void;
}) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [label, setLabel] = useState('');

  const refresh = useCallback(async () => {
    const r = await lensRun('app-maker', 'versionList', { projectId });
    if (r.data?.ok) setVersions(r.data.result?.versions ?? []);
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function snapshot() {
    setBusy(true);
    const r = await lensRun('app-maker', 'versionSnapshot', {
      projectId, label: label || undefined,
    });
    setBusy(false);
    if (r.data?.ok) { setLabel(''); await refresh(); }
  }

  async function restore(id: string) {
    setRestoring(id);
    const r = await lensRun('app-maker', 'versionRestore', { projectId, versionId: id });
    setRestoring(null);
    if (r.data?.ok) { await refresh(); onRestored(); }
  }

  const timeline: TimelineEvent[] = versions.map((v) => ({
    id: v.id,
    label: v.label,
    time: v.createdAt,
    detail: `${v.pageCount} page${v.pageCount === 1 ? '' : 's'} · ${v.tableCount} table${v.tableCount === 1 ? '' : 's'}${v.deployUrl ? ' · deployed' : ''}`,
    tone: v.deployUrl ? 'good' : 'default',
  }));

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Snapshot label (optional)"
            className="flex-1 rounded border border-pink-900/40 bg-black/40 px-2 py-1.5 text-[12px] text-pink-100"
          />
          <button
            onClick={snapshot}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded bg-pink-600 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-pink-500 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />} Snapshot
          </button>
        </div>
        <ul className="space-y-1">
          {versions.map((v) => (
            <li key={v.id} className="flex items-center gap-2 rounded border border-pink-900/30 bg-pink-950/10 px-2.5 py-2 text-[11px]">
              <History className="h-3.5 w-3.5 text-pink-500" />
              <span className="font-medium text-pink-100">{v.label}</span>
              <span className="text-pink-700">{new Date(v.createdAt).toLocaleString()}</span>
              {v.deployUrl && <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-[9px] text-emerald-300">deployed</span>}
              <button
                onClick={() => restore(v.id)}
                disabled={restoring === v.id}
                className="ml-auto inline-flex items-center gap-1 rounded bg-pink-800/40 px-2 py-0.5 text-[10px] text-pink-200 hover:bg-pink-700/50 disabled:opacity-40"
              >
                {restoring === v.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RotateCcw className="h-2.5 w-2.5" />} Restore
              </button>
            </li>
          ))}
          {!versions.length && <li className="text-[11px] text-pink-700">No snapshots yet — snapshot to enable rollback.</li>}
        </ul>
      </div>
      <aside className="rounded-lg border border-pink-900/40 bg-pink-950/10 p-2">
        <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-pink-500">History timeline</h4>
        <TimelineView events={timeline} />
      </aside>
    </div>
  );
}
