'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Form1099Row {
  vendorId: string; vendorName: string; taxId: string;
  total: number; billCount: number; reportable: boolean;
}

export function Form1099Panel() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<{ year: number; threshold: number; vendors: Form1099Row[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, [year]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'accounting', action: 'summary-1099', input: { year } });
      setData(r.data?.result || null);
    } catch (e) { console.error('[1099] failed', e); }
    finally { setLoading(false); }
  }

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);
  const reportable = data?.vendors.filter(v => v.reportable) || [];
  const subThreshold = data?.vendors.filter(v => !v.reportable) || [];

  return (
    <div className="bg-[#0d1117] border border-emerald-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <FileText className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-semibold text-gray-200">1099-NEC summary</span>
        {data && <span className="text-[10px] text-gray-500">threshold ≥ ${data.threshold} per IRS</span>}
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="ml-auto text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white font-mono">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : !data ? (
        <div className="p-10 text-center text-xs text-gray-500">No data.</div>
      ) : data.vendors.length === 0 ? (
        <div className="px-3 py-10 text-center text-xs text-gray-500"><FileText className="w-6 h-6 mx-auto mb-2 opacity-30" />No 1099 vendors paid in {year}.</div>
      ) : (
        <div className="p-4 space-y-3">
          {reportable.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-amber-300 font-semibold mb-1.5">Reportable ({reportable.length})</div>
              <Table rows={reportable} highlight />
            </div>
          )}
          {subThreshold.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">Below threshold ({subThreshold.length})</div>
              <Table rows={subThreshold} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Table({ rows, highlight }: { rows: Form1099Row[]; highlight?: boolean }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-[10px] uppercase text-gray-500 border-b border-white/5">
        <tr><th className="text-left py-1.5">Vendor</th><th className="text-left">Tax ID</th><th className="text-right">Bills</th><th className="text-right">Total paid</th></tr>
      </thead>
      <tbody className="divide-y divide-white/5">
        {rows.map(r => (
          <tr key={r.vendorId} className={cn('hover:bg-white/[0.03]', highlight && 'bg-amber-500/[0.04]')}>
            <td className="py-1.5 text-white">{r.vendorName}</td>
            <td className="font-mono text-[11px] text-gray-300">{r.taxId || <span className="text-rose-400">missing</span>}</td>
            <td className="text-right text-gray-400 font-mono">{r.billCount}</td>
            <td className="text-right font-mono tabular-nums text-white">${r.total.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default Form1099Panel;
