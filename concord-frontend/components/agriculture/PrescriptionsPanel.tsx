'use client';

import { useEffect, useState } from 'react';
import { FlaskConical, Plus, Loader2, Check, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Rx {
  id: string; fieldId: string; product: string; kind: string; unit: string;
  zoneRates: Array<{ zoneId: string; rate: number }>; flatRate: number | null; avgRate: number;
  status: 'draft' | 'approved'; authoredBy: string;
}

const KINDS = ['nitrogen', 'phosphorus', 'potassium', 'seed', 'herbicide', 'fungicide', 'insecticide'];

export function PrescriptionsPanel() {
  const [rxs, setRxs] = useState<Rx[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ fieldId: '', product: '', kind: 'nitrogen', flatRate: '', unit: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'agriculture', action: 'prescriptions-list', input: {} });
      setRxs((res.data?.result?.prescriptions || []) as Rx[]);
    } catch (e) { console.error('[Rx] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.fieldId.trim() || !form.product.trim()) return;
    try {
      await lensRun({
        domain: 'agriculture', action: 'prescriptions-create',
        input: { ...form, flatRate: Number(form.flatRate) || undefined, unit: form.unit || undefined },
      });
      setForm({ fieldId: '', product: '', kind: 'nitrogen', flatRate: '', unit: '' });
      await refresh();
    } catch (e) { console.error('[Rx] create', e); }
  }

  async function approve(id: string) {
    try {
      await lensRun({ domain: 'agriculture', action: 'prescriptions-approve', input: { id } });
      await refresh();
    } catch (e) { console.error('[Rx] approve', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'agriculture', action: 'prescriptions-delete', input: { id } });
      setRxs(prev => prev.filter(r => r.id !== id));
    } catch (e) { console.error('[Rx] delete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Prescription maps · variable rate</span>
        <span className="ml-auto text-[10px] text-gray-400">{rxs.length}</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <input value={form.fieldId} onChange={e => setForm({ ...form, fieldId: e.target.value })} placeholder="Field ID" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={form.product} onChange={e => setForm({ ...form, product: e.target.value })} placeholder="Product (UAN-32)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <input type="number" value={form.flatRate} onChange={e => setForm({ ...form, flatRate: e.target.value })} placeholder="Flat rate" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={create} className="col-span-5 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Author script</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : rxs.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><FlaskConical className="w-6 h-6 mx-auto mb-2 opacity-30" />No prescriptions yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {rxs.map(r => (
              <li key={r.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3">
                <FlaskConical className={cn('w-4 h-4', r.kind === 'nitrogen' ? 'text-cyan-300' : r.kind === 'seed' ? 'text-emerald-300' : 'text-amber-300')} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white">{r.product} <span className="text-[10px] text-gray-400 ml-1">({r.kind})</span></div>
                  <div className="text-[10px] text-gray-400">Field {r.fieldId.slice(0, 12)} · avg {r.avgRate} {r.unit} · {r.zoneRates.length} zone{r.zoneRates.length === 1 ? '' : 's'}</div>
                </div>
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', r.status === 'approved' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300')}>{r.status}</span>
                {r.status === 'draft' && <button onClick={() => approve(r.id)} className="p-1 text-emerald-400 hover:text-emerald-300" title="Approve"><Check className="w-3 h-3" /></button>}
                <button aria-label="Delete" onClick={() => remove(r.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PrescriptionsPanel;
