'use client';

/**
 * PjBacklogPanel — the issue list: filters, saved views, multi-select
 * bulk operations and rank ordering.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { PjTaskDetail } from './PjTaskDetail';

interface Task {
  id: string; ref: string; title: string; status: string; priority: string; type: string;
  points: number; assigneeId: string | null; rank: number;
}
interface Meta {
  members: { id: string; name: string }[];
  sprints: { id: string; name: string }[];
  milestones: { id: string; name: string }[];
  labels: { id: string; name: string; color: string }[];
  customFields: { id: string; name: string; type: string; options: string[] }[];
}
interface View { id: string; name: string; filters: Record<string, string | null> }

const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'];
const TYPES = ['story', 'bug', 'task', 'epic', 'chore'];
const SORTS = ['created', 'updated', 'priority', 'due', 'rank'];

export function PjBacklogPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [views, setViews] = useState<View[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: '', assigneeId: '', priority: '', type: '', query: '', sort: 'rank' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [viewName, setViewName] = useState('');
  const [bulk, setBulk] = useState({ status: '', priority: '' });

  const loadMeta = useCallback(async () => {
    const g = await lensRun('projects', 'project-get', { id: projectId });
    const res = g.data?.result as (Meta & { project: unknown }) | null;
    setMeta(res ? { members: res.members, sprints: res.sprints, milestones: res.milestones, labels: res.labels, customFields: res.customFields } : null);
    const v = await lensRun('projects', 'view-list', { projectId });
    setViews(v.data?.result?.views || []);
  }, [projectId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = { projectId, sort: filters.sort };
    if (filters.status) params.status = filters.status;
    if (filters.assigneeId) params.assigneeId = filters.assigneeId;
    if (filters.priority) params.priority = filters.priority;
    if (filters.type) params.type = filters.type;
    if (filters.query) params.query = filters.query;
    const r = await lensRun('projects', 'task-list', params);
    setTasks(r.data?.result?.tasks || []);
    setLoading(false);
    onChange();
  }, [projectId, filters, onChange]);

  useEffect(() => { void loadMeta(); }, [loadMeta]);
  useEffect(() => { void refresh(); }, [refresh]);

  const toggleSel = (id: string) => {
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const saveView = async () => {
    if (!viewName.trim()) return;
    await lensRun('projects', 'view-create', { projectId, name: viewName.trim(), filters });
    setViewName('');
    await loadMeta();
  };

  const runView = async (v: View) => {
    setFilters({
      status: v.filters.status || '', assigneeId: v.filters.assigneeId || '',
      priority: v.filters.priority || '', type: v.filters.type || '',
      query: v.filters.query || '', sort: v.filters.sort || 'created',
    });
  };

  const applyBulk = async () => {
    if (!selected.size) return;
    const patch: Record<string, string> = {};
    if (bulk.status) patch.status = bulk.status;
    if (bulk.priority) patch.priority = bulk.priority;
    if (Object.keys(patch).length) {
      await lensRun('projects', 'task-bulk-update', { ids: [...selected], patch });
    }
    setBulk({ status: '', priority: '' });
    setSelected(new Set());
    await refresh();
  };

  const bulkDelete = async () => {
    if (!selected.size) return;
    await lensRun('projects', 'task-bulk-delete', { ids: [...selected] });
    setSelected(new Set());
    await refresh();
  };

  const rank = async (id: string, dir: -1 | 1) => {
    const idx = tasks.findIndex((t) => t.id === id);
    await lensRun('projects', 'task-rank', { id, toIndex: Math.max(0, idx + dir) });
    await refresh();
  };

  if (loading && !tasks.length) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={selCls}>
            <option value="">Any status</option>
            {STATUSES.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}
          </select>
          <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} className={selCls}>
            <option value="">Any priority</option>
            {PRIORITIES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} className={selCls}>
            <option value="">Any type</option>
            {TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={filters.assigneeId} onChange={(e) => setFilters({ ...filters, assigneeId: e.target.value })} className={selCls}>
            <option value="">Any assignee</option>
            {meta?.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input placeholder="Search…" value={filters.query} onChange={(e) => setFilters({ ...filters, query: e.target.value })} className={selCls} />
          <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })} className={selCls}>
            {SORTS.map((x) => <option key={x} value={x}>sort: {x}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {views.map((v) => (
            <span key={v.id} className="flex items-center gap-1 text-[10px] bg-zinc-800 rounded-lg pl-2 pr-1 py-0.5">
              <button type="button" onClick={() => runView(v)} className="text-zinc-300 hover:text-indigo-300">{v.name}</button>
              <button type="button" onClick={() => lensRun('projects', 'view-delete', { id: v.id }).then(loadMeta)}
                className="text-zinc-400 hover:text-rose-300">×</button>
            </span>
          ))}
          <input placeholder="Save current as view…" value={viewName} onChange={(e) => setViewName(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-zinc-100" />
          <button type="button" onClick={saveView}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded">
            <Save className="w-3 h-3" /> Save view
          </button>
        </div>
      </section>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-indigo-950/40 border border-indigo-900/50 rounded-lg px-3 py-2">
          <span className="text-xs text-indigo-200">{selected.size} selected</span>
          <select value={bulk.status} onChange={(e) => setBulk({ ...bulk, status: e.target.value })} className={selCls}>
            <option value="">Set status…</option>
            {STATUSES.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}
          </select>
          <select value={bulk.priority} onChange={(e) => setBulk({ ...bulk, priority: e.target.value })} className={selCls}>
            <option value="">Set priority…</option>
            {PRIORITIES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <button type="button" onClick={applyBulk}
            className="text-[11px] px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">Apply</button>
          <button type="button" onClick={bulkDelete}
            className="text-[11px] px-2.5 py-1 bg-zinc-800 hover:bg-rose-900 text-zinc-200 rounded-lg">Delete</button>
          <button type="button" onClick={() => setSelected(new Set())}
            className="text-[11px] text-zinc-400 hover:text-zinc-200">Clear</button>
        </div>
      )}

      {/* List */}
      {tasks.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No issues match these filters.</p>
      ) : (
        <ul className="space-y-1">
          {tasks.map((t, i) => (
            <li key={t.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-2.5 py-1.5">
              <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSel(t.id)}
                className="accent-indigo-500" />
              <span className="text-[10px] font-mono text-zinc-400 w-14">{t.ref}</span>
              <button type="button" onClick={() => setOpenTask(t.id)} className="flex-1 text-left text-xs text-zinc-100 truncate">
                {t.title}
              </button>
              <span className="text-[10px] text-zinc-400 capitalize">{t.type}</span>
              <span className="text-[10px] text-zinc-400 capitalize">{t.status.replace(/_/g, ' ')}</span>
              {t.points > 0 && <span className="text-[10px] text-zinc-400">{t.points}pt</span>}
              {filters.sort === 'rank' && (
                <span className="flex">
                  <button aria-label="Collapse" type="button" onClick={() => rank(t.id, -1)} disabled={i === 0}
                    className="text-zinc-600 hover:text-zinc-300 disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
                  <button aria-label="Expand" type="button" onClick={() => rank(t.id, 1)} disabled={i === tasks.length - 1}
                    className="text-zinc-600 hover:text-zinc-300 disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
                </span>
              )}
              <button aria-label="Delete" type="button" onClick={() => lensRun('projects', 'task-delete', { id: t.id }).then(refresh)}
                className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}

      {openTask && meta && (
        <PjTaskDetail
          taskId={openTask} projectId={projectId}
          members={meta.members} sprints={meta.sprints} milestones={meta.milestones}
          labels={meta.labels} customFields={meta.customFields}
          allTasks={tasks.map((t) => ({ id: t.id, ref: t.ref, title: t.title }))}
          onClose={() => setOpenTask(null)} onChange={refresh}
        />
      )}
    </div>
  );
}

const selCls = 'bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100';
