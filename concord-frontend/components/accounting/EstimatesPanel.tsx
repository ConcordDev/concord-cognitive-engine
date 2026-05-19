'use client';

import { useEffect, useState } from 'react';
import { ScrollText, Loader2, Plus, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Estimate {
  id: string; number: string;
  customerName: string; customerId: string | null;
  total: number;
  status: 'pending' | 'accepted' | 'declined';
  issuedAt: string; expiresAt: string; memo: string;
  convertedInvoiceId: string | null;
}

export function EstimatesPanel() {
  const [list, setList] = useState<Estimate[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ customerName: '', total: '', memo: '', expiresAt: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.post('/api/lens/run', { domain: 'accounting', action: 'estimates-list', input: {} });
      setList((r.data?.result?.estimates || []) as Estimate[]);
    } catch (e) { console.error('[Estimates] list failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.customerName.trim() || !draft.total) return;
    try {
      await api.post('/api/lens/run', { domain: 'accounting', action: 'estimates-create', input: { ...draft, total: Number(draft.total) } });
      setDraft({ customerName: '', total: '', memo: '', expiresAt: '' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Estimates] create failed', e); }
  }

  async function convert(id: string) {
    try {
      const r = await api.post('/api/lens/run', { domain: 'accounting', action: 'estimates-convert', input: { id } });
      if (r.data?.ok === false) alert(r.data?.error);
      await refresh();
    } catch (e) { console.error('[Estimates] convert failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <ScrollText className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-gray-200">Estimates</span>
        <span className="text-[10px] text-gray-500">{list.length}</span>
        <button onClick={() => setCreating(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-emerald-500 text-black font-semibold hover:bg-emerald-400 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />New
        </button>
      </header>

      {creating && (
        <div className="px-4 py-3 border-b border-white/10 grid grid-cols-12 gap-2">
          <input value={draft.customerName} onChange={e => setDraft({ ...draft, customerName: e.target.value })} placeholder="Customer name *" className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" step="0.01" value={draft.total} onChange={e => setDraft({ ...draft, total: e.target.value })} placeholder="Total *" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input type="date" value={draft.expiresAt} onChange={e => setDraft({ ...draft, expiresAt: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <button onClick={create} className="col-span-2 px-2 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Save</button>
          <input value={draft.memo} onChange={e => setDraft({ ...draft, memo: e.target.value })} placeholder="Memo / scope" className="col-span-12 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        </div>
      )}

      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : list.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><ScrollText className="w-6 h-6 mx-auto mb-2 opacity-30" />No estimates yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map(e => (
              <li key={e.id} className="px-4 py-2.5 hover:bg-white/[0.02] flex items-center gap-3">
                <span className={cn(
                  'text-[9px] uppercase px-1.5 py-0.5 rounded font-mono',
                  e.status === 'accepted' ? 'bg-emerald-500/20 text-emerald-300' : e.status === 'declined' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/15 text-amber-300',
                )}>{e.status}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white flex items-center gap-2">
                    <span className="font-mono text-[10px] text-gray-500">{e.number}</span>
                    <span>{e.customerName}</span>
                  </div>
                  {e.memo && <div className="text-[11px] text-gray-400 truncate">{e.memo}</div>}
                  <div className="text-[10px] text-gray-500">Issued {e.issuedAt} · expires {e.expiresAt}</div>
                </div>
                <div className="text-sm font-mono tabular-nums text-white w-24 text-right">${e.total.toFixed(2)}</div>
                {!e.convertedInvoiceId ? (
                  <button onClick={() => convert(e.id)} className="px-2 py-1 text-[10px] rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 inline-flex items-center gap-1">
                    Convert <ArrowRight className="w-3 h-3" />
                  </button>
                ) : (
                  <span className="text-[10px] text-emerald-400">→ Invoice</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default EstimatesPanel;
