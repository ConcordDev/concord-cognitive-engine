'use client';

/**
 * ProductivityTaskDetail — full task hierarchy: subtasks with their own
 * priorities and due dates, assignee, and threaded comments. Every
 * mutation routes through the productivity.subtask-* / task-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Check, Trash2, MessageSquare, UserPlus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Subtask {
  id: string;
  content: string;
  done: boolean;
  priority: number;
  dueDate: string | null;
}
interface Comment { id: string; body: string; authorId: string; createdAt: string }
interface TaskDetail {
  id: string;
  content: string;
  priority: number;
  dueDate: string | null;
  assigneeId: string | null;
  subtasks: Subtask[];
  comments?: Comment[];
}

const PRIORITY_COLOR: Record<number, string> = {
  1: 'text-rose-400', 2: 'text-amber-400', 3: 'text-sky-400', 4: 'text-zinc-400',
};

export function ProductivityTaskDetail({ taskId, onChange }: { taskId: string; onChange: () => void }) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subForm, setSubForm] = useState({ content: '', priority: '4', dueDate: '' });
  const [assignee, setAssignee] = useState('');
  const [commentBody, setCommentBody] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [d, c] = await Promise.all([
      lensRun('productivity', 'task-detail', { id: taskId }),
      lensRun('productivity', 'task-comments', { taskId }),
    ]);
    const t = (d.data?.result?.task as TaskDetail | undefined) || null;
    setTask(t);
    setAssignee(t?.assigneeId || '');
    setComments(c.data?.result?.comments || []);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addSub = async () => {
    if (!subForm.content.trim()) { setError('Subtask content is required.'); return; }
    const r = await lensRun('productivity', 'subtask-add', {
      taskId, content: subForm.content.trim(),
      priority: Number(subForm.priority) || 4,
      dueDate: subForm.dueDate || undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed.'); return; }
    setSubForm({ content: '', priority: '4', dueDate: '' });
    setError(null);
    await refresh();
    onChange();
  };
  const toggleSub = async (sub: Subtask) => {
    await lensRun('productivity', 'subtask-update', { taskId, id: sub.id, done: !sub.done });
    await refresh();
  };
  const updateSub = async (sub: Subtask, patch: Partial<Subtask>) => {
    await lensRun('productivity', 'subtask-update', { taskId, id: sub.id, ...patch });
    await refresh();
  };
  const delSub = async (sub: Subtask) => {
    await lensRun('productivity', 'subtask-toggle', { taskId, id: sub.id, remove: true });
    await refresh();
  };
  const assign = async () => {
    await lensRun('productivity', 'task-assign', { taskId, assigneeId: assignee.trim() || undefined });
    await refresh();
    onChange();
  };
  const addComment = async () => {
    if (!commentBody.trim()) return;
    const r = await lensRun('productivity', 'task-comment-add', { taskId, body: commentBody.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Comment failed.'); return; }
    setCommentBody('');
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-8 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }
  if (!task) {
    return <div className="text-xs text-zinc-400 italic py-4">Task not found.</div>;
  }

  const doneCount = task.subtasks.filter((s) => s.done).length;

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div>
        <p className="text-sm font-semibold text-zinc-100">{task.content}</p>
        <p className="text-[11px] text-zinc-400">
          <span className={PRIORITY_COLOR[task.priority]}>P{task.priority}</span>
          {task.dueDate && <span className="ml-2">{task.dueDate}</span>}
        </p>
      </div>

      {/* Assignee */}
      <div className="flex gap-2 items-center">
        <UserPlus className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
        <input placeholder="Assignee user id" value={assignee} onChange={(e) => setAssignee(e.target.value)}
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={assign}
          className="px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
          Assign
        </button>
      </div>

      {/* Subtasks */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400">
          Subtasks {task.subtasks.length > 0 && `(${doneCount}/${task.subtasks.length})`}
        </p>
        {task.subtasks.map((sub) => (
          <div key={sub.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-2.5 py-1.5">
            <button type="button" onClick={() => toggleSub(sub)}
              className="w-4 h-4 rounded-full border border-zinc-600 hover:border-red-500 flex items-center justify-center shrink-0">
              {sub.done && <Check className="w-3 h-3 text-red-400" />}
            </button>
            <span className={cn('flex-1 text-xs min-w-0 truncate', sub.done ? 'line-through text-zinc-600' : 'text-zinc-200')}>
              {sub.content}
            </span>
            <select value={String(sub.priority)} onChange={(e) => updateSub(sub, { priority: Number(e.target.value) })}
              aria-label="Subtask priority"
              className="bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-100">
              {[1, 2, 3, 4].map((p) => <option key={p} value={p}>P{p}</option>)}
            </select>
            <input type="date" value={sub.dueDate || ''} onChange={(e) => updateSub(sub, { dueDate: e.target.value })}
              aria-label="Subtask due date"
              className="bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-100 w-28" />
            <button aria-label="Delete" type="button" onClick={() => delSub(sub)} className="text-zinc-600 hover:text-rose-400 shrink-0">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <div className="grid grid-cols-4 gap-1.5">
          <input placeholder="New subtask" value={subForm.content} onChange={(e) => setSubForm({ ...subForm, content: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={subForm.priority} onChange={(e) => setSubForm({ ...subForm, priority: e.target.value })}
            aria-label="New subtask priority"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {[1, 2, 3, 4].map((p) => <option key={p} value={p}>P{p}</option>)}
          </select>
          <input type="date" value={subForm.dueDate} onChange={(e) => setSubForm({ ...subForm, dueDate: e.target.value })}
            aria-label="New subtask due date"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-1 py-1.5 text-xs text-zinc-100" />
        </div>
        <button type="button" onClick={addSub}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add subtask
        </button>
      </div>

      {/* Comments */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400 flex items-center gap-1">
          <MessageSquare className="w-3 h-3" /> Comments ({comments.length})
        </p>
        {comments.map((c) => (
          <div key={c.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-2.5 py-1.5">
            <p className="text-xs text-zinc-200">{c.body}</p>
            <p className="text-[10px] text-zinc-400">{c.authorId} · {c.createdAt.slice(0, 16).replace('T', ' ')}</p>
          </div>
        ))}
        <div className="flex gap-2">
          <input placeholder="Add a comment" value={commentBody} onChange={(e) => setCommentBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addComment(); }}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addComment}
            className="px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
            Post
          </button>
        </div>
      </div>
    </div>
  );
}
