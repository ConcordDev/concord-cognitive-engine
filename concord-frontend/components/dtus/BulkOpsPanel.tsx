'use client';

/**
 * BulkOpsPanel — multi-select bulk operations over the DTU corpus.
 * Wired to the `dtus.bulkOp` macro, which validates the request and
 * returns the resolved per-DTU change set.
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Layers, Loader2, Tag, GitFork, ArrowUpDown, Archive, X } from 'lucide-react';

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

const OPS: { op: BulkOp; label: string; icon: typeof Tag; needsValue: boolean }[] = [
  { op: 'tag', label: 'Add tag', icon: Tag, needsValue: true },
  { op: 'untag', label: 'Remove tag', icon: Tag, needsValue: true },
  { op: 'cite', label: 'Cite DTU', icon: GitFork, needsValue: true },
  { op: 'tier', label: 'Set tier', icon: ArrowUpDown, needsValue: true },
  { op: 'archive', label: 'Archive', icon: Archive, needsValue: false },
];

export function BulkOpsPanel({
  selectedIds,
  onClear,
}: {
  selectedIds: string[];
  onClear: () => void;
}) {
  const [op, setOp] = useState<BulkOp>('tag');
  const [value, setValue] = useState('');
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const active = OPS.find((o) => o.op === op)!;

  const run = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const input: Record<string, unknown> = { dtuIds: selectedIds, op };
    if (active.needsValue) input.value = op === 'tier' ? value : value.trim();
    const res = await lensRun<BulkResult>('dtus', 'bulkOp', input);
    setLoading(false);
    if (res.data.ok && res.data.result) setResult(res.data.result);
    else setError(res.data.error || 'Bulk op failed');
  }, [selectedIds, op, value, active.needsValue]);

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
        <p className="text-xs text-gray-600">
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

          <button
            onClick={run}
            disabled={loading || (active.needsValue && !value.trim())}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-neon-green/30 bg-neon-green/10 py-1.5 text-xs text-neon-green hover:bg-neon-green/20 disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
            Apply to {selectedIds.length} DTU{selectedIds.length === 1 ? '' : 's'}
          </button>

          {error && <p className="text-[11px] text-red-400">{error}</p>}

          {result && (
            <div className="space-y-2 rounded-lg border border-green-500/30 bg-green-500/5 p-2.5">
              <p className="text-xs font-medium text-green-400">{result.summary}</p>
              <div className="max-h-40 space-y-1 overflow-auto">
                {result.changes.map((c, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded bg-lattice-surface px-2 py-1 text-[11px]"
                  >
                    <span className="truncate text-gray-300">{c.dtuId}</span>
                    <span className="text-gray-500">
                      {c.action} {c.field} → {c.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <button
        onClick={onClear}
        className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-white"
      >
        <X className="h-3 w-3" /> Clear selection
      </button>
    </div>
  );
}
