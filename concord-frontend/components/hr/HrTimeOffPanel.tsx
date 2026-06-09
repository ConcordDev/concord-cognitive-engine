'use client';

/**
 * HrTimeOffPanel — time-off requests, approvals and per-employee
 * balances.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Check, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Employee { id: string; name: string }
interface TimeoffRequest {
  id: string; employeeId: string; employeeName: string; kind: string;
  startDate: string; endDate: string; days: number; status: string;
}
interface Balance { kind: string; accrued: number; used: number; remaining: number }

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-amber-400', approved: 'text-emerald-400', denied: 'text-rose-400',
};

export function HrTimeOffPanel({ onChange }: { onChange: () => void }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [requests, setRequests] = useState<TimeoffRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ employeeId: '', kind: 'vacation', days: '', startDate: '' });
  const [balanceFor, setBalanceFor] = useState('');
  const [balances, setBalances] = useState<Balance[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [e, t] = await Promise.all([
      lensRun('hr', 'employee-list', {}),
      lensRun('hr', 'timeoff-list', {}),
    ]);
    setEmployees(e.data?.result?.employees || []);
    setRequests(t.data?.result?.requests || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async () => {
    if (!form.employeeId) { setError('Select an employee.'); return; }
    if (!(Number(form.days) > 0)) { setError('Days must be greater than zero.'); return; }
    const r = await lensRun('hr', 'timeoff-request', {
      employeeId: form.employeeId, kind: form.kind,
      days: Number(form.days), startDate: form.startDate,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ employeeId: '', kind: 'vacation', days: '', startDate: '' });
    setError(null);
    await refresh();
  };
  const decide = async (id: string, deny: boolean) => {
    await lensRun('hr', 'timeoff-approve', { id, deny });
    await refresh();
  };
  const loadBalance = async (employeeId: string) => {
    setBalanceFor(employeeId);
    if (!employeeId) { setBalances([]); return; }
    const r = await lensRun('hr', 'timeoff-balance', { employeeId });
    setBalances(r.data?.ok === false ? [] : (r.data?.result?.balances || []));
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Request form */}
      <div className="grid grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          <option value="">— employee —</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          {['vacation', 'sick', 'personal'].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input placeholder="Days" inputMode="decimal" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
      </div>
      <button type="button" onClick={submit}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg">
        <Plus className="w-3.5 h-3.5" /> Request time off
      </button>

      {/* Balance lookup */}
      <div>
        <select value={balanceFor} onChange={(e) => loadBalance(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          <option value="">View balances for…</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {balances.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-2">
            {balances.map((b) => (
              <div key={b.kind} className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
                <p className="text-sm font-bold text-zinc-100">{b.remaining}</p>
                <p className="text-[10px] text-zinc-400 capitalize">{b.kind} left ({b.used}/{b.accrued})</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Requests */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Requests</h3>
        {requests.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No time-off requests.</p>
        ) : (
          <ul className="space-y-1">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs text-zinc-200">{r.employeeName} · <span className="capitalize">{r.kind}</span></p>
                  <p className="text-[10px] text-zinc-400">{r.days} days from {r.startDate}</p>
                </div>
                {r.status === 'pending' ? (
                  <div className="flex gap-1">
                    <button aria-label="Confirm" type="button" onClick={() => decide(r.id, false)}
                      className="p-1 rounded bg-emerald-700/30 text-emerald-300"><Check className="w-3.5 h-3.5" /></button>
                    <button aria-label="Close" type="button" onClick={() => decide(r.id, true)}
                      className="p-1 rounded bg-rose-700/30 text-rose-300"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <span className={cn('text-[10px] capitalize', STATUS_COLOR[r.status])}>{r.status}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
