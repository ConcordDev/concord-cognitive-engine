'use client';

import { useEffect, useState } from 'react';
import { Tractor, Plus, Trash2, Loader2, Fuel } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Equipment {
  id: string; name: string; kind: string; make: string; model: string; year: number | null;
  hoursEngine: number; status: 'idle' | 'working' | 'transporting' | 'maintenance' | 'offline';
  fuelLevelPct: number; defLevelPct: number; speedMph: number; lat: number | null; lng: number | null;
}

const STATUS_COLOUR: Record<Equipment['status'], string> = {
  idle: 'bg-gray-500/15 text-gray-300',
  working: 'bg-emerald-500/15 text-emerald-300',
  transporting: 'bg-cyan-500/15 text-cyan-300',
  maintenance: 'bg-amber-500/15 text-amber-300',
  offline: 'bg-rose-500/15 text-rose-300',
};
const KINDS = ['tractor', 'combine', 'sprayer', 'planter', 'tillage', 'harvester', 'spreader', 'drone'];
const STATUSES = ['idle', 'working', 'transporting', 'maintenance', 'offline'] as const;

export function EquipmentPanel() {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', kind: 'tractor', make: '', model: '', year: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'agriculture', action: 'equipment-list', input: {} });
      setEquipment((res.data?.result?.equipment || []) as Equipment[]);
    } catch (e) { console.error('[Equipment] failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!form.name.trim()) return;
    try {
      await lensRun({ domain: 'agriculture', action: 'equipment-add', input: { ...form, year: Number(form.year) || undefined } });
      setForm({ name: '', kind: 'tractor', make: '', model: '', year: '' });
      await refresh();
    } catch (e) { console.error('[Equipment] add', e); }
  }

  async function setStatus(id: string, status: Equipment['status']) {
    try {
      await lensRun({ domain: 'agriculture', action: 'equipment-update-telemetry', input: { id, status } });
      await refresh();
    } catch (e) { console.error('[Equipment] status', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'agriculture', action: 'equipment-delete', input: { id } });
      setEquipment(prev => prev.filter(e => e.id !== id));
    } catch (e) { console.error('[Equipment] delete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-amber-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Tractor className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Equipment fleet</span>
        <span className="ml-auto text-[10px] text-gray-400">{equipment.length}</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name (8R 410)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <input value={form.make} onChange={e => setForm({ ...form, make: e.target.value })} placeholder="Make" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="Model" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} placeholder="Year" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={add} className="col-span-6 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Add equipment</button>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : equipment.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Tractor className="w-6 h-6 mx-auto mb-2 opacity-30" />No equipment yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {equipment.map(e => (
              <li key={e.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3">
                <Tractor className="w-4 h-4 text-amber-300 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white">{e.name}</div>
                  <div className="text-[10px] text-gray-400">{e.year} {e.make} {e.model} · {e.kind}</div>
                </div>
                <div className="text-right text-[10px]">
                  <div className="inline-flex items-center gap-1 text-gray-400"><Fuel className="w-2.5 h-2.5" />{e.fuelLevelPct}%</div>
                  <div className="text-gray-400">{e.hoursEngine}h</div>
                </div>
                <select value={e.status} onChange={ev => setStatus(e.id, ev.target.value as Equipment['status'])} className={cn('text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border-0', STATUS_COLOUR[e.status])}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button aria-label="Delete" onClick={() => remove(e.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default EquipmentPanel;
