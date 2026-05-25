'use client';

/**
 * HrBenefitsPanel — open-enrollment workflow: define benefit plans,
 * enroll employees with a coverage tier, see the employer/employee
 * cost split, and waive enrollments.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, ShieldCheck, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Employee { id: string; name: string }
interface Plan {
  id: string; name: string; category: string; provider: string | null;
  monthlyCost: number; employerContribution: number;
}
interface Enrollment {
  id: string; employeeId: string; employeeName: string; planName: string;
  category: string; coverageTier: string; employeeMonthlyCost: number;
  employerMonthlyCost: number; status: string;
}

const CATEGORIES = ['medical', 'dental', 'vision', 'retirement', 'life', 'disability'];
const TIERS = [
  { id: 'employee', label: 'Employee only' },
  { id: 'employee_spouse', label: 'Employee + spouse' },
  { id: 'employee_children', label: 'Employee + children' },
  { id: 'family', label: 'Family' },
];
const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function HrBenefitsPanel() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [totals, setTotals] = useState({ employee: 0, employer: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({ name: '', category: 'medical', provider: '', monthlyCost: '', employerContribution: '' });
  const [enrollForm, setEnrollForm] = useState({ employeeId: '', planId: '', coverageTier: 'employee' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [e, p, en] = await Promise.all([
      lensRun('hr', 'employee-list', {}),
      lensRun('hr', 'benefit-plan-list', {}),
      lensRun('hr', 'benefit-enrollment-list', {}),
    ]);
    setEmployees((e.data?.result?.employees as Employee[]) || []);
    setPlans((p.data?.result?.plans as Plan[]) || []);
    setEnrollments((en.data?.result?.enrollments as Enrollment[]) || []);
    setTotals({
      employee: (en.data?.result?.totalEmployeeCost as number) || 0,
      employer: (en.data?.result?.totalEmployerCost as number) || 0,
    });
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const addPlan = async () => {
    if (!planForm.name.trim()) { setError('Plan name is required.'); return; }
    const r = await lensRun('hr', 'benefit-plan-add', {
      name: planForm.name.trim(), category: planForm.category,
      provider: planForm.provider.trim() || undefined,
      monthlyCost: Number(planForm.monthlyCost) || 0,
      employerContribution: Number(planForm.employerContribution) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setPlanForm({ name: '', category: 'medical', provider: '', monthlyCost: '', employerContribution: '' });
    setError(null);
    await refresh();
  };
  const enroll = async () => {
    if (!enrollForm.employeeId || !enrollForm.planId) { setError('Select an employee and a plan.'); return; }
    const r = await lensRun('hr', 'benefit-enroll', enrollForm);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setEnrollForm({ employeeId: '', planId: '', coverageTier: 'employee' });
    setError(null);
    await refresh();
  };
  const waive = async (id: string) => {
    await lensRun('hr', 'benefit-waive', { id });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Plan setup */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Benefit plans</h3>
        <div className="grid grid-cols-3 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Plan name" value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={planForm.category} onChange={(e) => setPlanForm({ ...planForm, category: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input placeholder="Provider" value={planForm.provider} onChange={(e) => setPlanForm({ ...planForm, provider: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Monthly cost" inputMode="decimal" value={planForm.monthlyCost}
            onChange={(e) => setPlanForm({ ...planForm, monthlyCost: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Employer %" inputMode="numeric" value={planForm.employerContribution}
            onChange={(e) => setPlanForm({ ...planForm, employerContribution: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addPlan}
            className="flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
            <Plus className="w-3.5 h-3.5" /> Add plan
          </button>
        </div>
        {plans.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 mt-2">
            {plans.map((p) => (
              <li key={p.id} className="text-[11px] px-2 py-1 rounded-lg border border-zinc-700 text-zinc-300">
                {p.name} <span className="text-zinc-400">· {p.category} · {usd(p.monthlyCost)}/mo · {p.employerContribution}% employer</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Enrollment */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Open enrollment</h3>
        <div className="grid grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <select value={enrollForm.employeeId} onChange={(e) => setEnrollForm({ ...enrollForm, employeeId: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            <option value="">— employee —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <select value={enrollForm.planId} onChange={(e) => setEnrollForm({ ...enrollForm, planId: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            <option value="">— plan —</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={enrollForm.coverageTier} onChange={(e) => setEnrollForm({ ...enrollForm, coverageTier: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button type="button" onClick={enroll}
            className="flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
            <ShieldCheck className="w-3.5 h-3.5" /> Enroll
          </button>
        </div>
      </section>

      {/* Enrollment ledger */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-zinc-300">Enrollments</h3>
          <span className="text-[11px] text-zinc-400">
            EE {usd(totals.employee)}/mo · ER {usd(totals.employer)}/mo
          </span>
        </div>
        {enrollments.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No enrollments yet.</p>
        ) : (
          <ul className="space-y-1">
            {enrollments.map((en) => (
              <li key={en.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs text-zinc-200">{en.employeeName} · {en.planName}</p>
                  <p className="text-[10px] text-zinc-400">
                    {en.coverageTier.replace(/_/g, ' ')} · EE {usd(en.employeeMonthlyCost)} · ER {usd(en.employerMonthlyCost)}
                  </p>
                </div>
                {en.status === 'enrolled' ? (
                  <button type="button" onClick={() => waive(en.id)}
                    className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-rose-400">
                    <X className="w-3 h-3" /> Waive
                  </button>
                ) : (
                  <span className={cn('text-[10px] capitalize', 'text-zinc-400')}>{en.status}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
