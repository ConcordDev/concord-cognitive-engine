'use client';

/** AcRatiosPanel — key financial ratios computed from the ledger. */

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Ratios {
  currentRatio: number | null; quickRatio: number | null; debtToEquity: number | null;
  grossMarginPct: number | null; netMarginPct: number | null; workingCapital: number;
  totals: { currentAssets: number; totalAssets: number; currentLiabilities: number; totalLiabilities: number; revenue: number; netIncome: number };
  note: string;
}

export function AcRatiosPanel() {
  const [r, setR] = useState<Ratios | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await lensRun({ domain: 'accounting', action: 'financial-ratios', input: {} });
    setR(res.data?.result || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading || !r) return <div className="flex items-center justify-center py-10 text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  const fmt = (v: number | null) => (v == null ? '—' : v.toString());
  const fmtPct = (v: number | null) => (v == null ? '—' : `${v}%`);

  return (
    <div className="space-y-4 p-1">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Card label="Current ratio" value={fmt(r.currentRatio)} hint="current assets ÷ current liabilities" />
        <Card label="Quick ratio" value={fmt(r.quickRatio)} hint="(current assets − inventory) ÷ current liab." />
        <Card label="Debt to equity" value={fmt(r.debtToEquity)} hint="total liabilities ÷ equity" />
        <Card label="Gross margin" value={fmtPct(r.grossMarginPct)} hint="(revenue − COGS) ÷ revenue" />
        <Card label="Net margin" value={fmtPct(r.netMarginPct)} hint="net income ÷ revenue" />
        <Card label="Working capital" value={`$${r.workingCapital.toLocaleString()}`} hint="current assets − current liab." />
      </div>

      <div className="bg-black/30 border border-white/10 rounded-lg p-3">
        <h3 className="text-xs font-semibold text-gray-300 mb-2">Underlying totals</h3>
        <ul className="grid grid-cols-2 gap-1 text-[11px] text-gray-400">
          <li>Current assets: <span className="text-gray-200">${r.totals.currentAssets.toLocaleString()}</span></li>
          <li>Total assets: <span className="text-gray-200">${r.totals.totalAssets.toLocaleString()}</span></li>
          <li>Current liabilities: <span className="text-gray-200">${r.totals.currentLiabilities.toLocaleString()}</span></li>
          <li>Total liabilities: <span className="text-gray-200">${r.totals.totalLiabilities.toLocaleString()}</span></li>
          <li>Revenue: <span className="text-gray-200">${r.totals.revenue.toLocaleString()}</span></li>
          <li>Net income: <span className="text-gray-200">${r.totals.netIncome.toLocaleString()}</span></li>
        </ul>
        <p className="text-[10px] text-gray-600 mt-2">{r.note}</p>
      </div>
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-black/30 border border-white/10 rounded-lg p-3">
      <p className="text-xl font-bold text-emerald-300">{value}</p>
      <p className="text-[11px] text-gray-300">{label}</p>
      <p className="text-[9px] text-gray-600 mt-0.5">{hint}</p>
    </div>
  );
}
