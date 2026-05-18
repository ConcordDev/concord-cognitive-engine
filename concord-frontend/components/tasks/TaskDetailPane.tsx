'use client';

import { useState, useEffect, useCallback } from 'react';
import { callTasksMacro, type Task, type Workflow, type Sprint } from '@/lib/api/tasks';
import { X, AlertCircle, Trash2, Link2, MessageSquare, Clock, Loader2 } from 'lucide-react';

interface Props {
  task: Task;
  workflow: Workflow;
  sprints: Sprint[];
  onClose: () => void;
  onChange: () => void;
}

interface Comment { id: string; thread_id: string; author_id: string; body: string; resolved: number; created_at: number; }
interface HistoryItem { id: number; actor_id: string; action: string; field?: string | null; before_value?: string | null; after_value?: string | null; created_at: number; }
interface LinkItem { id: number; target_kind: string; target_id?: string | null; target_uri?: string | null; target_label?: string | null; }

const PRIORITIES = ['urgent','high','medium','low','none'] as const;

export function TaskDetailPane({ task, workflow, sprints, onClose, onChange }: Props) {
  const [fresh, setFresh] = useState<Task>(task);
  const [comments, setComments] = useState<Comment[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [composing, setComposing] = useState('');
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFresh(task);
    setTitleDraft(task.title);
    (async () => {
      const [c, h, l] = await Promise.all([
        callTasksMacro<{ comments?: Comment[] }>('comment_list', { taskId: task.id }),
        callTasksMacro<{ history?: HistoryItem[] }>('task_history', { taskId: task.id }),
        callTasksMacro<{ links?: LinkItem[] }>('link_list', { taskId: task.id }),
      ]);
      setComments(c.comments || []);
      setHistory(h.history || []);
      setLinks(l.links || []);
    })();
  }, [task.id]);

  const update = useCallback(async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await callTasksMacro('task_update', { id: task.id, ...patch });
      if (r.ok) onChange();
    } finally { setBusy(false); }
  }, [task.id, onChange]);

  const remove = useCallback(async () => {
    if (!confirm('Delete this task?')) return;
    setBusy(true);
    try {
      await callTasksMacro('task_delete', { id: task.id });
      onClose();
      onChange();
    } finally { setBusy(false); }
  }, [task.id, onChange, onClose]);

  const submitComment = useCallback(async () => {
    if (!composing.trim()) return;
    await callTasksMacro('comment_add', { taskId: task.id, body: composing.trim() });
    setComposing('');
    const c = await callTasksMacro<{ comments?: Comment[] }>('comment_list', { taskId: task.id });
    setComments(c.comments || []);
  }, [composing, task.id]);

  return (
    <aside className="w-96 border-l border-white/10 flex flex-col bg-black/60">
      <div className="flex items-center gap-2 p-3 border-b border-white/10">
        <span className="text-xs font-mono text-white/40">{fresh.task_key}</span>
        <span className="flex-1" />
        <button onClick={remove} className="p-1.5 rounded hover:bg-red-500/20 text-red-400" disabled={busy}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10 text-white/60">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Title */}
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => titleDraft !== fresh.title && update({ title: titleDraft })}
          className="w-full bg-transparent text-lg font-semibold text-white focus:outline-none"
        />

        {/* Status + priority + assignee inline */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <label className="text-white/40 uppercase">Status</label>
            <select
              value={fresh.status_id}
              onChange={(e) => update({ statusId: e.target.value })}
              disabled={busy}
              className="w-full mt-1 px-2 py-1 bg-white/5 border border-white/10 rounded text-white text-sm"
            >
              {workflow.statuses.map((s) => <option key={s.id} value={s.id} className="bg-black">{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-white/40 uppercase">Priority</label>
            <select
              value={fresh.priority}
              onChange={(e) => update({ priority: e.target.value })}
              disabled={busy}
              className="w-full mt-1 px-2 py-1 bg-white/5 border border-white/10 rounded text-white text-sm"
            >
              {PRIORITIES.map((p) => <option key={p} value={p} className="bg-black">{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-white/40 uppercase">Assignee</label>
            <input
              defaultValue={fresh.assignee_id || ''}
              onBlur={(e) => e.target.value !== (fresh.assignee_id || '') && update({ assigneeId: e.target.value || null })}
              placeholder="user id"
              className="w-full mt-1 px-2 py-1 bg-white/5 border border-white/10 rounded text-white text-sm"
            />
          </div>
          <div>
            <label className="text-white/40 uppercase">Estimate ({fresh.estimate_unit})</label>
            <input
              type="number"
              defaultValue={fresh.estimate ?? ''}
              onBlur={(e) => {
                const n = e.target.value ? Number(e.target.value) : null;
                if (n !== fresh.estimate) update({ estimate: n });
              }}
              className="w-full mt-1 px-2 py-1 bg-white/5 border border-white/10 rounded text-white text-sm"
            />
          </div>
          <div className="col-span-2">
            <label className="text-white/40 uppercase">Due date</label>
            <input
              type="date"
              defaultValue={fresh.due_at ? new Date(fresh.due_at * 1000).toISOString().slice(0,10) : ''}
              onBlur={(e) => {
                const v = e.target.value ? Math.floor(new Date(e.target.value).getTime() / 1000) : null;
                if (v !== fresh.due_at) update({ dueAt: v });
              }}
              className="w-full mt-1 px-2 py-1 bg-white/5 border border-white/10 rounded text-white text-sm"
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs text-white/40 uppercase">Description</label>
          <textarea
            defaultValue={fresh.description_html?.replace(/<[^>]+>/g, '') || ''}
            onBlur={(e) => update({ descriptionHtml: `<p>${e.target.value.replace(/\n+/g,'</p><p>')}</p>` })}
            rows={4}
            placeholder="What's the goal? Why does this matter?"
            className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white placeholder-white/40 resize-none"
          />
        </div>

        {/* Labels */}
        {fresh.labels && fresh.labels.length > 0 && (
          <div>
            <label className="text-xs text-white/40 uppercase">Labels</label>
            <div className="mt-1 flex flex-wrap gap-1">
              {fresh.labels.map((l) => (
                <span key={l} className="px-1.5 py-0.5 rounded bg-white/10 text-xs text-white/80">{l}</span>
              ))}
            </div>
          </div>
        )}

        {/* Links */}
        {links.length > 0 && (
          <div>
            <label className="text-xs text-white/40 uppercase flex items-center gap-1"><Link2 className="w-3 h-3" /> Linked</label>
            <div className="mt-1 space-y-1">
              {links.map((l) => (
                <div key={l.id} className="text-xs text-white/70 bg-white/5 px-2 py-1 rounded flex items-center gap-2">
                  <span className="text-cyan-300">{l.target_kind}</span>
                  <span className="flex-1 truncate">{l.target_label || l.target_id || l.target_uri}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comments */}
        <div>
          <label className="text-xs text-white/40 uppercase flex items-center gap-1">
            <MessageSquare className="w-3 h-3" /> Comments ({comments.length})
          </label>
          <div className="mt-1 space-y-2 max-h-48 overflow-y-auto">
            {comments.map((c) => (
              <div key={c.id} className={`p-2 rounded text-sm ${c.resolved ? 'bg-white/5 opacity-60' : 'bg-white/5'}`}>
                <div className="text-xs text-white/40">{c.author_id.slice(0,8)} · {new Date(c.created_at*1000).toLocaleString()}</div>
                <div className="mt-1 text-white/90">{c.body}</div>
              </div>
            ))}
          </div>
          <textarea
            value={composing}
            onChange={(e) => setComposing(e.target.value)}
            placeholder="Comment…"
            rows={2}
            className="w-full mt-2 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white resize-none"
          />
          <button
            onClick={submitComment}
            disabled={!composing.trim()}
            className="mt-1 w-full py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm disabled:opacity-40"
          >Comment</button>
        </div>

        {/* History */}
        {history.length > 0 && (
          <details>
            <summary className="text-xs text-white/40 uppercase cursor-pointer flex items-center gap-1">
              <Clock className="w-3 h-3" /> History ({history.length})
            </summary>
            <div className="mt-2 space-y-1">
              {history.slice(0,10).map((h) => (
                <div key={h.id} className="text-xs text-white/50">
                  <span className="text-cyan-300">{h.action}</span>
                  {h.after_value && <span> → <span className="text-white/70">{h.after_value.slice(0,80)}</span></span>}
                  <span className="ml-1 text-white/30">{new Date(h.created_at*1000).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </aside>
  );
}
