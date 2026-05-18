'use client';

import { useMemo } from 'react';
import type { Task } from '@/lib/api/tasks';

interface Props { tasks: Task[]; onSelect: (id: string) => void; }

export function TaskCalendarView({ tasks, onSelect }: Props) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthName = now.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = firstDay.getDay();

  const tasksByDay = useMemo(() => {
    const m = new Map<number, Task[]>();
    for (const t of tasks) {
      if (!t.due_at) continue;
      const d = new Date(t.due_at * 1000);
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      const day = d.getDate();
      if (!m.has(day)) m.set(day, []);
      m.get(day)!.push(t);
    }
    return m;
  }, [tasks, year, month]);

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="h-full overflow-y-auto p-3">
      <h3 className="text-sm font-semibold text-white mb-3">{monthName}</h3>
      <div className="grid grid-cols-7 gap-1 text-xs text-white/40 mb-1">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => <div key={d} className="px-2 py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => (
          <div key={i} className={`min-h-[88px] border border-white/10 rounded p-1 ${day === null ? 'opacity-30' : ''}`}>
            {day !== null && (
              <>
                <div className="text-xs text-white/50 mb-1">{day}</div>
                <div className="space-y-0.5">
                  {(tasksByDay.get(day) || []).slice(0, 3).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => onSelect(t.id)}
                      className="w-full text-left px-1 py-0.5 rounded text-xs bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 truncate"
                      title={t.title}
                    >
                      {t.task_key} {t.title}
                    </button>
                  ))}
                  {(tasksByDay.get(day) || []).length > 3 && (
                    <div className="text-xs text-white/40 px-1">+{(tasksByDay.get(day) || []).length - 3} more</div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
