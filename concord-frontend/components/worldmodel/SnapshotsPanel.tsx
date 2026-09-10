'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, GitCompareArrows, Loader2, RefreshCcw } from 'lucide-react';
import {
  type SnapshotDiff, type WmSnapshot,
  btn, btnGhost, card, input, invalidateWorldModel, wmRun, WM_QUERY_KEYS,
} from '@/components/worldmodel/wm-shared';

// ─── Snapshots tab ──────────────────────────────────────────────────────
export function SnapshotsPanel() {
  const qc = useQueryClient();
  const onRestored = () => invalidateWorldModel(qc);
  const [label, setLabel] = useState('');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);

  const snaps = useQuery({
    queryKey: WM_QUERY_KEYS.snapshots,
    queryFn: () => wmRun<{ snapshots: WmSnapshot[] }>('list_snapshots_full'),
  });
  const capture = useMutation({
    mutationFn: () => wmRun('capture_snapshot', { label: label || `snapshot-${new Date().toISOString()}` }),
    onSuccess: () => { setLabel(''); qc.invalidateQueries({ queryKey: WM_QUERY_KEYS.snapshots }); },
  });
  const doDiff = useMutation({
    mutationFn: () => wmRun<SnapshotDiff>('diff_snapshots', { fromId, toId }),
    onSuccess: (d) => setDiff(d),
  });
  const restore = useMutation({
    mutationFn: (id: string) => wmRun('restore_snapshot', { id }),
    onSuccess: onRestored,
  });

  const list = snaps.data?.snapshots ?? [];

  return (
    <div className="space-y-4">
      <div className={`${card} flex flex-wrap items-end gap-2`}>
        <input className={`${input} flex-1 min-w-40`} placeholder="Snapshot label" aria-label="Snapshot label"
          value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className={btn} disabled={capture.isPending} onClick={() => capture.mutate()}>
          {capture.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />} Capture snapshot
        </button>
      </div>

      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">World-state snapshots</h3>
        {list.length === 0 ? (
          <p className="text-xs text-emerald-700">No snapshots yet — capture one above.</p>
        ) : (
          <ul className="space-y-1">
            {list.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded border border-emerald-900/30 bg-black/30 px-3 py-2 text-xs">
                <Camera className="h-3 w-3 text-emerald-500" aria-hidden />
                <span className="text-emerald-100">{s.label}</span>
                <span className="text-emerald-600">{s.entityCount}E · {s.relationCount}R</span>
                <span className="text-[10px] text-emerald-800">{new Date(s.capturedAt).toLocaleString()}</span>
                <button className={`${btnGhost} ml-auto`} onClick={() => restore.mutate(s.id)}>
                  <RefreshCcw className="h-3 w-3" /> restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {list.length >= 2 && (
        <div className={card}>
          <h3 className="mb-2 text-sm font-semibold text-emerald-300">Compare snapshots</h3>
          <div className="flex flex-wrap items-center gap-2">
            <select className={input} aria-label="From snapshot" value={fromId} onChange={(e) => setFromId(e.target.value)}>
              <option value="">from…</option>
              {list.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <span className="text-emerald-700">→</span>
            <select className={input} aria-label="To snapshot" value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">to…</option>
              {list.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <button className={btn} disabled={!fromId || !toId || doDiff.isPending} onClick={() => doDiff.mutate()}>
              <GitCompareArrows className="h-3 w-3" /> Diff
            </button>
          </div>
          {diff && (
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex flex-wrap gap-3">
                {Object.entries(diff.summary).map(([k, v]) => (
                  <span key={k} className="rounded bg-emerald-900/30 px-2 py-0.5 text-emerald-300">{k}: {v}</span>
                ))}
              </div>
              {diff.addedEntities.length > 0 && (
                <DiffBlock title="Added entities" tone="text-emerald-400"
                  items={diff.addedEntities.map((e) => e.name)} />
              )}
              {diff.removedEntities.length > 0 && (
                <DiffBlock title="Removed entities" tone="text-rose-400"
                  items={diff.removedEntities.map((e) => e.name)} />
              )}
              {diff.changedEntities.length > 0 && (
                <div>
                  <p className="text-amber-400">Changed entities</p>
                  <ul className="ml-3 space-y-0.5">
                    {diff.changedEntities.map((c) => (
                      <li key={c.id} className="text-emerald-500">
                        {c.name}: {c.changes.map((ch) => `${ch.field} ${JSON.stringify(ch.from)}→${JSON.stringify(ch.to)}`).join(', ')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(diff.addedRelations.length > 0 || diff.removedRelations.length > 0) && (
                <DiffBlock title="Relations" tone="text-indigo-400"
                  items={[
                    ...diff.addedRelations.map((r) => `+ ${r.type}`),
                    ...diff.removedRelations.map((r) => `− ${r.type}`),
                  ]} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DiffBlock({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  return (
    <div>
      <p className={tone}>{title}</p>
      <ul className="ml-3 text-emerald-500">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

