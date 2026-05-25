'use client';

import { useEffect, useState } from 'react';
import { Clock, Loader2, Play, Square } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Entry { id: string; technicianId: string; jobId: string | null; clockIn: string; clockOut: string | null; durationMin: number | null }
interface Tech { id: string; name: string; status: string }

export function TimesheetsPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [techs, setTechs] = useState<Tech[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTech, setSelectedTech] = useState<string>('');
  const [jobId, setJobId] = useState('');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        lensRun({ domain: 'trades', action: 'timesheets-list', input: {} }),
        lensRun({ domain: 'trades', action: 'technicians-list', input: {} }),
      ]);
      setEntries((a.data?.result?.entries || []) as Entry[]);
      setTechs((b.data?.result?.technicians || []) as Tech[]);
    } catch (e) { console.error('[Timesheets] failed', e); }
    finally { setLoading(false); }
  }

  async function clockIn() {
    if (!selectedTech) return;
    try {
      const res = await lensRun({ domain: 'trades', action: 'timesheets-clock-in', input: { technicianId: selectedTech, jobId: jobId || undefined } });
      if (res.data?.ok === false) alert(res.data?.error);
      setJobId('');
      await refresh();
    } catch (e) { console.error('[Timesheets] clock-in', e); }
  }

  async function clockOut(technicianId: string) {
    try {
      await lensRun({ domain: 'trades', action: 'timesheets-clock-out', input: { technicianId } });
      await refresh();
    } catch (e) { console.error('[Timesheets] clock-out', e); }
  }

  const openByTech = new Map<string, Entry>();
  for (const e of entries) if (!e.clockOut) openByTech.set(e.technicianId, e);

  function fmtDuration(min: number | null): string {
    if (min == null) return '—';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Clock className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Timesheets</span>
        <span className="ml-auto text-[10px] text-gray-400">{openByTech.size} clocked in</span>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2">
        <select value={selectedTech} onChange={e => setSelectedTech(e.target.value)} className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">Select tech…</option>
          {techs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input value={jobId} onChange={e => setJobId(e.target.value)} placeholder="Job ID (optional)" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <button onClick={clockIn} disabled={!selectedTech} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40 inline-flex items-center justify-center gap-1"><Play className="w-3 h-3" />Clock in</button>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : entries.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Clock className="w-6 h-6 mx-auto mb-2 opacity-30" />No time entries yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {entries.map(e => {
              const tech = techs.find(t => t.id === e.technicianId);
              const isOpen = !e.clockOut;
              return (
                <li key={e.id} className={cn('px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3', isOpen && 'bg-emerald-500/5')}>
                  <Clock className={cn('w-3.5 h-3.5', isOpen ? 'text-emerald-400' : 'text-gray-400')} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white">{tech?.name || e.technicianId}</div>
                    <div className="text-[10px] text-gray-400">
                      {new Date(e.clockIn).toLocaleString()} {e.clockOut ? `→ ${new Date(e.clockOut).toLocaleTimeString()}` : '(open)'}
                      {e.jobId && ` · job ${e.jobId.slice(0, 10)}`}
                    </div>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-cyan-300">{fmtDuration(e.durationMin)}</span>
                  {isOpen && <button onClick={() => clockOut(e.technicianId)} className="px-2 py-1 text-[10px] rounded bg-rose-500/30 text-rose-300 hover:bg-rose-500/50 inline-flex items-center gap-1"><Square className="w-2.5 h-2.5" />Out</button>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default TimesheetsPanel;
