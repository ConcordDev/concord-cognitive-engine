'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Receipt, Plus, Trash2, Loader2, Tag, Check, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  autoCategorised: boolean;
  categorySource: 'manual' | 'user_rule' | 'rules';
  accountId: string | null;
}

const CATEGORIES = [
  'Groceries', 'Dining', 'Transportation', 'Gas', 'Shopping', 'Entertainment',
  'Subscriptions', 'Bills', 'Travel', 'Health', 'Income', 'Transfer', 'Investments', 'Other',
];

const SOURCE_LABEL: Record<Transaction['categorySource'], string> = {
  manual: 'manual', user_rule: 'rule', rules: 'auto',
};
const SOURCE_COLOR: Record<Transaction['categorySource'], string> = {
  manual: 'bg-zinc-500/15 text-zinc-300',
  user_rule: 'bg-violet-500/15 text-violet-300',
  rules: 'bg-cyan-500/15 text-cyan-300',
};

export function TransactionFeed() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [totals, setTotals] = useState({ totalSpend: 0, totalIncome: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ description: '', amount: '', date: '', category: '' });
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [filter, setFilter] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('finance', 'transactions-list', { limit: 300 });
      if (r.data?.ok) {
        const res = r.data.result as { transactions: Transaction[]; totalSpend: number; totalIncome: number; count: number };
        setTxns(res.transactions || []);
        setTotals({ totalSpend: res.totalSpend || 0, totalIncome: res.totalIncome || 0, count: res.count || 0 });
      }
    } catch (e) { console.error('[TxFeed] list failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function ingest() {
    const amount = Number(form.amount);
    if (!form.description.trim() || !Number.isFinite(amount) || amount === 0) return;
    try {
      const r = await lensRun('finance', 'transactions-ingest', {
        description: form.description.trim(),
        amount,
        date: form.date || undefined,
        category: form.category || undefined,
      });
      if (r.data?.ok) {
        setForm({ description: '', amount: '', date: '', category: '' });
        setAdding(false);
        await refresh();
      }
    } catch (e) { console.error('[TxFeed] ingest failed', e); }
  }

  async function recategorise(id: string, category: string) {
    try {
      const r = await lensRun('finance', 'transactions-recategorise', { id, category });
      if (r.data?.ok) { setEditing(null); await refresh(); }
    } catch (e) { console.error('[TxFeed] recategorise failed', e); }
  }

  async function remove(id: string) {
    try {
      const r = await lensRun('finance', 'transactions-delete', { id });
      if (r.data?.ok) setTxns((prev) => prev.filter((t) => t.id !== id));
    } catch (e) { console.error('[TxFeed] delete failed', e); }
  }

  const visible = useMemo(() => {
    const q = filter.toLowerCase();
    return txns.filter(
      (t) => !q || t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q),
    );
  }, [txns, filter]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Receipt className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          Transaction feed
        </span>
        <span className="ml-auto text-[10px] text-gray-500">
          {totals.count} txns · ${totals.totalIncome.toLocaleString()} in · ${totals.totalSpend.toLocaleString()} out
        </span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="p-1 text-gray-400 hover:text-white"
          aria-label="Add transaction"
        >
          <Plus className="w-4 h-4" />
        </button>
      </header>

      {adding && (
        <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Description / merchant"
            className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <input
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="Amount (neg = spend)"
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          >
            <option value="">Auto-categorise</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={ingest}
            className="col-span-6 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400"
          >
            Add transaction (auto-categorised at ingest)
          </button>
        </div>
      )}

      <div className="px-3 py-1.5 border-b border-white/5">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter transactions…"
          className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        />
      </div>

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : visible.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500">
            <Receipt className="w-6 h-6 mx-auto mb-2 opacity-30" />
            No transactions yet. Add one or sync a linked account.
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {visible.map((t) => (
              <li key={t.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3 text-xs">
                <span className="text-[10px] text-gray-500 font-mono w-20 shrink-0">{t.date}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{t.description}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {editing?.id === t.id ? (
                      <span className="inline-flex items-center gap-1">
                        <select
                          value={editing.value}
                          onChange={(e) => setEditing({ id: t.id, value: e.target.value })}
                          className="px-1.5 py-0.5 text-[10px] bg-lattice-deep border border-cyan-500/40 rounded text-white"
                        >
                          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button onClick={() => recategorise(t.id, editing.value)} className="text-emerald-300" aria-label="Save category">
                          <Check className="w-3 h-3" />
                        </button>
                        <button onClick={() => setEditing(null)} className="text-gray-400" aria-label="Cancel">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setEditing({ id: t.id, value: t.category })}
                        className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-white"
                      >
                        <Tag className="w-2.5 h-2.5" /> {t.category}
                      </button>
                    )}
                    <span className={cn('text-[9px] uppercase px-1 py-0.5 rounded', SOURCE_COLOR[t.categorySource])}>
                      {SOURCE_LABEL[t.categorySource]}
                    </span>
                  </div>
                </div>
                <span
                  className={cn(
                    'font-mono text-sm tabular-nums shrink-0',
                    t.amount >= 0 ? 'text-emerald-300' : 'text-rose-300',
                  )}
                >
                  {t.amount >= 0 ? '+' : '-'}${Math.abs(t.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <button
                  onClick={() => remove(t.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-rose-400"
                  aria-label="Delete transaction"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default TransactionFeed;
