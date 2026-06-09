'use client';

import { useEffect, useState } from 'react';
import { Package, Plus, Trash2, Loader2, ArrowRight } from 'lucide-react';
import dynamic from 'next/dynamic';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const ShipmentsMap = dynamic(() => import('./ShipmentsMap').then(m => m.ShipmentsMap), { ssr: false });

interface Shipment {
  id: string; trackingNumber: string; origin: string; destination: string;
  carrierId: string; mode: string; weightLbs: number; serviceLevel: string;
  status: string; estimatedDelivery: string | null; actualDelivery: string | null;
}

const STATUS_COLOUR: Record<string, string> = {
  label_created: 'bg-gray-500/15 text-gray-300',
  picked_up: 'bg-cyan-500/15 text-cyan-300',
  in_transit: 'bg-cyan-500/20 text-cyan-300',
  out_for_delivery: 'bg-violet-500/20 text-violet-300',
  delivered: 'bg-emerald-500/15 text-emerald-300',
  exception: 'bg-rose-500/15 text-rose-300',
  returned: 'bg-amber-500/15 text-amber-300',
};

const STATUSES = ['label_created', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned'];

export function ShipmentsPanel({ onSelect }: { onSelect?: (s: Shipment) => void }) {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ origin: '', destination: '', mode: 'parcel', weightLbs: '', poNumber: '', consignee: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'logistics', action: 'shipments-list', input: {} });
      const items = (res.data?.result?.shipments || res.data?.result?.items || []);
      setShipments(items as Shipment[]);
    } catch (e) { console.error('[Shipments] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.origin.trim() || !form.destination.trim()) return;
    try {
      await lensRun({
        domain: 'logistics', action: 'shipments-create',
        input: { origin: form.origin, destination: form.destination, mode: form.mode, weightLbs: Number(form.weightLbs) || 0, poNumber: form.poNumber, consignee: form.consignee },
      });
      setForm({ origin: '', destination: '', mode: 'parcel', weightLbs: '', poNumber: '', consignee: '' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Shipments] create', e); }
  }

  async function setStatus(id: string, status: string) {
    try {
      await lensRun({ domain: 'logistics', action: 'shipments-set-status', input: { id, status } });
      await refresh();
    } catch (e) { console.error('[Shipments] status', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'logistics', action: 'shipments-delete', input: { id } });
      setShipments(prev => prev.filter(s => s.id !== id));
    } catch (e) { console.error('[Shipments] delete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Package className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Shipments</span>
        <span className="ml-auto text-[10px] text-gray-400">{shipments.length}</span>
        <button aria-label="Add" onClick={() => setCreating(v => !v)} className="p-1 text-gray-400 hover:text-white"><Plus className="w-4 h-4" /></button>
      </header>

      <div className="border-b border-white/10">
        <ShipmentsMap shipments={shipments} className="h-64 w-full" />
      </div>

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
          <input value={form.origin} onChange={e => setForm({ ...form, origin: e.target.value })} placeholder="Origin" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} placeholder="Destination" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="parcel">Parcel</option><option value="ltl">LTL</option><option value="ftl">FTL</option><option value="ocean">Ocean</option><option value="air">Air</option><option value="intermodal">Intermodal</option><option value="drayage">Drayage</option>
          </select>
          <input type="number" value={form.weightLbs} onChange={e => setForm({ ...form, weightLbs: e.target.value })} placeholder="Weight lbs" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.poNumber} onChange={e => setForm({ ...form, poNumber: e.target.value })} placeholder="PO #" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.consignee} onChange={e => setForm({ ...form, consignee: e.target.value })} placeholder="Consignee" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Create</button>
        </div>
      )}

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : shipments.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Package className="w-6 h-6 mx-auto mb-2 opacity-30" />No shipments yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {shipments.map(s => (
              <li key={s.id} className="px-3 py-2 hover:bg-white/[0.03] group cursor-pointer" onClick={() => onSelect?.(s)}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-cyan-300">{s.trackingNumber}</span>
                  <span className="text-[9px] uppercase text-gray-400">{s.mode}</span>
                  <select value={s.status} onChange={e => { e.stopPropagation(); setStatus(s.id, e.target.value); }} onClick={e => e.stopPropagation()} className={cn('text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border-0 cursor-pointer', STATUS_COLOUR[s.status])}>
                    {STATUSES.map(st => <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>)}
                  </select>
                  <button aria-label="Delete" onClick={(e) => { e.stopPropagation(); remove(s.id); }} className="ml-auto opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-200">
                  <span className="truncate flex-1">{s.origin}</span>
                  <ArrowRight className="w-3 h-3 text-gray-400" />
                  <span className="truncate flex-1">{s.destination}</span>
                </div>
                {s.weightLbs > 0 && <div className="text-[10px] text-gray-400 mt-0.5">{s.weightLbs}lbs · {s.serviceLevel}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ShipmentsPanel;
