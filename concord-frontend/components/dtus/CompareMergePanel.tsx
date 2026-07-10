'use client';

/**
 * CompareMergePanel — side-by-side DTU comparison with a duplicate-merge
 * step. Wired to `dtus.compareDtus` (field diff + similarity) and
 * `dtus.mergeDtus` (produce a merged record + a tombstone recommendation
 * — a preview, not a persisted merge).
 *
 * The merge itself is honestly two separate, explicit, real actions the
 * user takes on the preview — never automatic:
 *   - "Save merged as new DTU" → `dtu.create` (a genuinely new DTU).
 *   - "Delete the duplicate" → `dtu.delete` (hard delete, confirmed) —
 *     there is no soft-delete/tombstone field on the DTU substrate yet,
 *     so this is the only real removal path available today.
 */

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { lensRun } from '@/lib/api/client';
import { GitMerge, Loader2, ArrowRight, Check, X, Save, Trash2 } from 'lucide-react';

export interface CompareDtu extends Record<string, unknown> {
  id: string;
  title?: string;
  summary?: string;
  tier?: string;
  tags?: string[];
}

interface DiffRow {
  field: string;
  a: unknown;
  b: unknown;
  same: boolean;
}

interface CompareResult {
  similarity: { title: number; body: number; tags: number; overall: number };
  recommendation: 'merge' | 'review' | 'keep_separate';
  diff: DiffRow[];
  tags: { shared: string[]; onlyA: string[]; onlyB: string[] };
}

interface MergeResult {
  strategy: string;
  merged: Record<string, unknown>;
  tombstone: string;
  keep: string;
  summary: string;
}

type Strategy = 'prefer_a' | 'prefer_b' | 'union';

