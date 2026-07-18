'use client';

/**
 * PjTimelinePanel — a Gantt timeline of scheduled tasks and milestones.
 */

import { useCallback, useEffect, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Skeleton, ErrorState } from '@/components/ui';

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
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('projects', 'timeline', { projectId });
    if (r.data?.ok === false) {
      setLoadError(r.data?.error || 'Could not load the timeline.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setTasks(r.data?.result?.tasks || []);
    setMilestones(r.data?.result?.milestones || []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton width="40%" height={14} />
        <Skeleton variant="block" height={24} className="rounded" />
        <div className="space-y-1.5">
          <Skeleton variant="block" height={20} className="rounded" />
          <Skeleton variant="block" height={20} className="rounded" />
          <Skeleton variant="block" height={20} className="rounded" />
          <Skeleton variant="block" height={20} className="rounded" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return <div className="p-4"><ErrorState message={loadError} onRetry={refresh} /></div>;
  }

  if (tasks.length === 0 && milestones.length === 0) {
    return (
      <p className="text-[11px] text-gray-400 italic py-8 text-center">
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
      <h3 className="flex items-center gap-1 text-xs font-semibold text-gray-300">
        <CalendarRange className="w-3.5 h-3.5 text-indigo-400" /> Timeline
        <span className="text-gray-400 font-normal tabular-nums">· {allDates.sort()[0]} → {allDates.sort()[allDates.length - 1]}</span>
      </h3>

      {/* Milestone markers */}
      {milestones.length > 0 && (
        <div className="relative h-6 bg-lattice-surface/50 rounded">
          {milestones.map((m) => (
            <div key={m.id} className="absolute top-0 -translate-x-1/2 flex flex-col items-center"
              style={{ left: `${pct(m.date)}%` }} title={`${m.name} · ${m.date}`}>
              <span className={cn('w-2 h-2 rotate-45', m.status === 'completed' ? 'bg-emerald-400' : 'bg-indigo-400')} />
              <span className="text-[8px] text-gray-400 whitespace-nowrap">{m.name.slice(0, 12)}</span>
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
              <span className="w-40 shrink-0 text-[11px] text-gray-300 truncate">
                <span className="font-mono tabular-nums text-gray-400">{t.ref}</span> {t.title}
              </span>
              <div className="relative flex-1 h-5 bg-lattice-surface/50 rounded">
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
