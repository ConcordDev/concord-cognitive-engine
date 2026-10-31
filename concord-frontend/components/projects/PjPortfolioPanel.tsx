'use client';

/**
 * PjPortfolioPanel — a cross-project rollup of health and progress.
 */

import { useCallback, useEffect, useState } from 'react';
import { Briefcase } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Skeleton, SkeletonTableRows, ErrorState } from '@/components/ui';

interface PProject {
  id: string; name: string; key: string; status: string; health: string;
  archived: boolean; targetDate: string | null;
  totalTasks: number; doneTasks: number; progressPct: number; points: number;
}

const HEALTH_COLOR: Record<string, string> = {
  on_track: 'text-emerald-400', at_risk: 'text-amber-400', off_track: 'text-rose-400',
};
const STATUS_COLOR: Record<string, string> = {
  planned: 'text-gray-400', started: 'text-sky-400', paused: 'text-amber-400',
  completed: 'text-emerald-400', canceled: 'text-rose-400',
};

export function PjPortfolioPanel({ onLifecycle }: { onLifecycle?: () => void }) {
  const [projects, setProjects] = useState<PProject[]>([]);
  const [byHealth, setByHealth] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('projects', 'portfolio', {});
    if (r.data?.ok === false) {
      setLoadError(r.data?.error || 'Could not load the portfolio.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setProjects(r.data?.result?.projects || []);
    setByHealth(r.data?.result?.byHealth || {});
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const restoreProject = async (id: string) => {
    const r = await lensRun('projects', 'project-archive', { id, archived: false });
    if (r.data?.ok === false) { setActionError(r.data?.error || 'Could not restore the project.'); return; }
    setActionError(null);
    await refresh();
    onLifecycle?.();
  };

  const deleteProject = async (id: string) => {
    const r = await lensRun('projects', 'project-delete', { id });
    if (r.data?.ok === false) { setActionError(r.data?.error || 'Could not delete the project.'); return; }
    setActionError(null);
    setConfirmDeleteId(null);
    await refresh();
    onLifecycle?.();
  };

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid grid-cols-3 gap-2">
          <Skeleton variant="block" height={64} className="rounded-xl" />
          <Skeleton variant="block" height={64} className="rounded-xl" />
          <Skeleton variant="block" height={64} className="rounded-xl" />
        </div>
        <div className="rounded-xl border border-lattice-border bg-lattice-surface/70 overflow-hidden">
          <SkeletonTableRows rows={5} columns={5} />
        </div>
      </div>
    );
  }

  if (loadError) {
    return <ErrorState message={loadError} onRetry={refresh} />;
  }

  const active = projects.filter((p) => !p.archived);
  const archivedCount = projects.length - active.length;
  // F2: the heading count and the visible rows must describe the same
  // set — archived projects sit behind an explicit toggle by default,
  // and carry their Archived marker when shown.
  const visible = showArchived ? projects : active;

  return (
    <div className="space-y-4">
      {actionError && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{actionError}</div>}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-lattice-surface/70 border border-lattice-border rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-emerald-300 tabular-nums">{byHealth.on_track || 0}</p>
          <p className="text-[10px] text-gray-400 uppercase">On track</p>
        </div>
        <div className="bg-lattice-surface/70 border border-lattice-border rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-amber-300 tabular-nums">{byHealth.at_risk || 0}</p>
          <p className="text-[10px] text-gray-400 uppercase">At risk</p>
        </div>
        <div className="bg-lattice-surface/70 border border-lattice-border rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-rose-300 tabular-nums">{byHealth.off_track || 0}</p>
          <p className="text-[10px] text-gray-400 uppercase">Off track</p>
        </div>
      </div>

      <h3 className="flex items-center gap-1 text-xs font-semibold text-gray-300">
        <Briefcase className="w-3.5 h-3.5 text-indigo-400" /> All projects (<span className="tabular-nums">{active.length}</span> active{archivedCount > 0 && <>, <span className="tabular-nums">{archivedCount}</span> archived</>})
        {archivedCount > 0 && (
          <button type="button" onClick={() => setShowArchived((v) => !v)}
            className="ml-2 px-2 py-0.5 text-[11px] font-normal bg-lattice-elevated hover:bg-lattice-border text-gray-300 rounded-lg">
            {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
          </button>
        )}
      </h3>
      {projects.length === 0 ? (
        <p className="text-[11px] text-gray-400 italic py-6 text-center">No projects yet.</p>
      ) : visible.length === 0 ? (
        <p className="text-[11px] text-gray-400 italic py-6 text-center">No active projects — everything here is archived. Use Show archived to see it.</p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((p) => (
            <li key={p.id} className={cn('bg-lattice-surface/70 border border-lattice-border rounded-xl p-3', p.archived && 'opacity-50')}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-mono text-indigo-400">{p.key}</span>
                <span className="text-sm font-semibold text-white flex-1">{p.name}</span>
                <span className={cn('text-[10px] uppercase', STATUS_COLOR[p.status])}>{p.status}</span>
                <span className={cn('text-[10px] uppercase', HEALTH_COLOR[p.health])}>{p.health.replace(/_/g, ' ')}</span>
                {p.targetDate && <span className="text-[10px] text-gray-400 tabular-nums">{p.targetDate}</span>}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-lattice-elevated overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${p.progressPct}%` }} />
                </div>
                <span className="text-[10px] text-gray-400 tabular-nums">{p.doneTasks}/{p.totalTasks} · {p.points}pt</span>
              </div>
              {p.archived && (
                <div className="mt-2 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-amber-300 border border-amber-800/60 bg-amber-950/40 rounded px-1.5 py-0.5">Archived</span>
                    <button type="button" onClick={() => void restoreProject(p.id)}
                      className="text-[11px] px-2 py-1 bg-lattice-elevated hover:bg-lattice-border text-gray-200 rounded-lg">Restore</button>
                    {confirmDeleteId !== p.id && (
                      <button type="button" onClick={() => setConfirmDeleteId(p.id)}
                        className="text-[11px] px-2 py-1 bg-lattice-elevated hover:bg-rose-900 text-gray-200 rounded-lg">Delete</button>
                    )}
                  </div>
                  {confirmDeleteId === p.id && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-900/50 bg-rose-950/40 px-2.5 py-2">
                      <span className="text-[11px] text-rose-200">
                        Delete “{p.name}” for good? Its issues, sprints and everything in it are deleted. Copies you saved as DTUs are separate and are not deleted.
                      </span>
                      <button type="button" onClick={() => void deleteProject(p.id)}
                        className="px-2 py-1 text-[11px] font-medium bg-rose-600 hover:bg-rose-500 text-white rounded-lg">Delete project</button>
                      <button type="button" onClick={() => setConfirmDeleteId(null)}
                        className="px-2 py-1 text-[11px] text-zinc-300">Cancel</button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
