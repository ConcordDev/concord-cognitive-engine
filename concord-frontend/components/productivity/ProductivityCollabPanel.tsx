'use client';

/**
 * ProductivityCollabPanel — task collaboration. Share a project with
 * collaborators (editor/viewer), then pick any task to open its full
 * detail view (subtasks, assignment, comments). Backed by the
 * productivity.project-share / project-collaborators / task-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Users, Share2, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ProductivityTaskDetail } from './ProductivityTaskDetail';

interface Project { id: string; name: string }
interface Collaborator { id: string; collaboratorId: string; role: string; sharedAt: string }
interface TaskOption { id: string; content: string; assigneeId: string | null }

export function ProductivityCollabPanel({ onChange }: { onChange: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState('');
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [shareForm, setShareForm] = useState({ collaboratorId: '', role: 'editor' });
  const [openTask, setOpenTask] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [p, t] = await Promise.all([
      lensRun('productivity', 'project-list', {}),
      lensRun('productivity', 'task-list', {}),
    ]);
    setProjects((p.data?.result?.projects || []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
    setTasks((t.data?.result?.tasks || []).map(
      (x: { id: string; content: string; assigneeId: string | null }) => ({ id: x.id, content: x.content, assigneeId: x.assigneeId })));
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadCollaborators = useCallback(async (projectId: string) => {
    if (!projectId) { setCollaborators([]); return; }
    const r = await lensRun('productivity', 'project-collaborators', { projectId });
    setCollaborators(r.data?.result?.collaborators || []);
  }, []);

  useEffect(() => { void loadCollaborators(activeProject); }, [activeProject, loadCollaborators]);

  const share = async () => {
    if (!activeProject) { setError('Pick a project first.'); return; }
    if (!shareForm.collaboratorId.trim()) { setError('Collaborator id is required.'); return; }
    const r = await lensRun('productivity', 'project-share', {
      projectId: activeProject,
      collaboratorId: shareForm.collaboratorId.trim(),
      role: shareForm.role,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Share failed.'); return; }
    setShareForm({ collaboratorId: '', role: 'editor' });
    setError(null);
    await loadCollaborators(activeProject);
  };
  const unshare = async (collaboratorId: string) => {
    await lensRun('productivity', 'project-unshare', { projectId: activeProject, collaboratorId });
    await loadCollaborators(activeProject);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Share a project */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400 flex items-center gap-1">
          <Share2 className="w-3 h-3" /> Share a project
        </p>
        {projects.length === 0 ? (
          <p className="text-xs text-zinc-400 italic">No projects yet — create one in the Tasks tab.</p>
        ) : (
          <>
            <select value={activeProject} onChange={(e) => setActiveProject(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100">
              <option value="">Select project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {activeProject && (
              <>
                <div className="flex gap-2">
                  <input placeholder="Collaborator user id" value={shareForm.collaboratorId}
                    onChange={(e) => setShareForm({ ...shareForm, collaboratorId: e.target.value })}
                    className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
                  <select value={shareForm.role} onChange={(e) => setShareForm({ ...shareForm, role: e.target.value })}
                    className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button type="button" onClick={share}
                    className="px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg">
                    Share
                  </button>
                </div>
                {collaborators.length === 0 ? (
                  <p className="text-xs text-zinc-400 italic">Not shared with anyone yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {collaborators.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-2.5 py-1.5">
                        <Users className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                        <span className="flex-1 text-xs text-zinc-200 truncate">{c.collaboratorId}</span>
                        <span className="text-[10px] text-zinc-400 uppercase">{c.role}</span>
                        <button aria-label="Delete" type="button" onClick={() => unshare(c.collaboratorId)}
                          className="text-zinc-600 hover:text-rose-400 shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Task picker → full detail */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400">Task detail — subtasks, assignee, comments</p>
        {tasks.length === 0 ? (
          <p className="text-xs text-zinc-400 italic">No tasks yet.</p>
        ) : (
          <ul className="space-y-1">
            {tasks.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setOpenTask(openTask === t.id ? null : t.id)}
                  className={cn('w-full text-left flex items-center gap-2 border rounded-lg px-3 py-2 text-xs',
                    openTask === t.id ? 'border-red-700/50 bg-red-950/30 text-red-200' : 'border-zinc-800 bg-zinc-900/70 text-zinc-200 hover:bg-zinc-800/60')}>
                  <span className="flex-1 truncate">{t.content}</span>
                  {t.assigneeId && <span className="text-[10px] text-violet-400">@{t.assigneeId}</span>}
                </button>
                {openTask === t.id && (
                  <div className="mt-1 ml-2 border-l-2 border-zinc-800 pl-3">
                    <ProductivityTaskDetail taskId={t.id} onChange={() => { void refresh(); onChange(); }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
