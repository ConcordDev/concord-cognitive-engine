'use client';

import { useEffect, useState } from 'react';
import { Eye, Package, DollarSign, Tag, TrendingUp, Loader2, Megaphone } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { ShopNav } from './ShopfrontShell';

interface Summary {
  days: number;
  visits: number;
  views: number;
  orderCount: number;
  revenueUsd: number;
  avgOrderValueUsd: number;
  conversionRatePct: number;
  series: Array<{ date: string; orders: number; revenue: number }>;
}
interface Dashboard {
  listingCount: number; publishedCount: number; draftCount: number;
  orderCount: number; pendingOrders: number; shippedOrders: number;
  lifetimeRevenueUsd: number; activePromos: number;
}

export function ShopDashboard({ onJumpTo }: { onJumpTo: (n: ShopNav) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [days]);

  async function refresh() {
    setLoading(true);
    try {
      const [s, d] = await Promise.all([
        lensRun({ domain: 'marketplace', action: 'analytics-summary', input: { days } }),
        lensRun({ domain: 'marketplace', action: 'dashboard-summary', input: {} }),
      ]);
      setSummary((s.data?.result as Summary) || null);
      setDash((d.data?.result as Dashboard) || null);
    } catch (e) { console.error('[Dashboard] failed', e); }
    finally { setLoading(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-12 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading dashboard…</div>;
  if (!summary || !dash) return <div className="p-10 text-center text-xs text-gray-400">No dashboard data yet.</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-gray-200">Shop overview</h2>
        <select value={days} onChange={e => setDays(Number(e.target.value))} className="ml-auto text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {/* The four classic Etsy KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Visits" value={String(summary.visits)} icon={Eye} onClick={() => onJumpTo('stats')} />
        <Tile label="Views" value={String(summary.views)} icon={Eye} tone="cyan" onClick={() => onJumpTo('stats')} />
        <Tile label="Orders" value={String(summary.orderCount)} sub={`${summary.conversionRatePct}% CVR`} icon={Package} tone="amber" onClick={() => onJumpTo('orders')} />
        <Tile label="Revenue" value={`$${summary.revenueUsd.toLocaleString()}`} sub={`$${summary.avgOrderValueUsd} AOV`} icon={DollarSign} tone="emerald" bold onClick={() => onJumpTo('stats')} />
      </div>

      {summary.series.length > 0 && (
        <div className="rounded border border-white/10 bg-black/30 p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Revenue · last {days} days</div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={summary.series} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="shopRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#ffffff10" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#94a3b8' }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={(v) => `$${v}`} />
                <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #ffffff20', fontSize: 11 }} formatter={(v) => `$${Number(v).toFixed(0)}`} />
                <Area type="monotone" dataKey="revenue" stroke="#f97316" strokeWidth={1.5} fill="url(#shopRev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label="Listings" value={String(dash.listingCount)} sub={`${dash.publishedCount} live · ${dash.draftCount} drafts`} icon={Tag} onClick={() => onJumpTo('listings')} />
        <Card label="Pending orders" value={String(dash.pendingOrders)} sub={`${dash.shippedOrders} shipped`} icon={Package} onClick={() => onJumpTo('orders')} />
        <Card label="Lifetime revenue" value={`$${dash.lifetimeRevenueUsd.toLocaleString()}`} icon={TrendingUp} />
        <Card label="Active promos" value={String(dash.activePromos)} icon={Megaphone} onClick={() => onJumpTo('marketing')} />
      </div>
    </div>
  );
}

function Tile({ label, value, sub, icon: Icon, tone = 'neutral', bold, onClick }: { label: string; value: string; sub?: string; icon: typeof Eye; tone?: 'positive' | 'negative' | 'amber' | 'cyan' | 'emerald' | 'neutral'; bold?: boolean; onClick?: () => void }) {
  const colour = tone === 'emerald' ? 'text-emerald-300' : tone === 'amber' ? 'text-amber-300' : tone === 'cyan' ? 'text-cyan-300' : tone === 'negative' ? 'text-rose-300' : 'text-white';
  return (
    <button onClick={onClick} className={cn('p-3 rounded-lg border bg-black/30 text-left hover:bg-white/[0.04]', bold ? 'border-orange-500/30' : 'border-white/10')}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3 h-3 text-gray-400" />
        <span className="text-[10px] uppercase tracking-wider text-gray-400">{label}</span>
      </div>
      <div className={cn('text-2xl font-mono tabular-nums', colour, bold && 'font-bold')}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </button>
  );
}

function Card({ label, value, sub, icon: Icon, onClick }: { label: string; value: string; sub?: string; icon: typeof Eye; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="p-2.5 rounded border border-white/10 bg-black/30 text-left hover:bg-white/[0.04] flex items-center gap-2.5">
      <Icon className="w-4 h-4 text-orange-400 flex-shrink-0" />
      <div className="flex-1">
        <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
        <div className="text-base font-mono tabular-nums text-white">{value}</div>
        {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
      </div>
    </button>
  );
}

export default ShopDashboard;
