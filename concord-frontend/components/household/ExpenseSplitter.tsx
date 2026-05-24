'use client';

/**
 * ExpenseSplitter — Cozi-shape budget / shared-expense splitting between
 * members. Real CRUD against household.expense-add / -list / -settle /
 * -delete plus household.expense-balances (net owed + minimal settle-up).
 */

import { useCallback, useEffect, useState } from 'react';
import { Receipt, Plus, Trash2, Check, Loader2, ArrowRight, Scale } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Expense {
  id: string; description: string; amount: number; category: string;
  paidBy: string; splitAmong: string[]; sharePerPerson: number; date: string; settled: boolean;
}
interface Balance { person: string; net: number }
interface Transfer { from: string; to: string; amount: number }
interface BalanceResult { balances: Balance[]; transfers: Transfer[]; unsettledExpenses: number }

const CATEGORIES = ['Groceries', 'Utilities', 'Rent', 'Dining', 'Transport', 'Entertainment', 'Other'];
const emptyForm = { description: '', amount: '', category: 'Groceries', paidBy: '', splitAmong: '' };

export function ExpenseSplitter() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [bal, setBal] = useState<BalanceResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [unsettledOnly, setUnsettledOnly] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const refresh = useCallback(async (filter: boolean) => {
    const [el, bl] = await Promise.all([
      lensRun<{ expenses: Expense[]; total: number }>('household', 'expense-list', { unsettledOnly: filter }),
      lensRun<BalanceResult>('household', 'expense-balances', {}),
    ]);
    if (el.data?.ok) { setExpenses(el.data.result?.expenses || []); setTotal(el.data.result?.total || 0); }
    if (bl.data?.ok) setBal(bl.data.result);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(unsettledOnly); }, [refresh, unsettledOnly]);

  async function add() {
    const amount = Number(form.amount);
    const splitAmong = form.splitAmong.split(',').map(s => s.trim()).filter(Boolean);
    if (!form.description.trim() || !(amount > 0) || !form.paidBy.trim() || splitAmong.length === 0) return;
    setBusy(true);
    await lensRun('household', 'expense-add', {
      description: form.description.trim(), amount, category: form.category,
      paidBy: form.paidBy.trim(), splitAmong,
    });
    setForm(emptyForm);
    setBusy(false);
    await refresh(unsettledOnly);
  }
  async function settle(id: string, settled: boolean) {
    await lensRun('household', 'expense-settle', { id, settled: !settled });
    await refresh(unsettledOnly);
  }
  async function del(id: string) {
    await lensRun('household', 'expense-delete', { id });
    await refresh(unsettledOnly);
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Receipt className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-bold text-zinc-100">Shared Expenses</h3>
        <span className="text-[11px] text-zinc-400">${total.toFixed(2)} total</span>
        <label className="ml-auto flex items-center gap-1 text-[11px] text-zinc-400">
          <input type="checkbox" checked={unsettledOnly} onChange={e => setUnsettledOnly(e.target.checked)} />
          Unsettled only
        </label>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description"
          className="col-span-2 sm:col-span-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input type="number" min={0} step={0.01} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="Amount"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={form.paidBy} onChange={e => setForm({ ...form, paidBy: e.target.value })} placeholder="Paid by"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.splitAmong} onChange={e => setForm({ ...form, splitAmong: e.target.value })} placeholder="Split among (comma-sep)"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button onClick={add} disabled={busy || !form.description.trim() || !(Number(form.amount) > 0) || !form.paidBy.trim() || !form.splitAmong.trim()}
          className="px-2.5 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-1">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}Add
        </button>
      </div>

      {bal && (bal.balances.length > 0 || bal.transfers.length > 0) && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400 mb-1.5 inline-flex items-center gap-1">
            <Scale className="w-3 h-3 text-amber-400" />Balances ({bal.unsettledExpenses} unsettled)
          </p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {bal.balances.map(b => (
              <span key={b.person} className={cn('text-[11px] px-2 py-0.5 rounded',
                b.net > 0.005 ? 'bg-emerald-950/60 text-emerald-300' : b.net < -0.005 ? 'bg-rose-950/60 text-rose-300' : 'bg-zinc-800 text-zinc-400')}>
                {b.person}: {b.net >= 0 ? '+' : ''}${b.net.toFixed(2)}
              </span>
            ))}
          </div>
          {bal.transfers.length > 0 ? (
            <ul className="space-y-0.5">
              {bal.transfers.map((t, i) => (
                <li key={i} className="text-[11px] text-zinc-300 inline-flex items-center gap-1.5">
                  <span className="text-rose-300">{t.from}</span>
                  <ArrowRight className="w-3 h-3 text-zinc-600" />
                  <span className="text-emerald-300">{t.to}</span>
                  <span className="text-amber-400 font-semibold">${t.amount.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-[11px] text-zinc-400 italic">All settled up.</p>}
        </div>
      )}

      {expenses.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">No data yet — add a shared expense above.</p>
      ) : (
        <ul className="space-y-1">
          {expenses.map(e => (
            <li key={e.id} className={cn('group flex items-center gap-2 border rounded-lg px-3 py-1.5',
              e.settled ? 'border-zinc-800 bg-zinc-900/30 opacity-60' : 'border-zinc-800 bg-zinc-900/60')}>
              <div className="min-w-0 flex-1">
                <p className={cn('text-xs font-semibold text-zinc-100 truncate', e.settled && 'line-through')}>{e.description}</p>
                <p className="text-[10px] text-zinc-400">
                  {e.date} · {e.category} · {e.paidBy} paid · ${e.sharePerPerson.toFixed(2)}/person ({e.splitAmong.join(', ')})
                </p>
              </div>
              <span className="text-xs font-bold text-amber-400 shrink-0">${e.amount.toFixed(2)}</span>
              <button onClick={() => settle(e.id, e.settled)} title={e.settled ? 'Mark unsettled' : 'Mark settled'}
                className={cn('w-5 h-5 rounded-full flex items-center justify-center shrink-0',
                  e.settled ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-emerald-700 hover:text-white')}>
                <Check className="w-3 h-3" />
              </button>
              <button onClick={() => del(e.id)} className="opacity-0 group-hover:opacity-100 text-rose-400" aria-label="Delete">
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
