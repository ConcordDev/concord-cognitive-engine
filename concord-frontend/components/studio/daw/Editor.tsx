'use client';

/**
 * The Studio editor: one transport, browser, arrangement/session, an editor
 * pane (piano roll · devices · mixer) and the inspector. All edits go through
 * useStudioProject (undo + autosave); the audio clock never re-renders React.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutList, Grid3x3, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DAWProject, DAWTrack, DAWClip, SynthPreset } from '@/lib/daw/types';
import { getStudioEngine } from '@/lib/daw/playback-engine';
import { assetMeta, newId, trackKind, createTrack, createBus, createVca, effect, createMidiClip, note as mkNote, setTransportBpm, writeTempoPoints, type NewTrackKind } from '@/lib/daw/project';
import { beatAfter, beatsPerBar, bpmAt, projectTempoPoints } from '@/lib/daw/tempo-map';
import { editClipFromKey, rippleDelete } from '@/lib/daw/clip-edit';
import { planRecording, recordingStartBeat } from '@/lib/daw/record-plan';
import { addTake } from '@/lib/daw/takes';
import type { AudioTake } from '@/lib/daw/take-types';
import { detectClipKey } from '@/lib/daw/dsp/pitch/key-detect';
import { isDrumInstrument } from '@/lib/daw/presets';
import { trackSampleChannel } from '@/lib/daw/sampler';
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
import { MidiClipPane } from './MidiClipPane';
import { DevicePanel } from './DevicePanel';
import { MixerPanel, MASTER_ID } from './MixerPanel';
import { Inspector, MasterPanel } from './Inspector';
import { BrowserPanel, type BrowserPayload } from './BrowserPanel';
import { ExportDialog, AutoMixDialog, VersionsDialog, AskProducerDialog } from './Dialogs';
import { AudioClipPane } from './AudioClipPane';
import { PublishDialog } from './PublishDialog';
import * as ops from './ops';
import { CollabPanel } from '../CollabPanel';
import { StudioKeepMenu } from '../StudioKeepMenu';
import { boothFontVars } from '../booth/boothFonts';
import { ROOM_KEY, parseRoom, roomFromKey, type Room } from '../booth/rooms';
import { SongSections } from '../booth/SongSections';
import { Tuner } from '../booth/Tuner';
import { TuneVocal } from '../booth/TuneVocal';
import { VuMeter } from '../booth/VuMeter';
import { MidiLearn } from '../booth/MidiLearn';
import { ChainShelf } from '../booth/ChainShelf';
import { GroovePicker } from '../booth/GroovePicker';
import { MasterLoudness } from '../booth/MasterLoudness';
import { ScoreWorld } from '../booth/ScoreWorld';
import '../booth/booth.css';
import { useTakeLane } from './useTakeLane';

export const LAST_PROJECT_KEY = 'concord-studio-last-project';

type BottomTab = 'editor' | 'devices';
type DialogKind = null | 'export' | 'automix' | 'versions' | 'producer' | 'publish';

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
  const armedAudioId = project.tracks.find((t) => t.armed && trackKind(t) === 'audio')?.id ?? null;
  const rec = useInputRecorder(armedAudioId);
  const { state: transport, launched } = useTransportState();
  const [view, setView] = useState<'arrange' | 'session'>('arrange');
  const [room, setRoomState] = useState<Room>(() => {
    try {
      return parseRoom(new URLSearchParams(window.location.search).get('room')) ?? parseRoom(localStorage.getItem(ROOM_KEY)) ?? 'write';
    } catch { return 'write'; }
  });
  const setRoom = useCallback((r: Room) => {
    setRoomState(r);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('room', r);
      window.history.replaceState(window.history.state, '', u.toString());
      localStorage.setItem(ROOM_KEY, r);
    } catch { /* noop */ }
  }, []);
  // The Write room always shows the arrangement (takes and comping live there).
  const shownView = room === 'write' ? 'arrange' : view;
  const [bottom, setBottom] = useState<BottomTab>('editor');
  const [selTrack, setSelTrack] = useState<string | null>(() => initial.tracks.find((t) => t.armed)?.id || initial.tracks.find((t) => t.type !== 'master')?.id || null);
  const [selClip, setSelClip] = useState<string | null>(null);
  const [bw, setBw] = useState(28);
  const [metronome, setMetronome] = useState(false);
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [importing, setImporting] = useState(false);
  const takeFileRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef(project);
  // Handlers read the latest project without subscribing the audio clock to React.
  // eslint-disable-next-line react-hooks/refs
  projectRef.current = project;
  const recordingRef = useRef<RecordingState | null>(null);
  // eslint-disable-next-line react-hooks/refs
  recordingRef.current = recording;
  const countIn = rec.state.prefs.countInBars;
  const bpb = beatsPerBar(project.timeSignature);

  useEffect(() => { engine.setMetronome(metronome); }, [engine, metronome]);
  useEffect(() => { engine.setMode(shownView); }, [engine, shownView]);
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
  const takes = useTakeLane(projectRef, edit, storeAudio);

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
    const planned = recordingStartBeat(Math.max(0, engine.getBeat()), p.transport, beatsPerBar(p.timeSignature));
    if (planned.error) { showToast('error', planned.error); return; }
    const startBeat = planned.startBeat;
    engine.stop();
    if (!rec.start()) { showToast('error', 'Input is not ready yet. Try again.'); return; }
    const beat0Time = await engine.play(startBeat, { countInBars: countIn, noLoop: planned.noLoop });
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
    const planned = planRecording({ channels, sampleRate: sr, startBeat, transport: projectRef.current.transport, points: map });
    if (!planned.pieces.length) { showToast('warning', planned.error || 'Nothing was captured.'); return; }
    const baseN = Object.keys(projectRef.current.audioAssets || {}).length;
    const stored: Array<{ id: string; meta: ReturnType<typeof assetMeta>; piece: typeof planned.pieces[number]; name: string }> = [];
    for (let i = 0; i < planned.pieces.length; i++) {
      const piece = planned.pieces[i];
      const name = piece.nameSuffix ? `Take ${baseN + i + 1} ${piece.nameSuffix}` : `Take ${baseN + 1}`;
      const saved = await storeAudio(name, piece.channels, sr);
      stored.push({ ...saved, piece, name });
    }
    edit((p) => {
      let q: DAWProject = { ...p, audioAssets: { ...(p.audioAssets || {}) }, sampleRate: p.sampleRate || sr };
      for (const item of stored) q = { ...q, audioAssets: { ...(q.audioAssets || {}), [item.id]: item.meta } };
      for (const tid of r.trackIds) {
        for (const item of stored) {
          if (item.piece.asTake) {
            const take: AudioTake = {
              id: newId('take'),
              audioBufferId: item.id,
              startBeat: item.piece.startBeat,
              lengthBeats: item.piece.lengthBeats,
              offsetSec: 0,
              name: item.name,
              createdAt: Date.now(),
            };
            q = ops.mapTrack(q, tid, (t) => addTake(t, take, true));
          } else {
            q = ops.addAudioClip(q, tid, item.piece.startBeat, item.piece.lengthBeats, item.id, item.name).project;
          }
        }
      }
      return q;
    });
    const label = stored.length === 1 ? stored[0].name : `${stored.length} takes`;
    showToast('success', `${label} saved`);
  }, [edit, engine, rec, storeAudio]);

  // ── transport ──
  const onPlay = useCallback(() => { void engine.play(shownView === 'session' ? 0 : engine.getBeat()); }, [engine, shownView]);
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
      if ((e.key === 'Delete' || e.key === 'Backspace') && selClip) { e.preventDefault(); edit((p) => (e.shiftKey ? rippleDelete(p, selClip) : ops.deleteClip(p, selClip))); setSelClip(null); return; }
      if (selClip) {
        const next = editClipFromKey(projectRef.current, selClip, e.key, e.altKey, e.shiftKey, Math.max(0, engine.getBeat()), 60 / (projectRef.current.bpm || 120));
        if (next && next !== projectRef.current) { e.preventDefault(); edit(() => next); return; }
      }
      const k = e.key.toLowerCase();
      const toRoom = roomFromKey(e.key);
      if (toRoom) { e.preventDefault(); setRoom(toRoom); return; }
      if (e.key === 'Escape' && selClip) { e.preventDefault(); setSelClip(null); return; }
      if (k === 'r') { e.preventDefault(); onRecord(); }
      else if (k === 'l') { e.preventDefault(); toggleLoop(); }
      else if (k === 'k') { e.preventDefault(); setMetronome((m) => !m); }
      // Tab and Shift+Tab move focus through the toolbar and tracks.
      // Arrange / Session is the pair of buttons, not a key that swallows Tab.
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api, dialog, edit, engine, onPlay, onRecord, onStop, selClip, setRoom, toggleLoop]);

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

  const tabs: Array<[BottomTab, string]> = [['editor', clip?.type === 'audio' ? 'Clip' : 'Piano roll'], ['devices', 'Devices']];
  const armedTrack = project.tracks.find((t) => t.id === armedAudioId) || null;
  const vocalFx = (track?.type === 'audio' ? track : armedTrack)?.effectChain.find((e) => e.type === 'pitchCorrect' && e.enabled !== false)?.id ?? null;
  const loopRange = (s: number, e: number) => edit((p) => ({ ...p, transport: { ...p.transport, loopEnabled: true, loopStart: s, loopEnd: Math.max(e, s + 1) } }));
  const selectClip = (id: string | null) => { setSelClip(id); if (id) { const f = ops.findClip(projectRef.current, id); if (f) setSelTrack(f.track.id); setBottom('editor'); } };

  const arrange = (
    <ArrangeView
      project={project}
      beatWidth={bw}
      selectedTrackId={selTrack}
      selectedClipId={selClip}
      recordingTrackIds={recording?.trackIds || []}
      onSelectTrack={(id) => { setSelTrack(id); }}
      onSelectClip={selectClip}
      onAddTrack={(k) => addTrackOf(k)}
      onCreateClip={(tid, beat) => { const r = ops.addMidiClip(projectRef.current, tid, beat, bpb); if (r.clip) { edit(() => r.project); setSelClip(r.clip.id); setSelTrack(tid); setBottom('editor'); } }}
      onMoveClip={(cid, tid, beat) => edit((p) => ops.moveClip(p, cid, tid, beat))}
      onResizeClip={(cid, len) => edit((p) => ops.resizeClip(p, cid, len))}
      onPatchClip={(cid, patch) => edit((p) => ops.mapClip(p, cid, (c) => ({ ...c, ...patch })))}
      onSeek={(b) => engine.seek(b)}
      onSetLoop={(s, e) => edit((p) => ({ ...p, transport: { ...p.transport, loopEnabled: true, loopStart: s, loopEnd: e } }))}
      onTrackChange={onTrack}
      onDropFiles={(tid, beat, files) => void importFiles(files, tid, beat)}
      onDropItem={onDropItem}
      onZoom={setBw}
      onTempo={(points) => edit((p) => writeTempoPoints(p, points), 'tempo')}
      audition={takes.audition}
      onAuditionTake={takes.onAudition}
      onSwipeTake={takes.onSwipe}
      onRenameTake={takes.onRename}
      onDeleteTake={takes.onDelete}
      onStarTake={takes.onStar}
      onCycleTake={takes.onCycle}
      onFlattenComp={(id) => void takes.onFlatten(id)}
    />
  );

  const session = (
    <SessionGrid
      project={project}
      launched={launched}
      selectedClipId={selClip}
      selectedTrackId={selTrack}
      onSelectTrack={setSelTrack}
      onSelectClip={(id) => selectClip(id)}
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
  );

  const clipEditor = clip && found && clip.type !== 'audio' ? (
    <MidiClipPane
      project={project}
      track={found.track}
      clip={clip}
      playing={transport !== 'stopped'}
      getBeat={() => engine.getBeat()}
      onEdit={(fn, key) => edit(fn, key)}
      onAudition={(pitch, vel) => engine.previewNote(found.track.id, pitch, vel)}
    />
  ) : clip && clip.type === 'audio' ? (
    <AudioClipPane
      clip={clip}
      project={project}
      pcm={clip.audioBufferId ? engine.audioMap().get(clip.audioBufferId) || null : null}
      onEdits={(doc, key) => edit((p) => ops.mapClip(p, clip.id, (c) => ({ ...c, pitchEdits: doc || undefined })), key)}
      onClip={(patch, key) => edit((p) => ops.mapClip(p, clip.id, (c) => ({ ...c, ...patch })), key)}
      onProject={(next) => edit(() => next)}
    />
  ) : (
    <div className="flex h-full items-center justify-center px-4 text-center text-xs text-zinc-600">
      {track && trackKind(track) !== 'audio' ? 'Double-click in the track lane (or an empty Session slot) to make a MIDI clip, then draw notes here.' : track ? 'Press R (or the record key) to record onto the armed track.' : 'Add a track to start.'}
    </div>
  );

  const devices = selTrack === MASTER_ID ? (
    <MasterPanel
      project={project}
      onMastering={(m, key) => edit((p) => ({ ...p, masteringChain: m }), key)}
      onInserts={(fx, key) => edit((p) => ({ ...p, masterBus: { ...p.masterBus, inserts: fx } }), key)}
    />
  ) : (
    <div className="flex h-full min-h-0 flex-col">
      <ChainShelf track={track} onEffects={(fx, key) => track && edit((p) => ops.setEffects(p, track.id, fx), key)} />
      <div className="min-h-0 flex-1">
        <DevicePanel
          project={project}
          track={track}
          sample={trackSampleChannel(track, engine.audioMap())}
          onTrack={(patch, key) => track && onTrack(track.id, patch, key)}
          onEffects={(fx, key) => track && edit((p) => ops.setEffects(p, track.id, fx), key)}
          onPreset={(pr, key) => edit((p) => ({ ...p, synthPresets: { ...p.synthPresets, [pr.id]: pr } }), key)}
        />
      </div>
    </div>
  );

  const inspector = (
    <Inspector
      project={project}
      track={track}
      clip={clip}
      recorder={rec}
      onTrack={(patch, key) => track && onTrack(track.id, patch, key)}
      onClip={onClip}
      onDeleteTrack={() => { if (!track) return; edit((p) => ops.removeTrack(p, track.id)); setSelTrack(null); setSelClip(null); }}
      onDuplicateTrack={() => track && edit((p) => ops.duplicateTrack(p, track.id))}
      onTransport={(patch) => edit((p) => ({ ...p, transport: { ...p.transport, ...patch } }))}
      onProject={(next) => edit(() => next)}
    />
  );

  const rail = 'flex w-full flex-shrink-0 flex-col gap-2 border-white/5 bg-[var(--bo-console)] p-2 sm:w-80 sm:overflow-y-auto sm:border-l';

  return (
    <div className={cn('booth flex h-full min-h-0 flex-col', boothFontVars)} data-room={room} data-testid="studio-editor">
      <TransportBar
        project={project}
        room={room}
        onRoom={setRoom}
        transport={transport}
        recording={!!recording}
        metronome={metronome}
        save={api.save}
        canUndo={api.canUndo}
        canRedo={api.canRedo}
        onBack={back}
        onPlay={onPlay}
        onStop={onStop}
        onRecord={onRecord}
        onToggleLoop={toggleLoop}
        onToggleMetronome={() => setMetronome((m) => !m)}
        onBpm={(bpm) => edit((p) => setTransportBpm(p, bpm), 'bpm')}
        onTimeSignature={(beats, unit) => edit((p) => ({ ...p, timeSignature: [Math.max(1, Math.min(16, Math.round(beats) || 4)), [2, 4, 8, 16].includes(unit) ? unit : 4] }))}
        onKeyScale={(key, scale, scaleMask) => edit((p) => ({ ...p, key, scale, scaleMask }), 'key')}
        onDetectKey={() => detectClipKey(project, selClip, engine.audioMap())}
        onRename={(title) => edit((p) => ({ ...p, title }), 'title')}
        onUndo={api.undo}
        onRedo={api.redo}
        onSaveNow={() => void api.saveNow()}
        onVersions={() => setDialog('versions')}
        onAutoMix={() => setDialog('automix')}
        onExport={() => setDialog('export')}
        onPublish={() => setDialog('publish')}
      />

      {room === 'write' && (
        // Write: the take on the timeline, song sections above it, and the booth rail (record, tuner, tune, session).
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto sm:flex-row sm:overflow-hidden" data-testid="booth-write">
          <div className="flex min-h-[460px] min-w-0 flex-1 flex-col sm:min-h-0">
            <SongSections key={project.id} projectId={project.id} beatsPerBar={bpb} onLoop={loopRange} />
            <div className="min-h-0 flex-1">{arrange}</div>
            {clip && <div className="h-[34%] min-h-[200px] flex-shrink-0 border-t border-white/5 bg-[var(--bo-console)]">{clipEditor}</div>}
          </div>
          <aside className={rail} aria-label="Booth">
            <section className="bo-metal flex items-center gap-3 rounded-lg border p-2.5" data-testid="booth-record">
              <button
                type="button"
                onClick={onRecord}
                aria-pressed={!!recording}
                aria-label={recording ? 'Stop recording' : 'Record'}
                className="bo-key flex h-16 w-16 flex-shrink-0 flex-col items-center justify-center gap-1 rounded-full"
                data-testid="booth-record-key"
              >
                <span className="bo-rec-light h-5 w-5 rounded-full" data-on={recording ? 'true' : 'false'} aria-hidden />
                <span className="text-[10px]">{recording ? 'Stop' : 'Rec'}</span>
              </button>
              <div className="min-w-0 flex-1">
                <div className="bo-on-air bo-engrave text-sm" data-on={recording ? 'true' : 'false'}>{recording ? 'On air' : 'Standby'}</div>
                <div className="truncate text-[11px] text-zinc-400">
                  {armedTrack ? <>Recording onto <span className="bo-scribble px-1 text-xs">{armedTrack.name}</span></> : 'Arm a track (the red dot on its header) to record.'}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <select value={countIn} onChange={(e) => void rec.setPrefs({ countInBars: Number(e.target.value) })} className="h-6 rounded bg-black/40 px-1 text-[11px] text-zinc-200 outline-none" aria-label="Count-in before recording" data-testid="booth-count-in">
                    <option value={0}>No count-in</option>
                    <option value={1}>1-bar count-in</option>
                    <option value={2}>2-bar count-in</option>
                  </select>
                  <button type="button" onClick={() => takeFileRef.current?.click()} disabled={importing} className="h-6 rounded px-1.5 text-[11px] text-zinc-300 underline-offset-2 hover:underline disabled:opacity-50" data-testid="booth-import-take">
                    {importing ? 'Importing…' : 'Import a take'}
                  </button>
                  <input ref={takeFileRef} type="file" accept="audio/*" multiple className="hidden" aria-label="Import a recorded take" onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    e.target.value = '';
                    const target = track && trackKind(track) === 'audio' ? track.id : armedAudioId;
                    if (files.length) void importFiles(files, target, playhead());
                  }} />
                </div>
              </div>
            </section>
            <div className="flex justify-center"><VuMeter read={() => rec.getLevel().rmsDb} label="Mic in" testId="booth-mic-vu" /></div>
            <Tuner fxId={vocalFx} />
            <TuneVocal key={track?.id ?? "none"} project={project} track={track} getAudio={() => engine.audioMap()} onProject={(next) => edit(() => next)} />
            <section className="bo-metal rounded-lg border p-2.5">
              <span className="bo-engrave text-sm">Session</span>
              <p className="mb-1.5 mt-0.5 text-[11px] text-zinc-500">Bring a producer in on this song, or ask for a starting idea.</p>
              <button type="button" onClick={() => setDialog('producer')} className="bo-key mb-2 h-8 w-full rounded text-xs" data-testid="booth-ask-producer">Ask producer for an idea</button>
              {project.id.startsWith('local_') ? <p className="text-[11px] text-zinc-500">Inviting collaborators opens once the song is saved.</p> : <CollabPanel projectId={project.id} />}
              <StudioKeepMenu project={project.id.startsWith('local_') ? null : { id: project.id, name: project.title, bpm: project.bpm, timeSignature: `${project.timeSignature?.[0] ?? 4}/${project.timeSignature?.[1] ?? 4}`, tracks: project.tracks.filter((t) => t.type !== 'master').map((t) => ({ id: t.id, name: t.name, kind: t.type })) }} />
            </section>
          </aside>
        </div>
      )}

      {room === 'produce' && (
        // Produce: browser, arrangement or session clips, the piano roll and devices, and the inspector.
        // FIX-music-002: below sm the panes stack in a vertical scroller so nothing clips off a phone.
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto sm:flex-row sm:overflow-x-auto sm:overflow-y-hidden" data-testid="studio-workspace">
          <BrowserPanel
            project={project}
            importing={importing}
            onAddInstrument={(id) => addTrackOf(isDrumInstrument(id) ? 'drums' : 'instrument', id)}
            onPlaceItem={(item) => void placeLibraryItem(item, selTrack, playhead())}
            onImportFiles={(files) => void importFiles(files, track && trackKind(track) === 'audio' ? track.id : null, playhead())}
          />
          <div className="flex min-h-[480px] w-full shrink-0 flex-col sm:min-h-0 sm:w-auto sm:min-w-0 sm:flex-1">
            <div className="flex min-h-9 flex-shrink-0 flex-wrap items-center gap-1 border-b border-white/5 px-2">
              {([['arrange', 'Arrange', LayoutList], ['session', 'Session', Grid3x3]] as const).map(([v, label, Icon]) => (
                <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} className="bo-key flex h-6 items-center gap-1 rounded px-2 text-[11px]" data-testid={`studio-view-${v}`}>
                  <Icon className="h-3 w-3" /> {label}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-white/10" />
              <GroovePicker swing={project.transport.swing || 0} onSwing={(swing) => edit((p) => ({ ...p, transport: { ...p.transport, swing } }), 'swing')} />
              <label className="flex items-center gap-1 text-[11px] text-zinc-500">
                <input
                  aria-label="Swing"
                  type="number"
                  min={0}
                  max={100}
                  value={Math.max(0, Math.min(100, Math.round(project.transport.swing || 0)))}
                  onChange={(e) => edit((p) => ({ ...p, transport: { ...p.transport, swing: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } }), 'swing')}
                  className="h-6 w-11 rounded bg-black/40 px-1 text-right text-[11px] text-zinc-100 outline-none"
                  title="0 is straight. 100 delays off-eighths by a triplet eighth."
                />
                Swing
              </label>
              <button type="button" onClick={() => setDialog('producer')} className="bo-key flex h-6 items-center gap-1 rounded px-2 text-[11px]" data-testid="studio-ask-producer">
                <Sparkles className="h-3 w-3" aria-hidden /> Ask producer
              </button>
              <span className="ml-auto hidden text-[10px] text-zinc-600 md:inline">Space play · R record · L loop · K click · 1 2 3 rooms · ⌘Z undo</span>
            </div>
            <div className="min-h-0 flex-1">{view === 'arrange' ? arrange : session}</div>
            <div className="flex h-[40%] min-h-[200px] flex-shrink-0 flex-col border-t border-white/5 bg-[var(--bo-console)]">
              <div className="flex h-7 flex-shrink-0 items-center gap-1 border-b border-white/5 px-2">
                {tabs.map(([t, label]) => (
                  <button key={t} type="button" onClick={() => setBottom(t)} aria-pressed={bottom === t} className={cn('rounded px-2 py-0.5 text-[11px] transition-colors', bottom === t ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300')} data-testid={`studio-tab-${t}`}>{label}</button>
                ))}
                {selTrack === MASTER_ID && <span className="ml-2 text-[10px] text-zinc-500">Master</span>}
              </div>
              <div className="min-h-0 flex-1">{bottom === 'editor' ? clipEditor : devices}</div>
            </div>
          </div>
          {inspector}
        </div>
      )}

      {room === 'mix' && (
        // Mix: the console across the room, the selected channel's inserts below, master meters and controllers on the right.
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto sm:flex-row sm:overflow-hidden" data-testid="booth-mix">
          <div className="flex min-h-[560px] min-w-0 flex-1 flex-col sm:min-h-0">
            <div className="min-h-[340px] flex-1">
              <MixerPanel
                size="console"
                project={project}
                selectedTrackId={selTrack}
                onSelectTrack={(id) => setSelTrack(id)}
                onTrack={onTrack}
                onMasterVolume={(db) => edit((p) => ({ ...p, masterBus: { ...p.masterBus, volume: db } }), 'master-vol')}
                onToggleMastering={() => edit((p) => ({ ...p, masteringChain: { ...p.masteringChain, enabled: !p.masteringChain.enabled } }))}
                onAutomation={(mode) => edit((p) => ({ ...p, transport: { ...p.transport, automation: mode } }))}
                onAddReturn={(kind) => edit((p) => {
                  const i = p.tracks.length;
                  const t = kind === 'vca'
                    ? createVca(i)
                    : createBus(i, kind === 'reverb' ? 'Reverb' : 'Delay', [
                      kind === 'reverb'
                        ? effect('reverb', 'Reverb', { decay: 2.2, preDelay: 0.02 }, 1)
                        : effect('delay', 'Delay', { time: 0.375, feedback: 0.35, tone: 5000 }, 0.35),
                    ]);
                  return { ...p, tracks: [...p.tracks, t] };
                })}
              />
            </div>
            <div className="flex h-[36%] min-h-[200px] flex-shrink-0 flex-col border-t border-white/5 bg-[var(--bo-console)]">
              <div className="flex h-7 flex-shrink-0 items-center gap-2 border-b border-white/5 px-2">
                <span className="bo-engrave text-xs">Inserts</span>
                <span className="truncate text-[11px] text-zinc-400">{selTrack === MASTER_ID ? 'Master bus' : track ? track.name : 'Pick a channel'}</span>
              </div>
              <div className="min-h-0 flex-1">{devices}</div>
            </div>
          </div>
          <aside className={rail} aria-label="Master">
            <section className="bo-metal rounded-lg border p-2.5" data-testid="booth-master">
              <span className="bo-engrave text-sm">Master</span>
              <div className="mt-1.5 flex justify-center"><VuMeter read={() => engine.masterRmsDb()} label="Mix bus" testId="booth-master-vu" /></div>
              <MasterLoudness />
              <button type="button" onClick={() => setSelTrack(MASTER_ID)} aria-pressed={selTrack === MASTER_ID} className="bo-key mt-2 h-8 w-full rounded text-[11px]" data-testid="booth-edit-mastering">Edit the mastering chain</button>
            </section>
            <ScoreWorld project={project} getAudio={() => engine.audioMap()} />
            <MidiLearn
              project={project}
              selectedTrackId={selTrack}
              onTrack={(id, patch, key) => onTrack(id, patch, key)}
              onMasterVolume={(db) => edit((p) => ({ ...p, masterBus: { ...p.masterBus, volume: db } }), 'master-vol')}
            />
          </aside>
        </div>
      )}

      {dialog === 'export' && <ExportDialog project={project} getAudio={() => engine.audioMap()} onClose={() => setDialog(null)} />}
      {dialog === 'publish' && <PublishDialog project={project} getAudio={() => engine.audioMap()} onClose={() => setDialog(null)} />}
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
