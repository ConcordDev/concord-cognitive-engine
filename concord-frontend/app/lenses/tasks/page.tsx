'use client';

/**
 * /lenses/tasks — Tasks Sprint A.
 *
 * Linear/Jira-shape three-pane layout: project tree on the left,
 * task list/board/calendar in the middle, detail pane on the right.
 * Jira-customisable workflows + custom fields per project.
 *
 * Backed by migration 214 substrate via the `tasks.*` macros.
 * Replaces the SCAFFOLD-tier /lenses/projects path (which had no
 * persistence) — projects analytics shell at /lenses/projects stays
 * for budget/risk/gantt math.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { callTasksMacro, type Project, type Task, type Workflow, type Sprint } from '@/lib/api/tasks';
import { TaskProjectSidebar } from '@/components/tasks/TaskProjectSidebar';
import { TaskListView } from '@/components/tasks/TaskListView';
import { TaskBoardView } from '@/components/tasks/TaskBoardView';
import { TaskCalendarView } from '@/components/tasks/TaskCalendarView';
import { TaskDetailPane } from '@/components/tasks/TaskDetailPane';
import { TaskCreateModal } from '@/components/tasks/TaskCreateModal';
import { ProjectCreateModal } from '@/components/tasks/ProjectCreateModal';
import { TaskCommandPalette } from '@/components/tasks/TaskCommandPalette';
import { SprintPanel } from '@/components/tasks/SprintPanel';
import { Plus, ListIcon, Layout, Calendar, Loader2, Filter, Search, FolderPlus } from 'lucide-react';

type ViewKind = 'list' | 'board' | 'calendar';

export default function TasksLensPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [activeSprintId, setActiveSprintId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [view, setView] = useState<ViewKind>('list');
  const [search, setSearch] = useState('');
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // ─── Load projects on mount ─────────────────────────────────────
  const refreshProjects = useCallback(async () => {
    try {
      const r = await callTasksMacro<{ projects?: Project[] }>('project_list', { limit: 200 });
      if (r?.projects) setProjects(r.projects);
      if (r?.projects?.length && !activeProject) setActiveProject(r.projects[0]);
    } catch (e) { console.error('project_list', e); }
    finally { setLoading(false); }
  }, [activeProject]);

  useEffect(() => { refreshProjects(); }, [refreshProjects]);

  // ─── Load workflow + sprints when active project changes ────────
  useEffect(() => {
    if (!activeProject) return;
    (async () => {
      const w = await callTasksMacro<{ workflows?: Workflow[] }>('workflow_list', { projectId: activeProject.id });
      const def = w.workflows?.find((x) => x.is_default) || w.workflows?.[0];
      setWorkflow(def || null);
      const s = await callTasksMacro<{ sprints?: Sprint[] }>('sprint_list', { projectId: activeProject.id });
      setSprints(s.sprints || []);
    })();
  }, [activeProject]);

  // ─── Load tasks when project / sprint / search changes ──────────
  const refreshTasks = useCallback(async () => {
    if (!activeProject) { setTasks([]); return; }
    const r = await callTasksMacro<{ tasks?: Task[] }>('task_list', {
      projectId: activeProject.id,
      sprintId: activeSprintId || undefined,
      search: search.length >= 2 ? search : undefined,
      limit: 500,
    });
    setTasks(r.tasks || []);
  }, [activeProject, activeSprintId, search]);

  useEffect(() => { refreshTasks(); }, [refreshTasks]);

  // ─── Cmd-K opens command palette ────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i' && activeProject) {
        e.preventDefault();
        setCreateTaskOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activeProject]);

  // ─── Helpers ────────────────────────────────────────────────────
  const statusesByCategory = useMemo(() => {
    if (!workflow) return [];
    return workflow.statuses;
  }, [workflow]);

  const activeTask = useMemo(() => tasks.find((t) => t.id === activeTaskId) || null, [tasks, activeTaskId]);

  if (loading) {
    return (
      <LensShell lensId="tasks">
        <div className="flex items-center justify-center h-[calc(100vh-3.5rem)] text-white/40">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      </LensShell>
    );
  }

  if (projects.length === 0) {
    return (
      <LensShell lensId="tasks">
        <div className="flex flex-col items-center justify-center h-[calc(100vh-3.5rem)] text-white/60 gap-4">
          <FolderPlus className="w-12 h-12 opacity-40" />
          <div className="text-center">
            <p className="text-lg mb-2">No projects yet</p>
            <p className="text-sm">Create your first project to start tracking tasks.</p>
          </div>
          <button
            onClick={() => setCreateProjectOpen(true)}
            className="px-4 py-2 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> New project
          </button>
        </div>
        <ProjectCreateModal
          open={createProjectOpen}
          onClose={() => setCreateProjectOpen(false)}
          onCreated={(id) => {
            setCreateProjectOpen(false);
            refreshProjects();
          }}
        />
      </LensShell>
    );
  }

  return (
    <LensShell lensId="tasks">
      <div className="flex h-[calc(100vh-3.5rem)] bg-black/40">
        {/* ─── Sidebar: project tree + sprint list ────────────────── */}
        <TaskProjectSidebar
          projects={projects}
          activeProject={activeProject}
          onSelectProject={setActiveProject}
          onCreateProject={() => setCreateProjectOpen(true)}
          sprints={sprints}
          activeSprintId={activeSprintId}
          onSelectSprint={setActiveSprintId}
        />

        {/* ─── Main: list / board / calendar ──────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-black/40">
            <h2 className="text-sm font-semibold text-white flex-1 truncate">
              {activeProject?.icon || '📋'} {activeProject?.name}
              <span className="ml-2 text-white/40 text-xs">{activeProject?.key}</span>
            </h2>
            <div className="relative">
              <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-white/40" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tasks…"
                className="pl-7 pr-2 py-1 text-xs bg-white/5 border border-white/10 rounded text-white placeholder-white/40 focus:outline-none focus:border-cyan-400/40 w-48"
              />
            </div>
            <button
              onClick={() => setCommandOpen(true)}
              className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-white/60"
              title="Command palette (⌘K)"
            >
              ⌘K
            </button>
            <div className="flex items-center gap-0.5 bg-white/5 rounded p-0.5">
              <ViewBtn icon={<ListIcon className="w-3.5 h-3.5" />} active={view === 'list'} onClick={() => setView('list')} />
              <ViewBtn icon={<Layout className="w-3.5 h-3.5" />} active={view === 'board'} onClick={() => setView('board')} />
              <ViewBtn icon={<Calendar className="w-3.5 h-3.5" />} active={view === 'calendar'} onClick={() => setView('calendar')} />
            </div>
            <button
              onClick={() => setCreateTaskOpen(true)}
              className="px-2 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-xs font-medium flex items-center gap-1"
              title="New task (⌘I)"
            >
              <Plus className="w-3 h-3" /> Task
            </button>
          </div>

          {/* View body */}
          <div className="flex-1 overflow-hidden">
            {workflow && view === 'list' && (
              <TaskListView
                tasks={tasks}
                statuses={statusesByCategory}
                onSelect={setActiveTaskId}
                activeTaskId={activeTaskId}
                onChange={refreshTasks}
              />
            )}
            {workflow && view === 'board' && (
              <TaskBoardView
                tasks={tasks}
                statuses={statusesByCategory}
                onSelect={setActiveTaskId}
                onChange={refreshTasks}
              />
            )}
            {workflow && view === 'calendar' && (
              <TaskCalendarView tasks={tasks} onSelect={setActiveTaskId} />
            )}
          </div>

          {/* Sprint panel docked at bottom when sprint selected */}
          {activeSprintId && (
            <SprintPanel
              sprintId={activeSprintId}
              onClose={() => setActiveSprintId(null)}
            />
          )}
        </div>

        {/* ─── Detail pane ────────────────────────────────────────── */}
        {activeTask && workflow && (
          <TaskDetailPane
            task={activeTask}
            workflow={workflow}
            sprints={sprints}
            onClose={() => setActiveTaskId(null)}
            onChange={refreshTasks}
          />
        )}
      </div>

      <TaskCreateModal
        open={createTaskOpen}
        onClose={() => setCreateTaskOpen(false)}
        project={activeProject}
        workflow={workflow}
        onCreated={() => { setCreateTaskOpen(false); refreshTasks(); }}
      />

      <ProjectCreateModal
        open={createProjectOpen}
        onClose={() => setCreateProjectOpen(false)}
        onCreated={() => { setCreateProjectOpen(false); refreshProjects(); }}
      />

      <TaskCommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        onJumpToTask={(id) => { setActiveTaskId(id); setCommandOpen(false); }}
        onJumpToProject={(p) => { setActiveProject(p); setCommandOpen(false); }}
      />
    </LensShell>
  );
}

function ViewBtn({ icon, active, onClick }: { icon: React.ReactNode; active: boolean; onClick: () => void; }) {
  return (
    <button
      onClick={onClick}
      className={`p-1 rounded ${active ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/80'}`}
    >
      {icon}
    </button>
  );
}
