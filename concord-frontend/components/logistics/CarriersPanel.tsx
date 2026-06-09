'use client';

import { useEffect, useState } from 'react';
import { Building, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Carrier { id: string; name: string; code: string; scac: string; modes: string[]; accountNumber: string; active: boolean }

const ALL_MODES = ['parcel', 'ltl', 'ftl', 'ocean', 'air', 'intermodal', 'drayage'];

export function CarriersPanel() {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', code: '', scac: '', modes: ['parcel'] as string[], accountNumber: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'logistics', action: 'carriers-list', input: {} });
      setCarriers((res.data?.result?.carriers || []) as Carrier[]);
    } catch (e) { console.error('[Carriers] failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!form.name.trim() || !form.code.trim()) return;
    try {
      await lensRun({ domain: 'logistics', action: 'carriers-add', input: form });
      setForm({ name: '', code: '', scac: '', modes: ['parcel'], accountNumber: '' });
      await refresh();
    } catch (e) { console.error('[Carriers] add', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'logistics', action: 'carriers-delete', input: { id } });
      setCarriers(prev => prev.filter(c => c.id !== id));
    } catch (e) { console.error('[Carriers] delete', e); }
  }

  function toggleMode(m: string) {
    setForm(f => ({ ...f, modes: f.modes.includes(m) ? f.modes.filter(x => x !== m) : [...f.modes, m] }));
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Building className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Carriers</span>
        <span className="ml-auto text-[10px] text-gray-400">{carriers.length}</span>
      </header>

      <div className="p-3 border-b border-white/10 space-y-2">
        <div className="grid grid-cols-5 gap-2">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name (FedEx)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="Code (FDX)" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={form.scac} onChange={e => setForm({ ...form, scac: e.target.value.toUpperCase() })} placeholder="SCAC" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <button onClick={add} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Add</button>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          <span className="text-gray-400 uppercase">Modes:</span>
          {ALL_MODES.map(m => (
            <button key={m} onClick={() => toggleMode(m)} className={`px-1.5 py-0.5 rounded ${form.modes.includes(m) ? 'bg-cyan-500/20 text-cyan-300' : 'bg-white/5 text-gray-400'}`}>{m}</button>
          ))}
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : carriers.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Building className="w-6 h-6 mx-auto mb-2 opacity-30" />No carriers configured. Add FedEx / UPS / USPS / DHL above.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {carriers.map(c => (
              <li key={c.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-cyan-500/15 text-cyan-300 flex items-center justify-center text-[10px] font-mono font-bold">{c.code}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{c.name}</div>
                  <div className="text-[10px] text-gray-400">SCAC {c.scac || '—'} · {c.modes.join(' / ')}</div>
                </div>
                <button aria-label="Delete" onClick={() => remove(c.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CarriersPanel;
