'use client';

/**
 * ProfitabilityReport — per-engagement cost-vs-billed margin report.
 * Wires consulting.profitability-report.
 */

import { useCallback, useEffect, useState } from 'react';
import { TrendingUp, Loader2, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

interface Row {
  engagementId: string; name: string; client: string; hours: number; billed: number;
  laborCost: number; expenses: number; totalCost: number; margin: number; marginPct: number; health: string;
}
interface Report {
  rows: Row[]; totalBilled: number; totalCost: number; totalMargin: number; overallMarginPct: number;
}

const HEALTH_COLOR: Record<string, string> = {
  healthy: 'text-emerald-400 bg-emerald-500/10',
  thin: 'text-amber-400 bg-amber-500/10',
  'loss-making': 'text-rose-400 bg-rose-500/10',
};

export function ProfitabilityReport() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('consulting', 'profitability-report', {});
    setReport((r.data?.result as Report) || null);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) return <div className="flex justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  const rows = report?.rows || [];
  const chartData = rows.map(r => ({ name: r.name, billed: r.billed, cost: r.totalCost }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-bold text-zinc-100">Profitability</h3>
        </div>
        <button onClick={refresh} aria-label="Refresh" className="text-zinc-400 hover:text-indigo-400"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>

      {report && (
        <div className="grid grid-cols-4 gap-2">
          {([
            ['Billed', `$${report.totalBilled.toLocaleString()}`, 'text-zinc-100'],
            ['Cost', `$${report.totalCost.toLocaleString()}`, 'text-amber-400'],
            ['Margin', `$${report.totalMargin.toLocaleString()}`, report.totalMargin >= 0 ? 'text-emerald-400' : 'text-rose-400'],
            ['Margin %', `${report.overallMarginPct}%`, report.overallMarginPct >= 0 ? 'text-emerald-400' : 'text-rose-400'],
          ] as const).map(([l, v, c]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className={`text-sm font-bold ${c}`}>{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      {chartData.length > 0 && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
          <p className="text-[10px] text-zinc-400 uppercase mb-2">Billed vs Cost</p>
          <ChartKit kind="bar" data={chartData} xKey="name" height={160}
            series={[{ key: 'billed', label: 'Billed', color: '#22c55e' }, { key: 'cost', label: 'Cost', color: '#f59e0b' }]} />
        </div>
      )}

      <ul className="space-y-1.5">
        {rows.length === 0 && <li className="text-xs text-zinc-400 italic py-3 text-center">No engagement data yet — log time and expenses first.</li>}
        {rows.map(r => (
          <li key={r.engagementId} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">{r.name} · <span className="text-zinc-400">{r.client}</span></p>
                <p className="text-[10px] text-zinc-400">{r.hours}h · billed ${r.billed.toLocaleString()} · labor ${r.laborCost.toLocaleString()} · expenses ${r.expenses.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold ${r.margin >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>${r.margin.toLocaleString()}</p>
                <p className="text-[10px] text-zinc-400">{r.marginPct}% margin</p>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${HEALTH_COLOR[r.health] || 'text-zinc-400 bg-zinc-800'}`}>{r.health}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
