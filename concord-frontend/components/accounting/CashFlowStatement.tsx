'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, TrendingUp } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';

interface MonthRow { month: string; in: number; out: number; net: number }
interface CashFlow {
  period: { start: string; end: string };
  series: MonthRow[];
  totalIn: number; totalOut: number; netCashFlow: number;
}

const today = () => new Date().toISOString().slice(0, 10);

export function CashFlowStatement() {
  const [cf, setCF] = useState<CashFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(today().slice(0, 4) + '-01-01');
  const [end, setEnd] = useState(today());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'accounting', action: 'cashflow-compute', input: { start, end } });
      setCF((r.data?.result as CashFlow) || null);
    } catch (e) { console.error('[CashFlow] failed', e); }
    finally { setLoading(false); }
  }, [start, end]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="bg-[#0d1117] border border-emerald-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-gray-200">Cash flow · direct method</span>
        <div className="ml-auto flex items-center gap-2">
          <input type="date" value={start} onChange={e => setStart(e.target.value)} className="text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <span className="text-[10px] text-gray-500">to</span>
          <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : !cf || cf.series.length === 0 ? (
        <div className="p-10 text-center text-xs text-gray-500">No cash activity in this period.</div>
      ) : (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <Tile label="Cash in" value={cf.totalIn} tone="positive" />
            <Tile label="Cash out" value={cf.totalOut} tone="negative" />
            <Tile label="Net cash flow" value={cf.netCashFlow} tone={cf.netCashFlow >= 0 ? 'positive' : 'negative'} bold />
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cf.series}>
                <CartesianGrid stroke="#ffffff10" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: '#0d1117', border: '1px solid #ffffff20', fontSize: 11 }}
                  formatter={(v) => `$${Number(v).toFixed(0)}`}
                />
                <ReferenceLine y={0} stroke="#ffffff20" />
                <Bar dataKey="in" stackId="cash" name="In" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="out" stackId="cash" name="Out" fill="#f43f5e" radius={[0, 0, 3, 3]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, tone, bold }: { label: string; value: number; tone: 'positive' | 'negative'; bold?: boolean }) {
  return (
    <div className={`rounded border border-white/10 bg-black/40 p-3 ${bold ? 'ring-1 ring-emerald-500/30' : ''}`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`text-xl font-mono tabular-nums ${tone === 'positive' ? 'text-emerald-300' : 'text-rose-300'} ${bold ? 'font-bold' : ''}`}>
        ${value.toFixed(0)}
      </div>
    </div>
  );
}

export default CashFlowStatement;
