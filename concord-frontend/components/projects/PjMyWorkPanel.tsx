'use client';

/**
 * PjMyWorkPanel — D3 (depends on S4): the caller's personal queue.
 * Everything assigned to the signed-in account across all their
 * projects, grouped by due state. Completing a row writes through the
 * normal status path, so the project's board updates in the same beat.
 * Below the queue: projects other accounts have shared with the caller
 * (ACL discovery via shared-with-me — names and levels only; opening a
 * shared project's tasks rides the platform's shared read path).
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Circle, Share2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ErrorState } from '@/components/ui';

interface MyTask {
  id: string; ref: string; title: string; projectId: string;
  projectName: string | null; projectKey: string | null;
  priority: string; dueDate: string | null; status: string;
}
interface SharedProject { projectId: string; name: string | null; key: string | null; level: string; ownerName: string | null }

const GROUPS: { id: string; label: string; test: (t: MyTask, today: string, week: string) => boolean }[] = [
  { id: 'overdue', label: 'Overdue', test: (t, today) => !!t.dueDate && t.dueDate < today },
  { id: 'today', label: 'Due today', test: (t, today) => t.dueDate === today },
  { id: 'week', label: 'This week', test: (t, today, week) => !!t.dueDate && t.dueDate > today && t.dueDate <= week },
  { id: 'later', label: 'Later', test: (t, _today, week) => !!t.dueDate && t.dueDate > week },
  { id: 'nodate', label: 'No due date', test: (t) => !t.dueDate },
];

function dayStr(d: Date) { return d.toISOString().slice(0, 10); }

export function PjMyWorkPanel({ onOpenTask }: { onOpenTask: (projectId: string, taskId: string) => void }) {
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [shared, setShared] = useState<SharedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [mine, sharedR] = await Promise.all([
      lensRun('projects', 'my-work', {}),
      lensRun('projects', 'shared-with-me', {}),
    ]);
    if (mine.data?.ok === false) {
      setLoadError(mine.data?.error || 'Could not load your work.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setTasks(mine.data?.result?.tasks || []);
    setShared(sharedR.data?.result?.projects || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const complete = async (task: MyTask) => {
    setTasks((prev) => prev.filter((x) => x.id !== task.id));
    await lensRun('projects', 'task-move-status', { id: task.id, status: 'done' });
    await refresh();
  };

  if (loadError) {
    return <div className="p-4"><ErrorState message={loadError} onRetry={refresh} /></div>;
  }
  if (loading) {
    return <p className="text-[11px] text-gray-400 italic py-6 text-center" aria-busy="true">Loading your work…</p>;
  }

  const today = dayStr(new Date());
  const week = dayStr(new Date(Date.now() + 7 * 86400000));

  return (
    <div className="space-y-5">
      {tasks.length === 0 ? (
        <div className="text-center py-8">
          <CheckCircle2 className="w-8 h-8 text-teal-400 mx-auto mb-2" />
          <p className="text-sm text-zinc-200 font-medium">Nothing assigned to you right now.</p>
          <p className="text-[11px] text-gray-500 mt-1">Work assigned to your account — by you or by a project owner who added you — lands here.</p>
        </div>
      ) : (
        GROUPS.map((g) => {
          const rows = tasks.filter((t) => g.test(t, today, week));
          if (rows.length === 0) return null;
          return (
            <section key={g.id}>
              <h3 className={`text-[11px] font-semibold uppercase tracking-wide mb-1.5 ${g.id === 'overdue' ? 'text-rose-300' : 'text-zinc-400'}`}>{g.label} · {rows.length}</h3>
              <ul className="space-y-1.5">
                {rows.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 bg-lattice-surface/70 border border-lattice-border rounded-lg px-3 py-2">
                    <button type="button" aria-label={`Complete ${t.ref}`} onClick={() => void complete(t)}
                      className="text-gray-500 hover:text-teal-300 shrink-0">
                      <Circle className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => onOpenTask(t.projectId, t.id)} className="flex-1 min-w-0 text-left">
                      <span className="text-xs font-medium text-white block truncate">{t.title}</span>
                      <span className="text-[10px] text-gray-500">{t.ref} · {t.projectName || t.projectKey || 'Project'}{t.dueDate ? ` · due ${t.dueDate}` : ''}</span>
                    </button>
                    {t.priority !== 'none' && (
                      <span className={`text-[9px] uppercase tracking-wide ${t.priority === 'urgent' || t.priority === 'high' ? 'text-rose-300' : 'text-gray-400'}`}>{t.priority}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      {shared.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 mb-1.5 flex items-center gap-1">
            <Share2 className="w-3 h-3" /> Shared with you
          </h3>
          <ul className="space-y-1.5">
            {shared.map((p) => (
              <li key={p.projectId} className="flex items-center gap-3 bg-lattice-surface/70 border border-lattice-border rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-white block truncate">{p.name || 'A project'}</span>
                  <span className="text-[10px] text-gray-500">{p.ownerName ? `by ${p.ownerName} · ` : ''}{p.level === 'edit' ? 'Can edit' : 'Can view'}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
