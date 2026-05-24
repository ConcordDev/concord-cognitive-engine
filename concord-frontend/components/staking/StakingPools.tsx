'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

export interface Pool {
  id: string;
  name: string;
  risk: string;
  description: string;
  minStake: number;
  baseAprPct: number;
  capAprPct: number;
  earlyPenaltyPct: number;
  previewMonths: number;
  previewAprPct: number;
  perMonthBps: number;
}

const RISK_TONE: Record<string, string> = {
  low: 'text-emerald-300 border-emerald-700/50 bg-emerald-950/30',
  medium: 'text-amber-300 border-amber-700/50 bg-amber-950/30',
  high: 'text-rose-300 border-rose-700/50 bg-rose-950/30',
};

export function StakingPools({
  selectedPoolId,
  months,
  onSelect,
}: {
  selectedPoolId: string;
  months: number;
  onSelect: (p: Pool) => void;
}) {
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const r = await lensRun<{ pools: Pool[] }>('staking', 'list_pools', { months });
      if (!cancelled) {
        setPools(r.data?.result?.pools || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [months]);

  if (loading) {
    return <div className="text-xs text-zinc-400 py-3">Loading pools…</div>;
  }
  if (pools.length === 0) {
    return <div className="text-xs text-zinc-400 py-3">No pools available.</div>;
  }

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {pools.map((p) => {
        const active = p.id === selectedPoolId;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p)}
            className={`text-left rounded-lg border p-3 transition focus:outline-none focus:ring-2 focus:ring-amber-500 ${
              active ? 'border-amber-500 bg-amber-950/40' : 'border-zinc-700/60 bg-zinc-900/70 hover:border-zinc-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-zinc-100">{p.name}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider border ${RISK_TONE[p.risk] || RISK_TONE.medium}`}>
                {p.risk}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-400 leading-snug">{p.description}</p>
            <dl className="mt-2 space-y-0.5 text-[11px] font-mono">
              <div className="flex justify-between"><dt className="text-zinc-400">APR @{p.previewMonths}mo</dt><dd className="text-amber-300">{p.previewAprPct.toFixed(2)}%</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">Range</dt><dd className="text-zinc-300">{p.baseAprPct.toFixed(1)}–{p.capAprPct.toFixed(1)}%</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">Min stake</dt><dd className="text-zinc-300">{p.minStake} CC</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">Early penalty</dt><dd className="text-rose-300">{(p.earlyPenaltyPct * 100).toFixed(0)}%</dd></div>
            </dl>
          </button>
        );
      })}
    </div>
  );
}
