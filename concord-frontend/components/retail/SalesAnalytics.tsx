'use client';

import { useEffect, useState } from 'react';
import { BarChart3, Loader2, TrendingUp, DollarSign, Package } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

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
        lensRun({ domain: 'retail', action: 'analytics-summary', input: {} }),
        lensRun({ domain: 'retail', action: 'analytics-revenue-by-day', input: { days: 30 } }),
        lensRun({ domain: 'retail', action: 'analytics-top-products', input: { limit: 10, days: 30 } }),
      ]);
      setSummary(s.data?.result || null);
      setRevSeries((r.data?.result?.series || []) as RevDay[]);
      setTop((t.data?.result?.topProducts || []) as TopProd[]);
    } catch (e) { console.error('[Analytics] refresh failed', e); }
    finally { setLoading(false); }
  }

  const chartData = revSeries.map(d => ({ date: d.date.slice(5), revenue: d.revenue, orders: d.orderCount }));
  const topChartData = top.slice(0, 8).map(p => ({ name: p.name.length > 14 ? p.name.slice(0, 13) + '…' : p.name, revenue: Math.round(p.revenue), qty: p.qty }));

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
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#ffffff10" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#94a3b8' }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ background: '#0d1117', border: '1px solid #ffffff20', fontSize: 11 }}
                    formatter={(v, k) => k === 'revenue' ? [`$${Number(v).toFixed(0)}`, 'Revenue'] : [String(v), 'Orders']}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={1.5} fill="url(#revGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">Top products · last 30 days</div>
            {top.length === 0 ? (
              <div className="py-3 text-center text-xs text-gray-500">No sales yet</div>
            ) : (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topChartData} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                    <CartesianGrid stroke="#ffffff10" strokeDasharray="2 4" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={(v) => `$${v}`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#cbd5e1' }} width={90} />
                    <Tooltip
                      contentStyle={{ background: '#0d1117', border: '1px solid #ffffff20', fontSize: 11 }}
                      formatter={(v, k) => k === 'revenue' ? [`$${Number(v).toFixed(0)}`, 'Revenue'] : [String(v), 'Qty']}
                    />
                    <Bar dataKey="revenue" fill="#10b981" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
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
