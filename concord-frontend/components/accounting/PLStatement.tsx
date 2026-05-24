'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, PieChart as PieIcon } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Line { id: string; code: string; name: string; amount: number }
interface PL {
  period: { start: string; end: string };
  revenue: { lines: Line[]; total: number };
  cogs: { lines: Line[]; total: number };
  grossProfit: number; grossMarginPct: number;
  operatingExpenses: { lines: Line[]; total: number };
  netIncome: number; netMarginPct: number;
}

const today = () => new Date().toISOString().slice(0, 10);

export function PLStatement() {
  const [pl, setPL] = useState<PL | null>(null);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(today().slice(0, 4) + '-01-01');
  const [end, setEnd] = useState(today());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'accounting', action: 'pl-compute', input: { start, end } });
      setPL((r.data?.result as PL) || null);
    } catch (e) { console.error('[PL] failed', e); }
    finally { setLoading(false); }
  }, [start, end]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="bg-[#0d1117] border border-emerald-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <PieIcon className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-gray-200">Profit & Loss</span>
        <div className="ml-auto flex items-center gap-2">
          <input type="date" value={start} onChange={e => setStart(e.target.value)} className="text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <span className="text-[10px] text-gray-400">to</span>
          <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : !pl ? (
        <div className="p-10 text-center text-xs text-gray-400">No data.</div>
      ) : (
        <div className="p-4">
          <Section label="Revenue" lines={pl.revenue.lines} total={pl.revenue.total} tone="positive" />
          <Section label="Cost of goods sold" lines={pl.cogs.lines} total={pl.cogs.total} tone="negative" />
          <Subtotal label="Gross profit" value={pl.grossProfit} pct={pl.grossMarginPct} />
          <Section label="Operating expenses" lines={pl.operatingExpenses.lines} total={pl.operatingExpenses.total} tone="negative" />
          <Subtotal label="Net income" value={pl.netIncome} pct={pl.netMarginPct} bold />
        </div>
      )}
    </div>
  );
}

function Section({ label, lines, total, tone }: { label: string; lines: Line[]; total: number; tone: 'positive' | 'negative' }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-1">{label}</div>
      <ul className="space-y-0.5 mb-1">
        {lines.map(l => (
          <li key={l.id} className="flex items-center justify-between text-xs">
            <span className="text-gray-300"><span className="text-[10px] text-gray-400 font-mono mr-1.5">{l.code}</span>{l.name}</span>
            <span className="font-mono tabular-nums text-white">${l.amount.toFixed(2)}</span>
          </li>
        ))}
        {lines.length === 0 && <li className="text-[11px] text-gray-400 italic">No entries</li>}
      </ul>
      <div className={cn('flex items-center justify-between text-sm pt-1 border-t border-white/10', tone === 'positive' ? 'text-emerald-300' : 'text-rose-300')}>
        <span className="font-semibold">Total {label.toLowerCase()}</span>
        <span className="font-mono tabular-nums">${total.toFixed(2)}</span>
      </div>
    </div>
  );
}

function Subtotal({ label, value, pct, bold }: { label: string; value: number; pct: number; bold?: boolean }) {
  const isPositive = value >= 0;
  return (
    <div className={cn(
      'flex items-center justify-between mt-3 mb-3 px-3 py-2 rounded',
      bold ? 'bg-emerald-500/[0.08] border border-emerald-500/20' : 'bg-white/[0.03]',
    )}>
      <span className={cn(bold ? 'text-base font-semibold text-white' : 'text-sm text-gray-200')}>{label}</span>
      <div className="text-right">
        <div className={cn('font-mono tabular-nums', isPositive ? 'text-emerald-300' : 'text-rose-300', bold ? 'text-base font-bold' : 'text-sm')}>
          ${value.toFixed(2)}
        </div>
        <div className="text-[10px] text-gray-400">{pct.toFixed(1)}% margin</div>
      </div>
    </div>
  );
}

export default PLStatement;
