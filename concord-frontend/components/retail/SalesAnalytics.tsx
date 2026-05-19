'use client';

import { useEffect, useState } from 'react';
import { BarChart3, Loader2, TrendingUp, DollarSign, Package, Users } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface RevDay { date: string; revenue: number; orderCount: number }
interface TopProd { sku: string; name: string; qty: number; revenue: number }
interface Summary {
  totalRevenue: number; totalOrders: number; ordersToday: number;
  revenueToday: number; revenue7d: number; revenue30d: number;
  avgOrderValue: number; productCount: number; customerCount: number; activeCarts: number;
}

export function SalesAnalytics() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [revSeries, setRevSeries] = useState<RevDay[]>([]);
  const [top, setTop] = useState<TopProd[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [s, r, t] = await Promise.all([
        api.post('/api/lens/run', { domain: 'retail', action: 'analytics-summary', input: {} }),
        api.post('/api/lens/run', { domain: 'retail', action: 'analytics-revenue-by-day', input: { days: 30 } }),
        api.post('/api/lens/run', { domain: 'retail', action: 'analytics-top-products', input: { limit: 10, days: 30 } }),
      ]);
      setSummary(s.data?.result || null);
      setRevSeries((r.data?.result?.series || []) as RevDay[]);
      setTop((t.data?.result?.topProducts || []) as TopProd[]);
    } catch (e) { console.error('[Analytics] refresh failed', e); }
    finally { setLoading(false); }
  }

  const maxRev = Math.max(1, ...revSeries.map(d => d.revenue));

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Sales analytics</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : !summary ? (
        <div className="p-10 text-center text-xs text-gray-500">No data yet</div>
      ) : (
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <Tile icon={DollarSign} label="Today" value={`$${summary.revenueToday.toFixed(0)}`} sub={`${summary.ordersToday} orders`} />
            <Tile icon={TrendingUp} label="7-day" value={`$${summary.revenue7d.toFixed(0)}`} sub="revenue" />
            <Tile icon={DollarSign} label="AOV" value={`$${summary.avgOrderValue.toFixed(0)}`} sub="avg order" />
            <Tile icon={Package} label="Products" value={String(summary.productCount)} sub={`${summary.customerCount} customers`} />
          </div>

          <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">Revenue · last 30 days</div>
            <div className="flex items-end gap-px h-24">
              {revSeries.map((d, i) => (
                <div key={d.date} className="flex-1" title={`${d.date}: $${d.revenue.toFixed(0)} (${d.orderCount} orders)`}>
                  <div
                    className={cn('w-full transition', d.revenue > 0 ? 'bg-emerald-400/70 hover:bg-emerald-500' : 'bg-white/5')}
                    style={{ height: `${(d.revenue / maxRev) * 100}%`, minHeight: 1 }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-gray-500">
              <span>{revSeries[0]?.date.slice(5)}</span>
              <span>{revSeries[revSeries.length - 1]?.date.slice(5)}</span>
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">Top products · last 30 days</div>
            {top.length === 0 ? (
              <div className="py-3 text-center text-xs text-gray-500">No sales yet</div>
            ) : (
              <ul className="space-y-1">
                {top.map((p, i) => (
                  <li key={p.sku} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-500 font-mono w-5 text-right">{i + 1}.</span>
                    <span className="text-white truncate flex-1">{p.name}</span>
                    <span className="text-gray-400 font-mono">{p.qty}×</span>
                    <span className="text-emerald-300 font-mono tabular-nums w-20 text-right">${p.revenue.toFixed(0)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub }: { icon: typeof DollarSign; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-2.5">
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className="w-3 h-3 text-emerald-300" />
        <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <div className="text-base font-mono tabular-nums text-white">{value}</div>
      <div className="text-[10px] text-gray-500">{sub}</div>
    </div>
  );
}

export default SalesAnalytics;
