'use client';

/**
 * HrSelfServicePanel — employee self-service portal. An employee picks
 * their own record and gets a consolidated view: profile, time-off
 * balances + history, benefits, paystubs, courses, goals, compliance.
 * They can update contact fields and request time off themselves.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, CalendarPlus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Employee { id: string; name: string }
interface Balance { kind: string; accrued: number; used: number; remaining: number }
interface TimeoffReq { id: string; kind: string; startDate: string; endDate: string; days: number; status: string }
interface Benefit { id: string; planName: string; coverageTier: string; employeeMonthlyCost: number }
interface Paystub { runId: string; periodLabel: string; payDate: string; grossPay: number; netPay: number; totalDeductions: number }
interface CourseAsg { id: string; courseTitle: string; progress: number; status: string }
interface Goal { id: string; title: string; progress: number }
interface Profile {
  id: string; name: string; title: string | null; department: string;
  email: string | null; hireDate: string; employmentType: string; status: string;
  phone?: string | null; address?: string | null; emergencyContact?: string | null;
}
interface Summary {
  profile: Profile;
  timeoffBalances: Balance[];
  timeoffRequests: TimeoffReq[];
  benefits: Benefit[];
  paystubs: Paystub[];
  courses: CourseAsg[];
  goals: Goal[];
  complianceOutstanding: number;
}

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_COLOR: Record<string, string> = {
  pending: 'text-amber-400', approved: 'text-emerald-400', denied: 'text-rose-400',
};

export function HrSelfServicePanel() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contact, setContact] = useState({ email: '', phone: '', address: '', emergencyContact: '' });
  const [pto, setPto] = useState({ kind: 'vacation', days: '', startDate: '' });

  const loadEmployees = useCallback(async () => {
    const r = await lensRun('hr', 'employee-list', {});
    setEmployees((r.data?.result?.employees as Employee[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { void loadEmployees(); }, [loadEmployees]);

  const loadSummary = useCallback(async (employeeId: string) => {
    setSelectedId(employeeId);
    if (!employeeId) { setSummary(null); return; }
    const r = await lensRun('hr', 'self-service-summary', { employeeId });
    if (r.data?.ok) {
      const s = r.data.result as Summary;
      setSummary(s);
      setContact({
        email: s.profile.email || '', phone: s.profile.phone || '',
        address: s.profile.address || '', emergencyContact: s.profile.emergencyContact || '',
      });
    } else {
      setSummary(null);
      setError(r.data?.error || 'Failed to load portal');
    }
  }, []);

  const saveContact = async () => {
    if (!selectedId) return;
    const r = await lensRun('hr', 'self-service-update', { employeeId: selectedId, ...contact });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await loadSummary(selectedId);
  };
  const requestTimeOff = async () => {
    if (!selectedId) return;
    if (!(Number(pto.days) > 0)) { setError('Days must be greater than zero.'); return; }
    const r = await lensRun('hr', 'timeoff-request', {
      employeeId: selectedId, kind: pto.kind, days: Number(pto.days), startDate: pto.startDate,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setPto({ kind: 'vacation', days: '', startDate: '' });
    setError(null);
    await loadSummary(selectedId);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <select value={selectedId} onChange={(e) => loadSummary(e.target.value)}
        className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
        <option value="">Sign in as employee…</option>
        {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>

      {!selectedId && (
        <p className="text-[11px] text-zinc-500 italic">Select an employee to open their self-service portal.</p>
      )}

      {summary && (
        <>
          {/* Profile */}
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
            <h3 className="text-base font-bold text-zinc-100">{summary.profile.name}</h3>
            <p className="text-xs text-zinc-500">
              {summary.profile.title || 'No title'} · {summary.profile.department} · hired {summary.profile.hireDate}
            </p>
          </div>

          {/* Time-off balances */}
          <section>
            <h4 className="text-xs font-semibold text-zinc-300 mb-2">Time-off balances</h4>
            <div className="grid grid-cols-3 gap-2">
              {summary.timeoffBalances.map((b) => (
                <div key={b.kind} className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
                  <p className="text-sm font-bold text-zinc-100">{b.remaining}</p>
                  <p className="text-[10px] text-zinc-500 capitalize">{b.kind} left ({b.used}/{b.accrued})</p>
                </div>
              ))}
            </div>
          </section>

          {/* Request time off */}
          <section>
            <h4 className="text-xs font-semibold text-zinc-300 mb-2">Request time off</h4>
            <div className="grid grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <select value={pto.kind} onChange={(e) => setPto({ ...pto, kind: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                {['vacation', 'sick', 'personal'].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <input placeholder="Days" inputMode="decimal" value={pto.days}
                onChange={(e) => setPto({ ...pto, days: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input type="date" value={pto.startDate} onChange={(e) => setPto({ ...pto, startDate: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <button type="button" onClick={requestTimeOff}
                className="flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
                <CalendarPlus className="w-3.5 h-3.5" /> Request
              </button>
            </div>
            {summary.timeoffRequests.length > 0 && (
              <ul className="space-y-1 mt-2">
                {summary.timeoffRequests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                    <span className="text-[11px] text-zinc-300 capitalize">{r.kind} · {r.days}d from {r.startDate}</span>
                    <span className={cn('text-[10px] capitalize', STATUS_COLOR[r.status] || 'text-zinc-500')}>{r.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Paystubs */}
          <section>
            <h4 className="text-xs font-semibold text-zinc-300 mb-2">Pay stubs</h4>
            {summary.paystubs.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic">No pay stubs yet.</p>
            ) : (
              <ul className="space-y-1">
                {summary.paystubs.map((p) => (
                  <li key={p.runId} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                    <div>
                      <p className="text-xs text-zinc-200">{p.periodLabel}</p>
                      <p className="text-[10px] text-zinc-500">paid {p.payDate} · gross {usd(p.grossPay)}</p>
                    </div>
                    <span className="text-xs text-emerald-300 font-semibold">{usd(p.netPay)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Benefits */}
          <section>
            <h4 className="text-xs font-semibold text-zinc-300 mb-2">My benefits</h4>
            {summary.benefits.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic">Not enrolled in any benefits.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {summary.benefits.map((b) => (
                  <li key={b.id} className="text-[11px] px-2 py-1 rounded-lg border border-zinc-700 text-zinc-300">
                    {b.planName} <span className="text-zinc-500">· {b.coverageTier.replace(/_/g, ' ')} · {usd(b.employeeMonthlyCost)}/mo</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Courses + goals */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <section>
              <h4 className="text-xs font-semibold text-zinc-300 mb-2">My training</h4>
              {summary.courses.length === 0 ? (
                <p className="text-[11px] text-zinc-500 italic">No courses assigned.</p>
              ) : (
                <ul className="space-y-1">
                  {summary.courses.map((c) => (
                    <li key={c.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                      <p className="text-[11px] text-zinc-200">{c.courseTitle}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${c.progress}%` }} />
                        </div>
                        <span className="text-[10px] text-zinc-400">{c.progress}%</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h4 className="text-xs font-semibold text-zinc-300 mb-2">My goals</h4>
              {summary.goals.length === 0 ? (
                <p className="text-[11px] text-zinc-500 italic">No goals set.</p>
              ) : (
                <ul className="space-y-1">
                  {summary.goals.map((g) => (
                    <li key={g.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                      <p className="text-[11px] text-zinc-200">{g.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${g.progress}%` }} />
                        </div>
                        <span className="text-[10px] text-zinc-400">{g.progress}%</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {summary.complianceOutstanding > 0 && (
            <div className="text-[11px] text-amber-400 bg-amber-950/40 border border-amber-900/50 rounded-lg px-3 py-2">
              {summary.complianceOutstanding} compliance document(s) awaiting your acknowledgement.
            </div>
          )}

          {/* Contact update */}
          <section>
            <h4 className="text-xs font-semibold text-zinc-300 mb-2">Update my contact info</h4>
            <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <input placeholder="Email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Phone" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Address" value={contact.address} onChange={(e) => setContact({ ...contact, address: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Emergency contact" value={contact.emergencyContact}
                onChange={(e) => setContact({ ...contact, emergencyContact: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <button type="button" onClick={saveContact}
                className="col-span-2 flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
                <Save className="w-3.5 h-3.5" /> Save contact info
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
