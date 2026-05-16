'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Loader2, TrendingUp, Users2, FileText, Coins } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Growth { period?: string; series?: { ts: string; users?: number; dtus?: number; activeUsers?: number; revenue?: number }[]; totals?: { users?: number; dtus?: number; activeUsers?: number; revenueUsd?: number }; [k: string]: unknown }
interface Marketplace { totalListings?: number; sold24h?: number; gmv24hUsd?: number; topSellers?: { creator: string; sales: number }[]; [k: string]: unknown }

const PERIODS = ['24h', '7d', '30d', '90d'] as const;

export function PlatformGrowth() {
  const [period, setPeriod] = useState<typeof PERIODS[number]>('30d');
  const hostRef = useRef<HTMLDivElement | null>(null);

  const growth = useQuery({
    queryKey: ['analytics-growth', period],
    queryFn: async () => (await apiHelpers.analytics.growth(period)).data as Growth,
  });
  const marketplace = useQuery({
    queryKey: ['analytics-marketplace'],
    queryFn: async () => (await apiHelpers.analytics.marketplace()).data as Marketplace,
  });

  useEffect(() => {
    let chart: { remove: () => void } | null = null;
    let cancelled = false;
    const series = growth.data?.series;
    if (!series || !hostRef.current || series.length === 0) return;
    (async () => {
      const lib = await import('lightweight-charts');
      if (cancelled || !hostRef.current) return;
      hostRef.current.innerHTML = '';
      const c = lib.createChart(hostRef.current, {
        height: 220, layout: { background: { color: '#09090b' } as never, textColor: '#a1a1aa' },
        grid: { vertLines: { color: '#1f1f23' }, horzLines: { color: '#1f1f23' } },
        rightPriceScale: { borderColor: '#27272a' }, timeScale: { borderColor: '#27272a' },
      });
      const s1 = (c as unknown as { addLineSeries: (o?: unknown) => { setData: (d: unknown[]) => void } }).addLineSeries({ color: '#22d3ee', lineWidth: 2 });
      const s2 = (c as unknown as { addLineSeries: (o?: unknown) => { setData: (d: unknown[]) => void } }).addLineSeries({ color: '#f97316', lineWidth: 2 });
      const sorted = [...series].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
      s1.setData(sorted.map((p) => ({ time: p.ts.slice(0, 10), value: p.users ?? p.activeUsers ?? 0 })));
      s2.setData(sorted.map((p) => ({ time: p.ts.slice(0, 10), value: p.dtus ?? 0 })));
      chart = c as unknown as { remove: () => void };
    })();
    return () => { cancelled = true; chart?.remove(); };
  }, [growth.data]);

  const g = growth.data || {};
  const m = marketplace.data || {};

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Platform growth</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/analytics/growth + marketplace</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-[10px]">
            {PERIODS.map((p) => (
              <button key={p} onClick={() => setPeriod(p)} className={`rounded px-2 py-0.5 font-mono uppercase ${period === p ? 'bg-cyan-500/20 text-cyan-200' : 'text-zinc-500 hover:text-zinc-300'}`}>{p}</button>
            ))}
          </div>
          {(growth.data || marketplace.data) && (
            <SaveAsDtuButton
              compact
              apiSource="concord-analytics"
              title={`Platform growth ${period} — ${new Date().toISOString().slice(0, 10)}`}
              content={`Period: ${period}\n\nTotals:\n  Users: ${g.totals?.users ?? '—'}\n  Active: ${g.totals?.activeUsers ?? '—'}\n  DTUs: ${g.totals?.dtus ?? '—'}\n  Revenue USD: ${g.totals?.revenueUsd ?? '—'}\n\nMarketplace:\n  Listings: ${m.totalListings ?? '—'}\n  24h sold: ${m.sold24h ?? '—'}\n  24h GMV USD: ${m.gmv24hUsd ?? '—'}`}
              extraTags={['analytics', 'growth', period]}
              rawData={{ growth: g, marketplace: m }}
            />
          )}
        </div>
      </header>
      {(growth.isError || marketplace.isError) && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Analytics unreachable.</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="Users" value={g.totals?.users?.toLocaleString() || '—'} icon={Users2} />
        <Cell label="Active" value={g.totals?.activeUsers?.toLocaleString() || '—'} icon={TrendingUp} />
        <Cell label="DTUs" value={g.totals?.dtus?.toLocaleString() || '—'} icon={FileText} />
        <Cell label="Revenue" value={g.totals?.revenueUsd != null ? `$${g.totals.revenueUsd.toLocaleString()}` : '—'} icon={Coins} />
      </div>
      <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-200">Time series <span className="text-[10px] text-cyan-300">users</span> + <span className="text-[10px] text-orange-300">dtus</span></div>
        {growth.isPending ? (
          <div className="flex items-center gap-2 py-6 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Pulling growth series…</div>
        ) : (
          <div ref={hostRef} className="w-full" />
        )}
      </div>
      {m.topSellers && m.topSellers.length > 0 && (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 text-xs font-semibold text-zinc-200">Top sellers (marketplace, 24h)</div>
          <div className="space-y-1">
            {m.topSellers.slice(0, 8).map((s, i) => (
              <div key={s.creator + i} className="flex justify-between text-[11px]">
                <span className="text-zinc-300">#{i + 1} {s.creator}</span>
                <span className="font-mono text-cyan-300">{s.sales} sales</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">{Icon && <Icon className="h-3 w-3" />}{label}</div>
      <div className="mt-0.5 font-mono text-lg text-cyan-300">{value}</div>
    </div>
  );
}
