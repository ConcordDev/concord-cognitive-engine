'use client';

import { useEffect, useState } from 'react';
import { Receipt, Plus, Paperclip } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonTableRows } from '@/components/ui';

interface Account { id: string; code: string; name: string; category: string; archived: boolean }
interface Expense {
  id: string; number: string; date: string; vendor: string; accountId: string;
  amount: number; memo: string; receiptUrl: string; status?: string;
  jeEntryId?: string; reversalJeId?: string;
}

export function ExpensesPanel() {
  const [list, setList] = useState<Expense[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ accountId: '', amount: '', vendor: '', memo: '', date: '', receiptUrl: '' });
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Expense | null>(null);
  const [voidArmed, setVoidArmed] = useState<string | null>(null);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [e, a] = await Promise.all([
        lensRun({ domain: 'accounting', action: 'expenses-list', input: {} }),
        lensRun({ domain: 'accounting', action: 'coa-list', input: {} }),
      ]);
      setList((e.data?.result?.expenses || []) as Expense[]);
      setAccounts((a.data?.result?.accounts || []) as Account[]);
    } catch (err) { console.error('[Expenses] refresh failed', err); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.accountId) { setFormError('Choose an expense account.'); return; }
    const amount = Number(draft.amount);
    if (!draft.amount.trim() || !Number.isFinite(amount) || amount <= 0) { setFormError('Amount must be a number greater than 0.'); return; }
    if (draft.date.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(draft.date.trim())) { setFormError('Date must be a real day as YYYY-MM-DD.'); return; }
    setFormError(null);
    try {
      const r = await lensRun({
        domain: 'accounting', action: 'expenses-create',
        input: { ...draft, amount, date: draft.date.trim() || undefined },
      });
      if (r.data?.ok === false) { setFormError(r.data?.message || r.data?.error || 'Could not post that expense.'); return; }
      setDraft({ accountId: '', amount: '', vendor: '', memo: '', date: '', receiptUrl: '' });
      setCreating(false);
      await refresh();
    } catch (err) { setFormError(err instanceof Error ? err.message : 'Could not post that expense.'); }
  }

  async function saveEdit() {
    if (!edit) return;
    setFormError(null);
    try {
      const r = await lensRun({
        domain: 'accounting', action: 'expenses-update',
        input: {
          id: edit.id, vendor: edit.vendor, memo: edit.memo, date: edit.date,
          amount: Number(edit.amount), accountId: edit.accountId, receiptUrl: edit.receiptUrl,
        },
      });
      if (r.data?.ok === false) { setFormError(r.data?.error || 'Could not update that expense.'); return; }
      setEdit(null);
      await refresh();
    } catch (err) { setFormError(err instanceof Error ? err.message : 'Could not update that expense.'); }
  }

  async function voidExpense(id: string) {
    setFormError(null);
    try {
      const r = await lensRun({ domain: 'accounting', action: 'expenses-void', input: { id } });
      if (r.data?.ok === false) { setFormError(r.data?.error || 'Could not void that expense.'); return; }
      setVoidArmed(null);
      setOpenId(null);
      await refresh();
    } catch (err) { setFormError(err instanceof Error ? err.message : 'Could not void that expense.'); }
  }

  const accountById = new Map(accounts.map(a => [a.id, a]));
  const expenseAccounts = accounts.filter(a => !a.archived && (a.category === 'expense' || a.category === 'cogs'));

  return (
    <div className="bg-[#0d1117] border border-emerald-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Receipt className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-gray-200">Expenses (out-of-pocket / card)</span>
        <span className="text-[10px] text-gray-400 font-mono tabular-nums">{list.length}</span>
        <button onClick={() => setCreating(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-emerald-500 text-black font-semibold hover:bg-emerald-400 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />New expense
        </button>
      </header>

      {creating && (
        <div className="px-4 py-3 border-b border-white/10 grid grid-cols-12 gap-2">
          <select aria-label="Expense account" value={draft.accountId} onChange={e => setDraft({ ...draft, accountId: e.target.value })} className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="">Expense account *</option>
            {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </select>
          <input type="number" step="0.01" value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })} placeholder="Amount *" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono tabular-nums" />
          <input value={draft.vendor} onChange={e => setDraft({ ...draft, vendor: e.target.value })} placeholder="Vendor" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono tabular-nums" />
          <input value={draft.memo} onChange={e => setDraft({ ...draft, memo: e.target.value })} placeholder="Memo" className="col-span-8 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.receiptUrl} onChange={e => setDraft({ ...draft, receiptUrl: e.target.value })} placeholder="Receipt URL" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          {formError && <p role="alert" className="col-span-12 text-xs text-rose-300">{formError}</p>}
          <button onClick={create} className="col-span-12 px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Post expense (auto Dr Expense / Cr Cash)</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <input
          id="expense-search" name="expenseSearch" aria-label="Search expenses"
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search vendor, memo, or date"
          className="flex-1 min-w-[10rem] px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        />
        <input type="date" aria-label="Expenses from" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="date" aria-label="Expenses to" value={toDate} onChange={(e) => setToDate(e.target.value)} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select aria-label="Sort expenses" value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'oldest')} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="newest">Newest date</option>
          <option value="oldest">Oldest date</option>
        </select>
      </div>
      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <SkeletonTableRows rows={5} columns={4} />
        ) : list.length === 0 ? (
          <EmptyState compact title="No expenses logged" description="Post an expense above. A blank amount, a zero, or a date that is not YYYY-MM-DD is refused here." />
        ) : (
          <ul className="divide-y divide-white/5">
            {[...list].filter((e) => {
              const q = query.trim().toLowerCase();
              if (q && !`${e.vendor} ${e.memo} ${e.date}`.toLowerCase().includes(q)) return false;
              if (fromDate && e.date < fromDate) return false;
              if (toDate && e.date > toDate) return false;
              return true;
            }).sort((a, b) => sort === 'newest' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)).map(e => {
              const a = accountById.get(e.accountId);
              const open = openId === e.id;
              const voided = e.status === 'void';
              return (
                <li key={e.id} className="px-4 py-2 hover:bg-white/[0.02]">
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => { setOpenId(open ? null : e.id); setEdit(null); setVoidArmed(null); }} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left">
                      <span className="font-mono tabular-nums text-[10px] text-gray-400 w-20">{e.date}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-white flex items-center gap-2">
                          {e.vendor && <span>{e.vendor}</span>}
                          <span className="text-[10px] text-gray-400">{a ? `${a.code} ${a.name}` : ''}</span>
                          {voided && <span className="text-[10px] uppercase text-amber-300">void</span>}
                        </div>
                        {e.memo && <div className="text-[10px] text-gray-400 truncate">{e.memo}</div>}
                      </div>
                      <span className={`text-sm font-mono tabular-nums w-20 text-right ${voided ? 'text-gray-500 line-through' : 'text-rose-300'}`}>−${e.amount.toFixed(2)}</span>
                    </button>
                    {e.receiptUrl && <a href={e.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 min-w-11 items-center justify-center text-cyan-300 hover:text-cyan-200" title="Receipt"><Paperclip className="w-3 h-3" /></a>}
                  </div>
                  {open && (
                    <div className="mt-2 rounded border border-white/10 bg-black/20 p-2 text-[11px] text-gray-300">
                      <p>{e.number}{e.jeEntryId ? ` · journal ${e.jeEntryId}` : ''}{e.reversalJeId ? ` · reversal ${e.reversalJeId}` : ''}</p>
                      {edit?.id === e.id ? (
                        <div className="mt-2 grid grid-cols-12 gap-2">
                          <select aria-label="Expense account" value={edit.accountId} onChange={(ev) => setEdit({ ...edit, accountId: ev.target.value })} className="col-span-4 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
                            {expenseAccounts.map((acct) => <option key={acct.id} value={acct.id}>{acct.code} {acct.name}</option>)}
                          </select>
                          <input aria-label="Expense amount" type="number" step="0.01" value={edit.amount} onChange={(ev) => setEdit({ ...edit, amount: Number(ev.target.value) })} className="col-span-2 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                          <input aria-label="Expense vendor" value={edit.vendor} onChange={(ev) => setEdit({ ...edit, vendor: ev.target.value })} className="col-span-3 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                          <input aria-label="Expense date" type="date" value={edit.date} onChange={(ev) => setEdit({ ...edit, date: ev.target.value })} className="col-span-3 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                          <input aria-label="Expense memo" value={edit.memo} onChange={(ev) => setEdit({ ...edit, memo: ev.target.value })} className="col-span-8 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                          <button type="button" onClick={saveEdit} className="col-span-4 rounded bg-emerald-500 px-2 py-1 text-xs font-semibold text-black">Save</button>
                        </div>
                      ) : !voided && (
                        <div className="mt-2 flex gap-2">
                          <button type="button" onClick={() => setEdit({ ...e })} className="rounded border border-white/15 px-2 py-1 text-xs text-white">Edit</button>
                          {voidArmed === e.id ? (
                            <>
                              <button type="button" onClick={() => voidExpense(e.id)} className="rounded bg-rose-500 px-2 py-1 text-xs font-semibold text-black">Confirm void</button>
                              <button type="button" onClick={() => setVoidArmed(null)} className="rounded border border-white/15 px-2 py-1 text-xs text-gray-300">Cancel</button>
                            </>
                          ) : (
                            <button type="button" onClick={() => setVoidArmed(e.id)} className="rounded border border-rose-500/40 px-2 py-1 text-xs text-rose-200">Void</button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ExpensesPanel;
