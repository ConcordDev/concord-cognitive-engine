'use client';

import { useEffect, useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { cn } from '@/lib/utils';

interface ListingRow { listingId: string; title: string; status: string; views: number; orders: number; revenueUsd: number; conversionRatePct: number }
interface VisibilityRow {
  listingId: string; title: string;
  totalImpressions: number; totalClicks: number; overallCtrPct: number;
  keywords: Array<{ keyword: string; impressions: number; clicks: number; ctrPct: number }>;
}

export function StatsPanel() {
  const [data, setData] = useState<ListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [days]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'marketplace', action: 'analytics-by-listing', input: { days } });
      setData((r.data?.result?.listings || []) as ListingRow[]);
    } catch (e) { console.error('[Stats] failed', e); }
    finally { setLoading(false); }
  }

  const chartData = data.filter(d => d.revenueUsd > 0).slice(0, 8).map(d => ({ name: d.title.length > 16 ? d.title.slice(0, 15) + '…' : d.title, revenue: d.revenueUsd, orders: d.orders }));

  return (
    <div className="bg-[#0d1117] border border-orange-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-orange-400" />
        <span className="text-sm font-semibold text-gray-200">Per-listing stats</span>
        <select value={days} onChange={e => setDays(Number(e.target.value))} className="ml-auto text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </header>
      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : data.length === 0 ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400">No data yet. Add listings + traffic to see stats.</div>
      ) : (
        <div className="p-4 space-y-3">
          {chartData.length > 0 && (
            <div className="rounded border border-white/10 bg-black/30 p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Top revenue by listing</div>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                    <CartesianGrid stroke="#ffffff10" strokeDasharray="2 4" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={(v) => `$${v}`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#cbd5e1' }} width={100} />
                    <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #ffffff20', fontSize: 11 }} formatter={(v, k) => k === 'revenue' ? [`$${Number(v).toFixed(0)}`, 'Revenue'] : [String(v), 'Orders']} />
                    <Bar dataKey="revenue" fill="#f97316" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-gray-400 border-b border-white/5">
              <tr><th className="text-left py-1.5">Listing</th><th className="text-right">Views</th><th className="text-right">Orders</th><th className="text-right">CVR</th><th className="text-right">Revenue</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.map(r => (
                <tr key={r.listingId} className="hover:bg-white/[0.03]">
                  <td className="py-1.5 text-white truncate max-w-[200px]">{r.title}</td>
                  <td className="text-right font-mono text-gray-300">{r.views}</td>
                  <td className="text-right font-mono text-gray-300">{r.orders}</td>
                  <td className={cn('text-right font-mono', r.conversionRatePct > 2 ? 'text-emerald-300' : 'text-gray-400')}>{r.conversionRatePct}%</td>
                  <td className="text-right font-mono text-orange-300">${r.revenueUsd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SearchVisibilityPanel() {
  const [data, setData] = useState<VisibilityRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    lensRun({ domain: 'marketplace', action: 'search-visibility', input: {} })
      .then(r => setData((r.data?.result?.listings || []) as VisibilityRow[]))
      .catch(e => console.error('[Visibility] failed', e))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-[#0d1117] border border-orange-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-orange-400" />
        <span className="text-sm font-semibold text-gray-200">Search visibility</span>
        <span className="text-[10px] text-gray-400">{data.length} listings tracked</span>
      </header>
      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : data.length === 0 ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400">
          No impression data yet. Call <span className="font-mono text-orange-300">marketplace.search-impression</span> with a listingId + keyword when listings appear in search results.
        </div>
      ) : (
        <ul className="divide-y divide-white/5">
          {data.map(l => (
            <li key={l.listingId} className="px-4 py-2.5">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{l.title}</div>
                  <div className="text-[10px] text-gray-400">{l.totalImpressions.toLocaleString()} impressions · {l.totalClicks.toLocaleString()} clicks · {l.overallCtrPct}% CTR</div>
                </div>
              </div>
              {l.keywords.length > 0 && (
                <div className="mt-2 ml-3 grid grid-cols-1 lg:grid-cols-2 gap-1">
                  {l.keywords.slice(0, 6).map(k => (
                    <div key={k.keyword} className="flex items-center gap-2 text-[11px] text-gray-300">
                      <span className="font-mono text-orange-300 w-24 truncate" title={k.keyword}>{k.keyword}</span>
                      <span className="text-gray-400">{k.impressions} imp</span>
                      <span className="text-gray-400">{k.clicks} clk</span>
                      <span className={cn('font-mono ml-auto', k.ctrPct > 5 ? 'text-emerald-300' : 'text-gray-400')}>{k.ctrPct}%</span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
