'use client';

/**
 * UsageSpendPanel — per-key token usage + spend tracking.
 *
 * Surfaces byo_keys.usage_summary: per-slot all-time + this-month
 * tokens/cost/calls, an aggregate total, and a daily cost series
 * rendered through ChartKit. All values are computed from real
 * recorded inference calls — empty until usage exists.
 */

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';

interface SlotUsage {
  slot: string;
  allTime: { tokensIn: number; tokensOut: number; costUsd: number; calls: number };
  thisMonth: { costUsd: number; tokens: number; calls: number };
}
interface UsageSummary {
  month: string;
  slots: SlotUsage[];
  totals: { costUsd: number; tokens: number; calls: number };
  dailySeries: { day: string; costUsd: number }[];
}

const fmtUsd = (n: number) => `$${(n || 0).toFixed(n < 1 ? 4 : 2)}`;
const fmtTok = (n: number) => (n || 0).toLocaleString();

export function UsageSpendPanel() {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<UsageSummary>('byo_keys', 'usage_summary', {});
    if (r.data?.ok && r.data.result) setData(r.data.result);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const hasUsage = !!data && data.totals.calls > 0;

  return (
    <section className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-zinc-100">Usage &amp; spend</h2>
        <button
          onClick={refresh}
          className="px-2 py-1 rounded-md text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
        >
          refresh
        </button>
      </div>

      {loading && <div className="text-xs text-zinc-400">Loading usage…</div>}

      {!loading && !hasUsage && (
        <div className="text-xs text-zinc-400 rounded-md border border-dashed border-zinc-800 p-6 text-center">
          No usage recorded yet. Token usage and a list-price cost estimate appear here
          once inference runs through one of your BYO keys.
        </div>
      )}

      {!loading && hasUsage && data && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="rounded-lg bg-zinc-950 ring-1 ring-zinc-800 p-3">
              <div className="text-[10px] uppercase tracking-wide text-zinc-400">Est. spend (all time)</div>
              <div className="text-lg font-semibold text-emerald-400">{fmtUsd(data.totals.costUsd)}</div>
            </div>
            <div className="rounded-lg bg-zinc-950 ring-1 ring-zinc-800 p-3">
              <div className="text-[10px] uppercase tracking-wide text-zinc-400">Tokens</div>
              <div className="text-lg font-semibold text-zinc-200">{fmtTok(data.totals.tokens)}</div>
            </div>
            <div className="rounded-lg bg-zinc-950 ring-1 ring-zinc-800 p-3">
              <div className="text-[10px] uppercase tracking-wide text-zinc-400">Inference calls</div>
              <div className="text-lg font-semibold text-zinc-200">{fmtTok(data.totals.calls)}</div>
            </div>
          </div>

          {data.dailySeries.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">
                Daily cost — {data.month}
              </div>
              <ChartKit
                kind="bar"
                height={160}
                xKey="day"
                series={[{ key: 'costUsd', label: 'cost (USD)', color: '#22c55e' }]}
                showLegend={false}
                data={data.dailySeries.map((d) => ({ day: d.day.slice(5), costUsd: d.costUsd }))}
              />
            </div>
          )}

          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-400 text-left">
                <th className="font-medium py-1">Slot</th>
                <th className="font-medium py-1 text-right">Tokens (in / out)</th>
                <th className="font-medium py-1 text-right">Calls</th>
                <th className="font-medium py-1 text-right">This month</th>
                <th className="font-medium py-1 text-right">All-time est.</th>
              </tr>
            </thead>
            <tbody>
              {data.slots.map((s) => (
                <tr key={s.slot} className="border-t border-zinc-800/60">
                  <td className="py-1.5 font-mono text-zinc-300">{s.slot}</td>
                  <td className="py-1.5 text-right text-zinc-400 font-mono">
                    {fmtTok(s.allTime.tokensIn)} / {fmtTok(s.allTime.tokensOut)}
                  </td>
                  <td className="py-1.5 text-right text-zinc-400">{s.allTime.calls}</td>
                  <td className="py-1.5 text-right text-zinc-300">{fmtUsd(s.thisMonth.costUsd)}</td>
                  <td className="py-1.5 text-right text-emerald-400">{fmtUsd(s.allTime.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-zinc-400">
            Costs are list-price estimates. The authoritative bill is your provider&apos;s dashboard.
          </p>
        </>
      )}
    </section>
  );
}
