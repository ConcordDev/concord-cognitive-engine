'use client';

/**
 * CompareMergePanel — side-by-side DTU comparison with a duplicate-merge
 * step. Wired to `dtus.compareDtus` (field diff + similarity) and
 * `dtus.mergeDtus` (produce a merged record + tombstone target).
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { GitMerge, Loader2, ArrowRight, Check, X } from 'lucide-react';

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
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [merge, setMerge] = useState<MergeResult | null>(null);
  const [loading, setLoading] = useState<'compare' | 'merge' | null>(null);
  const [strategy, setStrategy] = useState<Strategy>('union');

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
    const res = await lensRun<MergeResult>('dtus', 'mergeDtus', { a, b, strategy });
    setLoading(null);
    if (res.data.ok && res.data.result) setMerge(res.data.result);
  }, [a, b, strategy]);

  if (!a || !b) {
    return (
      <div className="flex h-44 flex-col items-center justify-center rounded-xl border border-lattice-border bg-lattice-deep text-gray-500">
        <GitMerge className="mb-2 h-7 w-7" />
        <p className="text-sm">Pick two DTUs to compare and merge.</p>
        <p className="text-xs text-gray-600">Use the checkboxes in the list — exactly 2.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-lattice-border bg-lattice-deep p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <GitMerge className="h-4 w-4 text-neon-pink" /> Compare &amp; Merge
        </h3>
        <button onClick={onClear} className="text-gray-500 hover:text-white" aria-label="Clear selection">
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
            <span className="text-xs text-gray-500">similarity</span>
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
              Build merged DTU
            </button>
          </div>
        </div>
      )}

      {merge && (
        <div className="space-y-2 rounded-lg border border-green-500/30 bg-green-500/5 p-3">
          <p className="text-xs font-medium text-green-400">{merge.summary}</p>
          <div className="space-y-1 text-[11px] text-gray-300">
            <p>
              <span className="text-gray-500">Title:</span>{' '}
              {String(merge.merged.title || '')}
            </p>
            <p>
              <span className="text-gray-500">Tier:</span>{' '}
              {String(merge.merged.tier || '')}
            </p>
            <p>
              <span className="text-gray-500">Tags:</span>{' '}
              {(merge.merged.tags as string[] | undefined)?.join(', ') || '—'}
            </p>
            <p>
              <span className="text-gray-500">Citations:</span>{' '}
              {String(merge.merged.citationCount ?? 0)}
            </p>
            <p className="text-yellow-400">
              Keep {merge.keep} · tombstone {merge.tombstone}
            </p>
          </div>
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
      <p className="mt-1 line-clamp-2 text-[11px] text-gray-500">{dtu.summary || ''}</p>
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
      <p className="text-[10px] text-gray-500">
        {label} {value}%
      </p>
    </div>
  );
}
