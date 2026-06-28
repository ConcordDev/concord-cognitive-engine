'use client';

/**
 * WindowCompare — compares two adjacent cognitive time windows (the most
 * recent N days vs the N days before that) via the
 * `cognitive-replay.compare` macro. Renders deltas with direction.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, GitCompare, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Delta { a: number; b: number; change: number; pct: number }
interface CompareResult {
  windowA: { start: number; end: number; turns: number; totalTokens: number };
  windowB: { start: number; end: number; turns: number; totalTokens: number };
  deltas: {
    turns: Delta; tokens: Delta; sessions: Delta;
    citations: Delta; toolCalls: Delta;
  };
}

const WINDOWS = [7, 14, 30];

export function WindowCompare() {
  const [windowDays, setWindowDays] = useState(7);
  const [data, setData] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<CompareResult>('cognitive-replay', 'compare', { windowDays });
    if (r.data.ok && r.data.result) setData(r.data.result);
    else setError(r.data.error || 'compare failed');
    setLoading(false);
  }, [windowDays]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <GitCompare className="h-4 w-4 text-cyan-400" />
        <h2 className="text-sm font-semibold text-zinc-100">Compare windows</h2>
        <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-[10px]">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWindowDays(w)}
              className={`rounded px-2 py-0.5 font-mono uppercase ${windowDays === w ? 'bg-cyan-500/20 text-cyan-200' : 'text-zinc-400 hover:text-zinc-300'}`}
            >
              {w}d
            </button>
          ))}
        </div>
        <span className="text-[11px] text-zinc-400">last {windowDays}d vs prior {windowDays}d</span>
      </div>
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          <span>{error}</span>
          <button onClick={load} className="rounded border border-rose-500/40 px-2 py-0.5 font-medium text-rose-100 hover:bg-rose-500/20">Retry</button>
        </div>
      )}
      {loading ? (
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Comparing…</div>
      ) : data ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <DeltaCard label="Turns" d={data.deltas.turns} />
          <DeltaCard label="Tokens" d={data.deltas.tokens} />
          <DeltaCard label="Sessions" d={data.deltas.sessions} />
          <DeltaCard label="Citations" d={data.deltas.citations} />
          <DeltaCard label="Tool calls" d={data.deltas.toolCalls} />
        </div>
      ) : null}
    </div>
  );
}

function DeltaCard({ label, d }: { label: string; d: Delta }) {
  const up = d.change > 0;
  const flat = d.change === 0;
  const tone = flat ? 'text-zinc-400' : up ? 'text-emerald-400' : 'text-rose-400';
  const Icon = flat ? Minus : up ? ArrowUp : ArrowDown;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-1 font-mono text-base text-zinc-100">{d.a.toLocaleString()}</div>
      <div className={`mt-0.5 flex items-center gap-0.5 text-[11px] ${tone}`}>
        <Icon className="h-3 w-3" />
        {flat ? 'no change' : `${up ? '+' : ''}${d.change.toLocaleString()} (${d.pct >= 0 ? '+' : ''}${d.pct}%)`}
      </div>
      <div className="mt-0.5 font-mono text-[9px] text-zinc-400">was {d.b.toLocaleString()}</div>
    </div>
  );
}
