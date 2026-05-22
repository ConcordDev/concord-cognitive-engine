'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, Camera, RotateCcw, Trash2, Check } from 'lucide-react';

interface SnapshotSummary {
  id: string;
  label: string;
  takenAt: string;
  qualityPreset?: string;
  keyCount: number;
}

/**
 * SnapshotManager — capture the current server-persisted preference set,
 * list captured snapshots, and re-apply (restore) or delete one. Backed by
 * `settings.captureSnapshot` / `listSnapshots` / `applySnapshot` /
 * `deleteSnapshot`. This is the rollback-to-known-good config surface.
 */
export function SnapshotManager({ onApplied }: { onApplied?: () => void }) {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<{ snapshots: SnapshotSummary[] }>('settings', 'listSnapshots', {});
      if (r.data?.ok && r.data.result) setSnapshots(r.data.result.snapshots);
      else if (r.data?.error) setError(r.data.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load snapshots');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capture = useCallback(async () => {
    setBusy('capture');
    setError(null);
    try {
      const r = await lensRun('settings', 'captureSnapshot', label.trim() ? { label: label.trim() } : {});
      if (r.data?.ok) {
        setLabel('');
        await load();
      } else {
        setError(r.data?.error || 'failed to capture snapshot');
      }
    } finally {
      setBusy(null);
    }
  }, [label, load]);

  const apply = useCallback(async (id: string) => {
    setBusy(id);
    setError(null);
    setAppliedId(null);
    try {
      const r = await lensRun<{ applied: string }>('settings', 'applySnapshot', { id });
      if (r.data?.ok && r.data.result) {
        setAppliedId(r.data.result.applied);
        onApplied?.();
      } else {
        setError(r.data?.error || 'failed to apply snapshot');
      }
    } finally {
      setBusy(null);
    }
  }, [onApplied]);

  const remove = useCallback(async (id: string) => {
    setBusy(id);
    try {
      const r = await lensRun('settings', 'deleteSnapshot', { id });
      if (r.data?.ok) await load();
      else if (r.data?.error) setError(r.data.error);
    } finally {
      setBusy(null);
    }
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Snapshot label (optional)"
          aria-label="Snapshot label"
          maxLength={80}
          className="flex-1 px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <button
          onClick={capture}
          disabled={busy === 'capture'}
          className="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded text-white inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {busy === 'capture' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
          Capture
        </button>
      </div>

      {error && (
        <p className="text-[11px] text-red-400 bg-red-950/40 border border-red-900/50 rounded px-3 py-1.5">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-3">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading snapshots…
        </div>
      ) : snapshots.length === 0 ? (
        <p className="text-[11px] text-gray-500 italic">No snapshots yet — capture one to roll back later.</p>
      ) : (
        <ul className="space-y-1.5">
          {snapshots.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800 rounded px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-200 truncate">{s.label}</p>
                <p className="text-[10px] text-white/40">
                  {new Date(s.takenAt).toLocaleString()} · {s.qualityPreset ?? 'unset'} · {s.keyCount} keys
                </p>
              </div>
              {appliedId === s.id && (
                <span className="text-[10px] text-emerald-400 inline-flex items-center gap-0.5">
                  <Check className="w-3 h-3" /> Restored
                </span>
              )}
              <button
                onClick={() => apply(s.id)}
                disabled={busy === s.id}
                className="px-2 py-1 text-[11px] bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 rounded text-white inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                {busy === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                Restore
              </button>
              <button
                onClick={() => remove(s.id)}
                disabled={busy === s.id}
                aria-label={`Delete snapshot ${s.label}`}
                title="Delete snapshot"
                className="text-gray-500 hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
