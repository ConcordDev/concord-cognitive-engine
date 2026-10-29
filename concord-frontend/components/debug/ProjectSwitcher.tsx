'use client';

/**
 * ProjectSwitcher — the Debug header's project control (S10).
 *
 * Switches the project every observability surface scopes to, and owns
 * the project-create / project-update / project-delete call sites.
 * Deleting a project with data asks first, stating exactly what the
 * server will remove (the counts come from project-list, and the
 * server's project-delete returns them again as the receipt). The
 * default project cannot be deleted — the control says so instead of
 * offering a button that would only fail.
 */

import { useCallback, useState } from 'react';
import { FolderGit2, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useDebugProject, type DebugProject } from './ProjectContext';

function countSummary(project: DebugProject): { total: number; parts: string[] } {
  const c = project.counts;
  if (!c) return { total: 0, parts: [] };
  const parts = [
    c.issues > 0 ? `${c.issues} issue${c.issues === 1 ? '' : 's'}` : null,
    c.traces > 0 ? `${c.traces} trace${c.traces === 1 ? '' : 's'}` : null,
    c.metrics > 0 ? `${c.metrics} metric sample${c.metrics === 1 ? '' : 's'}` : null,
    c.alerts > 0 ? `${c.alerts} alert rule${c.alerts === 1 ? '' : 's'}` : null,
    c.releases > 0 ? `${c.releases} release${c.releases === 1 ? '' : 's'}` : null,
  ].filter((p): p is string => p !== null);
  return {
    total: c.issues + c.traces + c.metrics + c.alerts + c.releases,
    parts,
  };
}

export function ProjectSwitcher() {
  const { projects, project, loading, error, selectProject, reloadProjects } = useDebugProject();
  const [mode, setMode] = useState<'none' | 'create' | 'manage'>('none');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [rename, setRename] = useState('');

  const openManage = useCallback(() => {
    setConfirmingDelete(false);
    setActionError(null);
    setRename(project?.name || '');
    setMode((m) => (m === 'manage' ? 'none' : 'manage'));
  }, [project]);

  const create = useCallback(async () => {
    if (!createForm.name.trim()) return;
    setBusy(true);
    setActionError(null);
    const r = await lensRun('debug', 'project-create', {
      name: createForm.name,
      description: createForm.description || undefined,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result?.project) {
      setCreateForm({ name: '', description: '' });
      setMode('none');
      await reloadProjects();
      selectProject(r.data.result.project.id);
    } else {
      setActionError(r.data?.error || 'Project create failed');
    }
  }, [createForm, reloadProjects, selectProject]);

  const saveRename = useCallback(async () => {
    if (!project || !rename.trim() || rename.trim() === project.name) return;
    setBusy(true);
    setActionError(null);
    const r = await lensRun('debug', 'project-update', { id: project.id, name: rename });
    setBusy(false);
    if (r.data?.ok) {
      await reloadProjects();
    } else {
      setActionError(r.data?.error || 'Rename failed');
    }
  }, [project, rename, reloadProjects]);

  const deleteProject = useCallback(async () => {
    if (!project) return;
    setBusy(true);
    setActionError(null);
    const r = await lensRun('debug', 'project-delete', { id: project.id, confirm: true });
    setBusy(false);
    if (r.data?.ok) {
      setConfirmingDelete(false);
      setMode('none');
      await reloadProjects();
    } else {
      setActionError(r.data?.error || 'Project delete failed');
    }
  }, [project, reloadProjects]);

  const counts = project ? countSummary(project) : { total: 0, parts: [] };
  const shownError = actionError || error;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-2 text-sm text-zinc-400">
          <FolderGit2 className="h-4 w-4" />
          <span className="hidden sm:inline">Project</span>
          <select
            aria-label="Debug project"
            value={project?.id || ''}
            disabled={loading || projects.length === 0}
            onChange={(e) => {
              setConfirmingDelete(false);
              setActionError(null);
              selectProject(e.target.value);
            }}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-sm text-zinc-200 hover:bg-white/[0.08] disabled:opacity-60"
          >
            {projects.length === 0 && <option value="">Loading projects…</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setActionError(null);
            setMode((m) => (m === 'create' ? 'none' : 'create'));
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-sm text-zinc-300 hover:bg-white/[0.08]"
        >
          <Plus className="h-4 w-4" /> New
        </button>
        <button
          type="button"
          onClick={openManage}
          disabled={!project}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-sm text-zinc-300 hover:bg-white/[0.08] disabled:opacity-60"
        >
          <Pencil className="h-4 w-4" /> Manage
        </button>
      </div>

      {shownError && <p className="text-xs text-red-400">{shownError}</p>}

      {mode === 'create' && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
          <input
            value={createForm.name}
            onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Project name (e.g. API service)"
            aria-label="New project name"
            className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600"
          />
          <input
            value={createForm.description}
            onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Description (optional)"
            aria-label="New project description"
            className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy || !createForm.name.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-zinc-100 hover:bg-white/15 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create project
          </button>
          <button
            type="button"
            onClick={() => setMode('none')}
            className="px-2 py-1.5 text-sm text-zinc-500 hover:text-zinc-300"
          >
            Cancel
          </button>
        </div>
      )}

      {mode === 'manage' && project && (
        <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={rename}
              onChange={(e) => setRename(e.target.value)}
              aria-label="Project name"
              className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-zinc-200"
            />
            <button
              type="button"
              onClick={() => void saveRename()}
              disabled={busy || !rename.trim() || rename.trim() === project.name}
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm text-zinc-100 hover:bg-white/15 disabled:opacity-60"
            >
              Rename
            </button>
            {!project.isDefault && !confirmingDelete && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/20"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete project
              </button>
            )}
          </div>
          {project.isDefault && (
            <p className="text-xs text-zinc-500">
              The default project can&apos;t be deleted — it holds everything recorded before
              projects, and anything recorded without choosing a project.
            </p>
          )}
          {confirmingDelete && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] px-3 py-2">
              <p className="text-sm text-red-200">
                Delete &ldquo;{project.name}&rdquo;?
                {counts.total > 0
                  ? ` It holds ${counts.parts.join(', ')} — deleting removes the project and all of that data.`
                  : ' It holds no records.'}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void deleteProject()}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-1.5 text-sm text-red-100 hover:bg-red-500/30 disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Delete it and its data
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="px-2 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
                >
                  Keep it
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
