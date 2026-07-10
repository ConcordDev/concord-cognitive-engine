'use client';

/**
 * BulkOpsPanel — multi-select bulk operations over the DTU corpus.
 *
 * Two-phase, honest-by-construction flow:
 *   1. Preview — `dtus.bulkOp` validates the request and returns the
 *      resolved per-DTU change set (a plan, nothing persisted yet).
 *   2. Apply — for the two ops the substrate can actually persist
 *      (tag / untag / tier), each affected DTU is updated for real via
 *      `dtu.update` (the same macro `PATCH /api/dtus/:id` calls). `cite`
 *      and `archive` have no real persistence path today (see inline
 *      notes) so they stay preview-only and say so — never a fabricated
 *      "applied" success.
 */

import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { lensRun } from '@/lib/api/client';
import { Layers, Loader2, Tag, GitFork, ArrowUpDown, Archive, X, Check, AlertTriangle } from 'lucide-react';

type BulkOp = 'tag' | 'untag' | 'cite' | 'tier' | 'archive';

interface BulkChange {
  dtuId: string;
  field: string;
  action: string;
  value: string;
}

interface BulkResult {
  op: BulkOp;
  value: string | null;
  affected: number;
  changes: BulkChange[];
  summary: string;
}

interface CorpusDtu extends Record<string, unknown> {
  id: string;
}

interface ApplyOutcome {
  dtuId: string;
  ok: boolean;
  error?: string;
}

const OPS: {
  op: BulkOp;
  label: string;
  icon: typeof Tag;
  needsValue: boolean;
  persistable: boolean;
  previewOnlyReason?: string;
}[] = [
  { op: 'tag', label: 'Add tag', icon: Tag, needsValue: true, persistable: true },
  { op: 'untag', label: 'Remove tag', icon: Tag, needsValue: true, persistable: true },
  {
    op: 'cite',
    label: 'Cite DTU',
    icon: GitFork,
    needsValue: true,
    persistable: false,
    previewOnlyReason:
      'Citation registration requires per-parent consent + royalty-cascade bookkeeping — no bulk write path exists yet. This computes the plan only.',
  },
  { op: 'tier', label: 'Set tier', icon: ArrowUpDown, needsValue: true, persistable: true },
  {
    op: 'archive',
    label: 'Archive',
    icon: Archive,
    needsValue: false,
    persistable: false,
    previewOnlyReason:
      "The DTU substrate has no archived/status field yet (only title, content, tags, tier are writable) — this computes the plan only, nothing is persisted.",
  },
];