export function CompareMergePanel({
  a,
  b,
  onClear,
}: {
  a: CompareDtu | null;
  b: CompareDtu | null;
  onClear: () => void;
}) {
  const queryClient = useQueryClient();
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [merge, setMerge] = useState<MergeResult | null>(null);
  const [loading, setLoading] = useState<'compare' | 'merge' | null>(null);
  const [strategy, setStrategy] = useState<Strategy>('union');
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const runCompare = useCallback(async () => {
    if (!a || !b) return;
    setLoading('compare');
    setMerge(null);
    const res = await lensRun<CompareResult>('dtus', 'compareDtus', { a, b });
    setLoading(null);
    if (res.data.ok && res.data.result) setCompare(res.data.result);
  }, [a, b]);

  const runMerge = useCallback(async () => {
    if (!a || !b) return;
    setLoading('merge');
    setSavedId(null);
    setSaveError(null);
    setDeleted(false);
    setDeleteError(null);
    const res = await lensRun<MergeResult>('dtus', 'mergeDtus', { a, b, strategy });
    setLoading(null);
    if (res.data.ok && res.data.result) setMerge(res.data.result);
  }, [a, b, strategy]);

  // Persist the preview as a genuinely new DTU (dtu.create) — the merge
  // preview itself is never auto-saved.
  const saveMergedAsNew = useCallback(async () => {
    if (!merge) return;
    setSaving(true);
    setSaveError(null);
    const m = merge.merged as { title?: string; summary?: string; tags?: string[] };
    const res = await lensRun<{ dtu?: { id?: string } }>('dtu', 'create', {
      title: m.title || 'Merged DTU',
      content: m.summary || '',
      tags: Array.isArray(m.tags) ? m.tags : [],
      meta: { mergedFrom: merge.merged.mergedFrom || [], mergeStrategy: merge.strategy },
    });
    setSaving(false);
    if (res.data.ok && res.data.result?.dtu?.id) {
      setSavedId(res.data.result.dtu.id);
      queryClient.invalidateQueries({ queryKey: ['dtus-browser'] });
    } else {
      setSaveError(res.data.error || 'Save failed');
    }
  }, [merge, queryClient]);

  // Hard-delete the tombstone-recommended duplicate. There is no soft
  // delete/status field on the DTU substrate today, so this is a real,
  // explicit, confirmed destructive action — never automatic.
  const deleteDuplicate = useCallback(async () => {
    if (!merge) return;
    if (!window.confirm(`Permanently delete DTU "${merge.tombstone}"? This cannot be undone.`)) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await lensRun('dtu', 'delete', { id: merge.tombstone });
    setDeleting(false);
    if (res.data.ok) {
      setDeleted(true);
      queryClient.invalidateQueries({ queryKey: ['dtus-browser'] });
    } else {
      setDeleteError(res.data.error || 'Delete failed');
    }
  }, [merge, queryClient]);

  if (!a || !b) {
    return (
      <div className="flex h-44 flex-col items-center justify-center rounded-xl border border-lattice-border bg-lattice-deep text-gray-400">
        <GitMerge className="mb-2 h-7 w-7" />
        <p className="text-sm">Pick two DTUs to compare and merge.</p>
        <p className="text-xs text-gray-400">Use the checkboxes in the list — exactly 2.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-lattice-border bg-lattice-deep p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <GitMerge className="h-4 w-4 text-neon-pink" /> Compare &amp; Merge
        </h3>
        <button onClick={onClear} className="text-gray-400 hover:text-white" aria-label="Clear selection">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DtuColumn dtu={a} label="A" />
        <DtuColumn dtu={b} label="B" />
      </div>

      <div className="flex gap-2">
        <button
          onClick={runCompare}
          disabled={loading !== null}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 py-1.5 text-xs text-neon-cyan hover:bg-neon-cyan/20 disabled:opacity-40"
        >
          {loading === 'compare' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
          Compare
        </button>
      </div>

      {compare && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                compare.recommendation === 'merge'
                  ? 'bg-red-500/20 text-red-400'
                  : compare.recommendation === 'review'
                    ? 'bg-yellow-500/20 text-yellow-400'
                    : 'bg-green-500/20 text-green-400'
              }`}
            >
              {compare.recommendation.replace('_', ' ')}
            </span>
            <span className="text-2xl font-bold text-white">{compare.similarity.overall}%</span>
            <span className="text-xs text-gray-400">similarity</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Bar label="Title" value={compare.similarity.title} />
            <Bar label="Body" value={compare.similarity.body} />
            <Bar label="Tags" value={compare.similarity.tags} />
          </div>

          <div className="space-y-1">
            {compare.diff.map((d) => (
              <div
                key={d.field}
                className="grid grid-cols-[80px_1fr_1fr] items-center gap-2 rounded bg-lattice-surface px-2 py-1 text-[11px]"
              >
                <span className="flex items-center gap-1 capitalize text-gray-400">
                  {d.same ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <X className="h-3 w-3 text-red-500" />
                  )}
                  {d.field}
                </span>
                <span className="truncate text-gray-300">{fmt(d.a)}</span>
                <span className="truncate text-gray-300">{fmt(d.b)}</span>
              </div>
            ))}
          </div>

          {/* Merge step */}
          <div className="space-y-2 rounded-lg border border-neon-pink/30 bg-neon-pink/5 p-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-400">Merge strategy:</span>
              {(['union', 'prefer_a', 'prefer_b'] as Strategy[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStrategy(s)}
                  className={`rounded px-1.5 py-0.5 text-[11px] ${
                    strategy === s
                      ? 'bg-neon-pink/20 text-neon-pink'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {s.replace('_', ' ')}
                </button>
              ))}
            </div>
            <button
              onClick={runMerge}
              disabled={loading !== null}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-neon-pink/20 py-1.5 text-xs text-neon-pink hover:bg-neon-pink/30 disabled:opacity-40"
            >
              {loading === 'merge' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GitMerge className="h-3.5 w-3.5" />
              )}
              Preview merged DTU
            </button>
          </div>
        </div>
      )}

      {merge && (
        <div className="space-y-2 rounded-lg border border-lattice-border bg-lattice-surface/60 p-3">
          <p className="text-xs font-medium text-gray-300">{merge.summary} (preview — not yet saved)</p>
          <div className="space-y-1 text-[11px] text-gray-300">
            <p>
              <span className="text-gray-400">Title:</span>{' '}
              {String(merge.merged.title || '')}
            </p>
            <p>
              <span className="text-gray-400">Tier:</span>{' '}
              {String(merge.merged.tier || '')}
            </p>
            <p>
              <span className="text-gray-400">Tags:</span>{' '}
              {(merge.merged.tags as string[] | undefined)?.join(', ') || '—'}
            </p>
            <p>
              <span className="text-gray-400">Citations:</span>{' '}
              {String(merge.merged.citationCount ?? 0)}
            </p>
            <p className="text-yellow-400">
              Recommendation: keep {merge.keep} · retire {merge.tombstone}
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={saveMergedAsNew}
              disabled={saving || !!savedId}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/10 py-1.5 text-xs text-green-400 hover:bg-green-500/20 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {savedId ? 'Saved as new DTU' : 'Save merged as new DTU'}
            </button>
            <button
              onClick={deleteDuplicate}
              disabled={deleting || deleted}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 py-1.5 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-40"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {deleted ? 'Duplicate deleted' : `Delete duplicate (${merge.tombstone.slice(0, 10)})`}
            </button>
          </div>
          {savedId && (
            <p className="text-[11px] text-green-400">Created DTU {savedId}. It now exists alongside the two originals until you delete the duplicate.</p>
          )}
          {saveError && <p className="text-[11px] text-red-400">{saveError}</p>}
          {deleteError && <p className="text-[11px] text-red-400">{deleteError}</p>}
        </div>
      )}
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.join(', ') || '—';
  return String(v);
}

function DtuColumn({ dtu, label }: { dtu: CompareDtu; label: string }) {
  return (
    <div className="rounded-lg border border-lattice-border bg-lattice-surface p-2.5">
      <span className="text-[10px] font-bold text-neon-cyan">DTU {label}</span>
      <p className="mt-1 line-clamp-2 text-xs font-medium text-white">
        {dtu.title || dtu.id}
      </p>
      <p className="mt-1 line-clamp-2 text-[11px] text-gray-400">{dtu.summary || ''}</p>
      <span className="mt-1 inline-block rounded bg-lattice-deep px-1.5 py-0.5 text-[10px] uppercase text-gray-400">
        {dtu.tier || 'regular'}
      </span>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-lattice-surface p-1.5">
      <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-lattice-border">
        <div className="h-full rounded-full bg-neon-cyan" style={{ width: `${value}%` }} />
      </div>
      <p className="text-[10px] text-gray-400">
        {label} {value}%
      </p>
    </div>
  );
}
