'use client';

/**
 * CrtCalendarPanel — a month grid of scheduled content.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface CalItem { id: string; title: string; format: string; stage: string }
interface Calendar { year: number; month: number; days: Record<string, CalItem[]> }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const STAGE_DOT: Record<string, string> = {
  idea: 'bg-zinc-500', scripted: 'bg-sky-500', in_production: 'bg-amber-500',
  scheduled: 'bg-violet-500', published: 'bg-emerald-500',
};

export function CrtCalendarPanel() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [cal, setCal] = useState<Calendar | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('creator', 'content-calendar', { year, month });
    setCal((r.data?.result as Calendar | null) || null);
    setLoading(false);
  }, [year, month]);

  useEffect(() => { void refresh(); }, [refresh]);

  const shift = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
  };

  const daysInMonth = new Date(year, month, 0).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button aria-label="Previous" type="button" onClick={() => shift(-1)} className="text-zinc-400 hover:text-zinc-200">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h3 className="text-sm font-semibold text-zinc-100">{MONTHS[month - 1]} {year}</h3>
        <button aria-label="Next" type="button" onClick={() => shift(1)} className="text-zinc-400 hover:text-zinc-200">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {loading || !cal ? (
        <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i} className="text-center text-[10px] text-zinc-400 uppercase">{d}</div>
          ))}
          {Array.from({ length: firstWeekday }, (_, i) => <div key={`pad${i}`} />)}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const d = String(i + 1).padStart(2, '0');
            const items = cal.days[d] || [];
            return (
              <div key={d}
                className={cn('min-h-[56px] rounded-lg border p-1',
                  items.length ? 'border-red-900/50 bg-red-950/20' : 'border-zinc-800 bg-zinc-900/40')}>
                <p className="text-[10px] text-zinc-400">{i + 1}</p>
                <div className="space-y-0.5 mt-0.5">
                  {items.slice(0, 3).map((it) => (
                    <p key={it.id} className="flex items-center gap-1 text-[9px] text-zinc-300 truncate">
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', STAGE_DOT[it.stage] || 'bg-zinc-500')} />
                      {it.title}
                    </p>
                  ))}
                  {items.length > 3 && <p className="text-[9px] text-zinc-400">+{items.length - 3} more</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[10px] text-zinc-400">Schedule content by setting a date on a pipeline item.</p>
    </div>
  );
}
