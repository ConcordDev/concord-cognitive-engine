'use client';

/**
 * HrPayrollPanel — run payroll over active employees and inspect the
 * generated pay stubs. Every figure is computed server-side from the
 * salary on each employee record (real federal/FICA/state arithmetic).
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Play, FileText, ChevronLeft } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Stub {
  employeeId: string; employeeName: string; grossPay: number;
  federalTax: number; stateTax: number; socialSecurity: number;
  medicare: number; totalDeductions: number; netPay: number;
}
interface PayRun {
  id: string; periodLabel: string; payDate: string; frequency: string;
  headcount: number; stubs: Stub[]; totalGross: number;
  totalDeductions: number; totalNet: number; status: string; createdAt: string;
}

const FREQUENCIES = ['weekly', 'biweekly', 'semimonthly', 'monthly'];
const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function HrPayrollPanel() {
  const [runs, setRuns] = useState<PayRun[]>([]);
  const [ytdPaid, setYtdPaid] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ frequency: 'biweekly', periodLabel: '', payDate: '' });
  const [openRun, setOpenRun] = useState<PayRun | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('hr', 'payroll-list', {});
    if (r.data?.ok) {
      setRuns((r.data.result?.runs as PayRun[]) || []);
      setYtdPaid((r.data.result?.ytdPaid as number) || 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const runPayroll = async () => {
    setBusy(true);
    const r = await lensRun('hr', 'payroll-run', {
      frequency: form.frequency,
      periodLabel: form.periodLabel.trim() || undefined,
      payDate: form.payDate || undefined,
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Payroll run failed'); return; }
    setError(null);
    setForm({ frequency: 'biweekly', periodLabel: '', payDate: '' });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (openRun) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setOpenRun(null)}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <ChevronLeft className="w-3.5 h-3.5" /> Pay runs
        </button>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h3 className="text-sm font-bold text-zinc-100">{openRun.periodLabel}</h3>
          <p className="text-[11px] text-zinc-400">
            {openRun.frequency} · pay date {openRun.payDate} · {openRun.headcount} stub(s)
          </p>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <Metric label="Gross" value={usd(openRun.totalGross)} />
            <Metric label="Deductions" value={usd(openRun.totalDeductions)} tone="rose" />
            <Metric label="Net" value={usd(openRun.totalNet)} tone="emerald" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-zinc-400 text-left border-b border-zinc-800">
                <th className="py-1.5 pr-2">Employee</th>
                <th className="py-1.5 px-2 text-right">Gross</th>
                <th className="py-1.5 px-2 text-right">Fed</th>
                <th className="py-1.5 px-2 text-right">State</th>
                <th className="py-1.5 px-2 text-right">SS</th>
                <th className="py-1.5 px-2 text-right">Medicare</th>
                <th className="py-1.5 pl-2 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {openRun.stubs.map((s) => (
                <tr key={s.employeeId} className="border-b border-zinc-900 text-zinc-300">
                  <td className="py-1.5 pr-2 text-zinc-100">{s.employeeName}</td>
                  <td className="py-1.5 px-2 text-right">{usd(s.grossPay)}</td>
                  <td className="py-1.5 px-2 text-right text-rose-300">{usd(s.federalTax)}</td>
                  <td className="py-1.5 px-2 text-right text-rose-300">{usd(s.stateTax)}</td>
                  <td className="py-1.5 px-2 text-right text-rose-300">{usd(s.socialSecurity)}</td>
                  <td className="py-1.5 px-2 text-right text-rose-300">{usd(s.medicare)}</td>
                  <td className="py-1.5 pl-2 text-right text-emerald-300 font-semibold">{usd(s.netPay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-3 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <input placeholder="Period label" value={form.periodLabel}
          onChange={(e) => setForm({ ...form, periodLabel: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input type="date" value={form.payDate} onChange={(e) => setForm({ ...form, payDate: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
      </div>
      <div className="flex items-center justify-between">
        <button type="button" onClick={runPayroll} disabled={busy}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Run payroll
        </button>
        <span className="text-[11px] text-zinc-400">YTD net paid: <span className="text-emerald-300 font-semibold">{usd(ytdPaid)}</span></span>
      </div>

      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Pay runs</h3>
        {runs.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No payroll runs yet. Add employees with salaries, then run payroll.</p>
        ) : (
          <ul className="space-y-1">
            {runs.map((run) => (
              <li key={run.id}>
                <button type="button" onClick={() => setOpenRun(run)}
                  className="w-full text-left flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2 hover:border-zinc-700">
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-emerald-400" />
                    <div>
                      <p className="text-xs text-zinc-100">{run.periodLabel}</p>
                      <p className="text-[10px] text-zinc-400">{run.frequency} · {run.headcount} employee(s) · {run.payDate}</p>
                    </div>
                  </div>
                  <span className="text-xs text-emerald-300 font-semibold">{usd(run.totalNet)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'rose' }) {
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-center">
      <p className={cn('text-sm font-bold',
        tone === 'emerald' ? 'text-emerald-300' : tone === 'rose' ? 'text-rose-300' : 'text-zinc-100')}>{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
