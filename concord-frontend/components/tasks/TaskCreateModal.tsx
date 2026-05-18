'use client';

import { useState, useCallback, useEffect } from 'react';
import { callTasksMacro, type Project, type Workflow } from '@/lib/api/tasks';
import { X, Loader2, Plus } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  project: Project | null;
  workflow: Workflow | null;
  onCreated: () => void;
}

const TYPES = ['task','bug','feature','epic','story','spike','chore'] as const;
const PRIORITIES = ['urgent','high','medium','low','none'] as const;

export function TaskCreateModal({ open, onClose, project, workflow, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<typeof TYPES[number]>('task');
  const [priority, setPriority] = useState<typeof PRIORITIES[number]>('medium');
  const [assignee, setAssignee] = useState('');
  const [estimate, setEstimate] = useState('');
  const [labels, setLabels] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(''); setDescription(''); setType('task'); setPriority('medium');
      setAssignee(''); setEstimate(''); setLabels(''); setBusy(false);
    }
  }, [open]);

  const submit = useCallback(async () => {
    if (!project || !title.trim()) return;
    setBusy(true);
    try {
      const r = await callTasksMacro<{ id?: string; taskKey?: string }>('task_create', {
        projectId: project.id,
        title,
        descriptionHtml: description ? `<p>${description.replace(/\n+/g,'</p><p>')}</p>` : undefined,
        type, priority,
        assigneeId: assignee || undefined,
        estimate: estimate ? Number(estimate) : undefined,
        labels: labels ? labels.split(',').map((l) => l.trim()).filter(Boolean) : undefined,
      });
      if (r.ok) onCreated();
    } finally { setBusy(false); }
  }, [project, title, description, type, priority, assignee, estimate, labels, onCreated]);

  if (!open || !project) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-24 p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-lg w-full max-w-xl flex flex-col">
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white">New task in {project.key}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            placeholder="Task title"
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(); }}
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Description (optional)"
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white resize-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <select value={type} onChange={(e) => setType(e.target.value as typeof TYPES[number])} className="px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white">
              {TYPES.map((t) => <option key={t} value={t} className="bg-black">{t}</option>)}
            </select>
            <select value={priority} onChange={(e) => setPriority(e.target.value as typeof PRIORITIES[number])} className="px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white">
              {PRIORITIES.map((p) => <option key={p} value={p} className="bg-black">{p}</option>)}
            </select>
            <input
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="assignee user id"
              className="px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white"
            />
            <input
              type="number"
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
              placeholder="estimate"
              className="px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white"
            />
          </div>
          <input
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            placeholder="labels, comma-separated"
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white"
          />
        </div>
        <div className="flex justify-end gap-2 p-3 border-t border-white/10">
          <button onClick={onClose} className="px-3 py-1.5 rounded hover:bg-white/10 text-white/70 text-sm">Cancel</button>
          <button
            onClick={submit}
            disabled={busy || !title.trim()}
            className="px-4 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
