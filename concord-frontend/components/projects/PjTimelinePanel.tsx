'use client';

/**
 * PjTimelinePanel — a Gantt timeline of scheduled tasks and milestones.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, CalendarRange } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface TLTask { id: string; ref: string; title: string; status: string; type: string; start: string; end: string }
interface TLMilestone { id: string; name: string; date: string; status: string }

const STATUS_COLOR: Record<string, string> = {
  backlog: 'bg-zinc-600', todo: 'bg-sky-600', in_progress: 'bg-amber-600',
  in_review: 'bg-violet-600', done: 'bg-emerald-600',
};
const DAY = 86400000;

export function PjTimelinePanel({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<TLTask[]>([]);
  const [milestones, setMilestones] = useState<TLMilestone[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('projects', 'timeline', { projectId });
    setTasks(r.data?.result?.tasks || []);
    setMilestones(r.data?.result?.milestones || []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (tasks.length === 0 && milestones.length === 0) {
    return (
      <p className="text-[11px] text-zinc-500 italic py-8 text-center">
        No scheduled items. Set start and due dates on issues to see them on the timeline.
      </p>
    );
  }

  const allDates = [
    ...tasks.flatMap((t) => [t.start, t.end]),
    ...milestones.map((m) => m.date),
  ].filter(Boolean);
  const min = Date.parse(`${allDates.sort()[0]}T00:00:00Z`);
  const max = Date.parse(`${allDates.sort()[allDates.length - 1]}T00:00:00Z`);
  const span = Math.max(DAY, max - min);
  const pct = (d: string) => ((Date.parse(`${d}T00:00:00Z`) - min) / span) * 100;

  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
        <CalendarRange className="w-3.5 h-3.5 text-indigo-400" /> Timeline
        <span className="text-zinc-500 font-normal">· {allDates.sort()[0]} → {allDates.sort()[allDates.length - 1]}</span>
      </h3>

      {/* Milestone markers */}
      {milestones.length > 0 && (
        <div className="relative h-6 bg-zinc-900/50 rounded">
          {milestones.map((m) => (
            <div key={m.id} className="absolute top-0 -translate-x-1/2 flex flex-col items-center"
              style={{ left: `${pct(m.date)}%` }} title={`${m.name} · ${m.date}`}>
              <span className={cn('w-2 h-2 rotate-45', m.status === 'completed' ? 'bg-emerald-400' : 'bg-indigo-400')} />
              <span className="text-[8px] text-zinc-500 whitespace-nowrap">{m.name.slice(0, 12)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Task bars */}
      <ul className="space-y-1.5">
        {tasks.map((t) => {
          const left = pct(t.start);
          const width = Math.max(2, pct(t.end) - left);
          return (
            <li key={t.id} className="flex items-center gap-2">
              <span className="w-40 shrink-0 text-[11px] text-zinc-300 truncate">
                <span className="font-mono text-zinc-500">{t.ref}</span> {t.title}
              </span>
              <div className="relative flex-1 h-5 bg-zinc-900/50 rounded">
                <div className={cn('absolute top-0.5 h-4 rounded', STATUS_COLOR[t.status] || 'bg-zinc-600')}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${t.start} → ${t.end}`} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
