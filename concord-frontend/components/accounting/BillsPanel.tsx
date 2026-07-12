'use client';

import { useCallback, useEffect, useState } from 'react';
import { Receipt, Loader2, Plus, Trash2, CheckCircle, AlertCircle, Sparkles, Truck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Account { id: string; code: string; name: string; category: string; archived: boolean }
interface Vendor { id: string; name: string; defaultExpenseAccountId: string }
// Real shape of the `accounting.ai-suggest-vendor` macro's result
// (server/domains/accounting.js:2244) — token-overlap match against
// existing vendors, or a suggested new-vendor name extracted from the
// free text. `score` is the macro's own hits/tokens ratio, never invented
// client-side.
interface VendorSuggestion {
  matched: boolean;
  vendorId?: string;
  vendorName?: string;
  score?: number;
  suggestedNewVendor?: string;
}
interface Bill {
  id: string; number: string;
  vendorId: string; vendorName: string;
  total: number; expenseAccountId: string;
  memo: string; status: 'open' | 'paid';
  issuedAt: string; dueAt: string; paidAt: string | null;
}

interface AgingBucket { key: string; label: string; total: number; bills: Array<Bill & { daysPastDue: number }> }

export function BillsPanel() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [aging, setAging] = useState<{ buckets: AgingBucket[]; totalOpen: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open' | 'paid'>('open');
  const [draft, setDraft] = useState({ vendorId: '', total: '', expenseAccountId: '', memo: '', issuedAt: '', dueAt: '' });

  // Vendor combobox — free-text entry backed by ai-suggest-vendor instead
  // of the old plain <select> of existing vendors only.
  const [vendorQuery, setVendorQuery] = useState('');
  const [vendorSuggestion, setVendorSuggestion] = useState<VendorSuggestion | null>(null);
  const [vendorDropdownOpen, setVendorDropdownOpen] = useState(false);
  const [suggestingVendor, setSuggestingVendor] = useState(false);
  const [creatingVendor, setCreatingVendor] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [b, v, a, ag] = await Promise.all([
        lensRun({ domain: 'accounting', action: 'bills-list', input: { status: filter } }),
        lensRun({ domain: 'accounting', action: 'vendors-list', input: {} }),
        lensRun({ domain: 'accounting', action: 'coa-list', input: {} }),
        lensRun({ domain: 'accounting', action: 'aging-ap', input: {} }),
      ]);
      setBills((b.data?.result?.bills || []) as Bill[]);
      setVendors((v.data?.result?.vendors || []) as Vendor[]);
      setAccounts((a.data?.result?.accounts || []) as Account[]);
      setAging({
        buckets: (ag.data?.result?.buckets || []) as AgingBucket[],
        totalOpen: ag.data?.result?.totalOpen || 0,
      });
    } catch (e) { console.error('[Bills] refresh failed', e); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Debounced ai-suggest-vendor lookup as the user types a vendor name that
  // doesn't already match a picked vendor. Real macro call, real score —
  // no fabricated confidence, no fabricated candidate list.
  useEffect(() => {
    const q = vendorQuery.trim();
    if (draft.vendorId || q.length < 2) { setVendorSuggestion(null); setSuggestingVendor(false); return; }
    setSuggestingVendor(true);
    const t = setTimeout(async () => {
      try {
        const r = await lensRun({ domain: 'accounting', action: 'ai-suggest-vendor', input: { description: q } });
        setVendorSuggestion(r.data?.ok && r.data.result ? (r.data.result as unknown as VendorSuggestion) : null);
      } catch (e) { console.error('[Bills] ai-suggest-vendor failed', e); setVendorSuggestion(null); }
      finally { setSuggestingVendor(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [vendorQuery, draft.vendorId]);

  function selectVendor(v: Vendor) {
    setDraft(d => ({ ...d, vendorId: v.id, expenseAccountId: v.defaultExpenseAccountId || d.expenseAccountId }));
    setVendorQuery(v.name);
    setVendorSuggestion(null);
    setVendorDropdownOpen(false);
  }

  async function createVendorFromSuggestion() {
    const name = vendorSuggestion?.suggestedNewVendor?.trim();
    if (!name || creatingVendor) return;
    setCreatingVendor(true);
    try {
      const r = await lensRun({ domain: 'accounting', action: 'vendors-create', input: { name } });
      const v = r.data?.result?.vendor as Vendor | undefined;
      if (v) { setVendors(prev => [...prev, v]); selectVendor(v); }
    } catch (e) { console.error('[Bills] vendor create-from-suggestion failed', e); }
    finally { setCreatingVendor(false); }
  }

  const filteredVendors = (vendorQuery.trim()
    ? vendors.filter(v => v.name.toLowerCase().includes(vendorQuery.trim().toLowerCase()))
    : vendors
  ).slice(0, 6);

  async function create() {
    if (!draft.vendorId || !draft.total) return;
    const vendor = vendors.find(v => v.id === draft.vendorId);
    const expenseAccountId = draft.expenseAccountId || vendor?.defaultExpenseAccountId || '';
    if (!expenseAccountId) { alert('Pick an expense account'); return; }
    try {
      await lensRun({
        domain: 'accounting', action: 'bills-create',
        input: { ...draft, total: Number(draft.total), expenseAccountId },
      });
      setDraft({ vendorId: '', total: '', expenseAccountId: '', memo: '', issuedAt: '', dueAt: '' });
      setVendorQuery('');
      setVendorSuggestion(null);
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Bills] create failed', e); }
  }

  async function pay(id: string) {
    try {
      await lensRun({ domain: 'accounting', action: 'bills-pay', input: { id } });
      await refresh();
    } catch (e) { console.error('[Bills] pay failed', e); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this bill and reverse its journal entries?')) return;
    try {
      await lensRun({ domain: 'accounting', action: 'bills-delete', input: { id } });
      await refresh();
    } catch (e) { console.error('[Bills] delete failed', e); }
  }

  const expenseAccounts = accounts.filter(a => !a.archived && (a.category === 'expense' || a.category === 'cogs'));

  return (
    <div className="space-y-3">
      {/* Aging summary */}
      {aging && aging.totalOpen > 0 && (
        <div className="bg-[#0d1117] border border-emerald-500/15 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">A/P aging · ${aging.totalOpen.toFixed(0)} open</div>
          <div className="grid grid-cols-4 gap-2">
            {aging.buckets.map(b => (
              <div key={b.key} className="rounded border border-white/10 bg-black/30 p-2">
                <div className="text-[10px] text-gray-400">{b.label}</div>
                <div className="text-lg font-mono text-amber-200 mt-0.5">${b.total.toFixed(0)}</div>
                <div className="text-[9px] text-gray-400">{b.bills.length} bill{b.bills.length === 1 ? '' : 's'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-[#0d1117] border border-emerald-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Receipt className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold text-gray-200">Bills</span>
          <span className="text-[10px] text-gray-400">{bills.length}</span>
          <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} className="ml-2 text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="open">Open</option>
            <option value="paid">Paid</option>
            <option value="all">All</option>
          </select>
          <button onClick={() => setCreating(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-emerald-500 text-black font-semibold hover:bg-emerald-400 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />New bill
          </button>
        </header>

        {creating && (
          <div className="px-4 py-3 border-b border-white/10 grid grid-cols-12 gap-2">
            <div className="col-span-4 relative">
              <input
                value={vendorQuery}
                onChange={e => { setVendorQuery(e.target.value); setDraft(d => ({ ...d, vendorId: '' })); setVendorDropdownOpen(true); }}
                onFocus={() => setVendorDropdownOpen(true)}
                onBlur={() => setTimeout(() => setVendorDropdownOpen(false), 150)}
                placeholder="Vendor * (type to search or add)"
                className={cn(
                  'w-full px-2 py-1.5 pr-6 text-xs bg-lattice-deep border rounded text-white',
                  draft.vendorId ? 'border-emerald-500/40' : 'border-lattice-border',
                )}
              />
              {draft.vendorId && (
                <CheckCircle className="w-3 h-3 text-emerald-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              )}
              {vendorDropdownOpen && (filteredVendors.length > 0 || suggestingVendor || vendorSuggestion) && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[#0d1117] border border-emerald-500/20 rounded shadow-lg max-h-48 overflow-y-auto">
                  {filteredVendors.map(v => (
                    <button
                      key={v.id}
                      type="button"
                      onMouseDown={() => selectVendor(v)}
                      className="w-full text-left px-2 py-1.5 text-xs text-gray-200 hover:bg-emerald-500/10 flex items-center gap-1.5"
                    >
                      <Truck className="w-3 h-3 text-gray-500 flex-shrink-0" />{v.name}
                    </button>
                  ))}
                  {suggestingVendor && (
                    <div className="px-2 py-1.5 text-[10px] text-gray-400 flex items-center gap-1.5 border-t border-white/5">
                      <Loader2 className="w-3 h-3 animate-spin" />Checking AI match…
                    </div>
                  )}
                  {!suggestingVendor && vendorSuggestion?.matched && vendorSuggestion.vendorId && !filteredVendors.some(v => v.id === vendorSuggestion!.vendorId) && (
                    <button
                      type="button"
                      onMouseDown={() => selectVendor({
                        id: vendorSuggestion!.vendorId!,
                        name: vendorSuggestion!.vendorName || vendorQuery,
                        defaultExpenseAccountId: vendors.find(v => v.id === vendorSuggestion!.vendorId)?.defaultExpenseAccountId || '',
                      })}
                      className="w-full text-left px-2 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10 flex items-center gap-1.5 border-t border-white/5"
                    >
                      <Sparkles className="w-3 h-3 flex-shrink-0" />AI match: {vendorSuggestion.vendorName} · {Math.round((vendorSuggestion.score ?? 0) * 100)}%
                    </button>
                  )}
                  {!suggestingVendor && vendorSuggestion && !vendorSuggestion.matched && vendorSuggestion.suggestedNewVendor && (
                    <button
                      type="button"
                      disabled={creatingVendor}
                      onMouseDown={createVendorFromSuggestion}
                      className="w-full text-left px-2 py-1.5 text-xs text-amber-300 hover:bg-amber-500/10 flex items-center gap-1.5 border-t border-white/5 disabled:opacity-50"
                    >
                      {creatingVendor ? <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" /> : <Plus className="w-3 h-3 flex-shrink-0" />}
                      Create vendor &quot;{vendorSuggestion.suggestedNewVendor}&quot;
                    </button>
                  )}
                </div>
              )}
            </div>
            <input type="number" step="0.01" value={draft.total} onChange={e => setDraft({ ...draft, total: e.target.value })} placeholder="Total *" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <select value={draft.expenseAccountId} onChange={e => setDraft({ ...draft, expenseAccountId: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="">Expense account…</option>
              {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
            </select>
            <input type="date" value={draft.issuedAt} onChange={e => setDraft({ ...draft, issuedAt: e.target.value })} placeholder="Issued" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <input value={draft.memo} onChange={e => setDraft({ ...draft, memo: e.target.value })} placeholder="Memo" className="col-span-9 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="date" value={draft.dueAt} onChange={e => setDraft({ ...draft, dueAt: e.target.value })} placeholder="Due" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <button onClick={create} className="col-span-12 px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Post bill (auto-creates JE: Dr Expense / Cr A/P)</button>
          </div>
        )}

        <div className="max-h-[28rem] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
          ) : bills.length === 0 ? (
            <div className="px-3 py-10 text-center text-xs text-gray-400"><Receipt className="w-6 h-6 mx-auto mb-2 opacity-30" />No bills in this view.</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {bills.map(b => {
                const today = new Date().toISOString().slice(0, 10);
                const overdue = b.status === 'open' && b.dueAt < today;
                return (
                  <li key={b.id} className="px-4 py-2.5 hover:bg-white/[0.02] group flex items-center gap-3">
                    <Receipt className={cn('w-3.5 h-3.5 flex-shrink-0', b.status === 'paid' ? 'text-emerald-400' : overdue ? 'text-rose-400' : 'text-amber-400')} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white flex items-center gap-2">
                        <span className="font-mono text-[10px] text-gray-400">{b.number}</span>
                        <span>{b.vendorName}</span>
                        {overdue && <span className="inline-flex items-center gap-0.5 text-[9px] uppercase text-rose-300"><AlertCircle className="w-2.5 h-2.5" />Overdue</span>}
                      </div>
                      {b.memo && <div className="text-[11px] text-gray-400 truncate">{b.memo}</div>}
                      <div className="text-[10px] text-gray-400 flex items-center gap-3">
                        <span>Issued {b.issuedAt}</span>
                        <span>Due {b.dueAt}</span>
                        {b.paidAt && <span className="text-emerald-300">Paid {b.paidAt}</span>}
                      </div>
                    </div>
                    <div className="text-sm font-mono tabular-nums text-white w-24 text-right">${b.total.toFixed(2)}</div>
                    {b.status === 'open' ? (
                      <button onClick={() => pay(b.id)} className="px-2 py-1 text-[10px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />Pay
                      </button>
                    ) : (
                      <span className="text-[10px] text-emerald-400 inline-flex items-center gap-0.5"><CheckCircle className="w-3 h-3" />Paid</span>
                    )}
                    <button aria-label="Delete" onClick={() => remove(b.id)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-rose-500/20 text-rose-300">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default BillsPanel;
