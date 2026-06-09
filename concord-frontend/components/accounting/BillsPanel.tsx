'use client';

import { useCallback, useEffect, useState } from 'react';
import { Receipt, Loader2, Plus, Trash2, CheckCircle, AlertCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Account { id: string; code: string; name: string; category: string; archived: boolean }
interface Vendor { id: string; name: string; defaultExpenseAccountId: string }
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
            <select value={draft.vendorId} onChange={e => {
              const v = vendors.find(x => x.id === e.target.value);
              setDraft({ ...draft, vendorId: e.target.value, expenseAccountId: v?.defaultExpenseAccountId || draft.expenseAccountId });
            }} className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="">Vendor *</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
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
