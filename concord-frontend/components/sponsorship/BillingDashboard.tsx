'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

interface UpcomingCharge { creatorName: string; amountCc: number; dueAt: number; tier: string; }
interface PaymentRow { id: string; creatorName: string; amountCc: number; kind: string; at: number; note: string; }
interface Billing {
  monthlyCommitted: number;
  totalContributed: number;
  activeCount: number;
  pausedCount: number;
  upcomingCharges: UpcomingCharge[];
  paymentHistory: PaymentRow[];
  trend: Array<{ monthsAgo: number; totalCc: number }>;
}

export function BillingDashboard({ refreshKey }: { refreshKey: number }) {
  const [b, setB] = useState<Billing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun('sponsorship', 'billing', {});
    setLoading(false);
    if (r.data?.ok && r.data.result) setB(r.data.result as Billing);
    else setError(r.data?.error || 'Could not load billing.');
  };

  useEffect(() => { void load(); }, [refreshKey]);

  if (loading && !b) {
    return <div role="status" aria-live="polite" className="text-center text-zinc-400 italic py-6 border border-zinc-800 rounded-xl">Loading billing…</div>;
  }
  if (error && !b) {
    return (
      <div role="alert" className="text-center py-6 border border-rose-800/60 bg-rose-950/30 rounded-xl">
        <p className="text-rose-300 text-sm">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 bg-rose-800 hover:bg-rose-700 text-white text-xs px-4 py-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
        >Retry</button>
      </div>
    );
  }
  if (!b) {
    return <div className="text-center text-zinc-400 italic py-6 border border-zinc-800 rounded-xl">No billing data yet.</div>;
  }

  const chartData = b.trend.map((t) => ({
    label: t.monthsAgo === 0 ? 'now' : `-${t.monthsAgo}mo`,
    cc: t.totalCc,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Monthly committed" value={`${b.monthlyCommitted} CC`} />
        <Stat label="Total contributed" value={`${b.totalContributed} CC`} />
        <Stat label="Active" value={String(b.activeCount)} />
        <Stat label="Paused" value={String(b.pausedCount)} />
      </div>

      <section>
        <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">Contribution trend (6 months)</h3>
        <ChartKit
          kind="bar"
          data={chartData}
          xKey="label"
          series={[{ key: 'cc', label: 'CC charged', color: '#f59e0b' }]}
          height={180}
        />
      </section>

      <section>
        <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">Upcoming charges</h3>
        {b.upcomingCharges.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No upcoming charges.</p>
        ) : (
          <ul className="space-y-1">
            {b.upcomingCharges.map((c, i) => (
              <li key={`${c.creatorName}-${i}`} className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm flex justify-between">
                <span className="text-zinc-200">{c.creatorName} <span className="text-zinc-400 text-[11px]">· {c.tier}</span></span>
                <span className="font-mono text-amber-300 text-xs">{c.amountCc} CC · {new Date(c.dueAt * 1000).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">Payment history</h3>
        {b.paymentHistory.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No payments yet.</p>
        ) : (
          <ul className="space-y-1">
            {b.paymentHistory.map((p) => (
              <li key={p.id} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-[12px] flex justify-between">
                <span className="text-zinc-300">
                  {p.creatorName} <span className="text-zinc-600">· {p.note}</span>
                </span>
                <span className="font-mono text-zinc-400">
                  {p.kind === 'charge' ? `${p.amountCc} CC` : p.kind} · {new Date(p.at * 1000).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-0.5 font-mono text-lg text-amber-300">{value}</div>
    </div>
  );
}
