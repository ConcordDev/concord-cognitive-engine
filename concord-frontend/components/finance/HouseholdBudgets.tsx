'use client';

import { useCallback, useEffect, useState } from 'react';
import { Users, Plus, UserPlus, UserMinus, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Member {
  userId: string;
  role: string;
  joinedAt: string;
}
interface Contribution {
  memberId: string;
  amount: number;
  note: string;
  at: string;
}
interface SharedBudget {
  id: string;
  category: string;
  monthlyTarget: number;
  spent: number;
  contributions: Contribution[];
  createdBy: string;
}
interface Household {
  id: string;
  name: string;
  ownerId: string;
  members: Member[];
  sharedBudgets: SharedBudget[];
}

export function HouseholdBudgets() {
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);
  const [hhName, setHhName] = useState('');
  const [memberId, setMemberId] = useState('');
  const [budgetForm, setBudgetForm] = useState({ category: '', monthlyTarget: '' });
  const [spendFor, setSpendFor] = useState<string | null>(null);
  const [spendForm, setSpendForm] = useState({ amount: '', note: '' });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('finance', 'household-get', {});
      if (r.data?.ok) setHousehold((r.data.result as { household: Household | null }).household);
    } catch (e) { console.error('[Household] get failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function createHousehold() {
    if (!hhName.trim()) return;
    setBusy(true);
    try {
      const r = await lensRun('finance', 'household-create', { name: hhName.trim() });
      if (r.data?.ok) { setHhName(''); await refresh(); }
    } catch (e) { console.error('[Household] create failed', e); }
    finally { setBusy(false); }
  }

  async function addMember() {
    if (!memberId.trim()) return;
    setBusy(true);
    try {
      const r = await lensRun('finance', 'household-add-member', { memberId: memberId.trim() });
      if (r.data?.ok) { setMemberId(''); await refresh(); }
    } catch (e) { console.error('[Household] add member failed', e); }
    finally { setBusy(false); }
  }

  async function removeMember(id: string) {
    try {
      const r = await lensRun('finance', 'household-remove-member', { memberId: id });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[Household] remove member failed', e); }
  }

  async function createBudget() {
    const target = Number(budgetForm.monthlyTarget);
    if (!budgetForm.category.trim() || !Number.isFinite(target) || target <= 0) return;
    setBusy(true);
    try {
      const r = await lensRun('finance', 'household-budget-create', {
        category: budgetForm.category.trim(),
        monthlyTarget: target,
      });
      if (r.data?.ok) { setBudgetForm({ category: '', monthlyTarget: '' }); await refresh(); }
    } catch (e) { console.error('[Household] budget create failed', e); }
    finally { setBusy(false); }
  }

  async function recordSpend(budgetId: string) {
    const amount = Number(spendForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setBusy(true);
    try {
      const r = await lensRun('finance', 'household-budget-spend', {
        budgetId,
        amount,
        note: spendForm.note,
      });
      if (r.data?.ok) {
        setSpendForm({ amount: '', note: '' });
        setSpendFor(null);
        await refresh();
      }
    } catch (e) { console.error('[Household] spend failed', e); }
    finally { setBusy(false); }
  }

  if (loading) {
    return (
      <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg flex items-center justify-center py-10 text-xs text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading household…
      </div>
    );
  }

  if (!household) {
    return (
      <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
        <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
          <Users className="w-4 h-4 text-cyan-400" />
          <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
            Household budgets
          </span>
        </header>
        <div className="p-6 text-center space-y-3">
          <Users className="w-8 h-8 mx-auto opacity-30" />
          <p className="text-xs text-gray-400">
            No household yet. Create one to share budgets with a partner or family.
          </p>
          <div className="flex items-center gap-2 max-w-sm mx-auto">
            <input
              value={hhName}
              onChange={(e) => setHhName(e.target.value)}
              placeholder="Household name"
              className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            />
            <button
              onClick={createHousehold}
              disabled={busy || !hhName.trim()}
              className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Users className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          {household.name}
        </span>
        <span className="ml-auto text-[10px] text-gray-400">
          {household.members.length} member(s) · {household.sharedBudgets.length} shared budget(s)
        </span>
      </header>

      {/* Members */}
      <div className="px-4 py-3 border-b border-white/10">
        <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Members</div>
        <ul className="space-y-1">
          {household.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-2 text-xs group">
              <span className="w-6 h-6 rounded-full bg-cyan-500/15 text-cyan-300 flex items-center justify-center text-[10px] font-bold">
                {m.userId.slice(0, 2).toUpperCase()}
              </span>
              <span className="text-white truncate flex-1">{m.userId}</span>
              <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', m.role === 'owner' ? 'bg-amber-500/15 text-amber-300' : 'bg-zinc-500/15 text-zinc-300')}>
                {m.role}
              </span>
              {m.role !== 'owner' && (
                <button
                  onClick={() => removeMember(m.userId)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-rose-400"
                  aria-label="Remove member"
                >
                  <UserMinus className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 mt-2">
          <input
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            placeholder="Member user ID"
            className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <button
            onClick={addMember}
            disabled={busy || !memberId.trim()}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-white/5 text-gray-300 hover:text-white disabled:opacity-50"
          >
            <UserPlus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </div>

      {/* Shared budgets */}
      <div className="px-4 py-3">
        <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Shared budgets</div>
        {household.sharedBudgets.length === 0 ? (
          <p className="text-xs text-gray-400 py-2">No shared budgets yet.</p>
        ) : (
          <ul className="space-y-2">
            {household.sharedBudgets.map((b) => {
              const pct = b.monthlyTarget > 0 ? Math.min(100, (b.spent / b.monthlyTarget) * 100) : 0;
              const over = b.spent > b.monthlyTarget;
              return (
                <li key={b.id} className="rounded-md bg-white/[0.03] border border-white/5 p-2.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-sm text-white font-medium flex-1">{b.category}</span>
                    <span className={cn('font-mono tabular-nums', over ? 'text-rose-300' : 'text-white')}>
                      ${b.spent.toLocaleString()} / ${b.monthlyTarget.toLocaleString()}
                    </span>
                    <button
                      onClick={() => setSpendFor((cur) => (cur === b.id ? null : b.id))}
                      className="px-2 py-0.5 text-[10px] rounded bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"
                    >
                      Log spend
                    </button>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mt-1.5">
                    <div
                      className={cn('h-full rounded-full', over ? 'bg-rose-500/70' : pct > 85 ? 'bg-amber-500/70' : 'bg-emerald-500/70')}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {b.contributions.length > 0 && (
                    <div className="text-[10px] text-gray-400 mt-1">
                      {b.contributions.length} contribution(s) from{' '}
                      {new Set(b.contributions.map((c) => c.memberId)).size} member(s)
                    </div>
                  )}
                  {spendFor === b.id && (
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="number"
                        value={spendForm.amount}
                        onChange={(e) => setSpendForm({ ...spendForm, amount: e.target.value })}
                        placeholder="Amount"
                        className="w-24 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                      />
                      <input
                        value={spendForm.note}
                        onChange={(e) => setSpendForm({ ...spendForm, note: e.target.value })}
                        placeholder="Note (optional)"
                        className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                      />
                      <button
                        onClick={() => recordSpend(b.id)}
                        disabled={busy}
                        className="px-2 py-1 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50"
                      >
                        Log
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-center gap-2 mt-2">
          <input
            value={budgetForm.category}
            onChange={(e) => setBudgetForm({ ...budgetForm, category: e.target.value })}
            placeholder="Category"
            className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <input
            type="number"
            value={budgetForm.monthlyTarget}
            onChange={(e) => setBudgetForm({ ...budgetForm, monthlyTarget: e.target.value })}
            placeholder="Monthly target"
            className="w-32 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <button
            onClick={createBudget}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-white/5 text-gray-300 hover:text-white disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Budget
          </button>
        </div>
      </div>
    </div>
  );
}

export default HouseholdBudgets;
