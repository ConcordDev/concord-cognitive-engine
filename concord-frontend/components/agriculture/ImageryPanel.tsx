'use client';

import { useEffect, useState } from 'react';
import { Image as ImageIcon, Plus, Loader2, Satellite, Plane } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Imagery { id: string; fieldId: string; url: string; source: 'satellite' | 'drone' | 'uav' | 'handheld'; kind: 'rgb' | 'ndvi' | 'ndre' | 'thermal' | 'elevation' | 'orthomosaic'; capturedAt: string; cloudCoverPct: number | null; gsd: string; notes: string }

const KIND_COLOUR: Record<Imagery['kind'], string> = {
  rgb: 'bg-cyan-500/15 text-cyan-300',
  ndvi: 'bg-emerald-500/15 text-emerald-300',
  ndre: 'bg-violet-500/15 text-violet-300',
  thermal: 'bg-rose-500/15 text-rose-300',
  elevation: 'bg-amber-500/15 text-amber-300',
  orthomosaic: 'bg-gray-500/15 text-gray-300',
};

export function ImageryPanel() {
  const [imagery, setImagery] = useState<Imagery[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ fieldId: '', url: '', source: 'drone' as Imagery['source'], kind: 'ndvi' as Imagery['kind'], notes: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'agriculture', action: 'imagery-list', input: {} });
      setImagery((res.data?.result?.imagery || []) as Imagery[]);
    } catch (e) { console.error('[Imagery] failed', e); }
    finally { setLoading(false); }
  }

  async function attach() {
    if (!form.fieldId.trim() || !form.url.trim()) return;
    try {
      await lensRun({ domain: 'agriculture', action: 'imagery-attach', input: form });
      setForm({ fieldId: '', url: '', source: 'drone', kind: 'ndvi', notes: '' });
      await refresh();
    } catch (e) { console.error('[Imagery] attach', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <ImageIcon className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Imagery layers · drone + satellite</span>
        <span className="ml-auto text-[10px] text-gray-400">{imagery.length}</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <input value={form.fieldId} onChange={e => setForm({ ...form, fieldId: e.target.value })} placeholder="Field ID" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="Image URL" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value as Imagery['source'] })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="drone">Drone</option><option value="satellite">Satellite</option><option value="uav">UAV</option><option value="handheld">Handheld</option>
        </select>
        <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as Imagery['kind'] })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="rgb">RGB</option><option value="ndvi">NDVI</option><option value="ndre">NDRE</option><option value="thermal">Thermal</option><option value="elevation">Elevation</option><option value="orthomosaic">Orthomosaic</option>
        </select>
        <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Notes" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={attach} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Attach</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : imagery.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><ImageIcon className="w-6 h-6 mx-auto mb-2 opacity-30" />No imagery attached.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {imagery.map(i => (
              <li key={i.id} className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3">
                {i.source === 'satellite' ? <Satellite className="w-3.5 h-3.5 text-cyan-300" /> : <Plane className="w-3.5 h-3.5 text-emerald-300" />}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate">{i.url}</div>
                  <div className="text-[10px] text-gray-400">Field {i.fieldId.slice(0, 10)} · {i.source} · {new Date(i.capturedAt).toLocaleDateString()}</div>
                </div>
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', KIND_COLOUR[i.kind])}>{i.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ImageryPanel;
