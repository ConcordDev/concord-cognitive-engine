'use client';

import { useEffect, useState } from 'react';
import { Wrench, Plus, Trash2, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Asset { id: string; kind: string; label: string; lat: number; lng: number; condition: 'good' | 'fair' | 'poor' | 'broken'; lastInspectedAt: string | null; maintenanceLog: Array<{ id: string; work: string; crew: string; condition: string; at: string }> }

const KINDS = ['streetlight', 'hydrant', 'sign', 'road_segment', 'park_bench', 'bus_stop', 'trash_can', 'traffic_signal', 'manhole'];
const CONDITION_COLOUR: Record<Asset['condition'], string> = {
  good: 'bg-emerald-500/15 text-emerald-300',
  fair: 'bg-cyan-500/15 text-cyan-300',
  poor: 'bg-amber-500/15 text-amber-300',
  broken: 'bg-rose-500/15 text-rose-300',
};

export function AssetsPanel() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ kind: 'streetlight', label: '', lat: '', lng: '', condition: 'good' as Asset['condition'] });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'government', action: 'assets-list', input: {} });
      setAssets((res.data?.result?.assets || []) as Asset[]);
    } catch (e) { console.error('[Assets] failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!form.lat || !form.lng) return;
    try {
      await lensRun({ domain: 'government', action: 'assets-add', input: { ...form, lat: Number(form.lat), lng: Number(form.lng) } });
      setForm({ ...form, label: '', lat: '', lng: '' });
      await refresh();
    } catch (e) { console.error('[Assets] add', e); }
  }

  async function logMaint(id: string) {
    const work = prompt('Maintenance work description?');
    if (!work) return;
    const condition = prompt('Updated condition (good/fair/poor/broken)?', 'good') || undefined;
    try {
      await lensRun({ domain: 'government', action: 'assets-log-maintenance', input: { id, work, condition } });
      await refresh();
    } catch (e) { console.error('[Assets] maint', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'government', action: 'assets-delete', input: { id } });
      setAssets(prev => prev.filter(a => a.id !== id));
    } catch (e) { console.error('[Assets] delete', e); }
  }

  const filtered = filter ? assets.filter(a => a.kind === filter) : assets;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Wrench className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Infrastructure assets</span>
        <span className="ml-auto text-[10px] text-gray-400">{filtered.length} / {assets.length}</span>
        <select value={filter} onChange={e => setFilter(e.target.value)} className="text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">All kinds</option>
          {KINDS.map(k => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
        </select>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
        <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {KINDS.map(k => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
        </select>
        <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="Label (SL-001)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" step="0.0001" value={form.lat} onChange={e => setForm({ ...form, lat: e.target.value })} placeholder="Lat" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input type="number" step="0.0001" value={form.lng} onChange={e => setForm({ ...form, lng: e.target.value })} placeholder="Lng" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <select value={form.condition} onChange={e => setForm({ ...form, condition: e.target.value as Asset['condition'] })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option><option value="broken">Broken</option>
        </select>
        <button onClick={add} className="col-span-6 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Add asset</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Wrench className="w-6 h-6 mx-auto mb-2 opacity-30" />No assets in this view.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {filtered.map(a => (
              <li key={a.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3">
                {(a.condition === 'broken' || a.condition === 'poor') ? <AlertTriangle className="w-3.5 h-3.5 text-rose-300" /> : <CheckCircle className="w-3.5 h-3.5 text-emerald-300" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white">{a.label || a.kind} <span className="text-[10px] text-gray-400">· {a.kind.replace(/_/g, ' ')}</span></div>
                  <div className="text-[10px] text-gray-400 font-mono">{a.lat.toFixed(4)},{a.lng.toFixed(4)} · {a.maintenanceLog.length} maint logs</div>
                </div>
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', CONDITION_COLOUR[a.condition])}>{a.condition}</span>
                <button onClick={() => logMaint(a.id)} className="px-2 py-0.5 text-[10px] rounded bg-cyan-500/30 text-cyan-300 hover:bg-cyan-500/50">Log work</button>
                <button aria-label="Delete" onClick={() => remove(a.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default AssetsPanel;
