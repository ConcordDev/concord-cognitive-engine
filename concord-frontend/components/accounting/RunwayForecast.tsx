'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Calendar } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';

interface MonthRow { month: string; projected: number; in: number; out: number }
interface Runway {
  cashOnHand: number; openInvTotal: number; openBillsTotal: number;
  liquidity: number;
  monthlyNet: number; monthlyBurn: number; runwayMonths: number | null;
  forecast: MonthRow[];
}

export function RunwayForecast() {
  const [data, setData] = useState<Runway | null>(null);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(12);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'accounting', action: 'runway-forecast', input: { months } });
      setData((r.data?.result as Runway) || null);
    } catch (e) { console.error('[Runway] failed', e); }
    finally { setLoading(false); }
  }, [months]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="bg-[#0d1117] border border-emerald-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-gray-200">Runway forecast</span>
        <select value={months} onChange={e => setMonths(Number(e.target.value))} className="ml-auto text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value={6}>Next 6 mo</option>
          <option value={12}>Next 12 mo</option>
          <option value={18}>Next 18 mo</option>
          <option value={24}>Next 24 mo</option>
        </select>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : !data ? (
        <div className="p-10 text-center text-xs text-gray-400">No data.</div>
      ) : (
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <Tile label="Cash" value={`$${data.cashOnHand.toLocaleString()}`} />
            <Tile label="+ A/R" value={`$${data.openInvTotal.toLocaleString()}`} />
            <Tile label="− A/P" value={`$${data.openBillsTotal.toLocaleString()}`} />
            <Tile label="Liquidity" value={`$${data.liquidity.toLocaleString()}`} bold />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Tile label="Net monthly" value={`${data.monthlyNet >= 0 ? '+' : ''}$${data.monthlyNet.toLocaleString()}`} tone={data.monthlyNet >= 0 ? 'positive' : 'negative'} />
            <Tile label="Monthly burn" value={`$${data.monthlyBurn.toLocaleString()}`} tone="negative" />
            <Tile label="Runway" value={data.runwayMonths !== null ? `${data.runwayMonths} mo` : 'profitable'} tone={data.runwayMonths === null ? 'positive' : data.runwayMonths < 6 ? 'negative' : 'neutral'} bold />
          </div>
          <div className="h-56 bg-black/30 rounded border border-white/10 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.forecast}>
                <defs>
                  <linearGradient id="runwayPos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="runwayNeg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.05} />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#ffffff10" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: '#0d1117', border: '1px solid #ffffff20', fontSize: 11 }}
                  formatter={(v) => `$${Number(v).toLocaleString()}`}
                />
                <ReferenceLine y={0} stroke="#f43f5e" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="projected" stroke="#10b981" strokeWidth={2} fill="url(#runwayPos)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, tone, bold }: { label: string; value: string; tone?: 'positive' | 'negative' | 'neutral'; bold?: boolean }) {
  const colour = tone === 'positive' ? 'text-emerald-300' : tone === 'negative' ? 'text-rose-300' : 'text-white';
  return (
    <div className={`rounded border border-white/10 bg-black/40 p-2.5 ${bold ? 'ring-1 ring-emerald-500/30' : ''}`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`text-base font-mono tabular-nums ${colour} ${bold ? 'text-lg font-bold' : ''}`}>{value}</div>
    </div>
  );
}

export default RunwayForecast;
