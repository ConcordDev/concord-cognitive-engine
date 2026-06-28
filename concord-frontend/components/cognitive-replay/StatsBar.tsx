'use client';

/**
 * StatsBar — aggregate cognitive stats over a date range. Every value
 * comes from the `cognitive-replay.stats` macro (computed over the live
 * session corpus). Mounted at the top of the cognitive-replay lens.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Brain, Zap, CalendarDays, Layers } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface StatsResult {
  sinceDays: number;
  turns: number;
  sessions: number;
  totalTokens: number;
  avgTokensPerTurn: number;
  totalToolCalls: number;
  totalCitations: number;
  topBrain: { brain: string; turns: number } | null;
  topTool: { tool: string; count: number } | null;
  busiestDay: { day: string; turns: number } | null;
  brainCounts: Record<string, number>;
  spanDays: number;
}

export function StatsBar({ sinceDays }: { sinceDays: number }) {
  const [data, setData] = useState<StatsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<StatsResult>('cognitive-replay', 'stats', { sinceDays });
    if (r.data.ok && r.data.result) setData(r.data.result);
    else setError(r.data.error || 'failed to load stats');
    setLoading(false);
  }, [sinceDays]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Computing aggregate stats…
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
  if (!data) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat icon={<Layers className="h-4 w-4 text-cyan-400" />} label="Turns" value={data.turns.toLocaleString()} sub={`${data.sessions} session${data.sessions === 1 ? '' : 's'}`} />
      <Stat icon={<Zap className="h-4 w-4 text-amber-400" />} label="Total tokens" value={data.totalTokens.toLocaleString()} sub={`~${data.avgTokensPerTurn}/turn`} />
      <Stat icon={<Brain className="h-4 w-4 text-purple-400" />} label="Top brain" value={data.topBrain ? data.topBrain.brain : '—'} sub={data.topBrain ? `${data.topBrain.turns} activations` : 'no activity'} />
      <Stat icon={<CalendarDays className="h-4 w-4 text-emerald-400" />} label="Busiest day" value={data.busiestDay ? data.busiestDay.day.slice(5) : '—'} sub={data.busiestDay ? `${data.busiestDay.turns} turns` : 'no activity'} />
    </div>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-400">
        {icon}{label}
      </div>
      <div className="mt-1 truncate text-lg font-bold text-zinc-100" title={value}>{value}</div>
      <div className="mt-0.5 text-[11px] text-zinc-400">{sub}</div>
    </div>
  );
}
