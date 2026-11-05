'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

/** One net, from the Host budget lines. Budgeted − Actual = Net. */

const FORMULA = 'Budgeted − Actual = Net';

interface OpsEvent { id: string; name: string; }
interface CategoryRow { budgeted: number; actual: number; }
interface Summary {
  budgetedExpense: number;
  actualExpense: number;
  statedNet: number;
  formula: string;
  byCategory: Record<string, CategoryRow>;
}

async function run(action: string, input: Record<string, unknown> = {}) {
  const r = await lensRun('events', action, input);
  if (!r.data?.ok) throw new Error(r.data?.error || `${action} failed`);
  return (r.data.result || {}) as Record<string, unknown>;
}

function money(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function OperationsBudgetPanel() {
  const [events, setEvents] = useState<OpsEvent[]>([]);
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const [eventId, setEventId] = useState('');
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('venue');
  const [budgeted, setBudgeted] = useState('');
  const [actual, setActual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const listed = await run('event-list');
      const evs = ((listed.events as OpsEvent[]) || []).map((e) => ({ id: e.id, name: e.name }));
      setEvents(evs);
      setEventId((prev) => (prev && evs.some((e) => e.id === prev) ? prev : (evs[0]?.id || '')));
      const next: Record<string, Summary> = {};
      await Promise.all(evs.map(async (event) => {
        const r = await run('budget-summary', { eventId: event.id });
        next[event.id] = {
          budgetedExpense: num(r.budgetedExpense),
          actualExpense: num(r.actualExpense),
          statedNet: num(r.statedNet),
          formula: typeof r.formula === 'string' ? r.formula : FORMULA,
          byCategory: (r.byCategory as Record<string, CategoryRow>) || {},
        };
      }));
      setSummaries(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!eventId || !label.trim()) return;
    const budgetedN = Number(budgeted);
    const actualN = Number(actual);
    if (!Number.isFinite(budgetedN) || budgetedN < 0 || !Number.isFinite(actualN) || actualN < 0) {
      setError('Budgeted and actual must be numbers.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await run('budget-line-add', {
        eventId,
        label: label.trim(),
        category: category.trim() || 'misc',
        kind: 'expense',
        budgeted: budgetedN,
        actual: actualN,
      });
      setLabel('');
      setBudgeted('');
      setActual('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const totals = Object.values(summaries).reduce(
    (acc, row) => ({
      budgeted: acc.budgeted + row.budgetedExpense,
      actual: acc.actual + row.actualExpense,
      net: acc.net + row.statedNet,
    }),
    { budgeted: 0, actual: 0, net: 0 },
  );

  return (
    <div className="space-y-4">
      <p className={ds.textMuted}>{FORMULA}. Same lines as the Host console.</p>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {events.length === 0 && (
        <p className={cn(ds.textMuted, 'py-6 text-center')}>No events yet. Host one, and its budget lines show here.</p>
      )}
      {events.length > 0 && (
        <form onSubmit={(e) => { e.preventDefault(); void add(); }} className="flex flex-wrap items-center gap-2">
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100">
            {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Line" className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100" />
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100" />
          <input value={budgeted} onChange={(e) => setBudgeted(e.target.value)} placeholder="Budgeted" inputMode="decimal" className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100" />
          <input value={actual} onChange={(e) => setActual(e.target.value)} placeholder="Actual" inputMode="decimal" className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100" />
          <button type="submit" disabled={busy || !label.trim()} className={cn(ds.btnPrimary, 'text-xs')}>Add line</button>
        </form>
      )}
      {events.length > 0 && (
        <section className={ds.panel}>
          <p className="text-sm text-zinc-200">{FORMULA}</p>
          <p className="mt-1 font-mono text-sm text-zinc-100">
            {money(totals.budgeted)} − {money(totals.actual)} = {money(totals.net)}
          </p>
        </section>
      )}
      {events.map((event) => {
        const summary = summaries[event.id];
        if (!summary) return null;
        const rows = Object.entries(summary.byCategory);
        return (
          <section key={event.id} className={ds.panel}>
            <h3 className={ds.heading3}>{event.name}</h3>
            <p className="mt-1 font-mono text-xs text-zinc-300">
              {money(summary.budgetedExpense)} − {money(summary.actualExpense)} = {money(summary.statedNet)}
            </p>
            {rows.length === 0 ? (
              <p className={cn(ds.textMuted, 'mt-2')}>No budget lines yet.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-400">
                    <th className="pb-1 pr-3">Category</th>
                    <th className="pb-1 pr-3 text-right">Budgeted</th>
                    <th className="pb-1 pr-3 text-right">Actual</th>
                    <th className="pb-1 text-right">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([name, row]) => (
                    <tr key={name} className="text-zinc-200">
                      <td className="py-1 pr-3 capitalize">{name}</td>
                      <td className="py-1 pr-3 text-right font-mono text-xs">{money(row.budgeted)}</td>
                      <td className="py-1 pr-3 text-right font-mono text-xs">{money(row.actual)}</td>
                      <td className="py-1 text-right font-mono text-xs">{money(row.budgeted - row.actual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
