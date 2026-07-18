'use client';

import { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import { usePipeValue } from '@/components/panel-polish';
import ClipsTimelinePanel from '@/components/studio/ClipsTimelinePanel';
import MidiPianoRoll from '@/components/studio/MidiPianoRoll';
import AutomationLanesPanel from '@/components/studio/AutomationLanesPanel';
import BouncePanel from '@/components/studio/BouncePanel';
import MarkersPanel from '@/components/studio/MarkersPanel';
import TempoMap from '@/components/studio/TempoMap';
import PresetsLibraryPanel from '@/components/studio/PresetsLibraryPanel';
import SendsRouting from '@/components/studio/SendsRouting';
import ScenesLauncher from '@/components/studio/ScenesLauncher';
import ClipEditorPanel from '@/components/studio/ClipEditorPanel';
import DrumRackPanel from '@/components/studio/DrumRackPanel';
import FxRackPanel from '@/components/studio/FxRackPanel';
import MidiMapPanel from '@/components/studio/MidiMapPanel';
import QuantizePanel from '@/components/studio/QuantizePanel';
import RecordingPanel from '@/components/studio/RecordingPanel';
import ProjectIOPanel from '@/components/studio/ProjectIOPanel';
import CollabPanel from '@/components/studio/CollabPanel';

/* ------------------------------------------------------------------ */
/*  Session workbench section                                          */
/* ------------------------------------------------------------------ */

type WorkbenchTab =
  | 'clips' | 'midi' | 'automation' | 'bounce' | 'markers' | 'tempo' | 'presets' | 'sends' | 'scenes'
  | 'clipEdit' | 'drumRack' | 'fxRack' | 'midiMap' | 'quantize' | 'recording' | 'projectIO' | 'collab';

interface WorkbenchProjectRow { id: string; name: string; trackCount?: number }
interface WorkbenchTrackRow { id: string; name: string; kind: string }
interface WorkbenchClipRow { id: string; name: string }

export function DawWorkbenchSection() {
  const [active, setActive] = useState<WorkbenchTab>('clips');
  const [projectId, setProjId] = useState<string>('');
  const [trackId, setTrackId] = useState<string>('');
  const [clipId, setClipId] = useState<string>('');

  // Real pickers sourced from the studio.* parity backend (project-list /
  // project-get / clips-list) — no raw-ID paste. Cascades project → track
  // → clip so a user can never select an id that doesn't actually belong
  // to the current project/track.
  const [projects, setProjects] = useState<WorkbenchProjectRow[]>([]);
  const [tracks, setTracks] = useState<WorkbenchTrackRow[]>([]);
  const [clips, setClips] = useState<WorkbenchClipRow[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  const refreshProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const res = await lensRun('studio', 'project-list', {});
      setProjects((res.data?.result?.projects || []) as WorkbenchProjectRow[]);
    } catch (e) {
      console.error('[Studio workbench] project-list failed:', e);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  useEffect(() => { void refreshProjects(); }, [refreshProjects]);

  // Wave-4 gap-closure: StudioActionPanel publishes `studio.project` on the
  // same PipingProvider tree right after a successful project-create. Auto
  // re-fetch the list so the workbench picker doesn't need the manual ⟳
  // button to see a project created in the panel below it. The button stays
  // as the honest fallback for cases where the pipe hasn't fired (e.g. the
  // project was created before this session's PipingProvider mounted).
  const createdProjectPipe = usePipeValue<{ id: string; name: string }>('studio.project');
  useEffect(() => {
    if (!createdProjectPipe) return;
    void refreshProjects();
  }, [createdProjectPipe, refreshProjects]);

  useEffect(() => {
    setTrackId('');
    setTracks([]);
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await lensRun('studio', 'project-get', { id: projectId });
        const proj = res.data?.result?.project as { tracks?: WorkbenchTrackRow[] } | undefined;
        if (!cancelled) setTracks(proj?.tracks || []);
      } catch (e) {
        console.error('[Studio workbench] project-get failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    setClipId('');
    setClips([]);
    if (!projectId || !trackId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await lensRun('studio', 'clips-list', { projectId, trackId });
        if (!cancelled) setClips((res.data?.result?.clips || []) as WorkbenchClipRow[]);
      } catch (e) {
        console.error('[Studio workbench] clips-list failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, trackId]);

  const TABS: { id: WorkbenchTab; label: string }[] = [
    { id: 'clips', label: 'Clips' },
    { id: 'clipEdit', label: 'Clip editor' },
    { id: 'midi', label: 'Piano roll' },
    { id: 'quantize', label: 'Quantize' },
    { id: 'automation', label: 'Automation' },
    { id: 'drumRack', label: 'Drum rack' },
    { id: 'fxRack', label: 'FX racks' },
    { id: 'midiMap', label: 'MIDI map' },
    { id: 'recording', label: 'Recording' },
    { id: 'bounce', label: 'Bounce' },
    { id: 'projectIO', label: 'Stems & I/O' },
    { id: 'markers', label: 'Markers' },
    { id: 'tempo', label: 'Tempo' },
    { id: 'presets', label: 'Presets' },
    { id: 'sends', label: 'Sends' },
    { id: 'scenes', label: 'Scenes' },
    { id: 'collab', label: 'Collaborate' },
  ];
  return (
    <section className="mt-6 space-y-3">
      <h2 className="text-sm font-semibold text-violet-300 uppercase tracking-wider">Session workbench</h2>
      <div className="grid grid-cols-3 gap-2 text-xs items-center">
        <div className="flex items-center gap-1">
          <select
            value={projectId}
            onChange={e => setProjId(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white"
          >
            <option value="">— pick a project ({projects.length}) —</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}{p.trackCount != null ? ` · ${p.trackCount} tracks` : ''}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void refreshProjects()}
            disabled={loadingProjects}
            title="Refresh project list"
            className="px-2 py-1 text-[10px] text-violet-300 hover:text-violet-200 border border-violet-500/20 rounded disabled:opacity-40"
          >
            {loadingProjects ? '…' : '⟳'}
          </button>
        </div>
        <select
          value={trackId}
          onChange={e => setTrackId(e.target.value)}
          disabled={!projectId}
          className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white disabled:opacity-40"
        >
          <option value="">{projectId ? `— pick a track (${tracks.length}) —` : 'pick a project first'}</option>
          {tracks.map(t => <option key={t.id} value={t.id}>{t.name} · {t.kind}</option>)}
        </select>
        <select
          value={clipId}
          onChange={e => setClipId(e.target.value)}
          disabled={!trackId}
          className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white disabled:opacity-40"
        >
          <option value="">{trackId ? `— pick a clip (${clips.length}) —` : 'pick a track first'}</option>
          {clips.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {!loadingProjects && projects.length === 0 && (
        <p className="text-[10px] text-gray-400">
          No projects yet — create one in &ldquo;Studio session&rdquo; below, then hit refresh (&#x27F3;) above.
        </p>
      )}
      <nav className="flex items-center gap-1 border-b border-violet-900/30 pb-2 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={
              'px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition ' +
              (active === t.id
                ? 'bg-violet-500/15 text-violet-300 border border-violet-500/20'
                : 'text-gray-400 hover:text-violet-300 hover:bg-violet-900/10 border border-transparent')
            }
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div>
        {active === 'clips' && <ClipsTimelinePanel projectId={projectId || undefined} trackId={trackId || undefined} />}
        {active === 'clipEdit' && <ClipEditorPanel projectId={projectId || undefined} trackId={trackId || undefined} />}
        {active === 'midi' && <MidiPianoRoll projectId={projectId || undefined} clipId={clipId || undefined} />}
        {active === 'quantize' && <QuantizePanel projectId={projectId || undefined} clipId={clipId || undefined} />}
        {active === 'automation' && <AutomationLanesPanel projectId={projectId || undefined} trackId={trackId || undefined} />}
        {active === 'drumRack' && <DrumRackPanel projectId={projectId || undefined} />}
        {active === 'fxRack' && <FxRackPanel />}
        {active === 'midiMap' && <MidiMapPanel projectId={projectId || undefined} />}
        {active === 'recording' && <RecordingPanel projectId={projectId || undefined} trackId={trackId || undefined} />}
        {active === 'bounce' && <BouncePanel projectId={projectId || undefined} />}
        {active === 'projectIO' && <ProjectIOPanel projectId={projectId || undefined} />}
        {active === 'markers' && <MarkersPanel projectId={projectId || undefined} />}
        {active === 'tempo' && <TempoMap projectId={projectId || undefined} />}
        {active === 'presets' && <PresetsLibraryPanel />}
        {active === 'sends' && <SendsRouting projectId={projectId || undefined} />}
        {active === 'scenes' && <ScenesLauncher projectId={projectId || undefined} />}
        {active === 'collab' && <CollabPanel projectId={projectId || undefined} />}
      </div>
    </section>
  );
}

export default DawWorkbenchSection;
