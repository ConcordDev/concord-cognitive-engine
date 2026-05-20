'use client';

/**
 * ProjectsSection — Linear + Asana + Jira shape project management.
 * Owns the project roster + active project; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { FolderKanban, Plus, KanbanSquare, Repeat, Flag, Users, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { PjBoardPanel } from './PjBoardPanel';
import { PjSprintsPanel } from './PjSprintsPanel';
import { PjMilestonesPanel } from './PjMilestonesPanel';
import { PjTeamPanel } from './PjTeamPanel';

interface Project { id: string; name: string; key: string; color: string }
interface Dash {
  name: string; totalTasks: number; done: number; completionPct: number;
  overdue: number; activeSprints: number; openMilestones: number; members: number;
}
type TabId = 'board' | 'sprints' | 'milestones' | 'team';
const TABS: { id: TabId; label: string; icon: typeof KanbanSquare }[] = [
  { id: 'board', label: 'Board', icon: KanbanSquare },
  { id: 'sprints', label: 'Sprints', icon: Repeat },
  { id: 'milestones', label: 'Milestones', icon: Flag },
  { id: 'team', label: 'Team', icon: Users },
];

export function ProjectsSection() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<string>('');
  const [dash, setDash] = useState<Dash | null>(null);
  const [tab, setTab] = useState<TabId>('board');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', key: '' });

  const refreshProjects = useCallback(async () => {
    const r = await lensRun('projects', 'project-list', {});
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
    setForm({ name: '', key: '' });
    setError(null);
    await refreshProjects();
  };

  const delProject = async (id: string) => {
    await lensRun('projects', 'project-delete', { id });
    await refreshProjects();
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-indigo-600/15 to-transparent">
        <FolderKanban className="w-5 h-5 text-indigo-400" />
        <h2 className="text-sm font-bold text-zinc-100">Project Management</h2>
        <span className="text-[11px] text-zinc-500">Linear + Asana + Jira shape</span>
      </header>

      {error && <div className="mx-4 mt-3 text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-zinc-800 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {projects.map((p) => (
                <span key={p.id} className={cn('flex items-center gap-1.5 text-[11px] pl-2.5 pr-1.5 py-1 rounded-lg',
                  activeProject === p.id ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-300')}>
                  <button type="button" onClick={() => setActiveProject(p.id)}>
                    <span className="font-mono opacity-70">{p.key}</span> {p.name}
                  </button>
                  <button type="button" onClick={() => delProject(p.id)} className="text-zinc-300/70 hover:text-rose-200">×</button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input placeholder="New project name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="KEY" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })}
                className="w-20 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 uppercase" />
              <button type="button" onClick={addProject}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">
                <Plus className="w-3.5 h-3.5" /> Project
              </button>
            </div>
          </div>

          {!activeProject ? (
            <p className="text-[11px] text-zinc-500 italic px-4 py-8 text-center">Create a project to start tracking work.</p>
          ) : (
            <>
              {dash && (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
                  <Stat label="Tasks" value={dash.totalTasks} />
                  <Stat label="Done" value={`${dash.completionPct}%`} />
                  <Stat label="Overdue" value={dash.overdue} />
                  <Stat label="Sprints" value={dash.activeSprints} />
                  <Stat label="Milestones" value={dash.openMilestones} />
                  <Stat label="Team" value={dash.members} />
                </div>
              )}
              <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
                {TABS.map((t) => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button key={t.id} type="button" onClick={() => setTab(t.id)}
                      className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-indigo-500',
                        active ? 'bg-zinc-900 text-indigo-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
                      <Icon className="w-3.5 h-3.5" /> {t.label}
                    </button>
                  );
                })}
              </nav>
              <div className="p-4">
                {tab === 'board' && <PjBoardPanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'sprints' && <PjSprintsPanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'milestones' && <PjMilestonesPanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'team' && <PjTeamPanel projectId={activeProject} onChange={refreshDash} />}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <p className="text-base font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
