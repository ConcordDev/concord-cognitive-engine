'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Workflow, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ChartKit } from '@/components/viz/ChartKit';

interface SankeyNode { id: string; label: string }
interface SankeyLink { source: string; target: string; value: number }
interface SankeyResult {
  nodes: SankeyNode[];
  links: SankeyLink[];
  income: number;
  totalSpend: number;
  netCashFlow: number;
  month: string | null;
}
interface TrendPoint {
  month: string;
  income: number;
  spend: number;
  net: number;
  savingsRate: number;
}
interface TrendResult {
  series: TrendPoint[];
  avgMonthlySpend: number;
  avgMonthlyIncome: number;
  avgNet: number;
}

const FLOW_COLORS = ['#22c55e', '#06b6d4', '#f59e0b', '#ec4899', '#a855f7', '#ef4444', '#6366f1'];

export function CashFlowSankey() {
  const [sankey, setSankey] = useState<SankeyResult | null>(null);
  const [trend, setTrend] = useState<TrendResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState('');

  const refresh = useCallback(async (selectedMonth: string) => {
    setLoading(true);
    try {
      const [sk, tr] = await Promise.all([
        lensRun('finance', 'cashflow-sankey', selectedMonth ? { month: selectedMonth } : {}),
        lensRun('finance', 'monthly-trend', { months: 12 }),
      ]);
      if (sk.data?.ok) setSankey(sk.data.result as SankeyResult);
      if (tr.data?.ok) setTrend(tr.data.result as TrendResult);
    } catch (e) { console.error('[CashFlow] load failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(month); }, [refresh, month]);

  // Category outflows: links whose source is "spending".
  const categoryFlows = useMemo(() => {
    if (!sankey) return [];
    const total = sankey.totalSpend || 1;
    return sankey.links
      .filter((l) => l.source === 'spending')
      .map((l) => {
        const node = sankey.nodes.find((n) => n.id === l.target);
        return { label: node?.label || l.target, value: l.value, pct: (l.value / total) * 100 };
      })
      .sort((a, b) => b.value - a.value);
  }, [sankey]);

  const months = trend?.series.map((s) => s.month) || [];

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Workflow className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          Cash-flow analysis
        </span>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="ml-auto px-2 py-1 text-[10px] bg-lattice-deep border border-lattice-border rounded text-white"
        >
          <option value="">All time</option>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : !sankey || (sankey.income === 0 && sankey.totalSpend === 0) ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400">
          <Workflow className="w-6 h-6 mx-auto mb-2 opacity-30" />
          No cash-flow data yet. Add transactions in the feed to see your money flow.
        </div>
      ) : (
        <>
          {/* Sankey-style flow diagram */}
          <div className="px-4 py-4 border-b border-white/10">
            <div className="grid grid-cols-3 gap-3 items-center">
              {/* Income */}
              <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-emerald-400">Income</div>
                <div className="text-lg font-mono tabular-nums text-emerald-300">
                  ${sankey.income.toLocaleString()}
                </div>
              </div>
              {/* Split */}
              <div className="space-y-2">
                <div className="rounded-md bg-rose-500/10 border border-rose-500/20 p-2 text-center">
                  <div className="text-[9px] uppercase tracking-wider text-rose-400">Spending</div>
                  <div className="text-sm font-mono tabular-nums text-rose-300">
                    ${sankey.totalSpend.toLocaleString()}
                  </div>
                </div>
                <div className={cn(
                  'rounded-md border p-2 text-center',
                  sankey.netCashFlow >= 0 ? 'bg-cyan-500/10 border-cyan-500/20' : 'bg-amber-500/10 border-amber-500/20',
                )}>
                  <div className={cn('text-[9px] uppercase tracking-wider', sankey.netCashFlow >= 0 ? 'text-cyan-400' : 'text-amber-400')}>
                    {sankey.netCashFlow >= 0 ? 'Savings' : 'Deficit'}
                  </div>
                  <div className={cn('text-sm font-mono tabular-nums', sankey.netCashFlow >= 0 ? 'text-cyan-300' : 'text-amber-300')}>
                    ${Math.abs(sankey.netCashFlow).toLocaleString()}
                  </div>
                </div>
              </div>
              {/* Category outflows */}
              <div className="space-y-1">
                {categoryFlows.slice(0, 7).map((c, i) => (
                  <div key={c.label} className="flex items-center gap-1.5 text-[10px]">
                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: FLOW_COLORS[i % FLOW_COLORS.length] }} />
                    <span className="text-gray-400 truncate flex-1">{c.label}</span>
                    <span className="text-white font-mono tabular-nums">${c.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Category proportion bar */}
            {categoryFlows.length > 0 && (
              <div className="flex h-2 rounded-full overflow-hidden mt-3">
                {categoryFlows.map((c, i) => (
                  <div
                    key={c.label}
                    style={{ width: `${c.pct}%`, background: FLOW_COLORS[i % FLOW_COLORS.length] }}
                    title={`${c.label}: ${c.pct.toFixed(0)}%`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Month-over-month trend */}
          {trend && trend.series.length >= 1 && (
            <div className="px-3 py-3">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[10px] uppercase tracking-wider text-gray-400">
                  Month-over-month trend
                </span>
                <span className="text-[10px] text-gray-400">
                  avg net ${trend.avgNet.toLocaleString()}/mo
                </span>
              </div>
              <ChartKit
                kind="bar"
                data={trend.series as unknown as Array<Record<string, unknown>>}
                xKey="month"
                series={[
                  { key: 'income', label: 'Income', color: '#22c55e' },
                  { key: 'spend', label: 'Spend', color: '#ef4444' },
                  { key: 'net', label: 'Net', color: '#06b6d4' },
                ]}
                height={200}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default CashFlowSankey;
