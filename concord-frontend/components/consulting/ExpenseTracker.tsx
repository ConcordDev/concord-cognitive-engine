'use client';

/**
 * ExpenseTracker — log expenses and reimbursables against engagements,
 * approve / reject / reimburse them, and roll up totals. Wires
 * consulting.expense-create / expense-list / expense-update / expense-delete.
 */

import { useCallback, useEffect, useState } from 'react';
import { Receipt, Loader2, Trash2, Plus, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Expense {
  id: string; engagementId: string; engagementName: string; description: string;
  category: string; amount: number; reimbursable: boolean; status: string; date: string;
}
interface EngagementOption { id: string; name: string }

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-amber-400 bg-amber-500/10',
  approved: 'text-sky-400 bg-sky-500/10',
  rejected: 'text-rose-400 bg-rose-500/10',
  reimbursed: 'text-emerald-400 bg-emerald-500/10',
};
const NEXT_STATUS = ['pending', 'approved', 'reimbursed'];

export function ExpenseTracker({ engagements }: { engagements: EngagementOption[] }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [totals, setTotals] = useState({ total: 0, reimbursable: 0, approved: 0 });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ engagementId: '', description: '', category: '', amount: '', reimbursable: true });
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const r = await lensRun('consulting', 'expense-list', {});
    const res = r.data?.result as { expenses?: Expense[]; total?: number; reimbursable?: number; approved?: number } | null;
    setExpenses(res?.expenses || []);
    setTotals({ total: res?.total || 0, reimbursable: res?.reimbursable || 0, approved: res?.approved || 0 });
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function add() {
    setError('');
    if (!form.engagementId || !form.description.trim() || !form.amount) {
      setError('Engagement, description and amount are required'); return;
    }
    const r = await lensRun('consulting', 'expense-create', {
      engagementId: form.engagementId, description: form.description.trim(),
      category: form.category.trim(), amount: Number(form.amount), reimbursable: form.reimbursable,
    });
    if (!r.data?.ok) { setError(r.data?.error || 'Failed to add expense'); return; }
    setForm({ engagementId: '', description: '', category: '', amount: '', reimbursable: true });
    await refresh();
  }
  async function cycleStatus(exp: Expense) {
    const idx = NEXT_STATUS.indexOf(exp.status);
    const next = idx >= 0 && idx < NEXT_STATUS.length - 1 ? NEXT_STATUS[idx + 1] : 'approved';
    await lensRun('consulting', 'expense-update', { id: exp.id, status: next });
    await refresh();
  }
  async function reject(exp: Expense) {
    await lensRun('consulting', 'expense-update', { id: exp.id, status: 'rejected' });
    await refresh();
  }
  async function del(id: string) {
    await lensRun('consulting', 'expense-delete', { id });
    await refresh();
  }

  if (loading) return <div className="flex justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {([['Total', totals.total, 'text-zinc-100'], ['Reimbursable', totals.reimbursable, 'text-amber-400'], ['Approved', totals.approved, 'text-emerald-400']] as const).map(([l, v, c]) => (
          <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2 text-center">
            <p className={`text-base font-bold ${c}`}>${v.toLocaleString()}</p>
            <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{l}</p>
          </div>
        ))}
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 flex flex-wrap gap-1.5 items-center">
        <select value={form.engagementId} onChange={e => setForm({ ...form, engagementId: e.target.value })}
          className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200">
          <option value="">Engagement…</option>
          {engagements.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="description"
          className="flex-1 min-w-[110px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="category"
          className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="$ amount"
          className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <label className="flex items-center gap-1 text-[11px] text-zinc-400">
          <input type="checkbox" checked={form.reimbursable} onChange={e => setForm({ ...form, reimbursable: e.target.checked })} />
          reimb.
        </label>
        <button onClick={add}
          className="px-2.5 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Add
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-400">{error}</p>}

      <ul className="space-y-1.5">
        {expenses.length === 0 && <li className="text-xs text-zinc-400 italic py-3 text-center">No expenses logged.</li>}
        {expenses.map(exp => (
          <li key={exp.id} className="group bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2 flex items-center gap-2">
            <Receipt className="w-4 h-4 text-indigo-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-zinc-100 truncate">{exp.description}</p>
              <p className="text-[10px] text-zinc-400">{exp.engagementName} · {exp.category} · {exp.date}{exp.reimbursable ? ' · reimbursable' : ''}</p>
            </div>
            <span className="text-sm font-bold text-zinc-100">${exp.amount.toLocaleString()}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase ${STATUS_COLOR[exp.status] || 'text-zinc-400 bg-zinc-800'}`}>{exp.status}</span>
            {exp.status !== 'reimbursed' && exp.status !== 'rejected' && (
              <button onClick={() => cycleStatus(exp)} aria-label="Advance status" className="text-zinc-400 hover:text-emerald-400"><Check className="w-3.5 h-3.5" /></button>
            )}
            {exp.status === 'pending' && (
              <button onClick={() => reject(exp)} className="text-[10px] text-rose-400 hover:text-rose-300">reject</button>
            )}
            <button onClick={() => del(exp.id)} aria-label="Delete" className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}
