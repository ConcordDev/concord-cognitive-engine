'use client';

/**
 * PjBoardPanel — the issue board (status columns) plus a task detail
 * editor with comments.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, MessageSquare, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Task {
  id: string; ref: string; title: string; description: string | null; status: string;
  priority: string; assigneeId: string | null; assigneeName?: string | null;
  sprintId: string | null; labels: string[]; points: number; dueDate: string | null;
}
interface Column { status: string; tasks: Task[] }
interface Member { id: string; name: string }
interface Comment { id: string; body: string; author: string; createdAt: string }

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

export function PjBoardPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [columns, setColumns] = useState<Column[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', priority: 'none', status: 'backlog' });
  const [selected, setSelected] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentBody, setCommentBody] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [b, m] = await Promise.all([
      lensRun('projects', 'board', { projectId }),
      lensRun('projects', 'member-list', { projectId }),
    ]);
    setColumns(b.data?.result?.columns || []);
    setMembers(m.data?.result?.members || []);
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addTask = async () => {
    if (!form.title.trim()) { setError('Task title is required.'); return; }
    const r = await lensRun('projects', 'task-create', {
      projectId, title: form.title.trim(), priority: form.priority, status: form.status,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', priority: 'none', status: 'backlog' });
    setError(null);
    await refresh();
  };

  const moveStatus = async (task: Task, status: string) => {
    await lensRun('projects', 'task-move-status', { id: task.id, status });
    await refresh();
  };

  const openTask = async (task: Task) => {
    setSelected(task);
    const r = await lensRun('projects', 'task-comments', { taskId: task.id });
    setComments(r.data?.result?.comments || []);
  };

  const saveTask = async () => {
    if (!selected) return;
    await lensRun('projects', 'task-update', {
      id: selected.id, title: selected.title, description: selected.description || '',
      priority: selected.priority, points: selected.points,
      dueDate: selected.dueDate || '', assigneeId: selected.assigneeId,
      labels: selected.labels,
    });
    setSelected(null);
    await refresh();
  };

  const delTask = async (id: string) => {
    await lensRun('projects', 'task-delete', { id });
    setSelected(null);
    await refresh();
  };

  const addComment = async () => {
    if (!selected || !commentBody.trim()) return;
    await lensRun('projects', 'task-comment-add', { taskId: selected.id, body: commentBody.trim() });
    setCommentBody('');
    const r = await lensRun('projects', 'task-comments', { taskId: selected.id });
    setComments(r.data?.result?.comments || []);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* New task */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Task title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="button" onClick={addTask}
          className="flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Task
        </button>
      </section>

      {/* Task detail */}
      {selected && (
        <section className="bg-zinc-900/80 border border-indigo-800/60 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-indigo-400">{selected.ref}</span>
            <input value={selected.title} onChange={(e) => setSelected({ ...selected, title: e.target.value })}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm font-semibold text-zinc-100" />
            <button type="button" onClick={() => setSelected(null)} className="text-zinc-500 hover:text-zinc-300">
              <X className="w-4 h-4" />
            </button>
          </div>
          <textarea value={selected.description || ''} placeholder="Description"
            onChange={(e) => setSelected({ ...selected, description: e.target.value })}
            rows={3}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 resize-y" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <select value={selected.priority} onChange={(e) => setSelected({ ...selected, priority: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={selected.assigneeId || ''} onChange={(e) => setSelected({ ...selected, assigneeId: e.target.value || null })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input type="number" placeholder="Points" value={selected.points || ''}
              onChange={(e) => setSelected({ ...selected, points: Number(e.target.value) || 0 })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input type="date" value={selected.dueDate || ''}
              onChange={(e) => setSelected({ ...selected, dueDate: e.target.value || null })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          </div>
          <input placeholder="Labels (comma-separated)" value={selected.labels.join(', ')}
            onChange={(e) => setSelected({ ...selected, labels: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <div className="flex items-center gap-2">
            <button type="button" onClick={saveTask}
              className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">Save</button>
            <button type="button" onClick={() => delTask(selected.id)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-zinc-800 hover:bg-rose-900 text-zinc-200 rounded-lg">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
          {/* Comments */}
          <div className="pt-2 border-t border-zinc-800">
            <p className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400 mb-1.5">
              <MessageSquare className="w-3 h-3" /> Comments
            </p>
            <ul className="space-y-1 mb-2">
              {comments.map((c) => (
                <li key={c.id} className="text-[11px] bg-zinc-950/60 rounded px-2 py-1">
                  <span className="text-zinc-300">{c.body}</span>
                  <span className="text-zinc-600"> — {c.author}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <input placeholder="Add a comment" value={commentBody} onChange={(e) => setCommentBody(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void addComment(); }}
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
              <button type="button" onClick={addComment}
                className="px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">Post</button>
            </div>
          </div>
        </section>
      )}

      {/* Board */}
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {STATUSES.map((col) => {
          const colData = columns.find((c) => c.status === col.id);
          const tasks = colData?.tasks || [];
          return (
            <div key={col.id} className="bg-zinc-900/50 border-t-2 border-indigo-700 rounded-lg p-2">
              <p className="text-[10px] font-semibold text-zinc-400 uppercase mb-1.5">
                {col.label} <span className="text-zinc-600">{tasks.length}</span>
              </p>
              <ul className="space-y-1.5">
                {tasks.map((t) => (
                  <li key={t.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2">
                    <button type="button" onClick={() => openTask(t)} className="block w-full text-left">
                      <p className="text-xs text-zinc-100">{t.title}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className="text-[9px] font-mono text-zinc-500">{t.ref}</span>
                        {t.priority !== 'none' && (
                          <span className={cn('text-[9px] uppercase', PRIORITY_COLOR[t.priority])}>{t.priority}</span>
                        )}
                        {t.points > 0 && <span className="text-[9px] text-zinc-500">{t.points}pt</span>}
                        {t.assigneeName && <span className="text-[9px] text-indigo-400">{t.assigneeName}</span>}
                        {t.labels.map((l) => <span key={l} className="text-[9px] text-zinc-500">#{l}</span>)}
                      </div>
                    </button>
                    <select value={t.status} onChange={(e) => moveStatus(t, e.target.value)}
                      className="mt-1.5 w-full bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-300">
                      {STATUSES.map((sx) => <option key={sx.id} value={sx.id}>{sx.label}</option>)}
                    </select>
                  </li>
                ))}
                {tasks.length === 0 && <li className="text-[10px] text-zinc-600 italic px-1">Empty</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
