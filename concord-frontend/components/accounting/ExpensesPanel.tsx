'use client';

import { useEffect, useState } from 'react';
import { Receipt, Loader2, Plus, Paperclip } from 'lucide-react';
import { api } from '@/lib/api/client';

interface Account { id: string; code: string; name: string; category: string; archived: boolean }
interface Expense {
  id: string; number: string; date: string; vendor: string; accountId: string;
  amount: number; memo: string; receiptUrl: string;
}

export function ExpensesPanel() {
  const [list, setList] = useState<Expense[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ accountId: '', amount: '', vendor: '', memo: '', date: '', receiptUrl: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [e, a] = await Promise.all([
        api.post('/api/lens/run', { domain: 'accounting', action: 'expenses-list', input: {} }),
        api.post('/api/lens/run', { domain: 'accounting', action: 'coa-list', input: {} }),
      ]);
      setList((e.data?.result?.expenses || []) as Expense[]);
      setAccounts((a.data?.result?.accounts || []) as Account[]);
    } catch (err) { console.error('[Expenses] refresh failed', err); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.accountId || !draft.amount) return;
    try {
      await api.post('/api/lens/run', {
        domain: 'accounting', action: 'expenses-create',
        input: { ...draft, amount: Number(draft.amount) },
      });
      setDraft({ accountId: '', amount: '', vendor: '', memo: '', date: '', receiptUrl: '' });
      setCreating(false);
      await refresh();
    } catch (err) { console.error('[Expenses] create failed', err); }
  }

  const accountById = new Map(accounts.map(a => [a.id, a]));
  const expenseAccounts = accounts.filter(a => !a.archived && (a.category === 'expense' || a.category === 'cogs'));

  return (
    <div className="bg-[#0d1117] border border-emerald-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Receipt className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-gray-200">Expenses (out-of-pocket / card)</span>
        <span className="text-[10px] text-gray-500">{list.length}</span>
        <button onClick={() => setCreating(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-emerald-500 text-black font-semibold hover:bg-emerald-400 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />New expense
        </button>
      </header>

      {creating && (
        <div className="px-4 py-3 border-b border-white/10 grid grid-cols-12 gap-2">
          <select value={draft.accountId} onChange={e => setDraft({ ...draft, accountId: e.target.value })} className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="">Expense account *</option>
            {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </select>
          <input type="number" step="0.01" value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })} placeholder="Amount *" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={draft.vendor} onChange={e => setDraft({ ...draft, vendor: e.target.value })} placeholder="Vendor" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={draft.memo} onChange={e => setDraft({ ...draft, memo: e.target.value })} placeholder="Memo" className="col-span-8 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.receiptUrl} onChange={e => setDraft({ ...draft, receiptUrl: e.target.value })} placeholder="Receipt URL" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={create} className="col-span-12 px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Post expense (auto Dr Expense / Cr Cash)</button>
        </div>
      )}

      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : list.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Receipt className="w-6 h-6 mx-auto mb-2 opacity-30" />No expenses logged.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map(e => {
              const a = accountById.get(e.accountId);
              return (
                <li key={e.id} className="px-4 py-2 hover:bg-white/[0.02] flex items-center gap-3">
                  <span className="font-mono text-[10px] text-gray-500 w-20">{e.date}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white flex items-center gap-2">
                      {e.vendor && <span>{e.vendor}</span>}
                      <span className="text-[10px] text-gray-500">{a ? `${a.code} ${a.name}` : ''}</span>
                    </div>
                    {e.memo && <div className="text-[10px] text-gray-500 truncate">{e.memo}</div>}
                  </div>
                  {e.receiptUrl && <a href={e.receiptUrl} target="_blank" rel="noreferrer" className="p-1 text-cyan-300 hover:text-cyan-200" title="Receipt"><Paperclip className="w-3 h-3" /></a>}
                  <span className="text-sm font-mono tabular-nums text-rose-300 w-20 text-right">−${e.amount.toFixed(2)}</span>
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
