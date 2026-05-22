'use client';

/**
 * CreativeWritingSection — Scrivener + Dabble + Plottr shape manuscript
 * studio. Owns the project roster + active project; panels hydrate via
 * lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import {
  PenTool, Plus, BookText, LayoutGrid, Users, GitBranch, TrendingUp, Loader2,
  Globe, FileDown, Target, BarChart3, GitCompare,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { CwBinderPanel } from './CwBinderPanel';
import { CwCorkboardPanel } from './CwCorkboardPanel';
import { CwCharactersPanel } from './CwCharactersPanel';
import { CwThreadsPanel } from './CwThreadsPanel';
import { CwProgressPanel } from './CwProgressPanel';
import { CwResearchPanel } from './CwResearchPanel';
import { CwBiblePanel } from './CwBiblePanel';
import { CwCompilePanel } from './CwCompilePanel';
import { CwTargetsPanel } from './CwTargetsPanel';
import { CwStatsPanel } from './CwStatsPanel';
import { CwSnapshotDiffPanel } from './CwSnapshotDiffPanel';

interface Project { id: string; title: string; genre: string; targetWords: number; wordCount?: number }
interface Dash {
  title: string; wordCount: number; targetWords: number; chapters: number;
  scenes: number; characters: number; threads: number;
  byStatus: Record<string, number>;
}
type TabId = 'binder' | 'corkboard' | 'characters' | 'plot' | 'research'
  | 'bible' | 'progress' | 'targets' | 'stats' | 'revisions' | 'compile';
const TABS: { id: TabId; label: string; icon: typeof BookText }[] = [
  { id: 'binder', label: 'Binder', icon: BookText },
  { id: 'corkboard', label: 'Corkboard', icon: LayoutGrid },
  { id: 'characters', label: 'Characters', icon: Users },
  { id: 'plot', label: 'Plot', icon: GitBranch },
  { id: 'research', label: 'Research', icon: BookText },
  { id: 'bible', label: 'Setting Bible', icon: Globe },
  { id: 'progress', label: 'Progress', icon: TrendingUp },
  { id: 'targets', label: 'Targets', icon: Target },
  { id: 'stats', label: 'Statistics', icon: BarChart3 },
  { id: 'revisions', label: 'Revisions', icon: GitCompare },
  { id: 'compile', label: 'Compile', icon: FileDown },
];

export function CreativeWritingSection() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<string>('');
  const [dash, setDash] = useState<Dash | null>(null);
  const [tab, setTab] = useState<TabId>('binder');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', genre: 'fiction', targetWords: '' });

  const refreshProjects = useCallback(async () => {
    const r = await lensRun('creative-writing', 'project-list', {});
    const list: Project[] = r.data?.result?.projects || [];
    setProjects(list);
    setActiveProject((prev) => (list.some((p) => p.id === prev) ? prev : list[0]?.id || ''));
    setLoading(false);
  }, []);

  const refreshDash = useCallback(async () => {
    if (!activeProject) { setDash(null); return; }
    const r = await lensRun('creative-writing', 'project-dashboard', { projectId: activeProject });
    setDash((r.data?.result as Dash | null) || null);
  }, [activeProject]);

  useEffect(() => { void refreshProjects(); }, [refreshProjects]);
  useEffect(() => { void refreshDash(); }, [refreshDash]);

  const addProject = async () => {
    if (!form.title.trim()) { setError('Project title is required.'); return; }
    const r = await lensRun('creative-writing', 'project-create', {
      title: form.title.trim(), genre: form.genre.trim() || 'fiction',
      targetWords: Number(form.targetWords) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', genre: 'fiction', targetWords: '' });
    setError(null);
    await refreshProjects();
  };

  const delProject = async (id: string) => {
    await lensRun('creative-writing', 'project-delete', { id });
    await refreshProjects();
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-amber-600/15 to-transparent">
        <PenTool className="w-5 h-5 text-amber-400" />
        <h2 className="text-sm font-bold text-zinc-100">Manuscript Studio</h2>
        <span className="text-[11px] text-zinc-500">Scrivener + Dabble + Plottr shape</span>
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
                  activeProject === p.id ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-300')}>
                  <button type="button" onClick={() => setActiveProject(p.id)}>{p.title}</button>
                  <button type="button" onClick={() => delProject(p.id)} className="text-zinc-300/70 hover:text-rose-200">×</button>
                </span>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <input placeholder="New manuscript title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Genre" value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Word target" inputMode="numeric" value={form.targetWords}
                onChange={(e) => setForm({ ...form, targetWords: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <button type="button" onClick={addProject}
                className="flex items-center justify-center gap-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg">
                <Plus className="w-3.5 h-3.5" /> Manuscript
              </button>
            </div>
          </div>

          {!activeProject ? (
            <p className="text-[11px] text-zinc-500 italic px-4 py-8 text-center">Create a manuscript to begin.</p>
          ) : (
            <>
              {dash && (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
                  <Stat label="Words" value={dash.wordCount.toLocaleString()} />
                  <Stat label="Target" value={dash.targetWords ? dash.targetWords.toLocaleString() : '—'} />
                  <Stat label="Chapters" value={dash.chapters} />
                  <Stat label="Scenes" value={dash.scenes} />
                  <Stat label="Characters" value={dash.characters} />
                  <Stat label="Threads" value={dash.threads} />
                </div>
              )}
              <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
                {TABS.map((t) => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button key={t.id} type="button" onClick={() => setTab(t.id)}
                      className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-amber-500',
                        active ? 'bg-zinc-900 text-amber-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
                      <Icon className="w-3.5 h-3.5" /> {t.label}
                    </button>
                  );
                })}
              </nav>
              <div className="p-4">
                {tab === 'binder' && <CwBinderPanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'corkboard' && <CwCorkboardPanel projectId={activeProject} />}
                {tab === 'characters' && <CwCharactersPanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'plot' && <CwThreadsPanel projectId={activeProject} onChange={refreshDash} />}
                {tab === 'research' && <CwResearchPanel projectId={activeProject} />}
                {tab === 'bible' && <CwBiblePanel projectId={activeProject} />}
                {tab === 'progress' && <CwProgressPanel projectId={activeProject} />}
                {tab === 'targets' && <CwTargetsPanel projectId={activeProject} />}
                {tab === 'stats' && <CwStatsPanel projectId={activeProject} />}
                {tab === 'revisions' && <CwSnapshotDiffPanel projectId={activeProject} />}
                {tab === 'compile' && <CwCompilePanel projectId={activeProject} />}
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
