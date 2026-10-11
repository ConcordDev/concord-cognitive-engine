'use client';

/**
 * ProjectsSection — Linear + Asana + Jira parity project management.
 * Owns the project roster + active project; nine panels hydrate via
 * lensRun().
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus, KanbanSquare, ListChecks, CalendarRange, Repeat, BarChart3,
  Flag, Users, Settings2, Briefcase, Radio,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Skeleton, ErrorState } from '@/components/ui';
import { PjBoardPanel } from './PjBoardPanel';
import { PjBacklogPanel } from './PjBacklogPanel';
import { PjTimelinePanel } from './PjTimelinePanel';
import { PjSprintsPanel } from './PjSprintsPanel';
import { PjReportsPanel } from './PjReportsPanel';
import { PjPlanningPanel } from './PjPlanningPanel';
import { PjTeamPanel } from './PjTeamPanel';
import { PjSettingsPanel } from './PjSettingsPanel';
import { PjPortfolioPanel } from './PjPortfolioPanel';
import { PjCollabPanel } from './PjCollabPanel';
import { ProjectsKeepMenu } from './ProjectsKeepMenu';

interface Project { id: string; name: string; key: string; color: string; status: string; health: string; archived: boolean }
interface Dash {
  name: string; totalTasks: number; done: number; completionPct: number;
  overdue: number; activeSprints: number; openMilestones: number; members: number;
}
type TabId = 'board' | 'backlog' | 'timeline' | 'sprints' | 'reports' | 'planning' | 'team' | 'collab' | 'settings' | 'portfolio';
const TABS: { id: TabId; label: string; icon: typeof KanbanSquare }[] = [
  { id: 'board', label: 'Board', icon: KanbanSquare },
  { id: 'backlog', label: 'Backlog', icon: ListChecks },
  { id: 'timeline', label: 'Timeline', icon: CalendarRange },
  { id: 'sprints', label: 'Sprints', icon: Repeat },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'planning', label: 'Planning', icon: Flag },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'collab', label: 'Collab', icon: Radio },
  { id: 'settings', label: 'Settings', icon: Settings2 },
  { id: 'portfolio', label: 'Portfolio', icon: Briefcase },
];
const PROJECT_STATUS = ['planned', 'started', 'paused', 'completed', 'canceled'];
const HEALTH = ['on_track', 'at_risk', 'off_track'];

export function ProjectsSection() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<string>('');
  const [dash, setDash] = useState<Dash | null>(null);
  const [tab, setTab] = useState<TabId>('board');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', key: '' });
  const [composerOpen, setComposerOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const openComposer = useCallback(() => {
    setComposerOpen(true);
    requestAnimationFrame(() => {
      nameInputRef.current?.scrollIntoView({ block: 'center' });
      nameInputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    window.addEventListener('projects:new', openComposer);
    return () => window.removeEventListener('projects:new', openComposer);
  }, [openComposer]);

  const refreshProjects = useCallback(async () => {
    const r = await lensRun('projects', 'project-list', {});
    if (r.data?.ok === false) {
      setLoadError(r.data?.error || 'Could not load projects.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    const list: Project[] = r.data?.result?.projects || [];
    setProjects(list);
    setActiveProject((prev) => (list.some((p) => p.id === prev) ? prev : list[0]?.id || ''));
    setLoading(false);
  }, []);

  const refreshDash = useCallback(async () => {
    if (!activeProject) { setDash(null); return; }
    const r = await lensRun('projects', 'project-dashboard', { projectId: activeProject });
    setDash((r.data?.result as Dash | null) || null);
  }, [activeProject]);

  useEffect(() => { void refreshProjects(); }, [refreshProjects]);
  useEffect(() => { void refreshDash(); }, [refreshDash]);

  const addProject = async () => {
    if (!form.name.trim()) { setError('Project name is required.'); return; }
    const r = await lensRun('projects', 'project-create', { name: form.name.trim(), key: form.key.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    const createdId = (r.data?.result as { project?: { id?: string } } | null)?.project?.id;
    setForm({ name: '', key: '' });
    setComposerOpen(false);
    setError(null);
    await refreshProjects();
    if (createdId) setActiveProject(createdId);
  };

  const delProject = async (id: string) => {
    await lensRun('projects', 'project-delete', { id });
    await refreshProjects();
  };

  const project = projects.find((p) => p.id === activeProject) || null;

  const updateProject = async (patch: Record<string, unknown>) => {
    if (!project) return;
    await lensRun('projects', 'project-update', { id: project.id, ...patch });
    await refreshProjects();
  };

  const archiveProject = async () => {
    if (!project) return;
    await lensRun('projects', 'project-archive', { id: project.id, archived: true });
    await refreshProjects();
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#111]">

      {error && <div className="mx-4 mt-3 text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <div className="p-4 space-y-3" aria-busy="true">
          <div className="flex gap-1.5">
            <Skeleton width={90} height={26} className="rounded-lg" />
            <Skeleton width={110} height={26} className="rounded-lg" />
            <Skeleton width={80} height={26} className="rounded-lg" />
          </div>
          <Skeleton variant="block" height={36} className="rounded-lg" />
        </div>
      ) : loadError ? (
        <div className="p-4"><ErrorState message={loadError} onRetry={refreshProjects} /></div>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-lattice-border space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {projects.map((p) => (
                <span key={p.id} className={cn('flex items-center gap-1.5 text-[11px] pl-2.5 pr-1.5 py-1 rounded-lg',
                  activeProject === p.id ? 'bg-indigo-600 text-white' : 'bg-lattice-elevated text-gray-300')}>
                  <button type="button" onClick={() => setActiveProject(p.id)}>
                    <span className="font-mono opacity-70">{p.key}</span> {p.name}
                  </button>
                  <button type="button" onClick={() => delProject(p.id)} className="text-gray-300/70 hover:text-rose-200">×</button>
                </span>
              ))}
            </div>
            {composerOpen && (
              <div
                className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
                onClick={() => setComposerOpen(false)}
              >
                <form
                  role="dialog"
                  aria-modal="true"
                  aria-label="New project"
                  className="w-full max-w-md space-y-3 rounded-2xl border border-white/10 bg-[#111] p-4"
                  onClick={(e) => e.stopPropagation()}
                  onSubmit={(e) => { e.preventDefault(); void addProject(); }}
                >
                  <h2 className="text-sm font-semibold text-zinc-100">New project</h2>
                  <input ref={nameInputRef} aria-label="New project name" placeholder="New project name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-lattice-void border border-lattice-border rounded-lg px-2 py-1.5 text-xs text-white" />
                  <input aria-label="Project key" placeholder="KEY" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })}
                    className="w-full bg-lattice-void border border-lattice-border rounded-lg px-2 py-1.5 text-xs text-white uppercase" />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setComposerOpen(false)}
                      className="px-3 py-1.5 text-xs text-zinc-300">
                      Cancel
                    </button>
                    <button type="submit"
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-teal-400 text-black rounded-lg">
                      <Plus className="w-3.5 h-3.5" /> Create
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          {!activeProject || !project ? (
            <p className="text-[11px] text-gray-400 italic px-4 py-8 text-center">Nothing in the substrate. Use New project to start one.</p>
          ) : (
            <>
              <ProjectsKeepMenu project={project} />
              <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-lattice-border">
                <select value={project.status} onChange={(e) => updateProject({ status: e.target.value })}
                  className="bg-lattice-void border border-lattice-border rounded-lg px-2 py-1 text-[11px] text-white capitalize">
                  {PROJECT_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={project.health} onChange={(e) => updateProject({ health: e.target.value })}
                  className="bg-lattice-void border border-lattice-border rounded-lg px-2 py-1 text-[11px] text-white">
                  {HEALTH.map((h) => <option key={h} value={h}>{h.replace(/_/g, ' ')}</option>)}
                </select>
                <button type="button" onClick={archiveProject}
                  className="text-[11px] px-2 py-1 bg-lattice-elevated hover:bg-lattice-border text-gray-300 rounded-lg">Archive</button>
              </div>
              <nav className="mx-4 mt-3 inline-flex max-w-[calc(100%-2rem)] items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Project views">
                {TABS.map((t) => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button key={t.id} type="button" onClick={() => setTab(t.id)}
                      aria-current={active ? 'page' : undefined}
                      className={cn('inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400',
                        active ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200')}>
                      <Icon className="h-3.5 w-3.5" /> {t.label}
                    </button>
                  );
                })}
              </nav>
              <div className="p-4">
                {tab === 'board' && <PjBoardPanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'backlog' && <PjBacklogPanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'timeline' && <PjTimelinePanel projectId={activeProject} />}
                {tab === 'sprints' && <PjSprintsPanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'reports' && <PjReportsPanel projectId={activeProject} project={project} dashboard={dash} />}
                {tab === 'planning' && <PjPlanningPanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'team' && <PjTeamPanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'collab' && <PjCollabPanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'settings' && <PjSettingsPanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'portfolio' && <PjPortfolioPanel />}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
