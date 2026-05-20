'use client';

/** AcBudgetsPanel — fiscal-year budgets and budget-vs-actual variance. */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Budget { id: string; name: string; fiscalYear: number; lines: Record<string, number> }
interface Account { id: string; code: string; name: string }
interface BvaRow { accountId: string; account: string; budgeted: number; actual: number; variance: number }

export function AcBudgetsPanel() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [active, setActive] = useState<string>('');
  const [bva, setBva] = useState<{ rows: BvaRow[]; totalBudgeted: number; totalActual: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', fiscalYear: String(new Date().getUTCFullYear()) });
  const [line, setLine] = useState({ accountId: '', annualAmount: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [b, c] = await Promise.all([
      lensRun({ domain: 'accounting', action: 'budget-list', input: {} }),
      lensRun({ domain: 'accounting', action: 'coa-list', input: {} }),
    ]);
    const list: Budget[] = b.data?.result?.budgets || [];
    setBudgets(list);
    setAccounts(c.data?.result?.accounts || []);
    setActive((prev) => (list.some((x) => x.id === prev) ? prev : list[0]?.id || ''));
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadBva = useCallback(async () => {
    if (!active) { setBva(null); return; }
    const r = await lensRun({ domain: 'accounting', action: 'budget-vs-actual', input: { budgetId: active } });
    setBva(r.data?.result || null);
  }, [active]);

  useEffect(() => { void loadBva(); }, [loadBva]);

  const addBudget = async () => {
    if (!form.name.trim()) return;
    await lensRun({ domain: 'accounting', action: 'budget-create', input: { name: form.name.trim(), fiscalYear: Number(form.fiscalYear) } });
    setForm({ name: '', fiscalYear: String(new Date().getUTCFullYear()) });
    await refresh();
  };
  const setBudgetLine = async () => {
    if (!active || !line.accountId) return;
    await lensRun({ domain: 'accounting', action: 'budget-set-line', input: { budgetId: active, accountId: line.accountId, annualAmount: Number(line.annualAmount) || 0 } });
    setLine({ accountId: '', annualAmount: '' });
    await loadBva();
  };

  if (loading) return <Spin />;

  return (
    <div className="space-y-4 p-1">
      <section className="bg-black/30 border border-white/10 rounded-lg p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input placeholder="Budget name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} />
          <input placeholder="Year" value={form.fiscalYear} onChange={(e) => setForm({ ...form, fiscalYear: e.target.value })}
            className="w-20 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100" />
          <button type="button" onClick={addBudget} className={btn}><Plus className="w-3.5 h-3.5" /> Budget</button>
          {budgets.length > 0 && (
            <select value={active} onChange={(e) => setActive(e.target.value)} className={inp}>
              {budgets.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.fiscalYear})</option>)}
            </select>
          )}
        </div>
      </section>

      {active && (
        <>
          <section className="bg-black/30 border border-white/10 rounded-lg p-3">
            <h3 className="text-xs font-semibold text-gray-300 mb-2">Set a budget line</h3>
            <div className="flex flex-wrap items-center gap-2">
              <select value={line.accountId} onChange={(e) => setLine({ ...line, accountId: e.target.value })} className={inp}>
                <option value="">Account…</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </select>
              <input placeholder="Annual amount" inputMode="decimal" value={line.annualAmount}
                onChange={(e) => setLine({ ...line, annualAmount: e.target.value })} className={inp} />
              <button type="button" onClick={setBudgetLine} className={btn}>Set</button>
              <button type="button" onClick={() => lensRun({ domain: 'accounting', action: 'budget-delete', input: { id: active } }).then(refresh)}
                className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /> Delete budget</button>
            </div>
          </section>

          {bva && (
            <section>
              <h3 className="text-xs font-semibold text-gray-300 mb-2">
                Budget vs actual — budgeted ${bva.totalBudgeted.toLocaleString()} · actual ${bva.totalActual.toLocaleString()}
              </h3>
              {bva.rows.length === 0 ? <Empty text="No budget lines set." /> : (
                <ul className="space-y-1">
                  {bva.rows.map((r) => (
                    <li key={r.accountId} className="flex items-center gap-2 text-xs bg-black/20 border border-white/10 rounded px-2 py-1.5">
                      <span className="flex-1 text-gray-200">{r.account}</span>
                      <span className="text-gray-500">budget ${r.budgeted.toLocaleString()}</span>
                      <span className="text-gray-300">actual ${r.actual.toLocaleString()}</span>
                      <span className={r.variance >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {r.variance >= 0 ? '+' : ''}{r.variance.toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
      {budgets.length === 0 && <Empty text="Create a budget to start." />}
    </div>
  );
}

const inp = 'bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100';
const btn = 'flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded px-3 py-1.5';
function Spin() { return <div className="flex items-center justify-center py-10 text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /></div>; }
function Empty({ text }: { text: string }) { return <p className="text-[11px] text-gray-500 italic">{text}</p>; }
