'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';

interface LedgerEntry {
  id: string;
  t: number;
  kind: string;
  amountCc?: number;
  yieldCc?: number;
  penaltyCc?: number;
  note?: string;
}

interface TimelinePoint {
  t: number;
  yieldCc: number;
  cumulativeCc: number;
}

interface Ledger {
  entries: LedgerEntry[];
  count: number;
  totalYieldEarnedCc: number;
  totalPenaltiesCc: number;
  timeline: TimelinePoint[];
}

const KIND_TONE: Record<string, TimelineEvent['tone']> = {
  stake_opened: 'info',
  stake_redeemed: 'good',
  compounded: 'good',
  early_unstake: 'bad',
  auto_compound_set: 'default',
  receipt_transferred: 'warn',
};

/**
 * EarningsLedger — rewards / earnings history over time with a cumulative
 * yield chart. Wires staking.earnings_ledger.
 */
export function EarningsLedger({ refreshKey }: { refreshKey: number }) {
  const [ledger, setLedger] = useState<Ledger | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun<Ledger>('staking', 'earnings_ledger', { limit: 200 });
      if (!cancelled && r.data?.ok && r.data.result) setLedger(r.data.result);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!ledger) {
    return <div className="text-xs text-zinc-500 py-3">Loading earnings ledger…</div>;
  }

  if (ledger.count === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 px-3 py-4 text-center text-xs italic text-zinc-500">
        No earnings activity yet. Open a stake to start the ledger.
      </div>
    );
  }

  const cumData = ledger.timeline.map((p) => ({
    when: new Date(p.t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    cumulativeCc: p.cumulativeCc,
  }));

  const events: TimelineEvent[] = ledger.entries.map((e) => ({
    id: e.id,
    label: e.note || e.kind,
    time: e.t * 1000,
    tone: KIND_TONE[e.kind] || 'default',
    detail:
      e.kind === 'early_unstake' && e.penaltyCc
        ? `Penalty ${e.penaltyCc} CC`
        : e.yieldCc
          ? `Yield ${e.yieldCc} CC`
          : undefined,
  }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-emerald-800/50 bg-emerald-950/20 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Total yield earned</div>
          <div className="mt-0.5 font-mono text-lg text-emerald-300">
            {ledger.totalYieldEarnedCc} CC
          </div>
        </div>
        <div className="rounded border border-rose-800/50 bg-rose-950/20 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Early-exit penalties</div>
          <div className="mt-0.5 font-mono text-lg text-rose-300">
            {ledger.totalPenaltiesCc} CC
          </div>
        </div>
      </div>
      {cumData.length >= 2 && (
        <ChartKit
          kind="area"
          data={cumData}
          xKey="when"
          height={170}
          series={[{ key: 'cumulativeCc', label: 'Cumulative yield (CC)', color: '#22c55e' }]}
        />
      )}
      <TimelineView events={events} />
    </div>
  );
}
