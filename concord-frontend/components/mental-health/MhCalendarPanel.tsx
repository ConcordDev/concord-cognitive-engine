'use client';

/**
 * MhCalendarPanel — year-in-pixels mood calendar. One cell per day,
 * coloured by the average mood logged that day (Daylio "year in pixels").
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface CalDay { date: string; mood: number; count: number }
interface CalResult { year: number; days: CalDay[]; loggedDays: number; distribution: Record<string, number>; avgMood: number | null }

const MOOD_COLOR = ['#27272a', '#f43f5e', '#fb923c', '#facc15', '#4ade80', '#22d3ee'];
function moodColor(m: number): string { return MOOD_COLOR[Math.max(1, Math.min(5, Math.round(m)))]; }

export function MhCalendarPanel() {
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [data, setData] = useState<CalResult | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('mental-health', 'mood-calendar', { year });
    setData((r.data?.result as CalResult | null) || null);
    setLoading(false);
  }, [year]);

  useEffect(() => { void refresh(); }, [refresh]);

  const byDate = useMemo(() => {
    const m = new Map<string, CalDay>();
    for (const d of data?.days || []) m.set(d.date, d);
    return m;
  }, [data]);

  // 12 month columns; each month a vertical strip of day cells.
  const months = useMemo(() => {
    const out: { name: string; days: string[] }[] = [];
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let mo = 0; mo < 12; mo++) {
      const count = new Date(Date.UTC(year, mo + 1, 0)).getUTCDate();
      const days: string[] = [];
      for (let d = 1; d <= count; d++) {
        days.push(`${year}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
      out.push({ name: names[mo], days });
    }
    return out;
  }, [year]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
          <CalendarDays className="w-3.5 h-3.5 text-sky-400" /> Year in pixels
        </h3>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setYear((y) => y - 1)}
            className="text-zinc-400 hover:text-zinc-200" aria-label="Previous year"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-xs font-mono text-zinc-200 w-12 text-center">{year}</span>
          <button type="button" onClick={() => setYear((y) => Math.min(new Date().getUTCFullYear(), y + 1))}
            className="text-zinc-400 hover:text-zinc-200 disabled:opacity-30"
            disabled={year >= new Date().getUTCFullYear()} aria-label="Next year"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : !data || data.loggedDays === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No mood entries logged in {year} yet.</p>
      ) : (
        <>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 overflow-x-auto">
            <div className="flex gap-1.5 min-w-max">
              {months.map((m) => (
                <div key={m.name} className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-zinc-400 text-center mb-0.5">{m.name}</span>
                  {m.days.map((dt) => {
                    const cell = byDate.get(dt);
                    return (
                      <div key={dt}
                        title={cell ? `${dt} · mood ${cell.mood} (${cell.count} check-in${cell.count > 1 ? 's' : ''})` : `${dt} · no entry`}
                        className="w-2.5 h-2.5 rounded-[2px]"
                        style={{ backgroundColor: cell ? moodColor(cell.mood) : '#1c1c1f' }} />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
              <p className="text-lg font-bold text-zinc-100">{data.loggedDays}</p>
              <p className="text-[10px] text-zinc-400 uppercase">Days logged</p>
            </div>
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
              <p className="text-lg font-bold text-zinc-100">{data.avgMood ?? '—'}</p>
              <p className="text-[10px] text-zinc-400 uppercase">Avg mood</p>
            </div>
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
              <p className="text-lg font-bold text-emerald-400">{(data.distribution['4'] || 0) + (data.distribution['5'] || 0)}</p>
              <p className="text-[10px] text-zinc-400 uppercase">Good days</p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 text-[10px] text-zinc-400">
            <span>Low</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: moodColor(n) }} />
            ))}
            <span>High</span>
          </div>
        </>
      )}
    </div>
  );
}
