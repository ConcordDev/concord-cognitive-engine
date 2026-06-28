'use client';

/**
 * WrappedCards — Spotify-Wrapped-style summary cards for the cognitive
 * week. Every card value comes from the `cognitive-replay.wrapped`
 * macro, which computes over the live session corpus.
 */

import { useEffect, useState, useCallback } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface WrappedCard {
  id: string;
  title: string;
  value: string | number;
  caption: string;
}
interface WrappedResult {
  sinceDays: number;
  archetype: string;
  peakHour: number;
  cards: WrappedCard[];
}

const ACCENT = [
  'from-amber-500/20 to-amber-500/5 border-amber-500/30 text-amber-200',
  'from-purple-500/20 to-purple-500/5 border-purple-500/30 text-purple-200',
  'from-cyan-500/20 to-cyan-500/5 border-cyan-500/30 text-cyan-200',
  'from-emerald-500/20 to-emerald-500/5 border-emerald-500/30 text-emerald-200',
  'from-rose-500/20 to-rose-500/5 border-rose-500/30 text-rose-200',
  'from-indigo-500/20 to-indigo-500/5 border-indigo-500/30 text-indigo-200',
];

export function WrappedCards({ sinceDays }: { sinceDays: number }) {
  const [data, setData] = useState<WrappedResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<WrappedResult>('cognitive-replay', 'wrapped', { sinceDays });
    if (r.data.ok && r.data.result) setData(r.data.result);
    else setError(r.data.error || 'failed to load wrapped summary');
    setLoading(false);
  }, [sinceDays]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="flex items-center gap-2 p-6 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Composing your cognitive wrapped…
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
        <span>{error}</span>
        <button onClick={load} className="rounded border border-rose-500/40 px-2 py-0.5 font-medium text-rose-100 hover:bg-rose-500/20">Retry</button>
      </div>
    );
  }
  if (!data || data.cards.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-400" />
        <h2 className="text-sm font-semibold text-white">Your {data.sinceDays}-day cognition, wrapped</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {data.cards.map((c, i) => (
          <div
            key={c.id}
            className={`rounded-xl border bg-gradient-to-b p-3.5 ${ACCENT[i % ACCENT.length]}`}
          >
            <div className="text-[10px] font-medium uppercase tracking-wider opacity-70">{c.title}</div>
            <div className="mt-1 truncate text-xl font-bold text-white" title={String(c.value)}>
              {typeof c.value === 'number' ? c.value.toLocaleString() : c.value}
            </div>
            <div className="mt-0.5 text-[11px] opacity-80">{c.caption}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
