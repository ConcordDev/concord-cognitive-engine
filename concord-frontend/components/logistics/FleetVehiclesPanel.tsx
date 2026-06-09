'use client';

import { useEffect, useState } from 'react';
import { Truck, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Vehicle { id: string; number: string; kind: string; make: string; model: string; year: number | null; mileage: number; capacityLbs: number; status: 'available' | 'in_use' | 'maintenance' | 'out_of_service' }

const STATUS_COLOUR: Record<Vehicle['status'], string> = {
  available: 'bg-emerald-500/15 text-emerald-300',
  in_use: 'bg-cyan-500/15 text-cyan-300',
  maintenance: 'bg-amber-500/15 text-amber-300',
  out_of_service: 'bg-gray-500/15 text-gray-300',
};

const STATUSES = ['available', 'in_use', 'maintenance', 'out_of_service'] as const;
const KINDS = ['box_truck', 'tractor', 'trailer', 'van', 'pickup'];

export function FleetVehiclesPanel() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ number: '', kind: 'box_truck', make: '', model: '', year: '', capacityLbs: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'logistics', action: 'fleet-vehicles-list', input: {} });
      setVehicles((res.data?.result?.vehicles || []) as Vehicle[]);
    } catch (e) { console.error('[Fleet] failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!form.number.trim()) return;
    try {
      await lensRun({
        domain: 'logistics', action: 'fleet-vehicles-add',
        input: { ...form, year: Number(form.year) || undefined, capacityLbs: Number(form.capacityLbs) || 0 },
      });
      setForm({ number: '', kind: 'box_truck', make: '', model: '', year: '', capacityLbs: '' });
      await refresh();
    } catch (e) { console.error('[Fleet] add', e); }
  }

  async function setStatus(id: string, status: Vehicle['status']) {
    try {
      await lensRun({ domain: 'logistics', action: 'fleet-vehicles-update-status', input: { id, status } });
      await refresh();
    } catch (e) { console.error('[Fleet] status', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'logistics', action: 'fleet-vehicles-delete', input: { id } });
      setVehicles(prev => prev.filter(v => v.id !== id));
    } catch (e) { console.error('[Fleet] delete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Truck className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Fleet vehicles</span>
        <span className="ml-auto text-[10px] text-gray-400">{vehicles.length}</span>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
        <input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} placeholder="Truck #" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {KINDS.map(k => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
        </select>
        <input value={form.make} onChange={e => setForm({ ...form, make: e.target.value })} placeholder="Make" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="Model" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} placeholder="Year" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.capacityLbs} onChange={e => setForm({ ...form, capacityLbs: e.target.value })} placeholder="Capacity lbs" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={add} className="col-span-6 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Add vehicle</button>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : vehicles.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Truck className="w-6 h-6 mx-auto mb-2 opacity-30" />No vehicles yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-gray-400 border-b border-white/5">
              <tr><th className="text-left px-3 py-1.5">Truck</th><th className="text-left">Kind</th><th className="text-left">Make/Model</th><th className="text-right">Mileage</th><th>Status</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {vehicles.map(v => (
                <tr key={v.id} className="hover:bg-white/[0.03] group">
                  <td className="px-3 py-2 font-mono text-cyan-300">{v.number}</td>
                  <td className="text-gray-300">{v.kind.replace('_', ' ')}</td>
                  <td className="text-gray-400">{v.year || ''} {v.make} {v.model}</td>
                  <td className="text-right font-mono tabular-nums text-gray-300">{v.mileage.toLocaleString()}</td>
                  <td>
                    <select value={v.status} onChange={e => setStatus(v.id, e.target.value as Vehicle['status'])} className={cn('text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border-0', STATUS_COLOUR[v.status])}>
                      {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  </td>
                  <td><button aria-label="Delete" onClick={() => remove(v.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default FleetVehiclesPanel;
