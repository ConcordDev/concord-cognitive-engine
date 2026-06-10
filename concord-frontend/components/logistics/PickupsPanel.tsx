'use client';

import { useEffect, useState } from 'react';
import { Truck, Plus, X, Loader2, Hash } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Pickup { id: string; carrierId: string; carrierName: string; address: string; date: string; timeWindow: string; packageCount: number; status: string; confirmationNumber: string }
interface Carrier { id: string; name: string; code: string }

export function PickupsPanel() {
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ carrierId: '', address: '', date: '', timeWindow: '9am-5pm', packageCount: '1' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        lensRun({ domain: 'logistics', action: 'pickups-list', input: {} }),
        lensRun({ domain: 'logistics', action: 'carriers-list', input: {} }),
      ]);
      setPickups((a.data?.result?.pickups || []) as Pickup[]);
      setCarriers((b.data?.result?.carriers || []) as Carrier[]);
    } catch (e) { console.error('[Pickups] failed', e); }
    finally { setLoading(false); }
  }

  async function schedule() {
    if (!form.carrierId || !form.address.trim() || !form.date) return;
    try {
      await lensRun({ domain: 'logistics', action: 'pickups-schedule', input: { ...form, packageCount: Number(form.packageCount) || 1 } });
      setForm({ carrierId: '', address: '', date: '', timeWindow: '9am-5pm', packageCount: '1' });
      await refresh();
    } catch (e) { console.error('[Pickups] schedule', e); }
  }

  async function cancel(id: string) {
    try {
      await lensRun({ domain: 'logistics', action: 'pickups-cancel', input: { id } });
      await refresh();
    } catch (e) { console.error('[Pickups] cancel', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Truck className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Carrier pickups</span>
        <span className="ml-auto text-[10px] text-gray-400">{pickups.filter(p => p.status === 'scheduled').length} scheduled</span>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <select value={form.carrierId} onChange={e => setForm({ ...form, carrierId: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">Select carrier…</option>
          {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Pickup address" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.timeWindow} onChange={e => setForm({ ...form, timeWindow: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option>9am-12pm</option><option>12pm-5pm</option><option>9am-5pm</option>
        </select>
        <input type="number" value={form.packageCount} onChange={e => setForm({ ...form, packageCount: e.target.value })} placeholder="Pkg count" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={schedule} className="col-span-4 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Schedule pickup</button>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : pickups.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Truck className="w-6 h-6 mx-auto mb-2 opacity-30" />No pickups scheduled.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {pickups.map(p => (
              <li key={p.id} className={cn('px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3', p.status === 'cancelled' && 'opacity-50')}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white">{p.carrierName}</span>
                    <span className="text-[10px] font-mono text-cyan-300 inline-flex items-center gap-0.5"><Hash className="w-2.5 h-2.5" />{p.confirmationNumber}</span>
                    <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded ml-auto', p.status === 'scheduled' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-500/15 text-gray-300')}>{p.status}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 truncate">{p.address}</div>
                  <div className="text-[10px] text-gray-400">{p.date} · {p.timeWindow} · {p.packageCount} pkg</div>
                </div>
                {p.status === 'scheduled' && <button aria-label="Close" onClick={() => cancel(p.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400 hover:text-rose-300"><X className="w-3 h-3" /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PickupsPanel;
