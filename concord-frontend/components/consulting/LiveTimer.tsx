'use client';

/**
 * LiveTimer — a start/stop billable timer that logs elapsed time as a
 * time entry on stop. Wires consulting.timer-start / timer-status /
 * timer-stop / timer-cancel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Square, X, Timer as TimerIcon, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface RunningTimer { engagementId: string; engagementName: string; note: string; startedAt: number }
interface EngagementOption { id: string; name: string }

function fmt(elapsedHours: number): string {
  const totalSec = Math.max(0, Math.round(elapsedHours * 3600));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function LiveTimer({ engagements, onLogged }: { engagements: EngagementOption[]; onLogged: () => void }) {
  const [timer, setTimer] = useState<RunningTimer | null>(null);
  const [loading, setLoading] = useState(true);
  const [engId, setEngId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('consulting', 'timer-status', {});
    const res = r.data?.result as { running?: boolean; timer?: RunningTimer } | null;
    setTimer(res?.running && res.timer ? res.timer : null);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // 1s display tick while a timer is running.
  useEffect(() => {
    if (timer) {
      intervalRef.current = setInterval(() => setTick(t => t + 1), 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [timer]);

  async function start() {
    setError('');
    if (!engId) { setError('Pick an engagement'); return; }
    const r = await lensRun('consulting', 'timer-start', { engagementId: engId, note: note.trim() });
    if (!r.data?.ok) { setError(r.data?.error || 'Could not start timer'); return; }
    setNote('');
    await refresh();
  }
  async function stop() {
    const r = await lensRun('consulting', 'timer-stop', {});
    if (r.data?.ok) { onLogged(); }
    await refresh();
  }
  async function cancel() {
    await lensRun('consulting', 'timer-cancel', {});
    await refresh();
  }

  if (loading) return <div className="flex justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  const elapsedHours = timer ? (Date.now() - timer.startedAt) / 3600000 : 0;

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <TimerIcon className="w-4 h-4 text-indigo-400" />
        <h3 className="text-sm font-bold text-zinc-100">Live Timer</h3>
      </div>

      {timer ? (
        <div className="text-center">
          <p className="text-[11px] text-zinc-400 mb-1">{timer.engagementName}{timer.note ? ` — ${timer.note}` : ''}</p>
          <p className="text-4xl font-mono font-bold text-emerald-400 tabular-nums mb-3">{fmt(elapsedHours)}</p>
          <div className="flex justify-center gap-2">
            <button onClick={stop}
              className="px-4 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold inline-flex items-center gap-1.5">
              <Square className="w-4 h-4" />Stop &amp; Log
            </button>
            <button onClick={cancel}
              className="px-3 py-2 text-sm rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 inline-flex items-center gap-1.5">
              <X className="w-4 h-4" />Discard
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <select value={engId} onChange={e => setEngId(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
            <option value="">Select engagement…</option>
            {engagements.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="What are you working on?"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <button onClick={start} disabled={!engId}
            className="w-full px-3 py-2 text-sm rounded bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
            <Play className="w-4 h-4" />Start Timer
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-rose-400 mt-2">{error}</p>}
    </div>
  );
}
