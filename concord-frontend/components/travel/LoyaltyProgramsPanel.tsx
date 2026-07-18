'use client';

/**
 * LoyaltyProgramsPanel — frequent-flyer / hotel loyalty account tracking
 * (TripIt Pro parity). Cloned structurally from TravelDocsPanel.tsx: a
 * per-user list with a create form up top and derived status per row.
 *
 * The one rule that matters here: an account's points balance is NEVER
 * a value this component invents or caches across renders — it always
 * comes straight from `loyalty-account-list`'s `balance` field, which
 * the backend computes live by summing the points ledger. Nothing here
 * stores or increments a local balance counter.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Award, Coins, ChevronDown, ChevronUp, Trash2, History } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface LoyaltyAccount {
  id: string;
  program: string;
  accountNumber: string | null;
  tier: string;
  notes: string | null;
  tripId: string | null;
  createdAt: string;
  balance: number;
  entries: number;
  lastActivity: string | null;
}

interface LoyaltyLogEntry {
  id: string;
  accountId: string;
  delta: number;
  kind: 'earned' | 'redeemed';
  bookingId: string | null;
  note: string | null;
  at: string;
}

const TIERS = ['none', 'basic', 'silver', 'gold', 'platinum', 'diamond'];
const TIER_COLOR: Record<string, string> = {
  none: 'text-zinc-400', basic: 'text-zinc-300', silver: 'text-slate-300',
  gold: 'text-amber-400', platinum: 'text-sky-300', diamond: 'text-fuchsia-300',
};

export function LoyaltyProgramsPanel() {
  const [accounts, setAccounts] = useState<LoyaltyAccount[]>([]);
  const [totalBalance, setTotalBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ program: '', accountNumber: '', tier: 'none', notes: '' });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [log, setLog] = useState<LoyaltyLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [entryForm, setEntryForm] = useState({ delta: '', note: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('travel', 'loyalty-account-list', {});
    const result = r.data?.result as { accounts?: LoyaltyAccount[]; totalBalance?: number } | undefined;
    setAccounts(result?.accounts || []);
    setTotalBalance(result?.totalBalance || 0);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    if (!form.program.trim()) { setError('Program name is required.'); return; }
    const r = await lensRun('travel', 'loyalty-account-add', {
      program: form.program.trim(), accountNumber: form.accountNumber.trim(),
      tier: form.tier, notes: form.notes.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ program: '', accountNumber: '', tier: 'none', notes: '' });
    setError(null);
    await refresh();
  };

  const remove = async (id: string) => {
    const r = await lensRun('travel', 'loyalty-account-remove', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Delete failed.'); return; }
    if (expandedId === id) { setExpandedId(null); setLog([]); }
    await refresh();
  };

  const loadLog = useCallback(async (accountId: string) => {
    setLogLoading(true);
    const r = await lensRun('travel', 'loyalty-points-log-list', { accountId });
    const result = r.data?.result as { entries?: LoyaltyLogEntry[] } | undefined;
    setLog(result?.entries || []);
    setLogLoading(false);
  }, []);

  const toggleExpand = async (accountId: string) => {
    if (expandedId === accountId) { setExpandedId(null); setLog([]); return; }
    setExpandedId(accountId);
    setEntryForm({ delta: '', note: '' });
    await loadLog(accountId);
  };

  const addEntry = async (accountId: string) => {
    const delta = Math.round(Number(entryForm.delta));
    if (!delta) { setError('Points delta must be a non-zero number (negative to redeem).'); return; }
    const r = await lensRun('travel', 'loyalty-points-log-add', {
      accountId, delta, note: entryForm.note.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to log points.'); return; }
    setError(null);
    setEntryForm({ delta: '', note: '' });
    await Promise.all([loadLog(accountId), refresh()]);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-xl px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Coins className="w-3.5 h-3.5 text-amber-400" /> Total points across all programs
        </div>
        <span className="text-sm font-bold text-zinc-100">{totalBalance.toLocaleString()}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Program (e.g. United MileagePlus)" value={form.program}
          onChange={(e) => setForm({ ...form, program: e.target.value })}
          className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input placeholder="Account / member number" value={form.accountNumber}
          onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
          {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input placeholder="Notes (optional)" value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={add}
          className="col-span-2 flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
          <Plus className="w-3.5 h-3.5" /> Add loyalty account
        </button>
      </div>

      {accounts.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No loyalty accounts yet. Track frequent-flyer and hotel rewards programs with a real points ledger.
        </div>
      ) : (
        <ul className="space-y-2">
          {accounts.map((a) => {
            const expanded = expandedId === a.id;
            return (
              <li key={a.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award className={cn('w-4 h-4', TIER_COLOR[a.tier] || 'text-zinc-400')} />
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{a.program}</p>
                      <p className="text-[11px] text-zinc-400">
                        <span className={cn('capitalize', TIER_COLOR[a.tier] || 'text-zinc-400')}>{a.tier}</span>
                        {a.accountNumber ? ` · ${a.accountNumber}` : ''}
                        {a.lastActivity ? ` · last activity ${new Date(a.lastActivity).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-bold text-amber-300">{a.balance.toLocaleString()}</p>
                      <p className="text-[9px] text-zinc-500 uppercase tracking-wide">{a.entries} entr{a.entries === 1 ? 'y' : 'ies'}</p>
                    </div>
                    <button type="button" aria-label={expanded ? 'Hide ledger' : 'Show ledger'}
                      onClick={() => { void toggleExpand(a.id); }}
                      className="text-zinc-400 hover:text-sky-400">
                      {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <button type="button" aria-label="Remove loyalty account" onClick={() => { void remove(a.id); }}
                      className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>

                {expanded && (
                  <div className="pl-6 space-y-2 border-t border-zinc-800 pt-2">
                    <div className="flex items-center gap-1 text-[10px] text-zinc-500 uppercase tracking-wide">
                      <History className="w-3 h-3" /> Points ledger
                    </div>
                    {logLoading ? (
                      <div className="flex items-center justify-center py-3 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
                    ) : log.length === 0 ? (
                      <p className="text-[11px] text-zinc-500 italic">No points logged yet.</p>
                    ) : (
                      <ul className="space-y-1 max-h-48 overflow-y-auto">
                        {log.map((e) => (
                          <li key={e.id} className="flex items-center justify-between text-[11px]">
                            <span className="text-zinc-400 truncate">
                              {new Date(e.at).toLocaleDateString()}{e.note ? ` — ${e.note}` : ''}
                              {e.bookingId ? ` (booking ${e.bookingId})` : ''}
                            </span>
                            <span className={cn('font-semibold shrink-0 ml-2', e.delta > 0 ? 'text-emerald-400' : 'text-rose-400')}>
                              {e.delta > 0 ? '+' : ''}{e.delta.toLocaleString()}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex gap-2">
                      <input type="number" placeholder="+earned / -redeemed" value={entryForm.delta}
                        onChange={(ev) => setEntryForm({ ...entryForm, delta: ev.target.value })}
                        className="w-32 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
                      <input placeholder="Note (e.g. flight SFO-NRT)" value={entryForm.note}
                        onChange={(ev) => setEntryForm({ ...entryForm, note: ev.target.value })}
                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
                      <button type="button" onClick={() => { void addEntry(a.id); }}
                        className="flex items-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg px-2.5 py-1.5">
                        <Plus className="w-3.5 h-3.5" /> Log
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
