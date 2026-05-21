'use client';

/**
 * PayoutHistory — fired-payout log. Shows pacts the caller wrote that
 * fired (sparks paid out) and payouts the caller received a split from.
 */

import { Skull, ArrowDownToLine } from 'lucide-react';
import { TimelineView } from '@/components/viz/TimelineView';
import type { Payout } from './types';

interface PayoutHistoryProps {
  paidOut: Payout[];
  received: Payout[];
  totalPaidOutSparks: number;
  totalReceivedSparks: number;
}

function fmtDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString();
}

export function PayoutHistory({
  paidOut,
  received,
  totalPaidOutSparks,
  totalReceivedSparks,
}: PayoutHistoryProps) {
  const timeline = [
    ...paidOut.map((p) => ({
      id: `out-${p.id}`,
      label: `Your pact fired — ${p.totalSparks} ⚡ paid out`,
      time: p.firedAt * 1000,
      detail: `${p.cause} · ${p.splits.length} beneficiary split`,
      tone: 'bad' as const,
    })),
    ...received.map((p) => ({
      id: `in-${p.id}`,
      label: `Inherited ${p.mySparks ?? 0} ⚡ from ${(p.insuredUserId || '').slice(0, 12)}`,
      time: p.firedAt * 1000,
      detail: `${p.cause} · your ${p.mySharePct ?? 0}% share`,
      tone: 'good' as const,
    })),
  ];

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-200">
        <Skull className="h-4 w-4 text-rose-400" /> Payout History
      </h2>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-rose-800/40 bg-rose-950/30 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-rose-400">Paid out (yours)</div>
          <div className="mt-0.5 font-mono text-lg text-rose-200">{totalPaidOutSparks} ⚡</div>
        </div>
        <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/30 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-emerald-400">Inherited (yours)</div>
          <div className="mt-0.5 font-mono text-lg text-emerald-200">{totalReceivedSparks} ⚡</div>
        </div>
      </div>

      {timeline.length === 0 ? (
        <p className="text-xs italic text-zinc-500">No pacts have fired yet.</p>
      ) : (
        <TimelineView events={timeline} />
      )}

      {received.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {received.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-emerald-800/30 bg-emerald-950/20 px-3 py-2 text-xs"
            >
              <span className="flex items-center gap-1.5 text-emerald-200">
                <ArrowDownToLine className="h-3.5 w-3.5" />
                {p.mySparks} ⚡ from {(p.insuredUserId || '').slice(0, 14)}
              </span>
              <span className="font-mono text-[10px] text-zinc-500">
                {p.cause} · {fmtDate(p.firedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
