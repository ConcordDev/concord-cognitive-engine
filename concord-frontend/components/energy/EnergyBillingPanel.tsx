'use client';

/**
 * EnergyBillingPanel — utility rate, monthly bill estimate and usage
 * savings goals.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Receipt, Target, Trash2, TrendingUp } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Bill {
  month: string; consumedKwh: number; solarKwh: number; netKwh: number;
  ratePerKwh: number; estimatedBill: number; solarSavings: number;
}
interface Goal { id: string; label: string; targetKwh: number; period: string; usedKwh: number; pct: number; overBudget: boolean }
interface Projection {
  hasData: boolean;
  isCurrentMonth?: boolean;
  loggedKwh?: number;
  distinctDays?: number;
  daysInMonth?: number;
  dailyAvgKwh?: number;
  projectedKwh?: number;
  projectedNetKwh?: number;
  billSoFar?: number;
  projectedBill?: number;
  confidence?: string;
}

export function EnergyBillingPanel({ onChange }: { onChange: () => void }) {
  const [rate, setRate] = useState<{ ratePerKwh: number; utility: string | null } | null>(null);
  const [isDefaultRate, setIsDefaultRate] = useState(true);
  const [bill, setBill] = useState<Bill | null>(null);
  const [projection, setProjection] = useState<Projection | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rateForm, setRateForm] = useState({ ratePerKwh: '', utility: '' });
  const [goalForm, setGoalForm] = useState({ label: '', targetKwh: '', period: 'month' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [r, b, p, g] = await Promise.all([
      lensRun('energy', 'rate-get', {}),
      lensRun('energy', 'bill-estimate', {}),
      lensRun('energy', 'cost-projection', {}),
      lensRun('energy', 'goal-list', {}),
    ]);
    setRate(r.data?.result?.rate || null);
    setIsDefaultRate(!!r.data?.result?.isDefault);
    setBill((b.data?.result as Bill | null) || null);
    setProjection((p.data?.result as Projection | null) || null);
    setGoals(g.data?.result?.goals || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveRate = async () => {
    if (!(Number(rateForm.ratePerKwh) > 0)) { setError('Enter a rate greater than zero.'); return; }
    const r = await lensRun('energy', 'rate-set', { ratePerKwh: Number(rateForm.ratePerKwh), utility: rateForm.utility.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setRateForm({ ratePerKwh: '', utility: '' }); setError(null);
    await refresh();
  };
  const addGoal = async () => {
    if (!(Number(goalForm.targetKwh) > 0)) { setError('Enter a target greater than zero.'); return; }
    const r = await lensRun('energy', 'goal-set', {
      label: goalForm.label.trim(), targetKwh: Number(goalForm.targetKwh), period: goalForm.period,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setGoalForm({ label: '', targetKwh: '', period: 'month' }); setError(null);
    await refresh();
  };
  const delGoal = async (id: string) => { await lensRun('energy', 'goal-delete', { id }); await refresh(); };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Rate */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Utility rate</h3>
        <p className="text-[11px] text-zinc-400 mb-2">
          Current: <span className="text-zinc-200">${rate?.ratePerKwh}/kWh</span>
          {rate?.utility ? ` · ${rate.utility}` : ''}{isDefaultRate ? ' (default — set yours below)' : ''}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <input placeholder="$/kWh" inputMode="decimal" value={rateForm.ratePerKwh} onChange={(e) => setRateForm({ ...rateForm, ratePerKwh: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Utility" value={rateForm.utility} onChange={(e) => setRateForm({ ...rateForm, utility: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={saveRate}
            className="bg-lime-600 hover:bg-lime-500 text-white text-xs font-medium rounded-lg">Save rate</button>
        </div>
      </section>

      {/* Bill estimate */}
      {bill && (
        <section>
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <Receipt className="w-3.5 h-3.5 text-lime-400" /> This month&apos;s estimate
          </h3>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
            <p className="text-2xl font-bold text-zinc-100">${bill.estimatedBill}</p>
            <p className="text-[11px] text-zinc-400">
              {bill.netKwh} net kWh ({bill.consumedKwh} used − {bill.solarKwh} solar) at ${bill.ratePerKwh}/kWh
            </p>
            {bill.solarSavings > 0 && (
              <p className="text-[11px] text-emerald-400 mt-0.5">Solar saved ${bill.solarSavings} this month.</p>
            )}
          </div>
        </section>
      )}

      {/* Cost projection */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-lime-400" /> Month-end projection
        </h3>
        {!projection || !projection.hasData ? (
          <p className="text-[11px] text-zinc-400 italic">
            Log readings this month to project the full bill.
          </p>
        ) : (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold text-lime-400">${projection.projectedBill}</p>
              <span className="text-[10px] text-zinc-400 uppercase">projected bill</span>
            </div>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              ${projection.billSoFar} so far · {projection.loggedKwh} kWh over {projection.distinctDays} day(s)
              · ~{projection.dailyAvgKwh} kWh/day
            </p>
            <p className="text-[11px] text-zinc-400">
              Projected {projection.projectedKwh} kWh ({projection.projectedNetKwh} net) over {projection.daysInMonth} days.
            </p>
            <span className={cn('inline-block mt-1.5 text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wide',
              projection.confidence === 'high' ? 'bg-emerald-950/60 text-emerald-300'
                : projection.confidence === 'medium' ? 'bg-amber-950/60 text-amber-300'
                  : 'bg-zinc-800 text-zinc-400')}>
              {projection.confidence} confidence
            </span>
          </div>
        )}
      </section>

      {/* Goals */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Target className="w-3.5 h-3.5 text-lime-400" /> Savings goals
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Label" value={goalForm.label} onChange={(e) => setGoalForm({ ...goalForm, label: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Target kWh" inputMode="decimal" value={goalForm.targetKwh} onChange={(e) => setGoalForm({ ...goalForm, targetKwh: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={goalForm.period} onChange={(e) => setGoalForm({ ...goalForm, period: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['week', 'month'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button type="button" onClick={addGoal}
            className="flex items-center justify-center gap-1 bg-lime-600 hover:bg-lime-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {goals.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No savings goals.</p>
        ) : (
          <ul className="space-y-2">
            {goals.map((g) => (
              <li key={g.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-200">{g.label} · {g.targetKwh} kWh / {g.period}</span>
                  <button aria-label="Delete" type="button" onClick={() => delGoal(g.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className={cn('h-full rounded-full', g.overBudget ? 'bg-rose-500' : 'bg-lime-500')}
                    style={{ width: `${Math.min(100, g.pct)}%` }} />
                </div>
                <p className="text-[10px] text-zinc-400 mt-1">
                  {g.usedKwh} / {g.targetKwh} kWh ({g.pct}%){g.overBudget ? ' · over budget' : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
