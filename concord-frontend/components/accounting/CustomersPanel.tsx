'use client';

import { useEffect, useState } from 'react';
import { Users, Loader2, Plus, Trash2, Mail, Phone, Building2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Customer {
  id: string; number: string; name: string; email: string; phone: string;
  company: string; billingAddress: string; taxId: string; notes: string;
}

export function CustomersPanel() {
  const [list, setList] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', email: '', phone: '', company: '', billingAddress: '', taxId: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'accounting', action: 'customers-list', input: {} });
      setList((r.data?.result?.customers || []) as Customer[]);
    } catch (e) { console.error('[Customers] list failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.name.trim()) return;
    try {
      await lensRun({ domain: 'accounting', action: 'customers-create', input: draft });
      setDraft({ name: '', email: '', phone: '', company: '', billingAddress: '', taxId: '' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Customers] create failed', e); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this customer?')) return;
    try {
      await lensRun({ domain: 'accounting', action: 'customers-delete', input: { id } });
      setList(prev => prev.filter(c => c.id !== id));
    } catch (e) { console.error('[Customers] delete failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Users className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-gray-200">Customers</span>
        <span className="text-[10px] text-gray-400">{list.length}</span>
        <button
          onClick={() => setCreating(v => !v)}
          className="ml-auto px-2.5 py-1 text-xs rounded bg-emerald-500 text-black font-semibold hover:bg-emerald-400 inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />New
        </button>
      </header>

      {creating && (
        <div className="px-4 py-3 border-b border-white/10 grid grid-cols-12 gap-2">
          <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Customer name *" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.company} onChange={e => setDraft({ ...draft, company: e.target.value })} placeholder="Company" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} placeholder="Email" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} placeholder="Phone" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.billingAddress} onChange={e => setDraft({ ...draft, billingAddress: e.target.value })} placeholder="Billing address" className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.taxId} onChange={e => setDraft({ ...draft, taxId: e.target.value })} placeholder="Tax ID" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <button onClick={create} className="col-span-12 px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Save customer</button>
        </div>
      )}

      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : list.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Users className="w-6 h-6 mx-auto mb-2 opacity-30" />No customers yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map(c => (
              <li key={c.id} className="px-4 py-2.5 hover:bg-white/[0.02] group flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-500/15 text-emerald-300 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {c.name.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{c.name} {c.company && <span className="text-[10px] text-gray-400">· {c.company}</span>}</div>
                  <div className="text-[10px] text-gray-400 flex items-center gap-3">
                    <span className="font-mono">{c.number}</span>
                    {c.email && <span className="inline-flex items-center gap-0.5"><Mail className="w-2.5 h-2.5" />{c.email}</span>}
                    {c.phone && <span className="inline-flex items-center gap-0.5"><Phone className="w-2.5 h-2.5" />{c.phone}</span>}
                    {c.taxId && <span className="inline-flex items-center gap-0.5"><Building2 className="w-2.5 h-2.5" />{c.taxId}</span>}
                  </div>
                </div>
                <button onClick={() => remove(c.id)} className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-rose-500/20 text-rose-300" title="Delete">
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

export default CustomersPanel;
