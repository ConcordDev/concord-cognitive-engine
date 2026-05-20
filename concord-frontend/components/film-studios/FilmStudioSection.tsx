'use client';

/**
 * FilmStudioSection — StudioBinder + DaVinci Resolve + Frame.io shape
 * production suite. Owns the project roster + active project; panels
 * hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Clapperboard, Plus, FileText, Camera, CalendarDays, Wallet, Scissors, MessageSquare, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { FsScriptPanel } from './FsScriptPanel';
import { FsShotsPanel } from './FsShotsPanel';
import { FsSchedulePanel } from './FsSchedulePanel';
import { FsBudgetTeamPanel } from './FsBudgetTeamPanel';
import { FsEditPanel } from './FsEditPanel';
import { FsReviewPanel } from './FsReviewPanel';

interface Project { id: string; title: string; format: string; logline: string | null }
interface Dash {
  scenes: number; scheduledScenes: number; pages: number; shots: number;
  shootDays: number; cast: number; crew: number; sequences: number;
  versions: number; budgetEstimated: number; budgetActual: number;
}
type TabId = 'script' | 'shots' | 'schedule' | 'budget' | 'edit' | 'review';
const TABS: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: 'script', label: 'Script', icon: FileText },
  { id: 'shots', label: 'Shots', icon: Camera },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'budget', label: 'Budget & Team', icon: Wallet },
  { id: 'edit', label: 'Edit', icon: Scissors },
  { id: 'review', label: 'Review', icon: MessageSquare },
];

const FORMATS = ['feature', 'short', 'series', 'spec', 'doc', 'commercial'];

export function FilmStudioSection() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<string>('');
  const [dash, setDash] = useState<Dash | null>(null);
  const [tab, setTab] = useState<TabId>('script');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', format: 'feature' });

  const refreshProjects = useCallback(async () => {
    const r = await lensRun('film-studios', 'project-list', {});
    const list: Project[] = r.data?.result?.projects || [];
    setProjects(list);
    setActiveProject((prev) => (list.some((p) => p.id === prev) ? prev : list[0]?.id || ''));
    setLoading(false);
  }, []);

  const refreshDash = useCallback(async () => {
    if (!activeProject) { setDash(null); return; }
    const r = await lensRun('film-studios', 'film-dashboard', { projectId: activeProject });
    setDash((r.data?.result as Dash | null) || null);
  }, [activeProject]);

  useEffect(() => { void refreshProjects(); }, [refreshProjects]);
  useEffect(() => { void refreshDash(); }, [refreshDash]);

  const addProject = async () => {
    if (!form.title.trim()) { setError('Project title is required.'); return; }
    const r = await lensRun('film-studios', 'project-create', { title: form.title.trim(), format: form.format });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', format: 'feature' });
    setError(null);
    await refreshProjects();
  };

  const delProject = async (id: string) => {
    await lensRun('film-studios', 'project-delete', { id });
    await refreshProjects();
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-fuchsia-600/15 to-transparent">
        <Clapperboard className="w-5 h-5 text-fuchsia-400" />
        <h2 className="text-sm font-bold text-zinc-100">Film Studio</h2>
        <span className="text-[11px] text-zinc-500">StudioBinder + Resolve + Frame.io shape</span>
      </header>

      {error && <div className="mx-4 mt-3 text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : (
        <>
          {/* Project roster */}
          <div className="px-4 py-3 border-b border-zinc-800 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {projects.map((p) => (
                <span key={p.id} className={cn('flex items-center gap-1.5 text-[11px] pl-2.5 pr-1.5 py-1 rounded-lg',
                  activeProject === p.id ? 'bg-fuchsia-600 text-white' : 'bg-zinc-800 text-zinc-300')}>
                  <button type="button" onClick={() => setActiveProject(p.id)}>{p.title}</button>
                  <button type="button" onClick={() => delProject(p.id)} className="text-zinc-300/70 hover:text-rose-200">×</button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input placeholder="New project title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
                {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <button type="button" onClick={addProject}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg">
                <Plus className="w-3.5 h-3.5" /> Project
              </button>
            </div>
          </div>

          {!activeProject ? (
            <p className="text-[11px] text-zinc-500 italic px-4 py-8 text-center">Create a project to start your production.</p>
          ) : (
            <>
              {dash && (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
                  <Stat label="Scenes" value={`${dash.scheduledScenes}/${dash.scenes}`} />
                  <Stat label="Pages" value={dash.pages} />
                  <Stat label="Shots" value={dash.shots} />
                  <Stat label="Shoot days" value={dash.shootDays} />
                  <Stat label="Cast/crew" value={`${dash.cast}/${dash.crew}`} />
                  <Stat label="Budget" value={`$${(dash.budgetActual || dash.budgetEstimated).toLocaleString()}`} />
                </div>
              )}
              <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
                {TABS.map((t) => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button key={t.id} type="button" onClick={() => setTab(t.id)}
                      className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-fuchsia-500',
                        active ? 'bg-zinc-900 text-fuchsia-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
                      <Icon className="w-3.5 h-3.5" /> {t.label}
                    </button>
                  );
                })}
              </nav>
              <div className="p-4">
                {tab === 'script' && <FsScriptPanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'shots' && <FsShotsPanel projectId={activeProject} />}
                {tab === 'schedule' && <FsSchedulePanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'budget' && <FsBudgetTeamPanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'edit' && <FsEditPanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'review' && <FsReviewPanel projectId={activeProject} onChange={refreshDash} />}
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
