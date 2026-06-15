'use client';

/**
 * BankFeedsInbox — BooksO 2026-style transaction inbox with AI bulk-suggest.
 *
 * Hero workflow:
 *   1. Click "Suggest all" → calls bank-feeds-bulk-suggest → server returns
 *      one suggestion per uncategorized txn with a confidence score.
 *   2. Header shows "N high-confidence suggestions" with one-click "Accept all".
 *   3. Each row shows the suggestion inline with a [✓ accept] [edit ▼] [skip] toolbar.
 */

import { useEffect, useState } from 'react';
import { Banknote, Loader2, Sparkles, Check, RefreshCw, Plus, Upload } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Account { id: string; code: string; name: string; category: string; archived: boolean }
interface BankTxn {
  id: string; number: string; date: string; description: string; amount: number;
  bankRef?: string; accountId: string | null; jeEntryId: string | null;
}
interface Suggestion {
  txnId: string; description: string; amount: number; date: string;
  suggestedAccountId: string; suggestedAccountName: string;
  source: 'rule' | 'brain' | 'heuristic' | string;
  confidence: number; highConfidence: boolean;
}

const HIGH_CONFIDENCE = 0.7;

export function BankFeedsInbox() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<BankTxn[]>([]);
  const [suggestions, setSuggestions] = useState<Map<string, Suggestion>>(new Map());
  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importDraft, setImportDraft] = useState({ description: '', amount: '', date: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [a, t] = await Promise.all([
        lensRun({ domain: 'accounting', action: 'coa-list', input: {} }),
        lensRun({ domain: 'accounting', action: 'bank-feeds-list', input: { status: 'uncategorized' } }),
      ]);
      setAccounts((a.data?.result?.accounts || []) as Account[]);
      setTxns((t.data?.result?.txns || []) as BankTxn[]);
    } catch (e) { console.error('[BankFeeds] refresh failed', e); }
    finally { setLoading(false); }
  }

  async function suggestAll() {
    setSuggesting(true);
    try {
      const res = await lensRun({ domain: 'accounting', action: 'bank-feeds-bulk-suggest', input: {} });
      const items = (res.data?.result?.suggestions || []) as Suggestion[];
      const map = new Map<string, Suggestion>();
      for (const s of items) map.set(s.txnId, s);
      setSuggestions(map);
    } catch (e) { console.error('[BankFeeds] bulk-suggest failed', e); }
    finally { setSuggesting(false); }
  }

  async function acceptOne(txnId: string, accountId?: string) {
    const sugg = suggestions.get(txnId);
    const pickAccountId = accountId || sugg?.suggestedAccountId;
    if (!pickAccountId) return;
    try {
      await lensRun({ domain: 'accounting', action: 'bank-feeds-categorize', input: { txnId, accountId: pickAccountId } });
      setSuggestions(prev => { const next = new Map(prev); next.delete(txnId); return next; });
      setTxns(prev => prev.filter(t => t.id !== txnId));
    } catch (e) { console.error('[BankFeeds] categorize failed', e); }
  }

  async function acceptAllHighConfidence() {
    const picks = Array.from(suggestions.values())
      .filter(s => s.highConfidence)
      .map(s => ({ txnId: s.txnId, accountId: s.suggestedAccountId }));
    if (picks.length === 0) return;
    try {
      await lensRun({ domain: 'accounting', action: 'bank-feeds-bulk-accept', input: { picks } });
      const accepted = new Set(picks.map(p => p.txnId));
      setTxns(prev => prev.filter(t => !accepted.has(t.id)));
      setSuggestions(prev => { const next = new Map(prev); for (const id of accepted) next.delete(id); return next; });
    } catch (e) { console.error('[BankFeeds] bulk-accept failed', e); }
  }

  async function importTxn() {
    if (!importDraft.description.trim() || !importDraft.amount) return;
    try {
      await lensRun({
        domain: 'accounting', action: 'bank-feeds-import',
        input: { description: importDraft.description.trim(), amount: Number(importDraft.amount), date: importDraft.date || undefined },
      });
      setImportDraft({ description: '', amount: '', date: '' });
      setImporting(false);
      await refresh();
    } catch (e) { console.error('[BankFeeds] import failed', e); }
  }

  const highCount = Array.from(suggestions.values()).filter(s => s.highConfidence).length;
  const totalSuggested = suggestions.size;

  return (
    <div className="bg-[#0d1117] border border-emerald-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Banknote className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-gray-200">Banking</span>
        <span className="text-[10px] text-gray-400">{txns.length} uncategorized</span>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setImporting(v => !v)}
            className="px-2.5 py-1 text-xs rounded border border-white/10 text-gray-300 hover:bg-white/[0.05] inline-flex items-center gap-1"
          >
            <Upload className="w-3 h-3" />Add txn
          </button>
          <button
            type="button"
            onClick={suggestAll}
            disabled={suggesting || txns.length === 0}
            className="px-2.5 py-1 text-xs rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40 inline-flex items-center gap-1"
          >
            {suggesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Suggest all
          </button>
          {highCount > 0 && (
            <button
              type="button"
              onClick={acceptAllHighConfidence}
              className="px-2.5 py-1 text-xs rounded bg-emerald-500 text-black font-semibold hover:bg-emerald-400 inline-flex items-center gap-1"
            >
              <Check className="w-3 h-3" />Accept {highCount} high-confidence
            </button>
          )}
        </div>
      </header>

      {totalSuggested > 0 && (
        <div className="px-4 py-2 bg-emerald-500/[0.04] border-b border-emerald-500/10 text-[11px] text-emerald-200 flex items-center gap-2">
          <Sparkles className="w-3 h-3" />
          {totalSuggested} suggestion{totalSuggested === 1 ? '' : 's'} ready · {highCount} high-confidence (≥{Math.round(HIGH_CONFIDENCE * 100)}%)
        </div>
      )}

      {importing && (
        <div className="px-4 py-3 border-b border-white/10 grid grid-cols-12 gap-2">
          <input
            value={importDraft.description}
            onChange={e => setImportDraft({ ...importDraft, description: e.target.value })}
            placeholder="Description (e.g. AWS USE1)"
            className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
          <input
            type="number" step="0.01"
            value={importDraft.amount}
            onChange={e => setImportDraft({ ...importDraft, amount: e.target.value })}
            placeholder="Amount (− out, + in)"
            className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
          />
          <input
            type="date"
            value={importDraft.date}
            onChange={e => setImportDraft({ ...importDraft, date: e.target.value })}
            className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
          />
          <button type="button" onClick={importTxn} className="col-span-2 px-2 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center justify-center gap-1">
            <Plus className="w-3 h-3" />Add
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : txns.length === 0 ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400"><RefreshCw className="w-6 h-6 mx-auto mb-2 opacity-30" />Inbox clear. Import a bank txn to start.</div>
      ) : (
        <ul className="divide-y divide-white/5">
          {txns.map(t => {
            const sugg = suggestions.get(t.id);
            const isDeposit = t.amount > 0;
            return (
              <li key={t.id} className="px-4 py-2.5 hover:bg-white/[0.02] group">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 font-mono w-20">{t.date}</span>
                  <span className="text-xs text-white flex-1 truncate">{t.description}</span>
                  <span className={cn('text-xs font-mono tabular-nums w-24 text-right', isDeposit ? 'text-emerald-300' : 'text-rose-300')}>
                    {isDeposit ? '+' : ''}${Math.abs(t.amount).toFixed(2)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  {sugg ? (
                    <>
                      <Sparkles className={cn('w-3 h-3 flex-shrink-0', sugg.highConfidence ? 'text-emerald-400' : 'text-amber-400')} />
                      <select
                        value={sugg.suggestedAccountId}
                        onChange={e => setSuggestions(prev => {
                          const next = new Map(prev);
                          const old = next.get(t.id)!;
                          const acct = accounts.find(a => a.id === e.target.value);
                          next.set(t.id, { ...old, suggestedAccountId: e.target.value, suggestedAccountName: acct?.name || '' });
                          return next;
                        })}
                        className="text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white max-w-[200px]"
                      >
                        {accounts
                          .filter(a => !a.archived)
                          .filter(a => isDeposit ? a.category === 'revenue' : (a.category === 'expense' || a.category === 'cogs'))
                          .map(a => (
                            <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                          ))}
                      </select>
                      <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-mono', sugg.highConfidence ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/15 text-amber-300')}>
                        {Math.round(sugg.confidence * 100)}% · {sugg.source}
                      </span>
                      <button
                        type="button"
                        onClick={() => acceptOne(t.id)}
                        className="ml-auto px-2 py-0.5 text-[10px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center gap-1"
                      >
                        <Check className="w-3 h-3" />Accept
                      </button>
                    </>
                  ) : (
                    <>
                      <select
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) acceptOne(t.id, e.target.value); }}
                        className="text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white max-w-[260px] ml-auto"
                      >
                        <option value="">Pick account…</option>
                        {accounts
                          .filter(a => !a.archived)
                          .filter(a => isDeposit ? a.category === 'revenue' : (a.category === 'expense' || a.category === 'cogs'))
                          .map(a => (
                            <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                          ))}
                      </select>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default BankFeedsInbox;
