'use client';

/** AcPayrollPanel — employees, pay runs and pay stubs. */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Users, Play } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Employee { id: string; name: string; payType: string; rate: number; title: string | null; active: boolean }
interface Stub { employeeName: string; hours: number | null; gross: number; withholding: number; net: number }
interface Run { id: string; periodStart: string; periodEnd: string; payDate: string; employeeCount: number; totalGross: number; totalNet: number }

export function AcPayrollPanel() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [detail, setDetail] = useState<{ stubs: Stub[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [emp, setEmp] = useState({ name: '', payType: 'salary', rate: '', title: '' });
  const [run, setRun] = useState({ periodStart: '', periodEnd: '', payDate: '', hours: {} as Record<string, string> });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [e, r] = await Promise.all([
      lensRun({ domain: 'accounting', action: 'employee-list', input: {} }),
      lensRun({ domain: 'accounting', action: 'payrun-list', input: {} }),
    ]);
    setEmployees(e.data?.result?.employees || []);
    setRuns(r.data?.result?.runs || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const addEmp = async () => {
    if (!emp.name.trim()) return;
    await lensRun({ domain: 'accounting', action: 'employee-create', input: { ...emp, rate: Number(emp.rate) || 0 } });
    setEmp({ name: '', payType: 'salary', rate: '', title: '' });
    await refresh();
  };
  const runPayroll = async () => {
    const lines = employees.filter((e) => e.active).map((e) => ({ employeeId: e.id, hours: Number(run.hours[e.id]) || 0 }));
    if (!lines.length) return;
    await lensRun({ domain: 'accounting', action: 'payrun-create', input: { ...run, lines } });
    setRun({ periodStart: '', periodEnd: '', payDate: '', hours: {} });
    await refresh();
  };
  const openRun = async (id: string) => {
    const r = await lensRun({ domain: 'accounting', action: 'payrun-detail', input: { id } });
    setDetail(r.data?.result?.run || null);
  };

  if (loading) return <Spin />;

  return (
    <div className="space-y-4 p-1">
      <section className="bg-black/30 border border-white/10 rounded-lg p-3">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-gray-300 mb-2"><Users className="w-3.5 h-3.5" /> Employees</h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">
          <input placeholder="Name" value={emp.name} onChange={(e) => setEmp({ ...emp, name: e.target.value })} className={inp} />
          <input placeholder="Title" value={emp.title} onChange={(e) => setEmp({ ...emp, title: e.target.value })} className={inp} />
          <select value={emp.payType} onChange={(e) => setEmp({ ...emp, payType: e.target.value })} className={inp}>
            <option value="salary">Salary</option><option value="hourly">Hourly</option>
          </select>
          <input placeholder={emp.payType === 'hourly' ? 'Rate/hr' : 'Annual'} inputMode="decimal" value={emp.rate}
            onChange={(e) => setEmp({ ...emp, rate: e.target.value })} className={inp} />
          <button type="button" onClick={addEmp} className={btn}><Plus className="w-3.5 h-3.5" /> Add</button>
        </div>
        {employees.length > 0 && (
          <ul className="space-y-1">
            {employees.map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-xs text-gray-300 bg-black/20 rounded px-2 py-1">
                <span className="flex-1">{e.name}{e.title && <span className="text-gray-400"> · {e.title}</span>}</span>
                <span className="text-gray-400">{e.payType === 'hourly' ? `$${e.rate}/hr` : `$${e.rate.toLocaleString()}/yr`}</span>
                {e.payType === 'hourly' && (
                  <input placeholder="hrs" value={run.hours[e.id] || ''}
                    onChange={(ev) => setRun({ ...run, hours: { ...run.hours, [e.id]: ev.target.value } })}
                    className="w-14 bg-black/40 border border-white/10 rounded px-1 py-0.5 text-[11px]" />
                )}
                <button aria-label="Delete" type="button" onClick={() => lensRun({ domain: 'accounting', action: 'employee-delete', input: { id: e.id } }).then(refresh)}
                  className="text-gray-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-black/30 border border-white/10 rounded-lg p-3">
        <h3 className="text-xs font-semibold text-gray-300 mb-2">Run payroll</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input type="date" value={run.periodStart} onChange={(e) => setRun({ ...run, periodStart: e.target.value })} className={inp} />
          <input type="date" value={run.periodEnd} onChange={(e) => setRun({ ...run, periodEnd: e.target.value })} className={inp} />
          <input type="date" value={run.payDate} onChange={(e) => setRun({ ...run, payDate: e.target.value })} className={inp} />
          <button type="button" onClick={runPayroll} className={btn}><Play className="w-3.5 h-3.5" /> Run</button>
        </div>
      </section>

      {detail && (
        <section className="bg-black/30 border border-emerald-500/20 rounded-lg p-3">
          <h3 className="text-xs font-semibold text-emerald-300 mb-1.5">Pay stubs</h3>
          <ul className="space-y-0.5">
            {detail.stubs.map((st, i) => (
              <li key={i} className="flex items-center gap-2 text-[11px] text-gray-300">
                <span className="flex-1">{st.employeeName}</span>
                <span>gross ${st.gross.toLocaleString()}</span>
                <span className="text-amber-400">−${st.withholding.toLocaleString()}</span>
                <span className="text-emerald-300 font-medium">net ${st.net.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold text-gray-300 mb-2">Pay run history</h3>
        {runs.length === 0 ? <Empty text="No pay runs yet." /> : (
          <ul className="space-y-1">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-xs text-gray-300 bg-black/20 border border-white/10 rounded px-2 py-1.5">
                <button type="button" onClick={() => openRun(r.id)} className="flex-1 text-left hover:text-emerald-300">
                  {r.periodStart} → {r.periodEnd}
                </button>
                <span className="text-gray-400">{r.employeeCount} emp</span>
                <span>gross ${r.totalGross.toLocaleString()}</span>
                <span className="text-emerald-300">net ${r.totalNet.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const inp = 'bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100';
const btn = 'flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded';
function Spin() { return <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>; }
function Empty({ text }: { text: string }) { return <p className="text-[11px] text-gray-400 italic">{text}</p>; }
