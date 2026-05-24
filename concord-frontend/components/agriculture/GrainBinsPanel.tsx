'use client';

import { useEffect, useState } from 'react';
import { Warehouse, Plus, Loader2, ArrowDown, ArrowUp } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Bin { id: string; name: string; capacityBushels: number; crop: string; currentBushels: number; moisturePct: number | null; tempF: number | null; location: string }

export function GrainBinsPanel() {
  const [bins, setBins] = useState<Bin[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', capacityBushels: '', crop: '', location: '' });
  const [txFor, setTxFor] = useState<string | null>(null);
  const [txAmt, setTxAmt] = useState('');
  const [txKind, setTxKind] = useState<'load' | 'unload'>('load');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'agriculture', action: 'grain-bins-list', input: {} });
      setBins((res.data?.result?.bins || []) as Bin[]);
    } catch (e) { console.error('[Bins] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.name.trim() || !form.capacityBushels) return;
    try {
      await lensRun({ domain: 'agriculture', action: 'grain-bins-create', input: { ...form, capacityBushels: Number(form.capacityBushels) } });
      setForm({ name: '', capacityBushels: '', crop: '', location: '' });
      await refresh();
    } catch (e) { console.error('[Bins] create', e); }
  }

  async function tx(binId: string) {
    if (!txAmt) return;
    try {
      const res = await lensRun({ domain: 'agriculture', action: txKind === 'load' ? 'grain-bins-load' : 'grain-bins-unload', input: { id: binId, bushels: Number(txAmt) } });
      if (res.data?.ok === false) alert(res.data?.error);
      else {
        setTxFor(null); setTxAmt('');
        await refresh();
      }
    } catch (e) { console.error('[Bins] tx', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-amber-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Warehouse className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Grain bins</span>
        <span className="ml-auto text-[10px] text-gray-400">{bins.length}</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Bin name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.capacityBushels} onChange={e => setForm({ ...form, capacityBushels: e.target.value })} placeholder="Capacity bu" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.crop} onChange={e => setForm({ ...form, crop: e.target.value })} placeholder="Crop" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Location" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Bin</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : bins.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Warehouse className="w-6 h-6 mx-auto mb-2 opacity-30" />No bins yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {bins.map(b => {
              const pct = b.capacityBushels > 0 ? Math.round((b.currentBushels / b.capacityBushels) * 100) : 0;
              return (
                <li key={b.id} className="px-3 py-2 hover:bg-white/[0.03]">
                  <div className="flex items-center gap-2 mb-1">
                    <Warehouse className="w-3.5 h-3.5 text-amber-300" />
                    <span className="text-sm text-white">{b.name}</span>
                    <span className="text-[10px] text-gray-400">{b.crop} · {b.location}</span>
                    <span className="ml-auto font-mono text-xs tabular-nums text-amber-300">{b.currentBushels.toLocaleString()} / {b.capacityBushels.toLocaleString()} bu</span>
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className={cn('h-full transition-all', pct > 90 ? 'bg-rose-400' : pct > 70 ? 'bg-amber-400' : 'bg-emerald-400')} style={{ width: `${pct}%` }} />
                  </div>
                  {txFor === b.id ? (
                    <div className="mt-2 flex items-center gap-2">
                      <select value={txKind} onChange={e => setTxKind(e.target.value as 'load' | 'unload')} className="px-2 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white">
                        <option value="load">Load</option><option value="unload">Unload</option>
                      </select>
                      <input type="number" value={txAmt} onChange={e => setTxAmt(e.target.value)} placeholder="Bushels" className="flex-1 px-2 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white" autoFocus />
                      <button onClick={() => tx(b.id)} className="px-3 py-1 text-[11px] rounded bg-amber-500 text-black font-bold hover:bg-amber-400">Go</button>
                      <button onClick={() => setTxFor(null)} className="px-2 py-1 text-[11px] text-gray-400">×</button>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-center gap-3 text-[11px]">
                      <button onClick={() => { setTxFor(b.id); setTxKind('load'); }} className="text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-0.5"><ArrowDown className="w-2.5 h-2.5" />Load</button>
                      <button onClick={() => { setTxFor(b.id); setTxKind('unload'); }} className="text-rose-300 hover:text-rose-200 inline-flex items-center gap-0.5"><ArrowUp className="w-2.5 h-2.5" />Unload</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default GrainBinsPanel;
