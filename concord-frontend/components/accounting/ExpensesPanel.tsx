'use client';

import { useEffect, useRef, useState } from 'react';
import { Receipt, Loader2, Plus, Paperclip, Sparkles } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Account { id: string; code: string; name: string; category: string; archived: boolean }
interface Expense {
  id: string; number: string; date: string; vendor: string; accountId: string;
  amount: number; memo: string; receiptUrl: string;
}
interface VendorSuggestion {
  matched: boolean;
  vendorId?: string;
  vendorName?: string;
  score?: number;
  suggestedNewVendor?: string;
}

export function ExpensesPanel() {
  const [list, setList] = useState<Expense[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ accountId: '', amount: '', vendor: '', memo: '', date: '', receiptUrl: '' });
  const [vendorHint, setVendorHint] = useState<VendorSuggestion | null>(null);
  const [vendorHintLoading, setVendorHintLoading] = useState(false);
  const vendorHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { refresh(); }, []);

  // AI vendor match — as the user describes the expense (memo), suggest a
  // matching existing vendor or a clean name for a new one. Debounced;
  // never overwrites the vendor field — the user clicks "Use" to accept.
  useEffect(() => {
    if (vendorHintTimer.current) clearTimeout(vendorHintTimer.current);
    const desc = draft.memo.trim();
    if (!creating || draft.vendor.trim() || desc.length < 4) { setVendorHint(null); return; }
    vendorHintTimer.current = setTimeout(async () => {
      setVendorHintLoading(true);
      try {
        const r = await lensRun({ domain: 'accounting', action: 'ai-suggest-vendor', input: { description: desc } });
        const res = r.data?.result as VendorSuggestion | undefined;
        if (res) setVendorHint(res);
      } catch (err) { console.error('[Expenses] vendor suggest failed', err); }
      finally { setVendorHintLoading(false); }
    }, 500);
    return () => { if (vendorHintTimer.current) clearTimeout(vendorHintTimer.current); };
  }, [draft.memo, draft.vendor, creating]);

  async function refresh() {
    setLoading(true);
    try {
      const [e, a] = await Promise.all([
        lensRun({ domain: 'accounting', action: 'expenses-list', input: {} }),
        lensRun({ domain: 'accounting', action: 'coa-list', input: {} }),
      ]);
      setList((e.data?.result?.expenses || []) as Expense[]);
      setAccounts((a.data?.result?.accounts || []) as Account[]);
    } catch (err) { console.error('[Expenses] refresh failed', err); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.accountId || !draft.amount) return;
    try {
      await lensRun({
        domain: 'accounting', action: 'expenses-create',
        input: { ...draft, amount: Number(draft.amount) },
      });
      setDraft({ accountId: '', amount: '', vendor: '', memo: '', date: '', receiptUrl: '' });
      setVendorHint(null);
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
        <span className="text-[10px] text-gray-400">{list.length}</span>
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

          {!draft.vendor.trim() && (vendorHintLoading || vendorHint) && (
            <div className="col-span-12 flex items-center gap-2 text-[10px] text-gray-400 -mt-1">
              <Sparkles className="w-3 h-3 text-cyan-400 flex-shrink-0" />
              {vendorHintLoading ? (
                <span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Matching vendor…</span>
              ) : vendorHint?.matched ? (
                <>
                  <span>Looks like <span className="text-white">{vendorHint.vendorName}</span> ({Math.round((vendorHint.score || 0) * 100)}% match)</span>
                  <button type="button" onClick={() => { setDraft(d => ({ ...d, vendor: vendorHint.vendorName || '' })); setVendorHint(null); }} className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25">Use</button>
                </>
              ) : vendorHint?.suggestedNewVendor ? (
                <>
                  <span>New vendor? <span className="text-white">{vendorHint.suggestedNewVendor}</span></span>
                  <button type="button" onClick={() => { setDraft(d => ({ ...d, vendor: vendorHint.suggestedNewVendor || '' })); setVendorHint(null); }} className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25">Use</button>
                </>
              ) : null}
            </div>
          )}

          <button onClick={create} className="col-span-12 px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Post expense (auto Dr Expense / Cr Cash)</button>
        </div>
      )}

      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : list.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Receipt className="w-6 h-6 mx-auto mb-2 opacity-30" />No expenses logged.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map(e => {
              const a = accountById.get(e.accountId);
              return (
                <li key={e.id} className="px-4 py-2 hover:bg-white/[0.02] flex items-center gap-3">
                  <span className="font-mono text-[10px] text-gray-400 w-20">{e.date}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white flex items-center gap-2">
                      {e.vendor && <span>{e.vendor}</span>}
                      <span className="text-[10px] text-gray-400">{a ? `${a.code} ${a.name}` : ''}</span>
                    </div>
                    {e.memo && <div className="text-[10px] text-gray-400 truncate">{e.memo}</div>}
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
