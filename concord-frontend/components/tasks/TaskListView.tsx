'use client';

import { useCallback, useMemo } from 'react';
import { callTasksMacro, type Task } from '@/lib/api/tasks';
import { Circle, CheckCircle2, AlertCircle, Clock } from 'lucide-react';

interface Status { id: string; name: string; category: string; color: string; }

interface Props {
  tasks: Task[];
  statuses: Status[];
  activeTaskId: string | null;
  onSelect: (id: string) => void;
  onChange: () => void;
}

const PRI_COLOR: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-orange-300',
  medium: 'text-yellow-300',
  low: 'text-zinc-400',
  none: 'text-zinc-600',
};

export function TaskListView({ tasks, statuses, activeTaskId, onSelect, onChange }: Props) {
  const grouped = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const s of statuses) m.set(s.id, []);
    for (const t of tasks) {
      if (!m.has(t.status_id)) m.set(t.status_id, []);
      m.get(t.status_id)!.push(t);
    }
    return m;
  }, [tasks, statuses]);

  const cycleStatus = useCallback(async (task: Task) => {
    const idx = statuses.findIndex((s) => s.id === task.status_id);
    if (idx < 0) return;
    const next = statuses[(idx + 1) % statuses.length];
    await callTasksMacro('task_update', { id: task.id, statusId: next.id });
    onChange();
  }, [statuses, onChange]);

  return (
    <div className="h-full overflow-y-auto">
      {statuses.map((s) => {
        const items = grouped.get(s.id) || [];
        return (
          <div key={s.id} className="border-b border-white/5">
            <div className="px-3 py-1.5 bg-black/20 sticky top-0 z-10 flex items-center gap-2 text-xs uppercase tracking-wide">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-white/80 font-medium">{s.name}</span>
              <span className="text-white/40">{items.length}</span>
            </div>
            {items.length === 0 ? (
              <div className="text-xs text-white/30 px-3 py-3">No tasks.</div>
            ) : (
              <div>
                {items.map((t) => {
                  const done = s.category === 'done';
                  return (
                    <div
                      key={t.id}
                      onClick={() => onSelect(t.id)}
                      className={`group flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer border-l-2 ${
                        activeTaskId === t.id
                          ? 'bg-cyan-500/10 border-cyan-400/60'
                          : 'border-transparent hover:bg-white/5'
                      }`}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); cycleStatus(t); }}
                        className="flex-shrink-0 hover:scale-110 transition-transform"
                        title="Cycle status"
                      >
                        {done ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Circle className="w-4 h-4" style={{ color: s.color }} />}
                      </button>
                      <span className="text-xs font-mono text-white/40 w-16 flex-shrink-0">{t.task_key}</span>
                      <span className={`flex-1 truncate ${done ? 'line-through text-white/50' : 'text-white/90'}`}>
                        {t.title}
                      </span>
                      {t.labels && t.labels.length > 0 && (
                        <span className="text-xs text-white/40">{t.labels.slice(0, 2).join(' ')}</span>
                      )}
                      {t.estimate != null && (
                        <span className="text-xs text-cyan-300 font-mono">{t.estimate}{t.estimate_unit === 'points' ? 'p' : 'h'}</span>
                      )}
                      {t.due_at && (
                        <span className="text-xs text-white/40 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(t.due_at * 1000).toLocaleDateString()}
                        </span>
                      )}
                      <AlertCircle className={`w-3 h-3 ${PRI_COLOR[t.priority] || 'text-white/30'}`} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
