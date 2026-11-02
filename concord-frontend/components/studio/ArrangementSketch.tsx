'use client';

/**
 * Arrangement Sketch — Section Markers + Audio Pins over a real studio project.
 *
 * One surface for the Studio parity workbench and the Music lens. Everything is
 * stored by the studio.* macros, so a sketch made in Music is the same one
 * Studio sees:
 *   Section Marker  → studio.markers-add / -update / -delete  (kind "section", with lengthBeats)
 *   Audio Pin       → studio.clips-create / -delete            (kind "audio" clip on an audio track)
 *   Arrangement Sketch → derived from those records (lib/daw/arrangement.ts), nothing invented.
 * Bars assume the project's own time signature (4/4 → 4 beats per bar).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, ChevronLeft, ChevronRight, Loader2, Music2, Pin, Plus, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { logStudioCollabEdit } from '@/lib/daw/collab-log';
import { SECTION_PRESETS } from '@/components/whiteboard/whiteboard-model';
import {
  arrangementEnd, beatsPerBar, moveSection, relayout, removeSection, resizeSection, sectionsFromMarkers, totalBars,
  type SectionMarker, type SketchSection,
} from '@/lib/daw/arrangement';

interface ProjectRow { id: string; name: string }
interface TrackRow { id: string; name: string; kind: string }
interface AudioClip { id: string; trackId: string; name: string; startBeats: number; lengthBeats: number; audioUrl: string | null; colour?: string }

const PX_PER_BAR = 22;

export function ArrangementSketch({ projectId: fixedProjectId, lens = 'studio', hostPicksProject = false }: { projectId?: string; lens?: 'studio' | 'music'; /** The host already shows a project picker (the Studio workbench does); do not render a second one. */ hostPicksProject?: boolean }) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [pickedId, setPickedId] = useState('');
  const ownPicker = !fixedProjectId && !hostPicksProject;
  const projectId = hostPicksProject ? (fixedProjectId || '') : (fixedProjectId || pickedId);

  const [timeSig, setTimeSig] = useState('4/4');
  const [bpm, setBpm] = useState<number | null>(null);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [markers, setMarkers] = useState<SectionMarker[]>([]);
  const [pins, setPins] = useState<AudioClip[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pinName, setPinName] = useState('');
  const [pinTrack, setPinTrack] = useState('');
  const [pinBar, setPinBar] = useState('1');
  const [pinBars, setPinBars] = useState('4');
  const [pinUrl, setPinUrl] = useState('');

  const bpb = useMemo(() => beatsPerBar(timeSig), [timeSig]);
  const sections = useMemo(() => sectionsFromMarkers(markers), [markers]);
  const audioTracks = useMemo(() => tracks.filter((t) => t.kind === 'audio'), [tracks]);

  // Project list (only when the host did not hand us a project).
  useEffect(() => {
    if (!ownPicker) return;
    let live = true;
    void lensRun('studio', 'project-list', {}).then((r) => {
      if (!live) return;
      const rows = (r.data?.result?.projects || []) as ProjectRow[];
      setProjects(rows);
      setPickedId((cur) => cur || rows[0]?.id || '');
    }).catch(() => { /* signed out / offline: the empty state says so */ });
    return () => { live = false; };
  }, [ownPicker]);

  const refresh = useCallback(async () => {
    if (!projectId) { setMarkers([]); setPins([]); setTracks([]); return; }
    setLoading(true);
    setError(null);
    try {
      const [proj, mk, cl] = await Promise.all([
        lensRun('studio', 'project-get', { id: projectId }),
        lensRun('studio', 'markers-list', { projectId }),
        lensRun('studio', 'clips-list', { projectId }),
      ]);
      const p = proj.data?.result?.project as { timeSignature?: string; bpm?: number; tracks?: TrackRow[] } | undefined;
      setTimeSig(p?.timeSignature || '4/4');
      setBpm(typeof p?.bpm === 'number' ? p.bpm : null);
      setTracks(Array.isArray(p?.tracks) ? p!.tracks! : []);
      setMarkers((mk.data?.result?.markers || []) as SectionMarker[]);
      setPins(((cl.data?.result?.clips || []) as Array<AudioClip & { kind?: string }>).filter((c) => c.kind === 'audio'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this project.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setPinTrack((cur) => (audioTracks.some((t) => t.id === cur) ? cur : audioTracks[0]?.id || '')); }, [audioTracks]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'That change failed.'); } finally { setBusy(false); }
  }, [refresh]);

  const writeLayout = useCallback(async (next: SketchSection[]) => {
    const origin = sections.length ? Math.min(...sections.map((s) => s.startBeats)) : 0;
    for (const w of relayout(next, origin, sections)) {
      const r = await lensRun('studio', 'markers-update', { id: w.id, timeBeats: w.timeBeats, lengthBeats: w.lengthBeats });
      if (r.data?.ok === false) throw new Error(r.data.error || 'Could not move a section.');
    }
  }, [sections]);

  const addSection = (preset: (typeof SECTION_PRESETS)[number]) => void run(async () => {
    const r = await lensRun('studio', 'markers-add', {
      projectId, name: preset.label, kind: 'section', colour: preset.color,
      timeBeats: arrangementEnd(sections), lengthBeats: preset.bars * bpb,
    });
    if (r.data?.ok === false) throw new Error(r.data.error || 'Could not add the section.');
    logStudioCollabEdit(projectId, 'markers-add', r.data?.result?.marker?.id, { name: preset.label, kind: 'section' });
  });

  const deleteSection = (id: string) => void run(async () => {
    const r = await lensRun('studio', 'markers-delete', { id });
    if (r.data?.ok === false) throw new Error(r.data.error || 'Could not delete the section.');
    logStudioCollabEdit(projectId, 'markers-delete', id);
    await writeLayout(removeSection(sections, id)); // close the gap
  });

  const shiftSection = (id: string, dir: -1 | 1) => void run(() => writeLayout(moveSection(sections, id, dir)));
  const resize = (id: string, deltaBars: number) => void run(() => writeLayout(resizeSection(sections, id, deltaBars, bpb)));

  const pinAudio = () => void run(async () => {
    const bar = Math.max(1, Math.floor(Number(pinBar) || 1));
    const lenBars = Math.max(1, Math.floor(Number(pinBars) || 1));
    const r = await lensRun('studio', 'clips-create', {
      projectId, trackId: pinTrack, name: pinName.trim() || 'Audio pin', kind: 'audio',
      startBeats: (bar - 1) * bpb, lengthBeats: lenBars * bpb, ...(pinUrl.trim() ? { audioUrl: pinUrl.trim() } : {}),
    });
    if (r.data?.ok === false) throw new Error(r.data.error || 'Could not pin the audio.');
    logStudioCollabEdit(projectId, 'clips-create', r.data?.result?.clip?.id, { name: pinName, kind: 'audio' });
    setPinName(''); setPinUrl('');
  });

  const unpin = (id: string) => void run(async () => {
    const r = await lensRun('studio', 'clips-delete', { id });
    if (r.data?.ok === false) throw new Error(r.data.error || 'Could not remove the pin.');
    logStudioCollabEdit(projectId, 'clips-delete', id);
  });

  const bars = totalBars(sections, bpb);
  const laneWidth = Math.max(240, Math.ceil(((arrangementEnd(sections) || 0) / bpb) * PX_PER_BAR) + 12);

  return (
    <section data-testid="arrangement-sketch" data-lens-host={lens} className="space-y-4 rounded-xl border border-white/10 bg-[#0d1117] p-4 text-gray-100">
      <header className="flex flex-wrap items-center gap-3">
        <Bookmark className="h-4 w-4 text-amber-400" aria-hidden />
        <h2 className="text-sm font-semibold">Arrangement Sketch</h2>
        <span data-testid="arrangement-summary" className="text-xs text-gray-400">
          {sections.length} section{sections.length === 1 ? '' : 's'} · {bars} bar{bars === 1 ? '' : 's'} · {timeSig}{bpm ? ` · ${bpm} BPM` : ''}
        </span>
        {ownPicker && (
          <select
            aria-label="Studio project"
            data-testid="arrangement-project"
            value={pickedId}
            onChange={(e) => setPickedId(e.target.value)}
            className="ml-auto rounded border border-white/10 bg-lattice-deep px-2 py-1 text-xs text-white"
          >
            {projects.length === 0 && <option value="">No studio projects yet</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {(loading || busy) && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" aria-label="Working" />}
      </header>

      {error && <p role="alert" className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-300">{error}</p>}

      {!projectId ? (
        <p data-testid="arrangement-empty" className="text-xs text-gray-400">
          {hostPicksProject
            ? 'Pick a project above to sketch its arrangement.'
            : 'Sketch an arrangement on a Studio project. Create one in the Studio (Parity workbench → Session workbench), then pick it here.'}
        </p>
      ) : (
        <>
          {/* Section Marker */}
          <div data-testid="section-marker-controls" className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-400">
              <Bookmark className="h-3 w-3" aria-hidden /> Section Marker
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SECTION_PRESETS.map((p) => (
                <button
                  key={p.type}
                  type="button"
                  data-testid={`arrangement-add-${p.type}`}
                  disabled={busy}
                  onClick={() => addSection(p)}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs hover:bg-white/5 disabled:opacity-40"
                  style={{ borderColor: `${p.color}55` }}
                >
                  <Plus className="h-3 w-3" aria-hidden /> {p.label} <span className="text-gray-400">{p.bars} bars</span>
                </button>
              ))}
            </div>
          </div>

          {/* The sketch lane: sections at bar scale, audio pins above */}
          <div className="overflow-x-auto">
            <div style={{ width: laneWidth }} className="space-y-1">
              <div data-testid="audio-pin-lane" className="relative h-6">
                {pins.map((c) => (
                  <div
                    key={c.id}
                    data-testid={`audio-pin-${c.id}`}
                    title={`${c.name} · bar ${Math.floor(c.startBeats / bpb) + 1}${c.audioUrl ? '' : ' · no audio attached'}`}
                    className="group absolute top-0 flex h-6 items-center gap-1 rounded border border-cyan-400/40 bg-cyan-400/10 px-1.5 text-[10px] text-cyan-200"
                    style={{ left: (c.startBeats / bpb) * PX_PER_BAR }}
                  >
                    <Music2 className="h-3 w-3" aria-hidden /> <span className="max-w-[90px] truncate">{c.name}</span>
                    <button type="button" aria-label={`Remove pin ${c.name}`} onClick={() => unpin(c.id)} className="opacity-0 group-hover:opacity-100"><Trash2 className="h-3 w-3 text-rose-300" /></button>
                  </div>
                ))}
              </div>
              <div data-testid="sketch-lane" className="flex items-stretch gap-0.5">
                {sections.length === 0 && <p className="py-3 text-xs text-gray-400">No sections yet. Add an Intro, Verse or Chorus above.</p>}
                {sections.map((s, i) => {
                  const nBars = Math.round(s.lengthBeats / bpb);
                  return (
                    <div
                      key={s.id}
                      data-testid={`sketch-section-${s.id}`}
                      className="flex min-h-[72px] flex-col rounded-lg border-2 p-1.5"
                      style={{ width: Math.max(56, (s.lengthBeats / bpb) * PX_PER_BAR), borderColor: s.colour, backgroundColor: `${s.colour}18` }}
                    >
                      <span className="truncate text-[11px] font-bold" style={{ color: s.colour }}>{s.name}</span>
                      <span className="flex-1 text-center text-lg font-bold tabular-nums text-white/80">{nBars}<span className="ml-0.5 text-[9px] font-normal text-gray-400">bars{s.open ? '*' : ''}</span></span>
                      <div className="flex items-center gap-0.5">
                        <button type="button" aria-label={`Move ${s.name} earlier`} disabled={busy || i === 0} onClick={() => shiftSection(s.id, -1)} className="rounded bg-white/5 p-0.5 disabled:opacity-30"><ChevronLeft className="h-3 w-3" /></button>
                        <button type="button" aria-label={`Move ${s.name} later`} disabled={busy || i === sections.length - 1} onClick={() => shiftSection(s.id, 1)} className="rounded bg-white/5 p-0.5 disabled:opacity-30"><ChevronRight className="h-3 w-3" /></button>
                        <button type="button" aria-label={`${s.name} one bar shorter`} disabled={busy || nBars <= 1} onClick={() => resize(s.id, -1)} className="rounded bg-white/5 px-1 text-[10px]">−</button>
                        <button type="button" aria-label={`${s.name} one bar longer`} disabled={busy} onClick={() => resize(s.id, 1)} className="rounded bg-white/5 px-1 text-[10px]">+</button>
                        <button type="button" aria-label={`Delete ${s.name}`} disabled={busy} onClick={() => deleteSection(s.id)} className="ml-auto rounded bg-white/5 p-0.5 text-rose-300"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {sections.some((s) => s.open) && <p className="text-[10px] text-gray-400">* length not stored yet; resize or re-order to fix it.</p>}
            </div>
          </div>

          {/* Audio Pin */}
          <div data-testid="audio-pin-controls" className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-400">
              <Pin className="h-3 w-3" aria-hidden /> Audio Pin
            </div>
            {audioTracks.length === 0 ? (
              <p data-testid="audio-pin-no-track" className="text-xs text-gray-400">This project has no audio track yet. Add one in the Studio, then pin audio to it here.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                <input aria-label="Pin name" value={pinName} onChange={(e) => setPinName(e.target.value)} placeholder="Verse vocal take 3" className="col-span-2 rounded border border-white/10 bg-lattice-deep px-2 py-1 text-xs text-white" />
                <select aria-label="Pin track" value={pinTrack} onChange={(e) => setPinTrack(e.target.value)} className="rounded border border-white/10 bg-lattice-deep px-2 py-1 text-xs text-white">
                  {audioTracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <input aria-label="Pin at bar" type="number" min={1} value={pinBar} onChange={(e) => setPinBar(e.target.value)} className="rounded border border-white/10 bg-lattice-deep px-2 py-1 text-xs text-white" title="Bar" />
                <input aria-label="Pin length in bars" type="number" min={1} value={pinBars} onChange={(e) => setPinBars(e.target.value)} className="rounded border border-white/10 bg-lattice-deep px-2 py-1 text-xs text-white" title="Length (bars)" />
                <input aria-label="Audio URL (optional)" value={pinUrl} onChange={(e) => setPinUrl(e.target.value)} placeholder="audio URL (optional)" className="col-span-2 rounded border border-white/10 bg-lattice-deep px-2 py-1 text-xs text-white sm:col-span-4" />
                <button type="button" data-testid="arrangement-pin-audio" disabled={busy || !pinTrack} onClick={pinAudio} className="col-span-2 inline-flex items-center justify-center gap-1 rounded bg-cyan-500 px-2 py-1 text-xs font-semibold text-black disabled:opacity-40">
                  <Pin className="h-3 w-3" aria-hidden /> Pin audio
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default ArrangementSketch;
