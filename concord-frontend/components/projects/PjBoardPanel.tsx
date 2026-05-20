'use client';

/**
 * PjBoardPanel — the issue board: status columns with WIP limits and an
 * optional swimlane grouping. Cards open the full PjTaskDetail editor.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { PjTaskDetail } from './PjTaskDetail';

interface Task {
  id: string; ref: string; title: string; status: string; priority: string;
  type: string; points: number; assigneeId: string | null; assigneeName?: string | null;
  labels: string[]; parentId: string | null;
}
interface Column { status: string; tasks: Task[] }
interface Meta {
  members: { id: string; name: string }[];
  sprints: { id: string; name: string }[];
  milestones: { id: string; name: string }[];
  labels: { id: string; name: string; color: string }[];
  customFields: { id: string; name: string; type: string; options: string[] }[];
}

const STATUSES = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
];
const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'];
const PRIORITY_COLOR: Record<string, string> = {
  none: 'text-zinc-600', low: 'text-sky-400', medium: 'text-amber-400',
  high: 'text-orange-400', urgent: 'text-rose-400',
};
const TYPE_COLOR: Record<string, string> = {
  story: 'text-emerald-400', bug: 'text-rose-400', task: 'text-sky-400',
  epic: 'text-violet-400', chore: 'text-zinc-400',
};

export function PjBoardPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [columns, setColumns] = useState<Column[]>([]);
  const [swimlanes, setSwimlanes] = useState<{ key: string; label: string; columns: Column[] }[]>([]);
  const [wip, setWip] = useState<Record<string, number>>({});
  const [meta, setMeta] = useState<Meta | null>(null);
  const [allTasks, setAllTasks] = useState<{ id: string; ref: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<string>('none');
  const [form, setForm] = useState({ title: '', type: 'task', priority: 'none' });
  const [openTask, setOpenTask] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [b, w, g, list] = await Promise.all([
      lensRun('projects', 'board', { projectId }),
      lensRun('projects', 'wip-list', { projectId }),
      lensRun('projects', 'project-get', { id: projectId }),
      lensRun('projects', 'task-list', { projectId }),
    ]);
    setColumns(b.data?.result?.columns || []);
    const wmap: Record<string, number> = {};
    for (const lim of (w.data?.result?.limits || []) as { status: string; limit: number }[]) wmap[lim.status] = lim.limit;
    setWip(wmap);
    const res = g.data?.result as (Meta & { project: unknown }) | null;
    setMeta(res ? { members: res.members, sprints: res.sprints, milestones: res.milestones, labels: res.labels, customFields: res.customFields } : null);
    setAllTasks(((list.data?.result?.tasks || []) as Task[]).map((t) => ({ id: t.id, ref: t.ref, title: t.title })));
    if (groupBy !== 'none') {
      const sl = await lensRun('projects', 'board-swimlanes', { projectId, groupBy });
      setSwimlanes(sl.data?.result?.swimlanes || []);
    }
    setLoading(false);
    onChange();
  }, [projectId, groupBy, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addTask = async () => {
    if (!form.title.trim()) { setError('Task title is required.'); return; }
    const r = await lensRun('projects', 'task-create', {
      projectId, title: form.title.trim(), type: form.type, priority: form.priority,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', type: 'task', priority: 'none' });
    setError(null);
    await refresh();
  };

  const moveStatus = async (id: string, status: string) => {
    await lensRun('projects', 'task-move-status', { id, status });
    await refresh();
  };

  const labelColor = (name: string) => meta?.labels.find((l) => l.name === name)?.color || 'zinc';

  const renderCard = (t: Task) => (
    <li key={t.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2">
      <button type="button" onClick={() => setOpenTask(t.id)} className="block w-full text-left">
        <p className="text-xs text-zinc-100">{t.title}</p>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <span className="text-[9px] font-mono text-zinc-500">{t.ref}</span>
          <span className={cn('text-[9px] uppercase', TYPE_COLOR[t.type])}>{t.type}</span>
          {t.priority !== 'none' && <span className={cn('text-[9px] uppercase', PRIORITY_COLOR[t.priority])}>{t.priority}</span>}
          {t.points > 0 && <span className="text-[9px] text-zinc-500">{t.points}pt</span>}
          {t.assigneeName && <span className="text-[9px] text-indigo-400">{t.assigneeName}</span>}
          {t.labels.map((l) => (
            <span key={l} className="text-[9px] px-1 rounded text-white" style={{ background: cssColor(labelColor(l)) }}>{l}</span>
          ))}
        </div>
      </button>
      <select value={t.status} onChange={(e) => moveStatus(t.id, e.target.value)}
        className="mt-1.5 w-full bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-300">
        {STATUSES.map((sx) => <option key={sx.id} value={sx.id}>{sx.label}</option>)}
      </select>
    </li>
  );

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* New task + swimlane toggle */}
      <section className="flex flex-wrap items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Task title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
          {['task', 'story', 'bug', 'epic', 'chore'].map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="button" onClick={addTask}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Task
        </button>
        <span className="text-[11px] text-zinc-500 ml-auto">Swimlanes</span>
        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          {['none', 'assignee', 'epic', 'priority', 'type'].map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </section>

      {/* Board */}
      {groupBy === 'none' ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {STATUSES.map((col) => {
            const tasks = columns.find((c) => c.status === col.id)?.tasks || [];
            const limit = wip[col.id];
            const over = limit > 0 && tasks.length > limit;
            return (
              <div key={col.id} className={cn('bg-zinc-900/50 border-t-2 rounded-lg p-2', over ? 'border-rose-600' : 'border-indigo-700')}>
                <p className="text-[10px] font-semibold text-zinc-400 uppercase mb-1.5">
                  {col.label} <span className={over ? 'text-rose-400' : 'text-zinc-600'}>{tasks.length}{limit > 0 ? `/${limit}` : ''}</span>
                </p>
                <ul className="space-y-1.5">
                  {tasks.map(renderCard)}
                  {tasks.length === 0 && <li className="text-[10px] text-zinc-600 italic px-1">Empty</li>}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {swimlanes.map((lane) => (
            <div key={lane.key}>
              <p className="text-xs font-semibold text-indigo-300 mb-1">{lane.label}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {STATUSES.map((col) => {
                  const tasks = lane.columns.find((c) => c.status === col.id)?.tasks || [];
                  return (
                    <div key={col.id} className="bg-zinc-900/50 border-t-2 border-zinc-700 rounded-lg p-2">
                      <p className="text-[10px] font-semibold text-zinc-500 uppercase mb-1.5">{col.label} {tasks.length}</p>
                      <ul className="space-y-1.5">{tasks.map(renderCard)}</ul>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {openTask && meta && (
        <PjTaskDetail
          taskId={openTask} projectId={projectId}
          members={meta.members} sprints={meta.sprints} milestones={meta.milestones}
          labels={meta.labels} customFields={meta.customFields} allTasks={allTasks}
          onClose={() => setOpenTask(null)}
          onChange={refresh}
        />
      )}
    </div>
  );
}

function cssColor(c: string): string {
  const map: Record<string, string> = {
    red: '#dc2626', rose: '#e11d48', orange: '#ea580c', amber: '#d97706', yellow: '#ca8a04',
    lime: '#65a30d', green: '#16a34a', emerald: '#059669', teal: '#0d9488', cyan: '#0891b2',
    sky: '#0284c7', blue: '#2563eb', indigo: '#4f46e5', violet: '#7c3aed', purple: '#9333ea',
    fuchsia: '#c026d3', pink: '#db2777', zinc: '#52525b',
  };
  return map[c] || '#52525b';
}
