'use client';

import { useEffect, useState, useRef } from 'react';
import { Timer, Loader2, Plus, Play, Square, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Matter { id: string; name: string; number: string; hourlyRate: number }
interface RunningTimer { id: string; matterId: string; matterName: string; description: string; startedAt: string; elapsedSec: number }
interface TimeEntry {
  id: string; number: string; matterId: string; matterName: string;
  date: string; description: string; hours: number; rate: number; amount: number;
  status: 'unbilled' | 'billed' | 'non_billable';
}

function fmtElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function TimeTracker() {
  const [matters, setMatters] = useState<Matter[]>([]);
  const [timers, setTimers] = useState<RunningTimer[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ matterId: '', description: '' });
  const [manualDraft, setManualDraft] = useState({ matterId: '', hours: '', description: '', billable: true });
  const [showManual, setShowManual] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    // Live-tick running timers each second
    if (timers.length === 0) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }
    if (!tickRef.current) {
      tickRef.current = setInterval(() => {
        setTimers(prev => prev.map(t => ({ ...t, elapsedSec: t.elapsedSec + 1 })));
      }, 1000);
    }
    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };
  }, [timers.length]);

  async function refresh() {
    setLoading(true);
    try {
      const [m, t, e] = await Promise.all([
        lensRun({ domain: 'legal', action: 'matters-list', input: { status: 'open' } }),
        lensRun({ domain: 'legal', action: 'timer-list', input: {} }),
        lensRun({ domain: 'legal', action: 'time-entries-list', input: {} }),
      ]);
      setMatters((m.data?.result?.matters || []) as Matter[]);
      setTimers((t.data?.result?.timers || []) as RunningTimer[]);
      setEntries((e.data?.result?.entries || []) as TimeEntry[]);
    } catch (err) { console.error('[Time] refresh failed', err); }
    finally { setLoading(false); }
  }

  async function startTimer() {
    if (!draft.matterId) return;
    try {
      await lensRun({ domain: 'legal', action: 'timer-start', input: draft });
      setDraft({ matterId: '', description: '' });
      await refresh();
    } catch (e) { console.error('[Time] start failed', e); }
  }

  async function stopTimer(id: string) {
    try {
      await lensRun({ domain: 'legal', action: 'timer-stop', input: { id } });
      await refresh();
    } catch (e) { console.error('[Time] stop failed', e); }
  }

  async function addManual() {
    if (!manualDraft.matterId || !manualDraft.hours) return;
    try {
      await lensRun({
        domain: 'legal', action: 'time-entries-create',
        input: { ...manualDraft, hours: Number(manualDraft.hours) },
      });
      setManualDraft({ matterId: '', hours: '', description: '', billable: true });
      setShowManual(false);
      await refresh();
    } catch (e) { console.error('[Time] manual failed', e); }
  }

  async function deleteEntry(id: string) {
    try {
      const r = await lensRun({ domain: 'legal', action: 'time-entries-delete', input: { id } });
      if (r.data?.ok === false) alert(r.data?.error);
      await refresh();
    } catch (e) { console.error('[Time] delete failed', e); }
  }

  const unbilled = entries.filter(e => e.status === 'unbilled');
  const totalUnbilled = unbilled.reduce((sum, e) => sum + e.amount, 0);
  const totalUnbilledHours = unbilled.reduce((sum, e) => sum + e.hours, 0);

  return (
    <div className="space-y-3">
      {/* Running timers */}
      <div className="bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Timer className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-gray-200">Timers</span>
          <span className="text-[10px] text-gray-400">{timers.length} running</span>
        </header>
        <div className="p-3 grid grid-cols-12 gap-2 border-b border-white/10">
          <select value={draft.matterId} onChange={e => setDraft({ ...draft, matterId: e.target.value })} className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="">Pick matter *</option>
            {matters.map(m => <option key={m.id} value={m.id}>{m.name} (${m.hourlyRate}/hr)</option>)}
          </select>
          <input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="What are you working on?" className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={startTimer} disabled={!draft.matterId} className="col-span-2 px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
            <Play className="w-3 h-3" />Start
          </button>
        </div>
        {timers.length > 0 && (
          <ul className="divide-y divide-white/5">
            {timers.map(t => (
              <li key={t.id} className="px-4 py-2 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{t.matterName}</div>
                  <div className="text-[10px] text-gray-400 truncate">{t.description || 'No description'}</div>
                </div>
                <div className="text-base font-mono tabular-nums text-emerald-300">{fmtElapsed(t.elapsedSec)}</div>
                <button onClick={() => stopTimer(t.id)} className="px-2 py-1 text-[10px] rounded bg-rose-500 text-white font-bold hover:bg-rose-400 inline-flex items-center gap-1">
                  <Square className="w-3 h-3" />Stop
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Manual entry */}
      <div className="bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Timer className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-gray-200">Time entries</span>
          <span className="text-[10px] text-amber-300 font-mono">${totalUnbilled.toFixed(2)} / {totalUnbilledHours.toFixed(1)}h unbilled</span>
          <button onClick={() => setShowManual(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-amber-500 text-black font-semibold hover:bg-amber-400 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />Manual entry
          </button>
        </header>

        {showManual && (
          <div className="p-3 grid grid-cols-12 gap-2 border-b border-white/10">
            <select value={manualDraft.matterId} onChange={e => setManualDraft({ ...manualDraft, matterId: e.target.value })} className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="">Matter *</option>
              {matters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input type="number" step="0.1" value={manualDraft.hours} onChange={e => setManualDraft({ ...manualDraft, hours: e.target.value })} placeholder="Hours *" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <input value={manualDraft.description} onChange={e => setManualDraft({ ...manualDraft, description: e.target.value })} placeholder="Description" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <label className="col-span-2 inline-flex items-center gap-1.5 text-[11px] text-gray-300">
              <input type="checkbox" checked={manualDraft.billable} onChange={e => setManualDraft({ ...manualDraft, billable: e.target.checked })} className="rounded" />Billable
            </label>
            <button onClick={addManual} className="col-span-12 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400">Add</button>
          </div>
        )}

        <div className="max-h-[28rem] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-10 text-center text-xs text-gray-400">No time entries.</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {entries.slice(0, 100).map(e => (
                <li key={e.id} className="px-4 py-2 hover:bg-white/[0.02] group flex items-center gap-3">
                  <span className={cn(
                    'text-[9px] uppercase px-1.5 py-0.5 rounded font-mono w-16 text-center',
                    e.status === 'billed' ? 'bg-gray-500/20 text-gray-300' : e.status === 'non_billable' ? 'bg-white/5 text-gray-400' : 'bg-amber-500/20 text-amber-300',
                  )}>{e.status === 'non_billable' ? 'NB' : e.status}</span>
                  <span className="text-[10px] font-mono text-gray-400 w-20">{e.date}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white truncate">{e.description || <span className="text-gray-400 italic">(no description)</span>}</div>
                    <div className="text-[10px] text-gray-400 truncate">{e.matterName}</div>
                  </div>
                  <span className="text-xs font-mono text-gray-400">{e.hours.toFixed(2)}h × ${e.rate}</span>
                  <span className="text-sm font-mono tabular-nums text-white w-20 text-right">${e.amount.toFixed(2)}</span>
                  {e.status !== 'billed' && (
                    <button aria-label="Delete" onClick={() => deleteEntry(e.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-500/20 text-rose-300">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default TimeTracker;
