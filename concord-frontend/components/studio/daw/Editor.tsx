'use client';

/**
 * The Studio editor: one transport, browser, arrangement/session, an editor
 * pane (piano roll · devices · mixer) and the inspector. All edits go through
 * useStudioProject (undo + autosave); the audio clock never re-renders React.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutList, Grid3x3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DAWProject, DAWTrack, DAWClip, SynthPreset } from '@/lib/daw/types';
import { getStudioEngine } from '@/lib/daw/playback-engine';
import { assetMeta, newId, trackKind, createTrack, createMidiClip, note as mkNote, setTransportBpm, writeTempoPoints, type NewTrackKind } from '@/lib/daw/project';
import { beatAfter, bpmAt, projectTempoPoints } from '@/lib/daw/tempo-map';
import { isDrumInstrument } from '@/lib/daw/presets';
import { classifyMusicItem } from '@/lib/daw/music-filter';
import { parseMidiFile } from '@/lib/daw/midi-file';
import { putAudio } from '@/lib/daw/audio-store';
import { studioTransport, browserLocalStore, type LibraryItem } from '@/lib/daw/studio-api';
import { resolveAudio } from '@/lib/daw/persistence';
import { showToast } from '@/components/common/Toasts';
import { useStudioProject } from './useStudioProject';
import { useInputRecorder } from './useInputRecorder';
import { useTransportState } from './engine-hooks';
import { TransportBar } from './TransportBar';
import { ArrangeView } from './ArrangeView';
import { SessionGrid } from './SessionGrid';
import { PianoRoll } from './PianoRoll';
import { DevicePanel } from './DevicePanel';
import { MixerPanel, MASTER_ID } from './MixerPanel';
import { Inspector, MasterPanel } from './Inspector';
import { BrowserPanel, type BrowserPayload } from './BrowserPanel';
import { WaveThumb } from './ClipShapes';
import { ExportDialog, AutoMixDialog, VersionsDialog, AskProducerDialog } from './Dialogs';
import * as ops from './ops';

export const LAST_PROJECT_KEY = 'concord-studio-last-project';

type BottomTab = 'editor' | 'devices' | 'mixer';
type DialogKind = null | 'export' | 'automix' | 'versions' | 'producer';

interface RecordingState { trackIds: string[]; beat0Time: number; startBeat: number }

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export interface StudioEditorProps {
  initial: DAWProject;
  initialRev: number;
  onBack: () => void;
}

export function StudioEditor({ initial, initialRev, onBack }: StudioEditorProps) {
  const api = useStudioProject(initial, initialRev);
  const { project, edit } = api;
  const engine = getStudioEngine();
  const rec = useInputRecorder();
  const { state: transport, launched } = useTransportState();
  const [view, setView] = useState<'arrange' | 'session'>('arrange');
  const [bottom, setBottom] = useState<BottomTab>('editor');
  const [selTrack, setSelTrack] = useState<string | null>(() => initial.tracks.find((t) => t.armed)?.id || initial.tracks.find((t) => t.type !== 'master')?.id || null);
  const [selClip, setSelClip] = useState<string | null>(null);
  const [bw, setBw] = useState(28);
  const [metronome, setMetronome] = useState(false);
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [importing, setImporting] = useState(false);
  const projectRef = useRef(project);
  // Handlers read the latest project without subscribing the audio clock to React.
  // eslint-disable-next-line react-hooks/refs
  projectRef.current = project;
  const recordingRef = useRef<RecordingState | null>(null);
  // eslint-disable-next-line react-hooks/refs
  recordingRef.current = recording;
  const countIn = rec.state.prefs.countInBars;
  const bpb = project.timeSignature?.[0] || 4;

  useEffect(() => { engine.setMetronome(metronome); }, [engine, metronome]);
  useEffect(() => { engine.setMode(view); }, [engine, view]);
  useEffect(() => () => engine.stop(), [engine]);
  // A brand-new project is created on the server right away (not on first edit).
  useEffect(() => {
    if (initial.id.startsWith('local_')) void api.saveNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Reload-safe: the URL and "last project" always point at the saved project.
  useEffect(() => {
    if (project.id.startsWith('local_')) return;
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get('project') !== project.id) { u.searchParams.set('project', project.id); window.history.replaceState(window.history.state, '', u.toString()); }
      localStorage.setItem(LAST_PROJECT_KEY, project.id);
    } catch { /* noop */ }
  }, [project.id]);

  const track = project.tracks.find((t) => t.id === selTrack) || null;
  const found = ops.findClip(project, selClip);
  const clip = found?.clip || null;

  // ── edits ──
  const onTrack = useCallback((id: string, patch: Partial<DAWTrack>, key?: string) => {
    if (patch.armed) {
      const t = projectRef.current.tracks.find((x) => x.id === id);
      if (t && trackKind(t) === 'audio' && !rec.isOpen()) void rec.openInput(); // inside the click gesture (Safari/iOS)
      setSelTrack(id);
    }
    edit((p) => ops.mapTrack(p, id, (t) => ({ ...t, ...patch })), key);
  }, [edit, rec]);
  const onClip = useCallback((patch: Partial<DAWClip>, key?: string) => {
    if (!selClip) return;
    edit((p) => ops.mapClip(p, selClip, (c) => ({ ...c, ...patch })), key);
  }, [edit, selClip]);
  const addTrackOf = useCallback((kind: NewTrackKind, instrumentId?: string) => {
    const { track: t } = ops.addTrack(projectRef.current, kind, instrumentId);
    edit((p) => ({ ...p, tracks: [...p.tracks, { ...t, color: t.color }] }));
    setSelTrack(t.id);
    setSelClip(null);
    return t;
  }, [edit]);

  // ── audio import helpers ──
  const storeAudio = useCallback(async (name: string, channels: Float32Array[], sampleRate: number) => {
    const id = newId('aud');
    try {
      await putAudio({ id, projectId: projectRef.current.id, name, sampleRate, channelData: channels, createdAt: Date.now() });
    } catch {
      showToast('warning', 'Could not store audio on this device (private mode or full storage). It will still upload with the next save if the tab stays open.');
    }
    engine.setAudio(id, { channels, sampleRate });
    return { id, meta: assetMeta(id, name, channels, sampleRate) };
  }, [engine]);

  const placeAudio = useCallback((trackId: string | null, beat: number, id: string, meta: ReturnType<typeof assetMeta>, name: string) => {
    const lengthBeats = (meta.duration * bpmAt(projectTempoPoints(projectRef.current), Math.max(0, beat))) / 60;
    let target = trackId ? projectRef.current.tracks.find((t) => t.id === trackId && trackKind(t) === 'audio') : undefined;
    let newTrack: DAWTrack | null = null;
    if (!target) { newTrack = createTrack('audio', projectRef.current.tracks.length, { name: name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40) }); target = newTrack; }
    const tid = target.id;
    edit((p) => {
      let q: DAWProject = { ...p, audioAssets: { ...(p.audioAssets || {}), [id]: meta }, sampleRate: p.sampleRate || meta.sampleRate };
      if (newTrack) q = { ...q, tracks: [...q.tracks, newTrack] };
      return ops.addAudioClip(q, tid, Math.max(0, beat), lengthBeats, id, name).project;
    });
    setSelTrack(tid);
  }, [edit]);

  const importMidi = useCallback((buf: ArrayBuffer, name: string, beat: number) => {
    const parsed = parseMidiFile(buf);
    if (!parsed.tracks.length) { showToast('warning', `${name}: no notes found`); return; }
    edit((p) => {
      const empty = !p.tracks.some((t) => t.clips.length);
      let tracks = [...p.tracks];
      parsed.tracks.forEach((pt) => {
        const t = createTrack(pt.isDrums ? 'drums' : 'instrument', tracks.length, { name: pt.name || name.replace(/\.[a-z]+$/i, '') });
        const len = Math.max(bpb, Math.ceil(Math.max(...pt.notes.map((n) => n.startBeat + n.lengthBeats)) / bpb) * bpb);
        const c = createMidiClip(t, beat, len, pt.notes.map((n) => mkNote(n.pitch, n.startBeat, n.lengthBeats, n.velocity)));
        c.name = pt.name || name;
        tracks = [...tracks, { ...t, clips: [c] }];
      });
      return { ...p, tracks, bpm: empty && parsed.bpm ? Math.round(parsed.bpm * 100) / 100 : p.bpm };
    });
  }, [edit, bpb]);

  const importFiles = useCallback(async (files: File[], trackId: string | null, beat: number) => {
    setImporting(true);
    const skipped: string[] = [];
    try {
      let first = true;
      for (const f of files) {
        const kind = classifyMusicItem({ name: f.name, mimeType: f.type });
        if (!kind) { skipped.push(f.name); continue; }
        const buf = await f.arrayBuffer();
        if (kind === 'midi') { importMidi(buf, f.name, beat); continue; }
        if (kind === 'preset') {
          try {
            const pr = JSON.parse(new TextDecoder().decode(buf)) as Partial<SynthPreset>;
            if (!pr || !pr.id || !pr.name || !pr.type) throw new Error('not a preset');
            edit((p) => ({ ...p, synthPresets: { ...p.synthPresets, [pr.id as string]: pr as SynthPreset } }));
            showToast('success', `Preset "${pr.name}" added to Instruments`);
          } catch { skipped.push(f.name); }
          continue;
        }
        if (kind === 'project' || kind === 'music-dtu') { skipped.push(f.name); continue; }
        try {
          const decoded = await engine.ctx.decodeAudioData(buf.slice(0));
          const channels = Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, i) => new Float32Array(decoded.getChannelData(i)));
          const { id, meta } = await storeAudio(f.name, channels, decoded.sampleRate);
          placeAudio(first ? trackId : null, beat, id, meta, f.name);
          first = false;
        } catch {
          showToast('error', `${f.name}: this browser can't decode that audio format. Try WAV or MP3.`);
        }
      }
      if (skipped.length) showToast('info', `Skipped (not music): ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}`);
    } finally {
      setImporting(false);
    }
  }, [edit, engine, importMidi, placeAudio, storeAudio]);

  const placeLibraryItem = useCallback(async (item: LibraryItem, trackId: string | null, beat: number) => {
    if (!item.url) { showToast('info', `"${item.title}" has no audio file attached yet.`); return; }
    try {
      const r = await fetch(item.url, { credentials: 'include' });
      if (!r.ok) throw new Error(String(r.status));
      const blob = await r.blob();
      const ext = item.kind === 'midi' ? '.mid' : '';
      // Library files are audio or MIDI by construction (see placeableItems); keep the
      // type music-shaped even when the server answers application/octet-stream.
      const type = item.kind === 'midi' ? 'audio/midi' : blob.type.startsWith('audio/') ? blob.type : 'audio/x-unknown';
      await importFiles([new File([blob], `${item.title}${ext}`, { type })], trackId, beat);
    } catch {
      showToast('error', `Couldn't load "${item.title}"`);
    }
  }, [importFiles]);

  const onDropItem = useCallback((trackId: string | null, beat: number, payload: string) => {
    let data: BrowserPayload | null = null;
    try { data = JSON.parse(payload) as BrowserPayload; } catch { return; }
    if (data.type === 'instrument' && data.instrumentId) {
      const t = trackId ? projectRef.current.tracks.find((x) => x.id === trackId) : null;
      const wantDrums = isDrumInstrument(data.instrumentId);
      if (t && trackKind(t) !== 'audio' && (trackKind(t) === 'drums') === wantDrums) onTrack(t.id, { instrumentId: data.instrumentId });
      else addTrackOf(wantDrums ? 'drums' : 'instrument', data.instrumentId);
    } else if (data.type === 'library' && data.item) {
      void placeLibraryItem(data.item, trackId, beat);
    }
  }, [addTrackOf, onTrack, placeLibraryItem]);

  // ── recording ──
  const startRecording = useCallback(async () => {
    await engine.resume();
    let p = projectRef.current;
    let targets = p.tracks.filter((t) => t.armed && trackKind(t) === 'audio').map((t) => t.id);
    if (!targets.length) {
      const sel = p.tracks.find((t) => t.id === selTrack);
      if (sel && trackKind(sel) === 'audio') {
        targets = [sel.id];
        edit((q) => ops.mapTrack(q, sel.id, (t) => ({ ...t, armed: true })));
      } else {
        const t = { ...createTrack('audio', p.tracks.length, { name: 'Vocal' }), armed: true };
        edit((q) => ({ ...q, tracks: [...q.tracks, t] }));
        targets = [t.id];
        setSelTrack(t.id);
      }
    }
    if (!rec.isOpen()) {
      const ok = await rec.openInput();
      if (!ok) { showToast('error', 'Microphone not available — see the Input panel on the right for how to fix it.'); return; }
    }
    if (view === 'session') setView('arrange');
    p = projectRef.current;
    const startBeat = Math.max(0, engine.getBeat());
    engine.stop();
    if (!rec.start()) { showToast('error', 'Input is not ready yet. Try again.'); return; }
    const beat0Time = await engine.play(startBeat, { countInBars: countIn, noLoop: true });
    setRecording({ trackIds: targets, beat0Time, startBeat });
  }, [countIn, edit, engine, rec, selTrack, view]);

  const finishRecording = useCallback(async () => {
    const r = recordingRef.current;
    if (!r) return;
    setRecording(null);
    const take = rec.stop();
    engine.stop();
    engine.seek(r.startBeat);
    if (!take) { showToast('warning', 'Nothing was captured. Check the input meter.'); return; }
    const map = projectTempoPoints(projectRef.current);
    const sr = take.sampleRate;
    const skip = Math.round((r.beat0Time - take.startTime) * sr);
    let startBeat = r.startBeat;
    let channels = take.channels;
    if (skip > 0) channels = channels.map((c) => c.slice(Math.min(skip, c.length)));
    else if (skip < 0) startBeat = beatAfter(map, r.startBeat, -skip / sr);
    if (channels[0].length < sr * 0.1) { showToast('info', 'Take too short — stopped during the count-in.'); return; }
    const n = Object.keys(projectRef.current.audioAssets || {}).length + 1;
    const name = `Take ${n}`;
    const { id, meta } = await storeAudio(name, channels, sr);
    const lengthBeats = (meta.duration * bpmAt(map, startBeat)) / 60;
    edit((p) => {
      let q: DAWProject = { ...p, audioAssets: { ...(p.audioAssets || {}), [id]: meta }, sampleRate: p.sampleRate || sr };
      for (const tid of r.trackIds) q = ops.addAudioClip(q, tid, startBeat, lengthBeats, id, name).project;
      return q;
    });
    showToast('success', `${name} saved (${meta.duration.toFixed(1)} s)`);
  }, [edit, engine, rec, storeAudio]);

  // ── transport ──
  const onPlay = useCallback(() => { void engine.play(view === 'session' ? 0 : engine.getBeat()); }, [engine, view]);
  const onStop = useCallback(() => {
    if (recordingRef.current) { void finishRecording(); return; }
    if (engine.isPlaying) engine.stop(); else engine.seek(0);
  }, [engine, finishRecording]);
  const onRecord = useCallback(() => { if (recordingRef.current) void finishRecording(); else void startRecording(); }, [finishRecording, startRecording]);
  const toggleLoop = useCallback(() => edit((p) => {
    const t = p.transport;
    const end = t.loopEnd > t.loopStart ? t.loopEnd : t.loopStart + bpb * 4;
    return { ...p, transport: { ...t, loopEnabled: !t.loopEnabled, loopEnd: end } };
  }), [edit, bpb]);

  // ── keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || dialog) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === 'Space') { e.preventDefault(); if (engine.isPlaying || recordingRef.current) onStop(); else onPlay(); return; }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) api.redo(); else api.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); api.redo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void api.saveNow(); return; }
      if (mod && e.key.toLowerCase() === 'd' && selClip) {
        e.preventDefault();
        const r = ops.duplicateClip(projectRef.current, selClip);
        if (r.clip) { edit(() => r.project); setSelClip(r.clip.id); }
        return;
      }
      if (mod) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selClip) { e.preventDefault(); edit((p) => ops.deleteClip(p, selClip)); setSelClip(null); return; }
      const k = e.key.toLowerCase();
      if (k === 'r') { e.preventDefault(); onRecord(); }
      else if (k === 'l') { e.preventDefault(); toggleLoop(); }
      else if (k === 'k') { e.preventDefault(); setMetronome((m) => !m); }
      else if (k === 'tab') { e.preventDefault(); setView((v) => (v === 'arrange' ? 'session' : 'arrange')); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api, dialog, edit, engine, onPlay, onRecord, onStop, selClip, toggleLoop]);

  // Unsaved-work guard while a save is pending.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (recordingRef.current || api.save.status === 'saving' || api.save.status === 'unsaved') { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [api.save.status]);

  const back = useCallback(() => { engine.stop(); void api.saveNow().finally(onBack); }, [api, engine, onBack]);
  const playhead = () => Math.max(0, engine.getBeat());

  const tabs: Array<[BottomTab, string]> = [['editor', clip?.type === 'audio' ? 'Clip' : 'Piano roll'], ['devices', 'Devices'], ['mixer', 'Mixer']];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0c0c11] text-zinc-200" data-testid="studio-editor">
      <TransportBar
        project={project}
        transport={transport}
        recording={!!recording}
        metronome={metronome}
        countInBars={countIn}
        save={api.save}
        canUndo={api.canUndo}
        canRedo={api.canRedo}
        onBack={back}
        onPlay={onPlay}
        onStop={onStop}
        onRecord={onRecord}
        onToggleLoop={toggleLoop}
        onToggleMetronome={() => setMetronome((m) => !m)}
        onCountIn={(bars) => void rec.setPrefs({ countInBars: bars })}
        onBpm={(bpm) => edit((p) => setTransportBpm(p, bpm), 'bpm')}
        onRename={(title) => edit((p) => ({ ...p, title }), 'title')}
        onUndo={api.undo}
        onRedo={api.redo}
        onSaveNow={() => void api.saveNow()}
        onVersions={() => setDialog('versions')}
        onAutoMix={() => setDialog('automix')}
        onExport={() => setDialog('export')}
        onAskProducer={() => setDialog('producer')}
      />
      <div className="flex min-h-0 flex-1">
        <BrowserPanel
          project={project}
          importing={importing}
          onAddInstrument={(id) => addTrackOf(isDrumInstrument(id) ? 'drums' : 'instrument', id)}
          onPlaceItem={(item) => void placeLibraryItem(item, selTrack, playhead())}
          onImportFiles={(files) => void importFiles(files, track && trackKind(track) === 'audio' ? track.id : null, playhead())}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-8 flex-shrink-0 items-center gap-1 border-b border-white/5 px-2">
            {([['arrange', 'Arrange', LayoutList], ['session', 'Session', Grid3x3]] as const).map(([v, label, Icon]) => (
              <button key={v} onClick={() => setView(v)} className={cn('flex items-center gap-1 rounded px-2 py-0.5 text-[11px]', view === v ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300')} data-testid={`studio-view-${v}`}>
                <Icon className="h-3 w-3" /> {label}
              </button>
            ))}
            <span className="ml-auto text-[10px] text-zinc-600">Space play · R record · L loop · K click · Tab view · ⌘Z undo</span>
          </div>
          <div className="min-h-0 flex-1">
            {view === 'arrange' ? (
              <ArrangeView
                project={project}
                beatWidth={bw}
                selectedTrackId={selTrack}
                selectedClipId={selClip}
                recordingTrackIds={recording?.trackIds || []}
                onSelectTrack={(id) => { setSelTrack(id); }}
                onSelectClip={(id) => { setSelClip(id); if (id) { const f = ops.findClip(projectRef.current, id); if (f) setSelTrack(f.track.id); setBottom('editor'); } }}
                onAddTrack={(k) => addTrackOf(k)}
                onCreateClip={(tid, beat) => { const r = ops.addMidiClip(projectRef.current, tid, beat, bpb); if (r.clip) { edit(() => r.project); setSelClip(r.clip.id); setSelTrack(tid); setBottom('editor'); } }}
                onMoveClip={(cid, tid, beat) => edit((p) => ops.moveClip(p, cid, tid, beat))}
                onResizeClip={(cid, len) => edit((p) => ops.resizeClip(p, cid, len))}
                onSeek={(b) => engine.seek(b)}
                onSetLoop={(s, e) => edit((p) => ({ ...p, transport: { ...p.transport, loopEnabled: true, loopStart: s, loopEnd: e } }))}
                onTrackChange={onTrack}
                onDropFiles={(tid, beat, files) => void importFiles(files, tid, beat)}
                onDropItem={onDropItem}
                onZoom={setBw}
                onTempo={(points) => edit((p) => writeTempoPoints(p, points), 'tempo')}
              />
            ) : (
              <SessionGrid
                project={project}
                launched={launched}
                selectedClipId={selClip}
                selectedTrackId={selTrack}
                onSelectTrack={setSelTrack}
                onSelectClip={(id) => { setSelClip(id); const f = ops.findClip(projectRef.current, id); if (f) setSelTrack(f.track.id); setBottom('editor'); }}
                onCreateClip={(tid, slot) => { const r = ops.addMidiClip(projectRef.current, tid, 0, bpb, slot); if (r.clip) { edit(() => r.project); setSelClip(r.clip.id); setSelTrack(tid); setBottom('editor'); } }}
                onLaunchClip={(tid, cid) => void engine.launchClip(tid, cid)}
                onStopTrack={(tid) => engine.stopTrackClip(tid)}
                onLaunchScene={(slot) => {
                  const map: Record<string, string> = {};
                  for (const t of projectRef.current.tracks) { const c = t.clips.find((x) => x.slot === slot); if (c) map[t.id] = c.id; }
                  void engine.launchScene(map);
                }}
                onAddTrack={(k) => addTrackOf(k)}
                onDropFiles={(tid, slot, files) => void importFiles(files, tid, 0).then(() => {
                  // Imported clip lands at beat 0 of the arrangement; move the newest clip of that track into the slot.
                  edit((p) => ops.mapTrack(p, tid, (t) => { const last = t.clips[t.clips.length - 1]; return last && last.slot === undefined ? { ...t, clips: t.clips.map((c) => (c.id === last.id ? { ...c, slot } : c)) } : t; }));
                })}
              />
            )}
          </div>
          <div className="flex h-[38%] min-h-[180px] flex-shrink-0 flex-col border-t border-white/5 bg-[#0f0f15]">
            <div className="flex h-7 flex-shrink-0 items-center gap-1 border-b border-white/5 px-2">
              {tabs.map(([t, label]) => (
                <button key={t} onClick={() => setBottom(t)} className={cn('rounded px-2 py-0.5 text-[11px]', bottom === t ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300')} data-testid={`studio-tab-${t}`}>{label}</button>
              ))}
              {selTrack === MASTER_ID && <span className="ml-2 text-[10px] text-zinc-500">Master</span>}
            </div>
            <div className="min-h-0 flex-1">
              {bottom === 'editor' && (
                clip && found && clip.type !== 'audio' ? (
                  <PianoRoll
                    key={clip.id}
                    track={found.track}
                    clip={clip}
                    onChange={(notes, key) => edit((p) => ops.setNotes(p, clip.id, notes), key)}
                    onClipChange={(patch) => edit((p) => ops.mapClip(p, clip.id, (c) => ({ ...c, ...patch })))}
                    onAudition={(pitch, vel) => engine.previewNote(found.track.id, pitch, vel)}
                  />
                ) : clip && clip.type === 'audio' ? (
                  <div className="h-full p-3">
                    <div className="mb-1 text-[11px] text-zinc-400">{clip.name} · {(project.audioAssets?.[clip.audioBufferId || '']?.duration || 0).toFixed(2)} s</div>
                    <div className="h-[calc(100%-1.5rem)] rounded bg-black/30">
                      <WaveThumb asset={project.audioAssets?.[clip.audioBufferId || '']} clip={clip} width={1200} height={160} bpm={bpmAt(projectTempoPoints(project), clip.startBeat)} />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                    {track && trackKind(track) !== 'audio' ? 'Double-click in the track lane (or an empty Session slot) to make a MIDI clip, then draw notes here.' : track ? 'Press R (or the record button) to record onto the armed track.' : 'Add a track to start.'}
                  </div>
                )
              )}
              {bottom === 'devices' && (
                selTrack === MASTER_ID ? (
                  <MasterPanel
                    project={project}
                    onMastering={(m, key) => edit((p) => ({ ...p, masteringChain: m }), key)}
                    onInserts={(fx, key) => edit((p) => ({ ...p, masterBus: { ...p.masterBus, inserts: fx } }), key)}
                  />
                ) : (
                  <DevicePanel
                    project={project}
                    track={track}
                    onTrack={(patch, key) => track && onTrack(track.id, patch, key)}
                    onEffects={(fx, key) => track && edit((p) => ops.setEffects(p, track.id, fx), key)}
                    onPreset={(pr, key) => edit((p) => ({ ...p, synthPresets: { ...p.synthPresets, [pr.id]: pr } }), key)}
                  />
                )
              )}
              {bottom === 'mixer' && (
                <MixerPanel
                  project={project}
                  selectedTrackId={selTrack}
                  onSelectTrack={(id) => setSelTrack(id)}
                  onTrack={onTrack}
                  onMasterVolume={(db) => edit((p) => ({ ...p, masterBus: { ...p.masterBus, volume: db } }), 'master-vol')}
                  onToggleMastering={() => edit((p) => ({ ...p, masteringChain: { ...p.masteringChain, enabled: !p.masteringChain.enabled } }))}
                />
              )}
            </div>
          </div>
        </div>
        <Inspector
          project={project}
          track={track}
          clip={clip}
          recorder={rec}
          onTrack={(patch, key) => track && onTrack(track.id, patch, key)}
          onClip={onClip}
          onDeleteTrack={() => { if (!track) return; edit((p) => ops.removeTrack(p, track.id)); setSelTrack(null); setSelClip(null); }}
          onDuplicateTrack={() => track && edit((p) => ops.duplicateTrack(p, track.id))}
        />
      </div>
      {dialog === 'export' && <ExportDialog project={project} getAudio={() => engine.audioMap()} onClose={() => setDialog(null)} />}
      {dialog === 'automix' && (
        <AutoMixDialog project={project} getAudio={() => engine.audioMap()} onApply={(p) => edit(() => p)} onRevert={api.undo} onClose={() => setDialog(null)} />
      )}
      {dialog === 'versions' && (
        <VersionsDialog project={project} saveNow={api.saveNow} onRestored={(p, rev) => {
          api.load(p, rev);
          setSelClip(null);
          void resolveAudio(p, studioTransport, browserLocalStore).then(({ audio }) => audio.forEach((a, id) => { if (!engine.hasAudio(id)) engine.setAudio(id, a); }));
        }} onClose={() => setDialog(null)} />
      )}
      {dialog === 'producer' && (
        <AskProducerDialog
          project={project}
          onAddTracks={(tracks, presets) => edit((p) => ({ ...p, tracks: [...p.tracks, ...tracks], synthPresets: { ...presets, ...p.synthPresets } }))}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
