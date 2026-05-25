'use client';

import { useEffect, useState } from 'react';
import { Trees, Plus, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Offset { id: string; tonnes: number; project: string; kind: string; registry: string; vintage: string; pricePerTonneUsd: number; serialNumber: string; status: 'purchased' | 'retired'; retiredAt: string | null; retirementReason?: string }

const KIND_LABEL: Record<string, string> = {
  forestry_redd: 'Forest REDD+',
  afforestation: 'Afforestation',
  direct_air_capture: 'Direct Air Capture',
  biochar: 'Biochar',
  soil_carbon: 'Soil carbon',
  renewable_energy: 'Renewable energy',
  methane_capture: 'Methane capture',
  cookstoves: 'Cookstoves',
};

export function OffsetsLedger() {
  const [offsets, setOffsets] = useState<Offset[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ tonnes: '', project: '', kind: 'forestry_redd', registry: 'Verra_VCS', vintage: String(new Date().getFullYear() - 1), pricePerTonneUsd: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'environment', action: 'offsets-list', input: {} });
      setOffsets((r.data?.result?.offsets || []) as Offset[]);
    } catch (e) { console.error('[Offsets] failed', e); }
    finally { setLoading(false); }
  }

  async function purchase() {
    if (!form.tonnes) return;
    try {
      await lensRun({ domain: 'environment', action: 'offsets-purchase', input: { ...form, tonnes: Number(form.tonnes), pricePerTonneUsd: Number(form.pricePerTonneUsd) || 0 } });
      setForm({ ...form, tonnes: '', project: '', pricePerTonneUsd: '' });
      await refresh();
    } catch (e) { console.error('[Offsets] purchase', e); }
  }

  async function retire(id: string) {
    const reason = prompt('Retirement reason?') || 'voluntary';
    try {
      const r = await lensRun({ domain: 'environment', action: 'offsets-retire', input: { id, reason } });
      if (r.data?.ok === false) alert(r.data?.error);
      await refresh();
    } catch (e) { console.error('[Offsets] retire', e); }
  }

  const totalTonnes = offsets.reduce((s, o) => s + o.tonnes, 0);
  const retiredTonnes = offsets.filter(o => o.status === 'retired').reduce((s, o) => s + o.tonnes, 0);
  const totalCost = offsets.reduce((s, o) => s + o.tonnes * o.pricePerTonneUsd, 0);

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Trees className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Carbon offsets</span>
        <span className="ml-auto text-[10px] text-gray-400">{retiredTonnes.toFixed(0)} / {totalTonnes.toFixed(0)} t retired · ${(totalCost / 1000).toFixed(1)}K</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
        <input type="number" value={form.tonnes} onChange={e => setForm({ ...form, tonnes: e.target.value })} placeholder="Tonnes" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.project} onChange={e => setForm({ ...form, project: e.target.value })} placeholder="Project name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={form.registry} onChange={e => setForm({ ...form, registry: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="Verra_VCS">Verra VCS</option>
          <option value="Gold_Standard">Gold Standard</option>
          <option value="Climate_Action_Reserve">CAR</option>
          <option value="American_Carbon_Registry">ACR</option>
          <option value="Puro_earth">Puro.earth</option>
        </select>
        <input type="number" step="0.01" value={form.pricePerTonneUsd} onChange={e => setForm({ ...form, pricePerTonneUsd: e.target.value })} placeholder="$/tonne" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={purchase} className="col-span-6 px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Purchase offsets</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : offsets.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Trees className="w-6 h-6 mx-auto mb-2 opacity-30" />No offsets yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {offsets.map(o => (
              <li key={o.id} className={cn('px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3', o.status === 'retired' && 'opacity-70')}>
                <Trees className={cn('w-3.5 h-3.5', o.status === 'retired' ? 'text-emerald-400' : 'text-amber-300')} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate">{o.project || KIND_LABEL[o.kind]}</div>
                  <div className="text-[10px] text-gray-400 font-mono truncate">{o.serialNumber} · {o.registry.replace(/_/g, ' ')} · vintage {o.vintage}</div>
                </div>
                <span className="font-mono text-sm tabular-nums text-emerald-300">{o.tonnes.toFixed(0)}t</span>
                {o.pricePerTonneUsd > 0 && <span className="text-[10px] text-gray-400 font-mono">${(o.tonnes * o.pricePerTonneUsd).toFixed(0)}</span>}
                {o.status === 'purchased' ? (
                  <button onClick={() => retire(o.id)} className="px-2 py-0.5 text-[10px] rounded bg-emerald-500/30 text-emerald-300 hover:bg-emerald-500/50">Retire</button>
                ) : (
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">retired</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default OffsetsLedger;
