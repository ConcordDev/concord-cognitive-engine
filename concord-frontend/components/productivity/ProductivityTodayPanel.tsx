'use client';

/**
 * ProductivityTodayPanel — the Today view (overdue + due today) and a
 * 7-day upcoming agenda.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sun, CalendarDays } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ErrorState } from '@/components/ui';
import { ProductivityTaskRow, type ProdTask } from './ProductivityTaskRow';

interface UpcomingDay { date: string; tasks: ProdTask[] }

// F1: due dates are calendar days in the viewer's timezone. The local
// today is computed from local components (never a UTC slice) and sent
// to the views; day labels are formatted from the date string's own
// components — parsing "2026-11-01" as a UTC instant and formatting it
// locally shifted every bucket label one day early behind UTC.
function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function ProductivityTodayPanel({ onChange }: { onChange: () => void }) {
  const [todayTasks, setTodayTasks] = useState<ProdTask[]>([]);
  const [overdue, setOverdue] = useState(0);
  const [days, setDays] = useState<UpcomingDay[]>([]);
  const [overdueTasks, setOverdueTasks] = useState<ProdTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const today = localToday();
    const [t, u] = await Promise.all([
      lensRun('productivity', 'today-view', { today }),
      lensRun('productivity', 'upcoming-view', { today }),
    ]);
    if (t.data?.ok === false || u.data?.ok === false) {
      setLoadError(t.data?.error || u.data?.error || 'Could not load today’s agenda.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    // The Today section lists tasks due today; overdue tasks render in
    // their own group at the head of the agenda below (today-view
    // returns both, separated by dueState).
    setTodayTasks((t.data?.result?.tasks || []).filter((x: ProdTask) => x.dueState === 'today'));
    setOverdue(t.data?.result?.overdue || 0);
    setDays(u.data?.result?.days || []);
    setOverdueTasks(u.data?.result?.overdue || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (loadError) {
    return <div className="p-4"><ErrorState message={loadError} onRetry={refresh} /></div>;
  }

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
          {overdueTasks.length > 0 && (
            <div>
              <p className="text-[11px] text-rose-400 mb-1">Overdue</p>
              <ul className="space-y-1">
                {overdueTasks.map((t) => <ProductivityTaskRow key={t.id} task={t} onChange={refresh} />)}
              </ul>
            </div>
          )}
          {days.map((d) => (
            <div key={d.date}>
              <p className="text-[11px] text-zinc-400 mb-1">{dayLabel(d.date)}</p>
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
