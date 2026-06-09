'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Entry {
  id: string; aircraftId: string; date: string; from: string; to: string;
  totalHours: number; pic: number; sic: number; crossCountry: number; night: number;
  instrument: number; simulated: number; dayLandings: number; nightLandings: number;
  conditions: 'VFR' | 'MVFR' | 'IFR' | 'LIFR'; remarks: string;
}
interface Totals { totalHours: number; pic: number; sic: number; crossCountry: number; night: number; instrument: number; simulated: number; totalFlights: number; totalLandings: number; nightLandings: number }
interface Aircraft { id: string; tail: string }

export function LogbookPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ aircraftId: '', date: new Date().toISOString().slice(0, 10), from: '', to: '', totalHours: '', pic: '', night: '', instrument: '', dayLandings: '1', nightLandings: '0', conditions: 'VFR' as 'VFR' | 'MVFR' | 'IFR' | 'LIFR', remarks: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [e, t, a] = await Promise.all([
        lensRun({ domain: 'aviation', action: 'logbook-list', input: {} }),
        lensRun({ domain: 'aviation', action: 'logbook-totals', input: {} }),
        lensRun({ domain: 'aviation', action: 'aircraft-list', input: {} }),
      ]);
      setEntries((e.data?.result?.entries || []) as Entry[]);
      setTotals((t.data?.result as Totals) || null);
      setAircraft((a.data?.result?.aircraft || []) as Aircraft[]);
    } catch (e) { console.error('[Logbook] failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!form.aircraftId || !form.date || !form.from.trim() || !form.to.trim() || !form.totalHours) return;
    try {
      await lensRun({ domain: 'aviation', action: 'logbook-add', input: { ...form, totalHours: Number(form.totalHours), pic: Number(form.pic) || 0, night: Number(form.night) || 0, instrument: Number(form.instrument) || 0, dayLandings: Number(form.dayLandings) || 0, nightLandings: Number(form.nightLandings) || 0 } });
      setForm({ ...form, from: '', to: '', totalHours: '', pic: '', night: '', instrument: '', remarks: '' });
      await refresh();
    } catch (e) { console.error('[Logbook] add', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'aviation', action: 'logbook-delete', input: { id } });
      await refresh();
    } catch (e) { console.error('[Logbook] delete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Pilot logbook</span>
        <span className="ml-auto text-[10px] text-gray-400">{entries.length} flights</span>
      </header>

      {totals && (
        <div className="px-4 py-2 border-b border-white/10 grid grid-cols-6 gap-2 text-xs">
          <Tile label="Total" value={`${totals.totalHours.toFixed(1)}h`} />
          <Tile label="PIC" value={`${totals.pic.toFixed(1)}h`} />
          <Tile label="Night" value={`${totals.night.toFixed(1)}h`} />
          <Tile label="IFR" value={`${totals.instrument.toFixed(1)}h`} />
          <Tile label="XC" value={`${totals.crossCountry.toFixed(1)}h`} />
          <Tile label="Landings" value={String(totals.totalLandings)} />
        </div>
      )}

      <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
        <select value={form.aircraftId} onChange={e => setForm({ ...form, aircraftId: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">Aircraft…</option>
          {aircraft.map(a => <option key={a.id} value={a.id}>{a.tail}</option>)}
        </select>
        <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.from} onChange={e => setForm({ ...form, from: e.target.value.toUpperCase() })} placeholder="From ICAO" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={form.to} onChange={e => setForm({ ...form, to: e.target.value.toUpperCase() })} placeholder="To ICAO" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input type="number" step="0.1" value={form.totalHours} onChange={e => setForm({ ...form, totalHours: e.target.value })} placeholder="Total hrs" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" step="0.1" value={form.pic} onChange={e => setForm({ ...form, pic: e.target.value })} placeholder="PIC hrs" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" step="0.1" value={form.night} onChange={e => setForm({ ...form, night: e.target.value })} placeholder="Night" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" step="0.1" value={form.instrument} onChange={e => setForm({ ...form, instrument: e.target.value })} placeholder="IFR" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.dayLandings} onChange={e => setForm({ ...form, dayLandings: e.target.value })} placeholder="Day ldgs" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.nightLandings} onChange={e => setForm({ ...form, nightLandings: e.target.value })} placeholder="Night ldgs" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.conditions} onChange={e => setForm({ ...form, conditions: e.target.value as 'VFR' | 'MVFR' | 'IFR' | 'LIFR' })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option>VFR</option><option>MVFR</option><option>IFR</option><option>LIFR</option>
        </select>
        <button onClick={add} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Log flight</button>
        <input value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} placeholder="Remarks" className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
      </div>

      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : entries.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><BookOpen className="w-6 h-6 mx-auto mb-2 opacity-30" />No logbook entries yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {entries.map(e => (
              <li key={e.id} className="px-3 py-2 hover:bg-white/[0.03] group flex items-center gap-3">
                <span className="text-[10px] font-mono text-gray-400 w-20">{e.date}</span>
                <span className="text-xs font-mono text-cyan-300">{e.from}→{e.to}</span>
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', e.conditions === 'VFR' ? 'bg-emerald-500/15 text-emerald-300' : e.conditions === 'MVFR' ? 'bg-amber-500/15 text-amber-300' : 'bg-rose-500/15 text-rose-300')}>{e.conditions}</span>
                <span className="ml-auto font-mono text-sm tabular-nums text-white">{e.totalHours.toFixed(1)}h</span>
                <span className="text-[10px] text-gray-400">PIC {e.pic.toFixed(1)} · {e.dayLandings + e.nightLandings} ldg</span>
                <button aria-label="Delete" onClick={() => remove(e.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-white/[0.03] border border-white/5 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-sm font-mono tabular-nums text-white">{value}</div>
    </div>
  );
}

export default LogbookPanel;
