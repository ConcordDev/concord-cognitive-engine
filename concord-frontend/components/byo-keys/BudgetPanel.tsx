'use client';

/**
 * BudgetPanel — per-slot monthly USD / token budget caps with
 * enforcement status. Reads byo_keys.budget_status, writes via
 * byo_keys.set_budget. The cap is enforced server-side by
 * byo_keys.budget_check before any BYO inference is routed.
 */

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';

interface BudgetRow {
  slot: string;
  budget: { monthlyUsdCap: number | null; monthlyTokenCap: number | null } | null;
  spentUsd: number;
  spentTokens: number;
  usdPct: number | null;
  tokenPct: number | null;
  exceeded: boolean;
}

const SLOTS = ['conscious', 'subconscious', 'utility', 'repair', 'vision'];

export function BudgetPanel() {
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [month, setMonth] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ usd: '', tokens: '' });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await lensRun<{ month: string; slots: BudgetRow[] }>('byo_keys', 'budget_status', {});
    if (r.data?.ok && r.data.result) {
      setRows(r.data.result.slots);
      setMonth(r.data.result.month);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const rowFor = (slot: string) => rows.find((r) => r.slot === slot);

  const startEdit = (slot: string) => {
    const r = rowFor(slot);
    setEditing(slot);
    setForm({
      usd: r?.budget?.monthlyUsdCap != null ? String(r.budget.monthlyUsdCap) : '',
      tokens: r?.budget?.monthlyTokenCap != null ? String(r.budget.monthlyTokenCap) : '',
    });
  };

  const save = async (slot: string) => {
    setBusy(true);
    const usd = form.usd.trim() === '' ? null : Number(form.usd);
    const tokens = form.tokens.trim() === '' ? null : Number(form.tokens);
    await lensRun('byo_keys', 'set_budget', { slot, monthlyUsdCap: usd, monthlyTokenCap: tokens });
    setBusy(false);
    setEditing(null);
    refresh();
  };

  const clearBudget = async (slot: string) => {
    await lensRun('byo_keys', 'set_budget', { slot, monthlyUsdCap: null, monthlyTokenCap: null });
    refresh();
  };

  const bar = (pct: number | null, exceeded: boolean) => {
    if (pct == null) return null;
    const w = Math.min(100, Math.round(pct * 100));
    return (
      <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden mt-1">
        <div
          className={`h-full ${exceeded ? 'bg-red-500' : w > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${w}%` }}
        />
      </div>
    );
  };

  return (
    <section className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-zinc-100">Monthly budget caps</h2>
        {month && <span className="text-[10px] text-zinc-500 font-mono">{month}</span>}
      </div>
      <p className="text-[11px] text-zinc-500 mb-3">
        Set a hard monthly USD or token ceiling per slot. When a cap is hit, Concord stops
        routing inference through that BYO key for the rest of the month.
      </p>

      <ul className="space-y-2">
        {SLOTS.map((slot) => {
          const r = rowFor(slot);
          const isEditing = editing === slot;
          const hasBudget = !!r?.budget && (r.budget.monthlyUsdCap != null || r.budget.monthlyTokenCap != null);
          return (
            <li key={slot} className="rounded-lg bg-zinc-950 ring-1 ring-zinc-800 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-zinc-300">{slot}</span>
                    {r?.exceeded && (
                      <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-mono text-red-300">
                        cap exceeded
                      </span>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      {hasBudget ? (
                        <>
                          {r?.budget?.monthlyUsdCap != null && (
                            <span>${r.spentUsd.toFixed(2)} / ${r.budget.monthlyUsdCap} </span>
                          )}
                          {r?.budget?.monthlyTokenCap != null && (
                            <span className="ml-2">
                              {r.spentTokens.toLocaleString()} / {r.budget.monthlyTokenCap.toLocaleString()} tok
                            </span>
                          )}
                          {bar(r?.usdPct ?? r?.tokenPct ?? null, !!r?.exceeded)}
                        </>
                      ) : (
                        <span>no cap — uncapped spend</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => (isEditing ? setEditing(null) : startEdit(slot))}
                    className="px-2 py-1 rounded-md text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                  >
                    {isEditing ? 'cancel' : hasBudget ? 'edit cap' : 'set cap'}
                  </button>
                  {hasBudget && !isEditing && (
                    <button
                      onClick={() => clearBudget(slot)}
                      className="px-2 py-1 rounded-md text-[11px] bg-zinc-800 hover:bg-red-900/50 text-zinc-400"
                    >
                      clear
                    </button>
                  )}
                </div>
              </div>

              {isEditing && (
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-zinc-800 pt-3">
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">Monthly USD cap</label>
                    <input
                      type="number" min="0" step="0.01"
                      value={form.usd}
                      onChange={(e) => setForm((f) => ({ ...f, usd: e.target.value }))}
                      placeholder="(no cap)"
                      className="w-full px-2 py-1 rounded-md bg-zinc-900 text-zinc-100 text-xs ring-1 ring-zinc-700 focus:ring-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">Monthly token cap</label>
                    <input
                      type="number" min="0" step="1000"
                      value={form.tokens}
                      onChange={(e) => setForm((f) => ({ ...f, tokens: e.target.value }))}
                      placeholder="(no cap)"
                      className="w-full px-2 py-1 rounded-md bg-zinc-900 text-zinc-100 text-xs ring-1 ring-zinc-700 focus:ring-amber-500 focus:outline-none"
                    />
                  </div>
                  <div className="col-span-2">
                    <button
                      onClick={() => save(slot)}
                      disabled={busy}
                      className="px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-amber-50 text-xs font-medium disabled:opacity-50"
                    >
                      save cap
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
