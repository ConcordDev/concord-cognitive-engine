'use client';

import { useCallback, useMemo, useState } from 'react';
import { callTasksMacro, type Task } from '@/lib/api/tasks';
import { AlertCircle, Clock } from 'lucide-react';

interface Status { id: string; name: string; category: string; color: string; }

interface Props {
  tasks: Task[];
  statuses: Status[];
  onSelect: (id: string) => void;
  onChange: () => void;
}

const PRI_COLOR: Record<string, string> = {
  urgent: 'border-red-400/60',
  high: 'border-orange-300/50',
  medium: 'border-yellow-300/40',
  low: 'border-zinc-500/30',
  none: 'border-transparent',
};

export function TaskBoardView({ tasks, statuses, onSelect, onChange }: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const s of statuses) m.set(s.id, []);
    for (const t of tasks) {
      if (!m.has(t.status_id)) m.set(t.status_id, []);
      m.get(t.status_id)!.push(t);
    }
    return m;
  }, [tasks, statuses]);

  const handleDrop = useCallback(async (toStatusId: string) => {
    if (!draggingId) return;
    const task = tasks.find((t) => t.id === draggingId);
    if (!task || task.status_id === toStatusId) { setDraggingId(null); return; }
    await callTasksMacro('task_update', { id: draggingId, statusId: toStatusId });
    setDraggingId(null);
    onChange();
  }, [draggingId, tasks, onChange]);

  return (
    <div className="h-full overflow-x-auto p-2 flex gap-2">
      {statuses.map((s) => {
        const items = grouped.get(s.id) || [];
        return (
          <div
            key={s.id}
            className="flex flex-col w-72 flex-shrink-0 bg-black/30 rounded border border-white/5 max-h-full"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(s.id)}
          >
            <div className="px-2 py-1.5 border-b border-white/10 flex items-center gap-2 text-xs uppercase tracking-wide">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-white/80 font-medium flex-1">{s.name}</span>
              <span className="text-white/40">{items.length}</span>
            </div>
            <div className="p-1.5 space-y-1.5 overflow-y-auto flex-1 min-h-[2rem]">
              {items.map((t) => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={() => setDraggingId(t.id)}
                  onDragEnd={() => setDraggingId(null)}
                  onClick={() => onSelect(t.id)}
                  className={`p-2 rounded bg-white/5 hover:bg-white/10 cursor-pointer text-sm border-l-2 ${PRI_COLOR[t.priority] || PRI_COLOR.none} ${draggingId === t.id ? 'opacity-40' : ''}`}
                >
                  <div className="flex items-start gap-2 mb-1">
                    <span className="text-xs font-mono text-white/40">{t.task_key}</span>
                    {t.priority !== 'none' && <AlertCircle className="w-3 h-3 text-white/40" />}
                  </div>
                  <div className={`text-white/90 ${s.category === 'done' ? 'line-through opacity-60' : ''}`}>{t.title}</div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-white/40">
                    {t.assignee_id && <span className="font-mono">{t.assignee_id.slice(0, 8)}</span>}
                    {t.estimate != null && <span className="text-cyan-300">{t.estimate}{t.estimate_unit === 'points' ? 'p' : 'h'}</span>}
                    {t.due_at && <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{new Date(t.due_at * 1000).toLocaleDateString()}</span>}
                  </div>
                  {t.labels && t.labels.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.labels.map((l) => (
                        <span key={l} className="px-1.5 py-0.5 rounded bg-white/10 text-xs text-white/60">{l}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {items.length === 0 && <div className="text-xs text-white/20 px-1 py-2">Drop tasks here</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
