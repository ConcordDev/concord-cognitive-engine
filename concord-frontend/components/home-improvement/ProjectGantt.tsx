'use client';

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { TimelineView } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';
import { GanttChartSquare, Plus, Trash2, Loader2, Link2 } from 'lucide-react';

interface ProjectSummary { id: string; name: string }
interface GanttBar {
  id: string;
  name: string;
  start: string;
  end: string;
  durationDays: number;
  progress: number;
  dependsOn: string[];
}
interface GanttResult {
  projectName: string;
  bars: GanttBar[];
  projectStart: string;
  projectEnd: string;
  totalDays: number;
  avgProgress: number;
}

const DOMAIN = 'home-improvement';

export function ProjectGantt() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [gantt, setGantt] = useState<GanttResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [phaseForm, setPhaseForm] = useState({ name: '', startDate: '', durationDays: '7', dependsOn: '' });

  const loadProjects = useCallback(async () => {
    setLoading(true);
    const { data } = await lensRun<{ projects: ProjectSummary[] }>(DOMAIN, 'project-list', {});
    if (data.ok && data.result) {
      const list = data.result.projects || [];
      setProjects(list);
      setSelected((s) => s || (list[0]?.id ?? ''));
    } else setError(data.error || 'Failed to load projects');
    setLoading(false);
  }, []);

  const loadGantt = useCallback(async (projectId: string) => {
    if (!projectId) { setGantt(null); return; }
    const { data } = await lensRun<GanttResult>(DOMAIN, 'gantt', { projectId });
    if (data.ok && data.result) setGantt(data.result);
    else { setGantt(null); setError(data.error || 'Failed to load timeline'); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadProjects(); }, []);
  useEffect(() => { if (selected) loadGantt(selected); }, [selected, loadGantt]);

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    setBusy(true); setError(null);
    const { data } = await lensRun<{ project: ProjectSummary }>(DOMAIN, 'project-add', { name: newProjectName });
    if (data.ok && data.result) { setNewProjectName(''); setSelected(data.result.project.id); await loadProjects(); }
    else setError(data.error || 'Failed to create project');
    setBusy(false);
  };

  const addPhase = async () => {
    if (!selected || !phaseForm.name.trim()) return;
    setBusy(true); setError(null);
    const dependsOn = phaseForm.dependsOn ? [phaseForm.dependsOn] : [];
    const { data } = await lensRun(DOMAIN, 'phase-add', {
      projectId: selected, name: phaseForm.name, startDate: phaseForm.startDate,
      durationDays: Number(phaseForm.durationDays) || 1, dependsOn,
    });
    if (data.ok) { setPhaseForm({ name: '', startDate: '', durationDays: '7', dependsOn: '' }); await loadGantt(selected); }
    else setError(data.error || 'Failed to add phase');
    setBusy(false);
  };

  const updateProgress = async (phaseId: string, progress: number) => {
    setBusy(true);
    const { data } = await lensRun(DOMAIN, 'phase-update', { projectId: selected, phaseId, progress });
    if (data.ok) await loadGantt(selected);
    setBusy(false);
  };

  const deletePhase = async (phaseId: string) => {
    setBusy(true);
    const { data } = await lensRun(DOMAIN, 'phase-delete', { projectId: selected, phaseId });
    if (data.ok) await loadGantt(selected);
    setBusy(false);
  };

  const bars = gantt?.bars || [];
  const span = gantt ? Date.parse(gantt.projectEnd) - Date.parse(gantt.projectStart) || 1 : 1;
  const projStart = gantt ? Date.parse(gantt.projectStart) : 0;
  const barName = new Map(bars.map((b) => [b.id, b.name]));

  const timelineEvents: TimelineEvent[] = bars.map((b) => ({
    id: b.id,
    label: b.name,
    time: b.start,
    tone: b.progress >= 100 ? 'good' : b.progress > 0 ? 'info' : 'default',
    detail: `${b.durationDays}d · ${b.progress}% done`,
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2 text-sm">
          <GanttChartSquare className="w-4 h-4 text-neon-cyan" /> Project Timeline
        </h3>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="panel p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {projects.length > 0 && (
            <select value={selected} onChange={(e) => setSelected(e.target.value)} className="input-lattice text-sm flex-1 min-w-[180px]">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="New project name" className="input-lattice text-sm flex-1 min-w-[160px]" />
          <button onClick={createProject} disabled={busy || !newProjectName.trim()} className="btn-neon text-xs disabled:opacity-50">
            <Plus className="w-3.5 h-3.5 inline" /> Project
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading...</div>
      ) : !selected ? (
        <p className="text-xs text-gray-400">Create a project to build a phase timeline.</p>
      ) : (
        <>
          {gantt && (
            <div className="grid grid-cols-3 gap-2">
              <div className="lens-card text-center">
                <p className="text-lg font-bold text-neon-cyan">{gantt.totalDays}d</p>
                <p className="text-xs text-gray-400">Total span</p>
              </div>
              <div className="lens-card text-center">
                <p className="text-lg font-bold text-neon-green">{gantt.avgProgress}%</p>
                <p className="text-xs text-gray-400">Avg progress</p>
              </div>
              <div className="lens-card text-center">
                <p className="text-lg font-bold text-neon-purple">{bars.length}</p>
                <p className="text-xs text-gray-400">Phases</p>
              </div>
            </div>
          )}

          {bars.length > 0 ? (
            <>
              <div className="panel p-3 space-y-2">
                {bars.map((b) => {
                  const offsetPct = ((Date.parse(b.start) - projStart) / span) * 100;
                  const widthPct = Math.max(4, ((Date.parse(b.end) - Date.parse(b.start)) / span) * 100);
                  return (
                    <div key={b.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-white font-medium">{b.name}</span>
                        <span className="flex items-center gap-2 text-gray-400">
                          {b.dependsOn.length > 0 && (
                            <span className="flex items-center gap-0.5 text-neon-purple">
                              <Link2 className="w-3 h-3" />after {b.dependsOn.map((d) => barName.get(d) || d).join(', ')}
                            </span>
                          )}
                          <span>{b.durationDays}d · {b.progress}%</span>
                          <button aria-label="Delete" onClick={() => deletePhase(b.id)} disabled={busy} className="text-gray-400 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                        </span>
                      </div>
                      <div className="relative h-5 bg-lattice-deep rounded">
                        <div
                          className="absolute h-5 rounded bg-neon-cyan/30 border border-neon-cyan/50"
                          style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
                        >
                          <div className="h-full rounded bg-neon-cyan/70" style={{ width: `${b.progress}%` }} />
                        </div>
                      </div>
                      <input
                        type="range" min={0} max={100} step={5} value={b.progress}
                        onChange={(e) => updateProgress(b.id, Number(e.target.value))}
                        disabled={busy} className="w-full accent-neon-cyan"
                      />
                    </div>
                  );
                })}
              </div>

              <div className="panel p-3">
                <p className="text-xs font-semibold text-gray-300 mb-2">Scheduled phase milestones</p>
                <TimelineView events={timelineEvents} height={110} />
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-400">No phases yet. Add phases below to build the timeline.</p>
          )}

          <div className="panel p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-300">Add phase</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <input value={phaseForm.name} onChange={(e) => setPhaseForm((f) => ({ ...f, name: e.target.value }))} placeholder="Phase name" className="input-lattice text-xs" />
              <input value={phaseForm.startDate} onChange={(e) => setPhaseForm((f) => ({ ...f, startDate: e.target.value }))} type="date" className="input-lattice text-xs" />
              <input value={phaseForm.durationDays} onChange={(e) => setPhaseForm((f) => ({ ...f, durationDays: e.target.value }))} type="number" placeholder="Days" className="input-lattice text-xs" />
              <select value={phaseForm.dependsOn} onChange={(e) => setPhaseForm((f) => ({ ...f, dependsOn: e.target.value }))} className="input-lattice text-xs">
                <option value="">No dependency</option>
                {bars.map((b) => <option key={b.id} value={b.id}>after: {b.name}</option>)}
              </select>
            </div>
            <button onClick={addPhase} disabled={busy || !phaseForm.name.trim()} className="btn-neon green w-full text-xs disabled:opacity-50">
              {busy ? 'Saving...' : 'Add Phase'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
