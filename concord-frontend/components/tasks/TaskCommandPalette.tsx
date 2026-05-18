'use client';

import { useState, useEffect, useCallback } from 'react';
import { callTasksMacro, type Project } from '@/lib/api/tasks';
import { X, Search, Folder, FileText } from 'lucide-react';

interface SearchHit { id: string; task_key: string; title: string; project_id: string; status_id: string; }

interface Props {
  open: boolean;
  onClose: () => void;
  onJumpToTask: (id: string) => void;
  onJumpToProject: (p: Project) => void;
}

export function TaskCommandPalette({ open, onClose, onJumpToTask, onJumpToProject }: Props) {
  const [q, setQ] = useState('');
  const [tasks, setTasks] = useState<SearchHit[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (!open) { setQ(''); setTasks([]); return; }
    (async () => {
      const r = await callTasksMacro<{ projects?: Project[] }>('project_list', { limit: 50 });
      setProjects(r.projects || []);
    })();
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) { setTasks([]); return; }
    // Direct key lookup if matches PROJ-N
    const keyMatch = q.toUpperCase().match(/^([A-Z]{2,10})-(\d+)$/);
    if (keyMatch) {
      (async () => {
        const r = await callTasksMacro<{ task?: SearchHit }>('task_get', { key: q.toUpperCase() });
        if (r?.task) setTasks([r.task]);
      })();
      return;
    }
    const t = setTimeout(async () => {
      const r = await callTasksMacro<{ results?: SearchHit[] }>('search', { query: q, limit: 20 });
      setTasks(r?.results || []);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const projectMatches = q
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(q.toLowerCase()) || p.key.toLowerCase().startsWith(q.toLowerCase()),
      ).slice(0, 5)
    : projects.slice(0, 8);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-24 p-4">
      <div className="bg-zinc-900 border border-cyan-500/30 rounded-lg w-full max-w-xl shadow-2xl">
        <div className="flex items-center gap-2 p-3 border-b border-white/10">
          <Search className="w-4 h-4 text-cyan-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            placeholder="Jump to task (PROJ-42) or search…"
            className="flex-1 bg-transparent text-white placeholder-white/40 focus:outline-none text-sm"
          />
          <button onClick={onClose} className="text-white/40 hover:text-white text-xs">esc</button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {tasks.length > 0 && (
            <div className="border-b border-white/5">
              <div className="px-3 py-1 text-xs uppercase tracking-wide text-white/40">Tasks</div>
              {tasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onJumpToTask(t.id)}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 text-sm text-white/90 flex items-center gap-2"
                >
                  <FileText className="w-3.5 h-3.5 text-white/40" />
                  <span className="font-mono text-xs text-white/40">{t.task_key}</span>
                  <span className="flex-1 truncate">{t.title}</span>
                </button>
              ))}
            </div>
          )}
          {projectMatches.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs uppercase tracking-wide text-white/40">Projects</div>
              {projectMatches.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onJumpToProject(p)}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 text-sm text-white/90 flex items-center gap-2"
                >
                  <Folder className="w-3.5 h-3.5 text-white/40" />
                  <span>{p.icon || '📋'}</span>
                  <span className="flex-1 truncate">{p.name}</span>
                  <span className="font-mono text-xs text-white/40">{p.key}</span>
                </button>
              ))}
            </div>
          )}
          {q.length >= 2 && tasks.length === 0 && projectMatches.length === 0 && (
            <div className="text-sm text-white/40 px-3 py-4 text-center">No matches.</div>
          )}
        </div>
      </div>
    </div>
  );
}
