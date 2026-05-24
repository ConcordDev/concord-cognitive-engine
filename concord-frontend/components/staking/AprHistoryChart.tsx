'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

interface AprPoint {
  t: number;
  aprPct: number;
  aprBps: number;
}

interface AprHistory {
  poolId: string;
  poolName: string;
  previewMonths: number;
  series: AprPoint[];
  points: number;
  currentAprPct: number;
  minAprPct: number;
  maxAprPct: number;
}

/**
 * AprHistoryChart — APR history series for a pool so users can judge the
 * variable rate. Wires staking.apr_history.
 */
export function AprHistoryChart({ poolId, months }: { poolId: string; months: number }) {
  const [hist, setHist] = useState<AprHistory | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun<AprHistory>('staking', 'apr_history', { poolId, months });
      if (!cancelled && r.data?.ok && r.data.result) setHist(r.data.result);
    })();
    return () => {
      cancelled = true;
    };
  }, [poolId, months]);

  if (!hist) {
    return <div className="text-xs text-zinc-400 py-3">Loading APR history…</div>;
  }

  const chartData = hist.series.map((p) => ({
    day: new Date(p.t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    aprPct: p.aprPct,
  }));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 text-[11px] font-mono">
        <span className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-amber-300">
          Now {hist.currentAprPct.toFixed(2)}%
        </span>
        <span className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-400">
          Low {hist.minAprPct.toFixed(2)}%
        </span>
        <span className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-400">
          High {hist.maxAprPct.toFixed(2)}%
        </span>
        <span className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-400">
          {hist.points} sample{hist.points === 1 ? '' : 's'}
        </span>
      </div>
      {chartData.length < 2 ? (
        <p className="text-[11px] text-zinc-400">
          One sample so far — the APR series builds a point per day this pool is viewed.
        </p>
      ) : (
        <ChartKit
          kind="area"
          data={chartData}
          xKey="day"
          height={180}
          series={[{ key: 'aprPct', label: `${hist.poolName} APR %`, color: '#f59e0b' }]}
        />
      )}
    </div>
  );
}
