'use client';

/**
 * PjTaskDetail — the full issue editor: fields, sub-issues, dependencies,
 * custom fields, attachments, threaded comments and activity history.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X, Trash2, Link2, Paperclip, MessageSquare, History, GitBranch, Upload, FileDown } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Member { id: string; name: string }
interface Sprint { id: string; name: string }
interface Milestone { id: string; name: string }
interface Label { id: string; name: string; color: string }
interface CustomField { id: string; name: string; type: string; options: string[] }
interface Task {
  id: string; ref: string; title: string; description: string | null; type: string;
  status: string; priority: string; assigneeId: string | null; sprintId: string | null;
  milestoneId: string | null; parentId: string | null; labels: string[];
  customFields: Record<string, string | number>; points: number;
  startDate: string | null; dueDate: string | null;
}
interface Detail {
  task: Task;
  parent: { ref: string; title: string } | null;
  subtasks: { id: string; ref: string; title: string; status: string }[];
  subtaskProgress: number | null;
  relations: { id: string; kind: string; task: { id: string; ref: string; title: string } | null }[];
  attachments: {
    id: string; name: string; url?: string; kind?: string;
    fileName?: string; mimeType?: string; bytes?: number;
  }[];
  comments: { id: string; body: string; author: string; parentCommentId: string | null; mentions: string[]; createdAt: string }[];
  activity: { id: string; action: string; detail: string | null; at: string }[];
}

const TYPES = ['story', 'bug', 'task', 'epic', 'chore'];
const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'];
const REL_KINDS = ['blocks', 'blocked_by', 'relates', 'duplicates'];

export function PjTaskDetail({
  taskId, projectId, members, sprints, milestones, labels, customFields, allTasks, onClose, onChange,
}: {
  taskId: string; projectId: string;
  members: Member[]; sprints: Sprint[]; milestones: Milestone[];
  labels: Label[]; customFields: CustomField[];
  allTasks: { id: string; ref: string; title: string }[];
  onClose: () => void; onChange: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [att, setAtt] = useState({ name: '', url: '' });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rel, setRel] = useState({ toTaskId: '', kind: 'blocks' });
  const [subtaskTitle, setSubtaskTitle] = useState('');

  const refresh = useCallback(async () => {
    const r = await lensRun('projects', 'task-detail', { id: taskId });
    setDetail((r.data?.result as Detail | null) || null);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const patch = async (p: Record<string, unknown>) => {
    await lensRun('projects', 'task-update', { id: taskId, ...p });
    await refresh();
    onChange();
  };

  const setField = async (fieldId: string, value: string) => {
    await lensRun('projects', 'task-set-field', { taskId, fieldId, value });
    await refresh();
  };

  const addSubtask = async () => {
    if (!subtaskTitle.trim()) return;
    await lensRun('projects', 'task-create', { projectId, title: subtaskTitle.trim(), parentId: taskId });
    setSubtaskTitle('');
    await refresh();
    onChange();
  };

  const addRelation = async () => {
    if (!rel.toTaskId) return;
    await lensRun('projects', 'relation-add', { fromTaskId: taskId, toTaskId: rel.toTaskId, kind: rel.kind });
    setRel({ toTaskId: '', kind: 'blocks' });
    await refresh();
  };

  const addAttachment = async () => {
    if (!att.url.trim()) return;
    await lensRun('projects', 'attachment-add', { taskId, url: att.url.trim(), name: att.name.trim() });
    setAtt({ name: '', url: '' });
    await refresh();
  };

  // Read the selected file as base64 and upload it as a binary attachment.
  const uploadFile = async (file: File) => {
    setUploadError(null);
    if (file.size > 5 * 1024 * 1024) { setUploadError('File exceeds the 5 MB limit.'); return; }
    setUploading(true);
    try {
      const data: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const r = await lensRun('projects', 'attachment-upload', {
        taskId, fileName: file.name,
        mimeType: file.type || 'application/octet-stream', data,
      });
      if (r.data?.ok === false) setUploadError(r.data?.error || 'Upload failed.');
      else await refresh();
    } catch {
      setUploadError('Could not read the file.');
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Fetch a binary attachment and trigger a browser download.
  const downloadAttachment = async (id: string, fileName: string) => {
    const r = await lensRun<{ data: string; mimeType: string; fileName: string }>(
      'projects', 'attachment-download', { id });
    const res = r.data?.result;
    if (!r.data?.ok || !res) return;
    const link = document.createElement('a');
    link.href = `data:${res.mimeType};base64,${res.data}`;
    link.download = res.fileName || fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const addComment = async () => {
    if (!comment.trim()) return;
    await lensRun('projects', 'task-comment-add', { taskId, body: comment.trim(), parentCommentId: replyTo || undefined });
    setComment('');
    setReplyTo(null);
    await refresh();
  };

  if (loading || !detail) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  const t = detail.task;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 overflow-y-auto p-4">
      <div className="w-full max-w-3xl bg-zinc-950 border border-zinc-800 rounded-2xl my-4">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <span className="text-[10px] font-mono text-indigo-400">{t.ref}</span>
          <select value={t.type} onChange={(e) => patch({ type: e.target.value })}
            className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-200 capitalize">
            {TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <span className="flex-1" />
          <button aria-label="Close" type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <input value={t.title} onChange={(e) => setDetail({ ...detail, task: { ...t, title: e.target.value } })}
            onBlur={(e) => patch({ title: e.target.value })}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-semibold text-zinc-100" />
          <textarea value={t.description || ''} placeholder="Description"
            onChange={(e) => setDetail({ ...detail, task: { ...t, description: e.target.value } })}
            onBlur={(e) => patch({ description: e.target.value })}
            rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 resize-y" />

          {/* Field grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Field label="Status">
              <select value={t.status} onChange={(e) => patch({ status: e.target.value })} className={selCls}>
                {STATUSES.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select value={t.priority} onChange={(e) => patch({ priority: e.target.value })} className={selCls}>
                {PRIORITIES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="Assignee">
              <select value={t.assigneeId || ''} onChange={(e) => patch({ assigneeId: e.target.value })} className={selCls}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Points">
              <input type="number" value={t.points || ''} onChange={(e) => patch({ points: Number(e.target.value) || 0 })}
                className={selCls} />
            </Field>
            <Field label="Sprint">
              <select value={t.sprintId || ''} onChange={(e) => patch({ sprintId: e.target.value })} className={selCls}>
                <option value="">No sprint</option>
                {sprints.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
              </select>
            </Field>
            <Field label="Milestone">
              <select value={t.milestoneId || ''} onChange={(e) => patch({ milestoneId: e.target.value })} className={selCls}>
                <option value="">None</option>
                {milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Start">
              <input type="date" value={t.startDate || ''} onChange={(e) => patch({ startDate: e.target.value })} className={selCls} />
            </Field>
            <Field label="Due">
              <input type="date" value={t.dueDate || ''} onChange={(e) => patch({ dueDate: e.target.value })} className={selCls} />
            </Field>
          </div>

          {/* Parent */}
          <Field label="Parent issue">
            <select value={t.parentId || ''} onChange={(e) => patch({ parentId: e.target.value })} className={selCls}>
              <option value="">No parent</option>
              {allTasks.filter((x) => x.id !== t.id).map((x) => <option key={x.id} value={x.id}>{x.ref} {x.title}</option>)}
            </select>
          </Field>

          {/* Labels */}
          {labels.length > 0 && (
            <div>
              <p className="text-[10px] text-zinc-400 uppercase mb-1">Labels</p>
              <div className="flex flex-wrap gap-1">
                {labels.map((l) => {
                  const on = t.labels.includes(l.name);
                  return (
                    <button key={l.id} type="button"
                      onClick={() => patch({ labels: on ? t.labels.filter((x) => x !== l.name) : [...t.labels, l.name] })}
                      className={cn('text-[10px] px-2 py-0.5 rounded border',
                        on ? 'border-transparent text-white' : 'border-zinc-700 text-zinc-400',
                        on ? `bg-${l.color}-600` : '')}
                      style={on ? { background: cssColor(l.color) } : {}}>
                      {l.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Custom fields */}
          {customFields.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {customFields.map((f) => (
                <Field key={f.id} label={f.name}>
                  {f.type === 'select' ? (
                    <select value={String(t.customFields[f.id] ?? '')} onChange={(e) => setField(f.id, e.target.value)} className={selCls}>
                      <option value="">—</option>
                      {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                      value={String(t.customFields[f.id] ?? '')}
                      onChange={(e) => setField(f.id, e.target.value)} className={selCls} />
                  )}
                </Field>
              ))}
            </div>
          )}

          {/* Subtasks */}
          <Section icon={GitBranch} title={`Sub-issues${detail.subtaskProgress != null ? ` · ${detail.subtaskProgress}%` : ''}`}>
            <ul className="space-y-1 mb-1.5">
              {detail.subtasks.map((st) => (
                <li key={st.id} className="flex items-center gap-2 text-[11px] text-zinc-300">
                  <span className="font-mono text-zinc-400">{st.ref}</span>
                  <span className="flex-1 truncate">{st.title}</span>
                  <span className="text-zinc-400">{st.status.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <input placeholder="New sub-issue" value={subtaskTitle} onChange={(e) => setSubtaskTitle(e.target.value)}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
              <button type="button" onClick={addSubtask} className="text-[11px] px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-200">Add</button>
            </div>
          </Section>

          {/* Relations */}
          <Section icon={Link2} title="Dependencies">
            <ul className="space-y-1 mb-1.5">
              {detail.relations.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-[11px]">
                  <span className="text-indigo-400 w-20">{r.kind.replace(/_/g, ' ')}</span>
                  <span className="flex-1 truncate text-zinc-300">{r.task ? `${r.task.ref} ${r.task.title}` : '—'}</span>
                  <button aria-label="Delete" type="button" onClick={() => lensRun('projects', 'relation-delete', { id: r.id }).then(refresh)}
                    className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <select value={rel.kind} onChange={(e) => setRel({ ...rel, kind: e.target.value })}
                className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-100">
                {REL_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
              </select>
              <select value={rel.toTaskId} onChange={(e) => setRel({ ...rel, toTaskId: e.target.value })}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-100">
                <option value="">Pick issue…</option>
                {allTasks.filter((x) => x.id !== t.id).map((x) => <option key={x.id} value={x.id}>{x.ref} {x.title}</option>)}
              </select>
              <button type="button" onClick={addRelation} className="text-[11px] px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-200">Link</button>
            </div>
          </Section>

          {/* Attachments */}
          <Section icon={Paperclip} title="Attachments">
            <ul className="space-y-1 mb-1.5">
              {detail.attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-[11px]">
                  {a.kind === 'binary' ? (
                    <>
                      <FileDown className="w-3 h-3 text-emerald-400 shrink-0" />
                      <button type="button" onClick={() => downloadAttachment(a.id, a.fileName || a.name)}
                        className="flex-1 truncate text-emerald-400 hover:underline text-left">{a.name}</button>
                      <span className="text-[9px] text-zinc-400">{fmtBytes(a.bytes || 0)}</span>
                    </>
                  ) : (
                    <>
                      <Link2 className="w-3 h-3 text-indigo-400 shrink-0" />
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-indigo-400 hover:underline">{a.name}</a>
                    </>
                  )}
                  <button aria-label="Delete" type="button" onClick={() => lensRun('projects', 'attachment-delete', { id: a.id }).then(refresh)}
                    className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </li>
              ))}
              {detail.attachments.length === 0 && (
                <li className="text-[10px] text-zinc-400 italic">No attachments yet.</li>
              )}
            </ul>
            <div className="flex items-center gap-2 mb-1.5">
              <input placeholder="Name" value={att.name} onChange={(e) => setAtt({ ...att, name: e.target.value })}
                className="w-28 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
              <input placeholder="https://… link" value={att.url} onChange={(e) => setAtt({ ...att, url: e.target.value })}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
              <button type="button" onClick={addAttachment} className="text-[11px] px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-200">Add link</button>
            </div>
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); }} />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="flex items-center gap-1 text-[11px] px-2 py-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 rounded text-white">
                {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                {uploading ? 'Uploading…' : 'Upload file'}
              </button>
              <span className="text-[9px] text-zinc-400">Binary files up to 5 MB</span>
            </div>
            {uploadError && <p className="text-[10px] text-rose-400 mt-1">{uploadError}</p>}
          </Section>

          {/* Comments */}
          <Section icon={MessageSquare} title="Comments">
            <ul className="space-y-1.5 mb-1.5">
              {detail.comments.map((c) => (
                <li key={c.id} className={cn('text-[11px] bg-zinc-900 rounded px-2 py-1.5', c.parentCommentId && 'ml-4')}>
                  <p className="text-zinc-200">{c.body}</p>
                  <p className="text-[9px] text-zinc-400">
                    {c.author}
                    <button type="button" onClick={() => setReplyTo(c.id)} className="ml-2 hover:text-indigo-300">reply</button>
                  </p>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <input placeholder={replyTo ? 'Reply…' : 'Comment…'} value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void addComment(); }}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
              {replyTo && <button type="button" onClick={() => setReplyTo(null)} className="text-[10px] text-zinc-400">cancel</button>}
              <button type="button" onClick={addComment} className="text-[11px] px-2 py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-white">Post</button>
            </div>
          </Section>

          {/* Activity */}
          <Section icon={History} title="Activity">
            <ul className="space-y-0.5">
              {detail.activity.map((a) => (
                <li key={a.id} className="text-[10px] text-zinc-400">
                  <span className="text-zinc-400">{a.action}</span>{a.detail ? ` — ${a.detail}` : ''}
                </li>
              ))}
            </ul>
          </Section>

          <button type="button" onClick={() => lensRun('projects', 'task-delete', { id: taskId }).then(() => { onChange(); onClose(); })}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-zinc-800 hover:bg-rose-900 text-zinc-200 rounded-lg">
            <Trash2 className="w-3.5 h-3.5" /> Delete issue
          </button>
        </div>
      </div>
    </div>
  );
}

const selCls = 'w-full bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-100';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[9px] text-zinc-400 uppercase mb-0.5">{label}</span>
      {children}
    </label>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Link2; title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-zinc-800 pt-2.5">
      <p className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400 mb-1.5">
        <Icon className="w-3 h-3" /> {title}
      </p>
      {children}
    </div>
  );
}
