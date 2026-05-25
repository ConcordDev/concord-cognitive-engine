'use client';

/**
 * ProductivityTodayPanel — the Today view (overdue + due today) and a
 * 7-day upcoming agenda.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sun, CalendarDays } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ProductivityTaskRow, type ProdTask } from './ProductivityTaskRow';

interface UpcomingDay { date: string; tasks: ProdTask[] }

export function ProductivityTodayPanel({ onChange }: { onChange: () => void }) {
  const [todayTasks, setTodayTasks] = useState<ProdTask[]>([]);
  const [overdue, setOverdue] = useState(0);
  const [days, setDays] = useState<UpcomingDay[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [t, u] = await Promise.all([
      lensRun('productivity', 'today-view', {}),
      lensRun('productivity', 'upcoming-view', {}),
    ]);
    setTodayTasks(t.data?.result?.tasks || []);
    setOverdue(t.data?.result?.overdue || 0);
    setDays(u.data?.result?.days || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const weekday = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div className="space-y-4">
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Sun className="w-3.5 h-3.5 text-red-400" /> Today
          {overdue > 0 && <span className="text-[10px] text-rose-400">· {overdue} overdue</span>}
        </h3>
        {todayTasks.length === 0 ? (
          <div className="text-center text-zinc-400 text-sm italic py-8 border border-zinc-800 rounded-xl">
            Nothing due today. Enjoy the clear deck.
          </div>
        ) : (
          <ul className="space-y-1">
            {todayTasks.map((t) => <ProductivityTaskRow key={t.id} task={t} onChange={refresh} />)}
          </ul>
        )}
      </section>

      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <CalendarDays className="w-3.5 h-3.5 text-red-400" /> Next 7 days
        </h3>
        <div className="space-y-3">
          {days.map((d) => (
            <div key={d.date}>
              <p className="text-[11px] text-zinc-400 mb-1">{weekday(d.date)}</p>
              {d.tasks.length === 0 ? (
                <p className="text-[10px] text-zinc-400 italic pl-1">No tasks</p>
              ) : (
                <ul className="space-y-1">
                  {d.tasks.map((t) => <ProductivityTaskRow key={t.id} task={t} onChange={refresh} />)}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
