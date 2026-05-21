'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

interface MonthlyRow {
  month: number;
  simpleBalanceCc: number;
  compoundBalanceCc: number;
}

interface Estimate {
  poolId: string;
  poolName: string;
  principalCc: number;
  months: number;
  aprPct: number;
  aprBps: number;
  monthlyCc: number;
  annualCc: number;
  termCc: number;
  compoundTermCc: number;
  compoundBonusCc: number;
  monthly: MonthlyRow[];
}

/**
 * RewardsEstimator — annual/monthly estimated-rewards breakdown before
 * staking, simple vs auto-compound. Wires staking.estimate_rewards.
 */
export function RewardsEstimator({
  poolId,
  principalCc,
  months,
}: {
  poolId: string;
  principalCc: number;
  months: number;
}) {
  const [est, setEst] = useState<Estimate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun<Estimate>('staking', 'estimate_rewards', {
        poolId,
        principalCc,
        months,
      });
      if (cancelled) return;
      if (r.data?.ok && r.data.result) {
        setEst(r.data.result);
        setError(null);
      } else {
        setEst(null);
        setError(r.data?.error || 'estimate_failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [poolId, principalCc, months]);

  if (error) {
    return (
      <div className="rounded-lg border border-rose-800/50 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
        Estimate unavailable: {error}
      </div>
    );
  }
  if (!est) {
    return <div className="text-xs text-zinc-500 py-3">Calculating estimate…</div>;
  }

  const chartData: Array<Record<string, unknown>> = est.monthly.map((m) => ({
    month: m.month,
    simpleBalanceCc: m.simpleBalanceCc,
    compoundBalanceCc: m.compoundBalanceCc,
  }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="APR" value={`${est.aprPct.toFixed(2)}%`} tone="text-amber-300" />
        <Metric label="Monthly" value={`${est.monthlyCc} CC`} tone="text-emerald-300" />
        <Metric label="Annual" value={`${est.annualCc} CC`} tone="text-emerald-300" />
        <Metric label={`Term (${est.months}mo)`} value={`${est.termCc} CC`} tone="text-emerald-300" />
      </div>
      <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">
        Auto-compound over {est.months}mo yields{' '}
        <strong className="font-mono">{est.compoundTermCc} CC</strong> — a{' '}
        <strong className="font-mono">+{est.compoundBonusCc} CC</strong> bonus vs simple interest.
      </div>
      <ChartKit
        kind="line"
        data={chartData}
        xKey="month"
        height={200}
        series={[
          { key: 'simpleBalanceCc', label: 'Simple', color: '#f59e0b' },
          { key: 'compoundBalanceCc', label: 'Auto-compound', color: '#22c55e' },
        ]}
      />
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-sm ${tone}`}>{value}</div>
    </div>
  );
}
