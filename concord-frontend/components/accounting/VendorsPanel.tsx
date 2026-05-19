'use client';

import { useEffect, useState } from 'react';
import { Truck, Loader2, Plus, Trash2, Mail, Phone, Building2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Account { id: string; code: string; name: string; category: string; archived: boolean }
interface Vendor {
  id: string; number: string; name: string; email: string; phone: string;
  taxId: string; is1099: boolean; defaultExpenseAccountId: string;
  paymentTerms: 'due_on_receipt' | 'net15' | 'net30' | 'net60'; notes: string;
}

const TERMS = [
  { id: 'due_on_receipt', label: 'Due on receipt' },
  { id: 'net15', label: 'Net 15' },
  { id: 'net30', label: 'Net 30' },
  { id: 'net60', label: 'Net 60' },
] as const;

export function VendorsPanel() {
  const [list, setList] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', email: '', phone: '', taxId: '', is1099: false, defaultExpenseAccountId: '', paymentTerms: 'net30' as Vendor['paymentTerms'] });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [v, a] = await Promise.all([
        api.post('/api/lens/run', { domain: 'accounting', action: 'vendors-list', input: {} }),
        api.post('/api/lens/run', { domain: 'accounting', action: 'coa-list', input: {} }),
      ]);
      setList((v.data?.result?.vendors || []) as Vendor[]);
      setAccounts((a.data?.result?.accounts || []) as Account[]);
    } catch (e) { console.error('[Vendors] refresh failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.name.trim()) return;
    try {
      await api.post('/api/lens/run', { domain: 'accounting', action: 'vendors-create', input: draft });
      setDraft({ name: '', email: '', phone: '', taxId: '', is1099: false, defaultExpenseAccountId: '', paymentTerms: 'net30' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Vendors] create failed', e); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this vendor?')) return;
    try {
      await api.post('/api/lens/run', { domain: 'accounting', action: 'vendors-delete', input: { id } });
      setList(prev => prev.filter(v => v.id !== id));
    } catch (e) { console.error('[Vendors] delete failed', e); }
  }

  const expenseAccounts = accounts.filter(a => !a.archived && (a.category === 'expense' || a.category === 'cogs'));

  return (
    <div className="bg-[#0d1117] border border-emerald-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Truck className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-gray-200">Vendors</span>
        <span className="text-[10px] text-gray-500">{list.length} · {list.filter(v => v.is1099).length} 1099</span>
        <button
          onClick={() => setCreating(v => !v)}
          className="ml-auto px-2.5 py-1 text-xs rounded bg-emerald-500 text-black font-semibold hover:bg-emerald-400 inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />New
        </button>
      </header>

      {creating && (
        <div className="px-4 py-3 border-b border-white/10 grid grid-cols-12 gap-2">
          <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Vendor name *" className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} placeholder="Email" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} placeholder="Phone" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.taxId} onChange={e => setDraft({ ...draft, taxId: e.target.value })} placeholder="EIN / SSN" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <select value={draft.paymentTerms} onChange={e => setDraft({ ...draft, paymentTerms: e.target.value as Vendor['paymentTerms'] })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {TERMS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <select value={draft.defaultExpenseAccountId} onChange={e => setDraft({ ...draft, defaultExpenseAccountId: e.target.value })} className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="">Default expense account…</option>
            {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </select>
          <label className="col-span-2 inline-flex items-center gap-1.5 text-[11px] text-gray-300">
            <input type="checkbox" checked={draft.is1099} onChange={e => setDraft({ ...draft, is1099: e.target.checked })} className="rounded" />1099
          </label>
          <button onClick={create} className="col-span-12 px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Save vendor</button>
        </div>
      )}

      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : list.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Truck className="w-6 h-6 mx-auto mb-2 opacity-30" />No vendors yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map(v => (
              <li key={v.id} className="px-4 py-2.5 hover:bg-white/[0.02] group flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500/15 text-amber-300 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {v.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate flex items-center gap-2">
                    {v.name}
                    {v.is1099 && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">1099</span>}
                  </div>
                  <div className="text-[10px] text-gray-500 flex items-center gap-3">
                    <span className="font-mono">{v.number}</span>
                    <span>{TERMS.find(t => t.id === v.paymentTerms)?.label}</span>
                    {v.email && <span className="inline-flex items-center gap-0.5"><Mail className="w-2.5 h-2.5" />{v.email}</span>}
                    {v.phone && <span className="inline-flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" />{v.phone}</span>}
                    {v.taxId && <span className={cn('inline-flex items-center gap-0.5 font-mono', v.is1099 && 'text-amber-300')}><Building2 className="w-2.5 h-2.5" />{v.taxId}</span>}
                  </div>
                </div>
                <button onClick={() => remove(v.id)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-rose-500/20 text-rose-300" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default VendorsPanel;
