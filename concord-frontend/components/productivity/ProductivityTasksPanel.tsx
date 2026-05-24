'use client';

/**
 * ProductivityTasksPanel — full task list with add, project filtering
 * and project management.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, FolderPlus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ProductivityTaskRow, type ProdTask } from './ProductivityTaskRow';

interface Project { id: string; name: string; color: string; taskCount: number }

export function ProductivityTasksPanel({ onChange }: { onChange: () => void }) {
  const [tasks, setTasks] = useState<ProdTask[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState('');
  const [form, setForm] = useState({ content: '', priority: '4', dueDate: '', projectId: '', labels: '', recurring: '' });
  const [showAdd, setShowAdd] = useState(false);
  const [projName, setProjName] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [t, p] = await Promise.all([
      lensRun('productivity', 'task-list', projectFilter ? { projectId: projectFilter } : {}),
      lensRun('productivity', 'project-list', {}),
    ]);
    setTasks(t.data?.result?.tasks || []);
    setProjects(p.data?.result?.projects || []);
    setLoading(false);
    onChange();
  }, [projectFilter, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    if (!form.content.trim()) { setError('Task content is required.'); return; }
    const r = await lensRun('productivity', 'task-add', {
      content: form.content.trim(), priority: Number(form.priority) || 4,
      dueDate: form.dueDate, projectId: form.projectId || undefined,
      labels: form.labels.split(',').map((l) => l.trim()).filter(Boolean),
      recurring: form.recurring || undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ content: '', priority: '4', dueDate: '', projectId: '', labels: '', recurring: '' });
    setShowAdd(false); setError(null);
    await refresh();
  };
  const createProject = async () => {
    if (!projName.trim()) { setError('Project name is required.'); return; }
    await lensRun('productivity', 'project-create', { name: projName.trim() });
    setProjName(''); setError(null);
    await refresh();
  };
  const delProject = async (id: string) => {
    await lensRun('productivity', 'project-delete', { id });
    if (projectFilter === id) setProjectFilter('');
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Projects */}
      <div className="flex items-center gap-2">
        <div className="flex flex-wrap gap-1 flex-1">
          <button type="button" onClick={() => setProjectFilter('')}
            className={cn('text-[11px] px-2 py-0.5 rounded-full border', projectFilter === '' ? 'border-red-700/50 bg-red-950/40 text-red-300' : 'border-zinc-700 text-zinc-400')}>
            All
          </button>
          {projects.map((p) => (
            <span key={p.id} className="inline-flex items-center">
              <button type="button" onClick={() => setProjectFilter(p.id)}
                className={cn('text-[11px] pl-2 pr-1 py-0.5 rounded-l-full border-y border-l',
                  projectFilter === p.id ? 'border-red-700/50 bg-red-950/40 text-red-300' : 'border-zinc-700 text-zinc-400')}>
                {p.name} ({p.taskCount})
              </button>
              <button type="button" onClick={() => delProject(p.id)}
                className={cn('text-[11px] px-1 py-0.5 rounded-r-full border-y border-r text-zinc-400 hover:text-rose-400',
                  projectFilter === p.id ? 'border-red-700/50 bg-red-950/40' : 'border-zinc-700')}>
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <input value={projName} onChange={(e) => setProjName(e.target.value)} placeholder="New project…"
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={createProject}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
          <FolderPlus className="w-3.5 h-3.5" /> Project
        </button>
      </div>

      {/* Add task */}
      <button type="button" onClick={() => setShowAdd((v) => !v)}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg">
        <Plus className="w-3.5 h-3.5" /> Add task
      </button>
      {showAdd && (
        <div className="grid grid-cols-3 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="What needs doing?" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
            className="col-span-3 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {[1, 2, 3, 4].map((p) => <option key={p} value={p}>Priority {p}</option>)}
          </select>
          <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.recurring} onChange={(e) => setForm({ ...form, recurring: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            <option value="">One-time</option>
            <option value="daily">Daily</option>
            <option value="weekday">Every weekday</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            <option value="every 3 days">Every 3 days</option>
            <option value="every 7 days">Every 7 days</option>
            <option value="every 14 days">Every 14 days</option>
          </select>
          <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input placeholder="Labels (comma)" value={form.labels} onChange={(e) => setForm({ ...form, labels: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={add}
            className="bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg">Add</button>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No tasks. Add one to get started.
        </div>
      ) : (
        <ul className="space-y-1">
          {tasks.map((t) => <ProductivityTaskRow key={t.id} task={t} onChange={refresh} />)}
        </ul>
      )}
    </div>
  );
}
