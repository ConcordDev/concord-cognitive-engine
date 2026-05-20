'use client';

import { useEffect, useMemo, useState } from 'react';
import { PieChart, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface BudgetCategory {
  name: string;
  amountBillions: number;
  pctOfTotal: number;
  yoyChangePct: number;
  color: string;
}

export function BudgetVisualizer() {
  const [scope, setScope] = useState<'federal' | 'state' | 'local'>('federal');
  const [year, setYear] = useState(2026);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const res = await lensRun({ domain: 'government', action: 'budget-breakdown', input: { scope, year } });
        setCategories((res.data?.result?.categories || []) as BudgetCategory[]);
        setTotal(Number(res.data?.result?.totalBillions) || 0);
      } catch (e) { console.error('[Budget] failed', e); }
      finally { setLoading(false); }
    })();
  }, [scope, year]);

  const sortedCats = useMemo(() => [...categories].sort((a, b) => b.amountBillions - a.amountBillions), [categories]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <PieChart className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Budget · where your tax dollars go</span>
        <div className="ml-auto flex items-center gap-1">
          {(['federal', 'state', 'local'] as const).map(s => (
            <button key={s} onClick={() => setScope(s)} className={cn('px-2 py-0.5 text-[10px] uppercase tracking-wider rounded',
              scope === s ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-500 hover:text-white'
            )}>{s}</button>
          ))}
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="px-2 py-0.5 text-[10px] bg-lattice-deep border border-lattice-border rounded text-white">
            {[2026, 2025, 2024, 2023].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </header>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-white/5">
            <div className="text-3xl font-bold text-white tabular-nums">${total.toFixed(0)}B</div>
            <div className="text-xs text-gray-500">FY {year} {scope} budget</div>
          </div>
          <div className="p-4 space-y-2">
            {sortedCats.map((c, i) => (
              <div key={c.name}>
                <div className="flex items-center gap-2 text-xs mb-0.5">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: c.color }} />
                  <span className="text-white">{c.name}</span>
                  <span className="ml-auto tabular-nums text-cyan-300">${c.amountBillions.toFixed(1)}B</span>
                  <span className="tabular-nums text-gray-500 w-12 text-right">{c.pctOfTotal.toFixed(1)}%</span>
                  <span className={cn('tabular-nums w-14 text-right',
                    c.yoyChangePct > 0 ? 'text-green-400' : c.yoyChangePct < 0 ? 'text-red-400' : 'text-gray-500'
                  )}>{c.yoyChangePct > 0 ? '+' : ''}{c.yoyChangePct.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full transition-all" style={{ width: `${c.pctOfTotal}%`, backgroundColor: c.color }} />
                </div>
                {i === 0 && (
                  <div className="text-[9px] text-gray-500 mt-0.5">Largest single budget line</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default BudgetVisualizer;
