'use client';

import { useEffect, useState } from 'react';
import { Layers, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Zone { id: string; fieldId: string; name: string; productivityClass: 'high' | 'medium' | 'low'; areaAcres: number; soilType: string; organicMatterPct: number }

export function ZonesPanel() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ fieldId: '', name: '', productivityClass: 'medium' as Zone['productivityClass'], areaAcres: '', soilType: 'loam' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'agriculture', action: 'zones-list', input: {} });
      setZones((res.data?.result?.zones || []) as Zone[]);
    } catch (e) { console.error('[Zones] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.fieldId.trim() || !form.name.trim()) return;
    try {
      await lensRun({ domain: 'agriculture', action: 'zones-create', input: { ...form, areaAcres: Number(form.areaAcres) || 0 } });
      setForm({ fieldId: '', name: '', productivityClass: 'medium', areaAcres: '', soilType: 'loam' });
      await refresh();
    } catch (e) { console.error('[Zones] create', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'agriculture', action: 'zones-delete', input: { id } });
      setZones(prev => prev.filter(z => z.id !== id));
    } catch (e) { console.error('[Zones] delete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Layers className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Field zones</span>
        <span className="ml-auto text-[10px] text-gray-400">{zones.length}</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
        <input value={form.fieldId} onChange={e => setForm({ ...form, fieldId: e.target.value })} placeholder="Field ID" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Zone name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.productivityClass} onChange={e => setForm({ ...form, productivityClass: e.target.value as Zone['productivityClass'] })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <input type="number" value={form.areaAcres} onChange={e => setForm({ ...form, areaAcres: e.target.value })} placeholder="Acres" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Add</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : zones.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Layers className="w-6 h-6 mx-auto mb-2 opacity-30" />No zones yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {zones.map(z => (
              <li key={z.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3">
                <Layers className={cn('w-3.5 h-3.5', z.productivityClass === 'high' ? 'text-emerald-300' : z.productivityClass === 'medium' ? 'text-amber-300' : 'text-rose-300')} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white">{z.name}</div>
                  <div className="text-[10px] text-gray-400">Field {z.fieldId.slice(0, 10)} · {z.soilType} · {z.areaAcres}ac</div>
                </div>
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', z.productivityClass === 'high' ? 'bg-emerald-500/15 text-emerald-300' : z.productivityClass === 'medium' ? 'bg-amber-500/15 text-amber-300' : 'bg-rose-500/15 text-rose-300')}>{z.productivityClass}</span>
                <button aria-label="Delete" onClick={() => remove(z.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ZonesPanel;