export function BulkOpsPanel({
  selectedIds,
  corpus,
  onClear,
}: {
  selectedIds: string[];
  corpus: CorpusDtu[];
  onClear: () => void;
}) {
  const queryClient = useQueryClient();
  const byId = useMemo(() => new Map(corpus.map((d) => [d.id, d])), [corpus]);

  const [op, setOp] = useState<BulkOp>('tag');
  const [value, setValue] = useState('');
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyOutcomes, setApplyOutcomes] = useState<ApplyOutcome[] | null>(null);

  const active = OPS.find((o) => o.op === op)!;

  const runPreview = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setApplyOutcomes(null);
    const input: Record<string, unknown> = { dtuIds: selectedIds, op };
    if (active.needsValue) input.value = op === 'tier' ? value : value.trim();
    const res = await lensRun<BulkResult>('dtus', 'bulkOp', input);
    setLoading(false);
    if (res.data.ok && res.data.result) setResult(res.data.result);
    else setError(res.data.error || 'Bulk op failed');
  }, [selectedIds, op, value, active.needsValue]);

  const applyChanges = useCallback(async () => {
    if (!result || !active.persistable) return;
    setApplying(true);
    const outcomes: ApplyOutcome[] = [];
    for (const change of result.changes) {
      try {
        let patch: Record<string, unknown> | null = null;
        if (change.field === 'tags' && change.action === 'add') {
          const existing = Array.isArray(byId.get(change.dtuId)?.tags) ? (byId.get(change.dtuId)!.tags as string[]) : [];
          patch = { tags: Array.from(new Set([...existing, change.value])) };
        } else if (change.field === 'tags' && change.action === 'remove') {
          const existing = Array.isArray(byId.get(change.dtuId)?.tags) ? (byId.get(change.dtuId)!.tags as string[]) : [];
          patch = { tags: existing.filter((t) => t !== change.value) };
        } else if (change.field === 'tier') {
          patch = { tier: change.value };
        }
        if (!patch) { outcomes.push({ dtuId: change.dtuId, ok: false, error: 'no persist mapping' }); continue; }
        const res = await lensRun<{ dtu: unknown }>('dtu', 'update', { id: change.dtuId, ...patch });
        outcomes.push({ dtuId: change.dtuId, ok: res.data.ok, error: res.data.ok ? undefined : (res.data.error || 'update failed') });
      } catch (e) {
        outcomes.push({ dtuId: change.dtuId, ok: false, error: e instanceof Error ? e.message : 'update failed' });
      }
    }
    setApplying(false);
    setApplyOutcomes(outcomes);
    if (outcomes.some((o) => o.ok)) {
      queryClient.invalidateQueries({ queryKey: ['dtus-browser'] });
    }
  }, [result, active.persistable, byId, queryClient]);

  const succeeded = applyOutcomes?.filter((o) => o.ok).length ?? 0;
  const failed = applyOutcomes?.filter((o) => !o.ok).length ?? 0;

  return (
    <div className="space-y-3 rounded-xl border border-lattice-border bg-lattice-deep p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="h-4 w-4 text-neon-green" /> Bulk Operations
        </h3>
        <span className="rounded bg-lattice-surface px-2 py-0.5 text-[11px] text-gray-400">
          {selectedIds.length} selected
        </span>
      </div>

      {selectedIds.length === 0 ? (
        <p className="text-xs text-gray-400">
          Tick DTUs in the list to multi-select, then apply a bulk operation here.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {OPS.map((o) => {
              const Icon = o.icon;
              return (
                <button
                  key={o.op}
                  onClick={() => {
                    setOp(o.op);
                    setValue('');
                    setResult(null);
                    setApplyOutcomes(null);
                  }}
                  className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors ${
                    op === o.op
                      ? 'bg-neon-green/20 text-neon-green'
                      : 'bg-lattice-surface text-gray-400 hover:text-white'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {o.label}
                </button>
              );
            })}
          </div>

          {active.needsValue &&
            (op === 'tier' ? (
              <div className="flex gap-1.5">
                {(['regular', 'mega', 'hyper'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setValue(t)}
                    className={`flex-1 rounded px-2 py-1 text-[11px] capitalize ${
                      value === t
                        ? 'bg-neon-cyan/20 text-neon-cyan'
                        : 'bg-lattice-surface text-gray-400 hover:text-white'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            ) : (
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={op === 'cite' ? 'DTU id to cite…' : 'Tag value…'}
                className="w-full rounded-lg border border-lattice-border bg-lattice-surface px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none"
              />
            ))}

          {!active.persistable && (
            <p className="flex items-start gap-1.5 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-2 py-1.5 text-[11px] text-yellow-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" /> {active.previewOnlyReason}
            </p>
          )}

          <button
            onClick={runPreview}
            disabled={loading || (active.needsValue && !value.trim())}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-neon-green/30 bg-neon-green/10 py-1.5 text-xs text-neon-green hover:bg-neon-green/20 disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
            Preview {op} on {selectedIds.length} DTU{selectedIds.length === 1 ? '' : 's'}
          </button>

          {error && <p className="text-[11px] text-red-400">{error}</p>}

          {result && (
            <div className="space-y-2 rounded-lg border border-lattice-border bg-lattice-surface/60 p-2.5">
              <p className="text-xs font-medium text-gray-300">{result.summary} (preview)</p>
              <div className="max-h-40 space-y-1 overflow-auto">
                {result.changes.map((c, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded bg-lattice-surface px-2 py-1 text-[11px]"
                  >
                    <span className="truncate text-gray-300">{c.dtuId}</span>
                    <span className="text-gray-400">
                      {c.action} {c.field} → {c.value}
                    </span>
                  </div>
                ))}
              </div>

              {active.persistable ? (
                <button
                  onClick={applyChanges}
                  disabled={applying}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-green-500/30 bg-green-500/10 py-1.5 text-xs text-green-400 hover:bg-green-500/20 disabled:opacity-40"
                >
                  {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Apply {result.changes.length} change{result.changes.length === 1 ? '' : 's'} to the substrate
                </button>
              ) : (
                <p className="text-[10px] text-gray-400">No apply step — see the note above.</p>
              )}

              {applyOutcomes && (
                <p className={`text-[11px] ${failed > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {succeeded} applied{failed > 0 ? `, ${failed} failed (e.g. tier changes need admin role)` : ''}.
                </p>
              )}
            </div>
          )}
        </>
      )}

      <button
        onClick={onClear}
        className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-white"
      >
        <X className="h-3 w-3" /> Clear selection
      </button>
    </div>
  );
}
