'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface CalJob {
  id: string;
  number: string;
  customerName: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'emergency';
  status: string;
  slot: number | null;
  assignedTech: string | null;
}
interface CalDay { date: string; weekday: string; jobs: CalJob[] }
interface Unscheduled { id: string; number: string; customerName: string; description: string; priority: CalJob['priority'] }
interface WeekResult { weekStart: string; days: CalDay[]; unscheduled: Unscheduled[]; totalScheduled: number }

const PRIO: Record<CalJob['priority'], string> = {
  emergency: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  high: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  normal: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  low: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
};
const SLOTS = Array.from({ length: 11 }, (_, i) => i + 7); // 7am - 5pm

function mondayOf(d: Date): string {
  const c = new Date(d);
  const dow = c.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  c.setDate(c.getDate() + diff);
  return c.toISOString().slice(0, 10);
}

export function SchedulingCalendarPanel() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [data, setData] = useState<WeekResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<WeekResult>('trades', 'schedule-week', { weekStart });
      if (r.data?.ok && r.data.result) setData(r.data.result);
    } catch (e) { console.error('[Schedule] week failed', e); }
    finally { setLoading(false); }
  }, [weekStart]);

  useEffect(() => { refresh(); }, [refresh]);

  const shiftWeek = (deltaDays: number) => {
    const d = new Date(`${weekStart}T00:00:00`);
    d.setDate(d.getDate() + deltaDays);
    setWeekStart(mondayOf(d));
  };

  async function place(jobId: string, date: string, slot: number) {
    try {
      const r = await lensRun('trades', 'schedule-set', { jobId, date, slot });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[Schedule] set failed', e); }
  }

  const onDrop = (date: string, slot: number) => {
    if (dragId) { place(dragId, date, slot); setDragId(null); }
  };

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Scheduling calendar</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => shiftWeek(-7)} className="p-1 rounded hover:bg-white/5 text-gray-400" aria-label="Previous week"><ChevronLeft className="w-3.5 h-3.5" /></button>
          <span className="text-[10px] font-mono text-gray-400 w-24 text-center">{weekStart}</span>
          <button onClick={() => shiftWeek(7)} className="p-1 rounded hover:bg-white/5 text-gray-400" aria-label="Next week"><ChevronRight className="w-3.5 h-3.5" /></button>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading week…</div>
      ) : !data ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400">No schedule data yet.</div>
      ) : (
        <div className="p-3 space-y-3">
          <p className="text-[10px] text-gray-400">Drag an unscheduled job onto an hour cell to book it. {data.totalScheduled} jobs scheduled this week.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[680px] border-separate border-spacing-0.5">
              <thead>
                <tr>
                  <th className="text-left px-2 py-1 text-[9px] uppercase text-gray-400 w-12">Hr</th>
                  {data.days.map(d => (
                    <th key={d.date} className="text-center px-1 py-1 text-[9px] uppercase text-gray-400">
                      {d.weekday}<div className="text-[8px] text-gray-400 font-mono">{d.date.slice(5)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SLOTS.map(slot => (
                  <tr key={slot}>
                    <td className="px-2 py-1 text-[9px] font-mono text-gray-400 align-top">{slot}{slot < 12 ? 'a' : 'p'}</td>
                    {data.days.map(d => {
                      const job = d.jobs.find(j => j.slot === slot);
                      return (
                        <td
                          key={d.date + slot}
                          onDragOver={e => { if (dragId) e.preventDefault(); }}
                          onDrop={() => onDrop(d.date, slot)}
                          className={cn('px-0.5 py-0.5 align-top h-9 border border-white/5 rounded', dragId && 'bg-cyan-500/[0.03]')}
                        >
                          {job && (
                            <div
                              draggable
                              onDragStart={() => setDragId(job.id)}
                              onDragEnd={() => setDragId(null)}
                              className={cn('rounded px-1 py-0.5 text-[9px] border cursor-grab leading-tight', PRIO[job.priority])}
                              title={`${job.number} · ${job.description}`}
                            >
                              <div className="font-medium truncate">{job.customerName}</div>
                              {job.assignedTech && <div className="text-[8px] opacity-70 truncate">{job.assignedTech}</div>}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-white/10 pt-2">
            <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-1">Unscheduled · {data.unscheduled.length}</div>
            {data.unscheduled.length === 0 ? (
              <p className="text-[10px] text-gray-400">All open jobs are scheduled.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {data.unscheduled.map(j => (
                  <div
                    key={j.id}
                    draggable
                    onDragStart={() => setDragId(j.id)}
                    onDragEnd={() => setDragId(null)}
                    className={cn('rounded px-2 py-1 text-[10px] border cursor-grab', PRIO[j.priority])}
                    title={j.description}
                  >
                    <span className="font-mono opacity-70">{j.number}</span> {j.customerName}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SchedulingCalendarPanel;
