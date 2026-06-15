'use client';

import { useEffect, useMemo, useState } from 'react';
import { Wallet, Plus, Trash2, Loader2, AlertTriangle, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Envelope {
  id: string;
  category: string;
  monthlyTarget: number;
  rolloverEnabled: boolean;
  currentBalance: number;
  spentThisMonth: number;
}

interface EnvelopeBudgetProps {
  monthlyIncome?: number;
}

export function EnvelopeBudget({ monthlyIncome = 0 }: EnvelopeBudgetProps) {
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [income, setIncome] = useState<number>(monthlyIncome);

  useEffect(() => { refresh(); }, []);
  useEffect(() => { setIncome(monthlyIncome); }, [monthlyIncome]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'finance', action: 'envelopes-list', input: {},
      });
      const items = (res.data?.result?.envelopes || []) as Envelope[];
      setEnvelopes(items);
      const inc = res.data?.result?.monthlyIncome;
      if (typeof inc === 'number') setIncome(inc);
    } catch (e) { console.error('[Envelopes] list failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!newCat.trim() || !newTarget) return;
    try {
      await lensRun({
        domain: 'finance', action: 'envelopes-create',
        input: { category: newCat.trim(), monthlyTarget: Number(newTarget), rolloverEnabled: true },
      });
      setNewCat(''); setNewTarget(''); setCreating(false);
      await refresh();
    } catch (e) { console.error('[Envelopes] create failed', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({
        domain: 'finance', action: 'envelopes-delete', input: { id },
      });
      setEnvelopes(prev => prev.filter(e => e.id !== id));
    } catch (e) { console.error('[Envelopes] delete failed', e); }
  }

  async function saveIncome(value: number) {
    setIncome(value);
    try {
      await lensRun({
        domain: 'finance', action: 'monthly-income-set', input: { monthlyIncome: value },
      });
    } catch (e) { console.error('[Income] save failed', e); }
  }

  const totalTarget = useMemo(() => envelopes.reduce((s, e) => s + e.monthlyTarget, 0), [envelopes]);
  const totalSpent = useMemo(() => envelopes.reduce((s, e) => s + e.spentThisMonth, 0), [envelopes]);
  const unallocated = Math.max(0, income - totalTarget);
  const zeroBased = income > 0 && Math.abs(income - totalTarget) < 0.01;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Wallet className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Envelope budgets</span>
        <span className="ml-auto text-[10px] text-gray-400">zero-based</span>
        <button onClick={() => setCreating(v => !v)} className="p-1 text-gray-400 hover:text-white" title="New envelope">
          <Plus className="w-4 h-4" />
        </button>
      </header>

      <div className="px-4 py-3 border-b border-white/5 flex items-center gap-3 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-gray-400">Monthly income $</span>
          <input
            type="number"
            value={income}
            onChange={e => saveIncome(Number(e.target.value) || 0)}
            className="w-28 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white"
            min={0}
          />
        </label>
        <span className="ml-auto text-gray-400">
          Allocated: <span className={cn('font-mono tabular-nums', zeroBased ? 'text-green-400' : 'text-cyan-300')}>${totalTarget.toFixed(0)}</span>
        </span>
        <span className="text-gray-400">
          Unallocated: <span className={cn('font-mono tabular-nums', unallocated === 0 ? 'text-green-400' : 'text-yellow-300')}>${unallocated.toFixed(0)}</span>
        </span>
        {zeroBased && <span className="text-green-400 inline-flex items-center gap-1"><Check className="w-3 h-3" /> Zero-based!</span>}
      </div>

      {creating && (
        <div className="p-3 border-b border-white/10 flex items-center gap-2">
          <input
            value={newCat}
            onChange={e => setNewCat(e.target.value)}
            placeholder="Category (e.g. Groceries)"
            className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <input
            type="number"
            value={newTarget}
            onChange={e => setNewTarget(e.target.value)}
            placeholder="Monthly $"
            className="w-24 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            min={0}
          />
          <button
            onClick={create}
            className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400"
          >Add</button>
        </div>
      )}

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : envelopes.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400">
            <Wallet className="w-6 h-6 mx-auto mb-2 opacity-30" />
            No envelopes yet. Hit + to create one.
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {envelopes.map(e => {
              const remaining = e.monthlyTarget - e.spentThisMonth;
              const pct = e.monthlyTarget > 0 ? Math.min(100, (e.spentThisMonth / e.monthlyTarget) * 100) : 0;
              const overspent = e.spentThisMonth > e.monthlyTarget;
              return (
                <li key={e.id} className="px-3 py-2 hover:bg-white/[0.03] group">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm text-white font-medium">{e.category}</span>
                    {overspent && <span className="text-[10px] text-red-300 inline-flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" /> over</span>}
                    <span className="ml-auto text-xs font-mono tabular-nums">
                      <span className={overspent ? 'text-red-300' : 'text-white'}>${e.spentThisMonth.toFixed(0)}</span>
                      <span className="text-gray-400"> / ${e.monthlyTarget.toFixed(0)}</span>
                    </span>
                    <button
                      onClick={() => remove(e.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={cn('h-full transition-all', overspent ? 'bg-red-500' : pct > 80 ? 'bg-yellow-400' : 'bg-cyan-500')}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[10px] text-gray-400">
                    <span>Remaining: <span className={overspent ? 'text-red-300' : 'text-cyan-300'}>${remaining.toFixed(0)}</span></span>
                    {e.rolloverEnabled && <span>Rolls over · ${e.currentBalance.toFixed(0)} carry</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <footer className="px-3 py-2 border-t border-white/10 text-[10px] text-gray-400 flex items-center justify-between">
        <span>Total spent: <span className="text-white tabular-nums">${totalSpent.toFixed(0)}</span></span>
        <span>Savings rate: <span className={cn('tabular-nums', income > 0 ? 'text-green-400' : 'text-gray-400')}>{income > 0 ? `${(((income - totalSpent) / income) * 100).toFixed(0)}%` : '—'}</span></span>
      </footer>
    </div>
  );
}

export default EnvelopeBudget;
