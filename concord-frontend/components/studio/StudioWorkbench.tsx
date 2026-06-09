'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Music, Sliders, Plus, Trash2, Save, Volume2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Track {
  id: string;
  name: string;
  kind: 'audio' | 'midi' | 'drum' | 'synth' | 'sample';
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  effects: Effect[];
}

export interface Effect {
  id: string;
  kind: 'delay' | 'reverb' | 'eq3' | 'compressor' | 'distortion';
  params: Record<string, number>;
  bypassed: boolean;
}

export interface Project {
  id: string;
  name: string;
  bpm: number;
  timeSignature: string;
  masterVolume: number;
  tracks: Track[];
  trackCount?: number;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function StudioWorkbench({ open, onClose }: Props) {
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[680px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-purple-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-purple-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Music className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-semibold text-gray-200">Studio Workbench</span>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-white/5 text-gray-400" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {activeProjectId ? <ProjectView projectId={activeProjectId} onBack={() => setActiveProjectId(null)} /> : <ProjectList onSelect={setActiveProjectId} />}
      </div>
    </div>
  );
}

function ProjectList({ onSelect }: { onSelect: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', bpm: 120, timeSignature: '4/4' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'studio', action: 'project-list', input: {} });
      setProjects(((r.data as { result?: { projects?: Project[] } }).result?.projects) || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    try {
      await lensRun({ domain: 'studio', action: 'project-create', input: draft });
      setCreating(false); setDraft({ name: '', bpm: 120, timeSignature: '4/4' });
      await refresh();
    } catch (e) { console.error(e); }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this project?')) return;
    try {
      await lensRun({ domain: 'studio', action: 'project-delete', input: { id } });
      await refresh();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-2">
      <button type="button" onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-purple-500/30 bg-purple-500/10 text-xs text-purple-200">
        <Plus className="w-3 h-3" /> New project
      </button>
      {creating && (
        <div className="rounded border border-purple-500/30 bg-purple-500/5 p-3 space-y-2">
          <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Project name"
            className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100" />
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1"><span className="text-[10px] text-gray-400">BPM</span>
              <input type="number" value={draft.bpm} onChange={(e) => setDraft({ ...draft, bpm: Number(e.target.value) })} min="30" max="300"
                className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            </label>
            <label className="flex flex-col gap-1"><span className="text-[10px] text-gray-400">Time sig</span>
              <input type="text" value={draft.timeSignature} onChange={(e) => setDraft({ ...draft, timeSignature: e.target.value })}
                className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            </label>
          </div>
          <button type="button" onClick={save} disabled={!draft.name.trim()}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-purple-500/40 bg-purple-500/15 text-xs text-purple-100 disabled:opacity-40">
            <Save className="w-3 h-3" /> Create
          </button>
        </div>
      )}
      {loading ? <div className="text-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div> :
        projects.length === 0 ? <p className="text-center text-xs text-gray-400 py-8">No projects.</p> :
        projects.map((p) => (
          <div key={p.id} className="rounded border border-white/10 bg-black/20 p-3 group hover:bg-white/5">
            <div className="flex items-start justify-between gap-2">
              <button type="button" onClick={() => onSelect(p.id)} className="flex-1 text-left min-w-0">
                <p className="text-sm font-medium text-gray-100">{p.name}</p>
                <p className="text-[11px] text-gray-400">{p.bpm} BPM · {p.timeSignature} · {p.trackCount} tracks</p>
              </button>
              <button aria-label="Delete" type="button" onClick={() => remove(p.id)}
                className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
            </div>
          </div>
        ))
      }
    </div>
  );
}

function ProjectView({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [project, setProject] = useState<Project | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await lensRun({ domain: 'studio', action: 'project-get', input: { id: projectId } });
      setProject(((r.data as { result?: { project?: Project } }).result?.project) || null);
    } catch (e) { console.error(e); }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const addTrack = async (kind: Track['kind']) => {
    try {
      await lensRun({ domain: 'studio', action: 'track-add', input: { projectId, kind } });
      await refresh();
    } catch (e) { console.error(e); }
  };

  const updateTrack = async (trackId: string, patch: Partial<Track>) => {
    try {
      await lensRun({ domain: 'studio', action: 'track-update', input: { projectId, trackId, ...patch } });
      await refresh();
    } catch (e) { console.error(e); }
  };

  const removeTrack = async (trackId: string) => {
    try {
      await lensRun({ domain: 'studio', action: 'track-delete', input: { projectId, trackId } });
      await refresh();
    } catch (e) { console.error(e); }
  };

  const addEffect = async (trackId: string, kind: Effect['kind']) => {
    try {
      await lensRun({ domain: 'studio', action: 'effect-add', input: { projectId, trackId, kind } });
      await refresh();
    } catch (e) { console.error(e); }
  };

  if (!project) return <div className="text-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>;

  return (
    <div className="p-3 space-y-3">
      <button type="button" onClick={onBack} className="text-xs text-gray-400 hover:text-gray-200">← Back to projects</button>

      <div className="rounded border border-purple-500/30 bg-purple-500/5 p-3">
        <h3 className="text-lg font-semibold text-gray-100">{project.name}</h3>
        <p className="text-[11px] text-gray-400">{project.bpm} BPM · {project.timeSignature} · {project.tracks.length} tracks</p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase text-gray-400">Add track:</span>
        {(['audio', 'midi', 'drum', 'synth', 'sample'] as const).map((k) => (
          <button key={k} type="button" onClick={() => addTrack(k)}
            className="px-2 py-1 rounded-md border border-purple-500/30 bg-purple-500/10 text-xs text-purple-200">
            <Plus className="w-3 h-3 inline" /> {k}
          </button>
        ))}
      </div>

      {project.tracks.map((t) => (
        <div key={t.id} className="rounded border border-white/10 bg-black/20 p-3 space-y-2 group">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sliders className="w-3 h-3 text-purple-400" />
              <span className="text-sm font-medium text-gray-100">{t.name}</span>
              <span className="text-[10px] text-gray-400 uppercase">{t.kind}</span>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => updateTrack(t.id, { muted: !t.muted })}
                className={cn('px-2 py-0.5 text-[10px] rounded uppercase font-mono', t.muted ? 'bg-rose-500/20 text-rose-300' : 'border border-white/10 text-gray-400')}>M</button>
              <button type="button" onClick={() => updateTrack(t.id, { solo: !t.solo })}
                className={cn('px-2 py-0.5 text-[10px] rounded uppercase font-mono', t.solo ? 'bg-amber-500/20 text-amber-300' : 'border border-white/10 text-gray-400')}>S</button>
              <button aria-label="Delete" type="button" onClick={() => removeTrack(t.id)}
                className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label>
              <span className="text-[10px] text-gray-400 inline-flex items-center gap-1"><Volume2 className="w-3 h-3" /> Vol {(t.volume * 100).toFixed(0)}</span>
              <input type="range" min="0" max="1" step="0.01" value={t.volume}
                onChange={(e) => updateTrack(t.id, { volume: Number(e.target.value) })} className="w-full" />
            </label>
            <label>
              <span className="text-[10px] text-gray-400">Pan {t.pan > 0 ? `R${(t.pan * 100).toFixed(0)}` : t.pan < 0 ? `L${(-t.pan * 100).toFixed(0)}` : 'C'}</span>
              <input type="range" min="-1" max="1" step="0.01" value={t.pan}
                onChange={(e) => updateTrack(t.id, { pan: Number(e.target.value) })} className="w-full" />
            </label>
          </div>
          {t.effects.length > 0 && (
            <div className="border-t border-white/10 pt-2 space-y-1">
              <p className="text-[10px] uppercase text-gray-400">Effects ({t.effects.length})</p>
              {t.effects.map((e) => (
                <p key={e.id} className="text-[11px] text-gray-400">→ {e.kind}</p>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1 mt-1">
            {(['delay', 'reverb', 'eq3', 'compressor', 'distortion'] as const).map((k) => (
              <button key={k} type="button" onClick={() => addEffect(t.id, k)}
                className="px-1.5 py-0.5 text-[10px] rounded border border-white/10 hover:border-purple-500/30 text-gray-400 hover:text-purple-300">
                + {k}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default StudioWorkbench;
