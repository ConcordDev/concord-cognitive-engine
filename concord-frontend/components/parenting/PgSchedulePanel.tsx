'use client';

/**
 * PgSchedulePanel — predicts the rest of today's nap/bedtime windows from
 * the child's own logged sleep and age-based wake windows.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, CalendarClock, Moon, Sun } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface ScheduleSlot {
  kind: 'nap' | 'bedtime';
  index?: number;
  windowStart: string;
  ideal: string;
  windowEnd: string;
  expectedDurationMin: number;
  expectedWake: string;
}
interface Schedule {
  ageMonths: number;
  wakeWindow: { min: number; typical: number; max: number };
  learnedNapMin: number;
  napsPerDay: number;
  napsLogged: number;
  schedule: ScheduleSlot[];
  anchoredOn: string | null;
  note: string;
}

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function PgSchedulePanel({ childId }: { childId: string }) {
  const [sched, setSched] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('parenting', 'sleep-schedule', { childId });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); setSched(null); }
    else { setSched(r.data?.result as Schedule); setError(null); }
    setLoading(false);
  }, [childId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }
  if (error || !sched) {
    return <p className="text-[11px] text-zinc-400 italic py-6 text-center">{error || 'No schedule available.'}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
          <CalendarClock className="w-3.5 h-3.5 text-indigo-400" /> Predicted schedule
        </h3>
        <button type="button" onClick={refresh}
          className="px-2 py-1 text-[11px] rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700">Refresh</button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Wake window" value={`${sched.wakeWindow.typical}m`} />
        <Stat label="Typical nap" value={`${sched.learnedNapMin}m`} />
        <Stat label="Naps left" value={Math.max(0, sched.napsPerDay - sched.napsLogged)} />
      </div>

      <ol className="space-y-2">
        {sched.schedule.map((slot, i) => (
          <li key={i} className={`rounded-xl border p-3 ${slot.kind === 'bedtime'
            ? 'border-indigo-900/50 bg-gradient-to-br from-indigo-900/40 to-zinc-900/70'
            : 'border-zinc-800 bg-zinc-900/70'}`}>
            <div className="flex items-center gap-2">
              {slot.kind === 'bedtime'
                ? <Moon className="w-4 h-4 text-indigo-300" />
                : <Sun className="w-4 h-4 text-amber-300" />}
              <span className="text-xs font-semibold text-zinc-100">
                {slot.kind === 'bedtime' ? 'Bedtime' : `Nap ${slot.index}`}
              </span>
              <span className="ml-auto text-base font-bold text-zinc-100">{timeOf(slot.ideal)}</span>
            </div>
            <p className="text-[11px] text-zinc-400 mt-1">
              Window {timeOf(slot.windowStart)} – {timeOf(slot.windowEnd)} ·
              {' '}~{Math.floor(slot.expectedDurationMin / 60)}h {slot.expectedDurationMin % 60}m ·
              {' '}wake ≈ {timeOf(slot.expectedWake)}
            </p>
          </li>
        ))}
      </ol>
      <p className="text-[10px] text-zinc-400">{sched.note}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2.5 text-center">
      <p className="text-base font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
