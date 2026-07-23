'use client';

import { useCallback, useEffect, useState } from 'react';
import { Sparkles, AlertCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { KPIStrip, PeriodSelector, type KPI, type Period } from './KPIStrip';
import { computePeriodRange, deltaPct } from './period-range';

interface DashboardSummary {
  cashOnHand: number; openInvTotal: number; openInvCount: number;
  openBillsTotal: number; openBillsCount: number;
  ytdRevenue: number; ytdExpense: number; ytdNetIncome: number;
  uncategorizedTxns: number; customerCount: number; vendorCount: number;
}

interface PlSlice { revenue: number; expense: number; netIncome: number }

async function fetchPl(start: string, end: string): Promise<PlSlice> {
  const r = await lensRun({ domain: 'accounting', action: 'pl-compute', input: { start, end } }).catch(() => null);
  const result = r?.data?.result;
  return {
    revenue: Number(result?.revenue?.total) || 0,
    expense: Number(result?.operatingExpenses?.total) || 0,
    netIncome: Number(result?.netIncome) || 0,
  };
}

export function AccountingDashboard({ onJumpTo }: { onJumpTo?: (nav: string) => void }) {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('mtd');
  const [current, setCurrent] = useState<PlSlice | null>(null);
  const [prior, setPrior] = useState<PlSlice | null>(null);
  const [plLoading, setPlLoading] = useState(true);

  useEffect(() => { refresh(); }, []);

  // Real period-over-period comparison — two genuine `pl-compute` calls
  // (current window + the immediately-prior comparable window), never a
  // fabricated trend. Re-fires on every PeriodSelector click (§2 micro-
  // interaction: a real macro call driven by real user input).
  const loadPl = useCallback(async (p: Period) => {
    setPlLoading(true);
    const range = computePeriodRange(p);
    try {
      const [cur, prev] = await Promise.all([
        fetchPl(range.start, range.end),
        fetchPl(range.priorStart, range.priorEnd),
      ]);
      setCurrent(cur);
      setPrior(prev);
    } finally {
      setPlLoading(false);
    }
  }, []);

  useEffect(() => { loadPl(period); }, [period, loadPl]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'accounting', action: 'dashboard-summary', input: {} });
      setData((r.data?.result as DashboardSummary) || null);
    } catch (e) { console.error('[Dashboard] failed', e); }
    finally { setLoading(false); }
  }

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-md border border-white/10 bg-black/40 p-3">
              <Skeleton variant="line" width="60%" height="0.625rem" />
              <Skeleton variant="line" className="mt-2" width="80%" height="1.25rem" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton variant="block" height="3.5rem" />
          <Skeleton variant="block" height="3.5rem" />
        </div>
      </div>
    );
  }
  if (!data) {
    return <div className="p-10 text-center text-xs text-gray-400">No dashboard data yet.</div>;
  }

  const range = computePeriodRange(period);
  const revDelta = current && prior ? deltaPct(current.revenue, prior.revenue) : undefined;
  const expDelta = current && prior ? deltaPct(current.expense, prior.expense) : undefined;
  const netDelta = current && prior ? deltaPct(current.netIncome, prior.netIncome) : undefined;

  const kpis: KPI[] = [
    {
      id: 'cash', label: 'Cash on hand', value: data.cashOnHand, unit: '$',
      caption: 'live balance', onClick: () => onJumpTo?.('coa'),
    },
    {
      id: 'rev', label: 'Revenue', value: plLoading ? '—' : (current?.revenue ?? 0), unit: plLoading ? undefined : '$',
      deltaPct: plLoading ? undefined : revDelta, caption: plLoading ? undefined : range.priorLabel,
      onClick: () => onJumpTo?.('pl'),
    },
    {
      id: 'exp', label: 'Expenses', value: plLoading ? '—' : (current?.expense ?? 0), unit: plLoading ? undefined : '$',
      // Expense deltas invert tone — a rising expense is bad, not good.
      deltaPct: plLoading ? undefined : expDelta,
      tone: plLoading || expDelta === undefined ? undefined : (expDelta > 0 ? 'negative' : expDelta < 0 ? 'positive' : 'neutral'),
      caption: plLoading ? undefined : range.priorLabel,
      onClick: () => onJumpTo?.('pl'),
    },
    {
      id: 'net', label: 'Net income', value: plLoading ? '—' : (current?.netIncome ?? 0), unit: plLoading ? undefined : '$',
      deltaPct: plLoading ? undefined : netDelta, caption: plLoading ? undefined : range.priorLabel,
      onClick: () => onJumpTo?.('pl'),
    },
    {
      id: 'inv', label: 'Open invoices', value: data.openInvTotal, unit: '$',
      caption: `${data.openInvCount} unpaid`, onClick: () => onJumpTo?.('invoices'),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <div className={cn('transition-opacity', plLoading && 'opacity-70')} aria-busy={plLoading}>
        <KPIStrip kpis={kpis} periodLabel={range.label} />
      </div>

      {data.uncategorizedTxns > 0 && (
        <button
          onClick={() => onJumpTo?.('banking')}
          className="w-full p-3 rounded-lg bg-emerald-500/[0.07] border border-emerald-500/30 flex items-center gap-3 hover:bg-emerald-500/[0.12] text-left"
        >
          <Sparkles className="w-5 h-5 text-emerald-400" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-emerald-200">{data.uncategorizedTxns} bank txns waiting</div>
            <div className="text-[11px] text-emerald-300/70">Use AI bulk-categorize to clear them in one click</div>
          </div>
          <span className="text-[10px] text-emerald-300">→</span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onJumpTo?.('bills')}
          className="p-3 rounded border border-white/10 bg-black/30 hover:bg-white/[0.04] text-left flex items-center gap-3"
        >
          <div className="text-2xl font-mono tabular-nums text-rose-300">${data.openBillsTotal.toLocaleString()}</div>
          <div>
            <div className="text-xs text-white">Open bills</div>
            <div className="text-[10px] text-gray-400">{data.openBillsCount} unpaid</div>
          </div>
        </button>
        <button
          onClick={() => onJumpTo?.('customers')}
          className="p-3 rounded border border-white/10 bg-black/30 hover:bg-white/[0.04] text-left flex items-center gap-3"
        >
          <div className="text-2xl font-mono tabular-nums text-emerald-300">{data.customerCount}</div>
          <div>
            <div className="text-xs text-white">Customers</div>
            <div className="text-[10px] text-gray-400">{data.vendorCount} vendors</div>
          </div>
        </button>
      </div>

      {!plLoading && current && current.netIncome < 0 && (
        <div className="p-3 rounded border border-amber-500/30 bg-amber-500/[0.04] flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-amber-400" />
          <div className="flex-1 text-xs text-amber-100">
            Net loss for {range.label.toLowerCase()}. <button onClick={() => onJumpTo?.('runway')} className="underline text-amber-300 hover:text-amber-200">Check runway →</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AccountingDashboard;
