'use client';

import { useCallback, useEffect, useState } from 'react';
import { Calendar, Plus, Loader2, Anchor, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Dock { id: string; name: string; facility: string; kind: string; status: string; hoursStart: string; hoursEnd: string }
interface Appt { id: string; dockId: string; dockName: string; date: string; startTime: string; durationMin: number; truckNumber: string; kind: 'pickup' | 'delivery'; status: string }

export function DockAppointmentsPanel() {
  const [docks, setDocks] = useState<Dock[]>([]);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dockForm, setDockForm] = useState({ name: '', facility: '', kind: 'loading' });
  const [aptForm, setAptForm] = useState({ dockId: '', startTime: '09:00', durationMin: '60', truckNumber: '', kind: 'delivery' as 'pickup' | 'delivery' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [d, a] = await Promise.all([
        lensRun({ domain: 'logistics', action: 'docks-list', input: {} }),
        lensRun({ domain: 'logistics', action: 'dock-appointments-list', input: { date } }),
      ]);
      setDocks((d.data?.result?.docks || []) as Dock[]);
      setAppts((a.data?.result?.appointments || []) as Appt[]);
    } catch (e) { console.error('[Docks] failed', e); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function addDock() {
    if (!dockForm.name.trim() || !dockForm.facility.trim()) return;
    try {
      await lensRun({ domain: 'logistics', action: 'docks-create', input: dockForm });
      setDockForm({ name: '', facility: '', kind: 'loading' });
      await refresh();
    } catch (e) { console.error('[Docks] add', e); }
  }

  async function book() {
    if (!aptForm.dockId || !aptForm.startTime) return;
    try {
      const res = await lensRun({ domain: 'logistics', action: 'dock-appointments-book', input: { ...aptForm, date, durationMin: Number(aptForm.durationMin) || 60 } });
      if (res.data?.ok === false) alert(res.data?.error);
      else {
        setAptForm({ dockId: '', startTime: '09:00', durationMin: '60', truckNumber: '', kind: 'delivery' });
        await refresh();
      }
    } catch (e) { console.error('[Docks] book', e); }
  }

  async function cancel(id: string) {
    try {
      await lensRun({ domain: 'logistics', action: 'dock-appointments-cancel', input: { id } });
      await refresh();
    } catch (e) { console.error('[Docks] cancel', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-amber-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Dock scheduling</span>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="ml-auto text-xs bg-lattice-deep border border-lattice-border rounded px-2 py-0.5 text-white" />
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2 text-xs">
        <span className="text-gray-400 uppercase text-[10px] flex items-center">Add dock:</span>
        <input value={dockForm.name} onChange={e => setDockForm({ ...dockForm, name: e.target.value })} placeholder="Dock name" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={dockForm.facility} onChange={e => setDockForm({ ...dockForm, facility: e.target.value })} placeholder="Facility" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={addDock} className="px-3 py-1 rounded bg-amber-500/30 text-amber-300 hover:bg-amber-500/50 inline-flex items-center justify-center gap-1"><Anchor className="w-3 h-3" />Add dock</button>
      </div>

      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2 text-xs">
        <select value={aptForm.dockId} onChange={e => setAptForm({ ...aptForm, dockId: e.target.value })} className="col-span-2 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">Select dock…</option>
          {docks.map(d => <option key={d.id} value={d.id}>{d.name} · {d.facility}</option>)}
        </select>
        <input type="time" value={aptForm.startTime} onChange={e => setAptForm({ ...aptForm, startTime: e.target.value })} className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={aptForm.durationMin} onChange={e => setAptForm({ ...aptForm, durationMin: e.target.value })} placeholder="Min" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={aptForm.kind} onChange={e => setAptForm({ ...aptForm, kind: e.target.value as typeof aptForm.kind })} className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="delivery">Delivery</option><option value="pickup">Pickup</option>
        </select>
        <input value={aptForm.truckNumber} onChange={e => setAptForm({ ...aptForm, truckNumber: e.target.value })} placeholder="Truck #" className="col-span-3 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <button onClick={book} disabled={!aptForm.dockId} className="col-span-2 px-3 py-1 rounded bg-amber-500 text-black font-bold hover:bg-amber-400 disabled:opacity-40 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Book</button>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : appts.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Calendar className="w-6 h-6 mx-auto mb-2 opacity-30" />No appointments on {date}.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {appts.map(a => (
              <li key={a.id} className={cn('px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3', a.status === 'cancelled' && 'opacity-50')}>
                <div className="w-14 h-10 rounded bg-amber-500/15 flex flex-col items-center justify-center text-[10px] text-amber-300 font-mono">
                  <span className="font-bold">{a.startTime}</span>
                  <span className="text-[9px]">{a.durationMin}min</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white">{a.dockName}</span>
                    <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', a.kind === 'pickup' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-violet-500/15 text-violet-300')}>{a.kind}</span>
                  </div>
                  <div className="text-[10px] text-gray-400">{a.truckNumber || '—'}</div>
                </div>
                {a.status === 'scheduled' && <button aria-label="Close" onClick={() => cancel(a.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400 hover:text-rose-300"><X className="w-3 h-3" /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default DockAppointmentsPanel;
