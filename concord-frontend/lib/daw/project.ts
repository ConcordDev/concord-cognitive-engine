/**
 * Project model helpers: factories, normalization of saved/legacy snapshots,
 * and the JSON-safe persist snapshot (deterministic, so save → reload → load
 * round-trips identically).
 */

import type { DAWProject, DAWTrack, DAWClip, MIDINote, EffectInstance, TrackRole, AudioAssetMeta, TempoAutomation } from './types';
import { isDrumInstrument } from './presets';
import { clampTempo, type TempoPoint } from './tempo-map';
import { sanitizeComp, sanitizeTakes } from './takes';
import { sanitizePitchEdits } from './dsp/pitch/editor';

export const TRACK_COLORS = ['#7c3aed', '#ec4899', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#a855f7', '#14b8a6', '#f97316'];

export type NewTrackKind = 'audio' | 'instrument' | 'drums';

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createProject(title = 'Untitled Song', bpm = 120, key = 'C', scale = 'minor'): DAWProject {
  const now = Date.now();
  return {
    id: newId('local'),
    title,
    bpm,
    key,
    scale,
    timeSignature: [4, 4],
    genre: null,
    tracks: [],
    masterBus: { volume: 0, inserts: [], metering: { peakL: -60, peakR: -60, rmsL: -60, rmsR: -60, lufs: -60 } },
    masteringChain: defaultMasteringChain(false),
    arrangement: { lengthBars: 32, sections: [], markers: [], tempo: [] },
    transport: { bpm, timeSignature: [4, 4], swing: 0, loopEnabled: false, loopStart: 0, loopEnd: 16, metronome: false, preRoll: 0 },
    audioBuffers: {},
    audioAssets: {},
    synthPresets: {},
    drumPatterns: {},
    createdAt: now,
    updatedAt: now,
    sessionDTUIds: [],
  };
}

export function defaultMasteringChain(enabled: boolean): DAWProject['masteringChain'] {
  return {
    eq: { id: 'mc-eq', type: 'eq3', name: 'Master EQ', enabled: true, wet: 1, params: { lowGain: 0, midGain: 0, highGain: 0, lowFreq: 120, highFreq: 8000 } },
    multibandCompressor: { id: 'mc-mb', type: 'multibandCompressor', name: 'Multiband', enabled: true, wet: 1, params: { threshold: -16, ratio: 1.6, attack: 0.02, release: 0.25, lowCross: 200, highCross: 3000, makeup: 0 } },
    stereoWidener: { id: 'mc-width', type: 'stereoWidener', name: 'Width', enabled: true, wet: 1, params: { width: 1, monoBelow: 120 } },
    limiter: { id: 'mc-lim', type: 'limiter', name: 'True-peak Limiter', enabled: true, wet: 1, params: { ceiling: -1, release: 0.08, gain: 0 } },
    loudnessTarget: -14,
    enabled,
  };
}

export function createTrack(kind: NewTrackKind, index: number, opts: { name?: string; instrumentId?: string; role?: TrackRole } = {}): DAWTrack {
  const instrumentId = kind === 'audio' ? null : opts.instrumentId || (kind === 'drums' ? 'drums:808' : 'keys-ep');
  const role: TrackRole = opts.role || (kind === 'drums' ? 'drums' : kind === 'audio' ? 'vocal' : 'keys');
  return {
    id: newId('trk'),
    name: opts.name || (kind === 'audio' ? `Audio ${index + 1}` : kind === 'drums' ? 'Drums' : `Instrument ${index + 1}`),
    type: kind === 'audio' ? 'audio' : 'midi',
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    volume: 0,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    frozen: false,
    height: 64,
    instrumentId,
    effectChain: [],
    sendLevels: {},
    clips: [],
    automationLanes: [],
    inputSource: null,
    outputTarget: 'master',
    role,
  };
}

export function trackKind(t: DAWTrack): NewTrackKind {
  if (t.type === 'audio') return 'audio';
  return isDrumInstrument(t.instrumentId) ? 'drums' : 'instrument';
}

export function createMidiClip(track: DAWTrack, startBeat: number, lengthBeats = 4, notes: MIDINote[] = []): DAWClip {
  return {
    id: newId('clip'),
    name: track.name,
    type: 'midi',
    trackId: track.id,
    startBeat,
    lengthBeats,
    offset: 0,
    color: track.color,
    looped: false,
    loopLength: lengthBeats,
    fadeIn: 0,
    fadeOut: 0,
    gain: 0,
    pitch: 0,
    reversed: false,
    timeStretch: 1,
    midiNotes: notes,
  };
}

export function createAudioClip(track: DAWTrack, startBeat: number, lengthBeats: number, audioBufferId: string, name: string): DAWClip {
  return {
    id: newId('clip'),
    name,
    type: 'audio',
    trackId: track.id,
    startBeat,
    lengthBeats,
    offset: 0,
    color: track.color,
    looped: false,
    loopLength: lengthBeats,
    fadeIn: 0,
    fadeOut: 0,
    gain: 0,
    pitch: 0,
    reversed: false,
    timeStretch: 1,
    audioBufferId,
  };
}

export function note(pitch: number, startBeat: number, lengthBeats: number, velocity = 100): MIDINote {
  return { id: newId('n'), pitch, startBeat, lengthBeats, velocity, channel: 0 };
}

export function effect(type: EffectInstance['type'], name: string, params: EffectInstance['params'], wet = 1, id?: string): EffectInstance {
  return { id: id || newId('fx'), type, name, enabled: true, wet, params };
}

/** End of the last clip, in beats. */
export function projectEndBeat(p: DAWProject): number {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) if (c.slot === undefined || c.slot === null) end = Math.max(end, c.startBeat + c.lengthBeats);
  return end;
}

/** Waveform peaks (absolute max per bucket), used for clip drawing. */
export function computePeaks(channels: Float32Array[], buckets = 400): number[] {
  const len = channels[0]?.length || 0;
  if (!len) return [];
  const n = Math.min(buckets, len);
  const size = len / n;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    const a = Math.floor(i * size);
    const b = Math.min(len, Math.floor((i + 1) * size));
    for (const ch of channels) for (let j = a; j < b; j++) { const v = Math.abs(ch[j]); if (v > m) m = v; }
    out[i] = Math.round(Math.min(1, m) * 1000) / 1000;
  }
  return out;
}

export function assetMeta(id: string, name: string, channels: Float32Array[], sampleRate: number): AudioAssetMeta {
  return {
    id,
    name,
    sampleRate,
    duration: (channels[0]?.length || 0) / sampleRate,
    channels: channels.length,
    waveformPeaks: computePeaks(channels),
  };
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Drop broken points. Exponential/log curves are stored as linear — those shapes are not integrated. */
export function sanitizeTempo(raw: unknown): TempoAutomation[] {
  if (!Array.isArray(raw)) return [];
  const out: TempoAutomation[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const o = p as TempoAutomation;
    if (typeof o.bpm !== 'number' || !Number.isFinite(o.bpm)) continue;
    const beat = typeof o.beat === 'number' && Number.isFinite(o.beat) ? Math.max(0, o.beat) : undefined;
    const bar = typeof o.bar === 'number' && Number.isFinite(o.bar) ? Math.max(0, o.bar) : (beat ?? 0) / 4;
    out.push({ bar, beat, bpm: clampTempo(o.bpm), curve: o.curve === 'step' ? 'step' : 'linear' });
  }
  out.sort((a, b) => (a.beat ?? a.bar * 4) - (b.beat ?? b.bar * 4));
  return out;
}

/** Transport tempo. With a map, this is the tempo at beat 0. */
export function setTransportBpm(p: DAWProject, bpm: number): DAWProject {
  const b = clampTempo(bpm);
  const tempo = sanitizeTempo(p.arrangement?.tempo);
  if (!tempo.length) {
    return { ...p, bpm: b, transport: { ...p.transport, bpm: b } };
  }
  const bpb = p.timeSignature?.[0] || 4;
  const next = tempo.map((t) => ({ ...t }));
  const at0 = next.findIndex((t) => (t.beat ?? t.bar * bpb) <= 1e-6);
  if (at0 >= 0) next[at0] = { ...next[at0], bar: 0, beat: 0, bpm: b };
  else next.unshift({ bar: 0, beat: 0, bpm: b, curve: 'step' });
  return { ...p, bpm: b, transport: { ...p.transport, bpm: b }, arrangement: { ...p.arrangement, tempo: next } };
}

/** Replace the tempo lane. An empty list is a constant map at `project.bpm`. */
export function writeTempoPoints(p: DAWProject, points: TempoPoint[]): DAWProject {
  const bpb = p.timeSignature?.[0] || 4;
  const sorted = [...points].sort((a, b) => a.beat - b.beat);
  const tempo: TempoAutomation[] = sorted.map((pt) => ({
    bar: pt.beat / bpb,
    beat: pt.beat,
    bpm: clampTempo(pt.bpm),
    curve: pt.curve === 'step' ? 'step' : 'linear',
  }));
  const head = tempo.find((t) => (t.beat ?? 0) <= 1e-6);
  const bpm = head ? head.bpm : p.bpm;
  return { ...p, bpm, transport: { ...p.transport, bpm }, arrangement: { ...p.arrangement, tempo } };
}

/** Make any saved or legacy snapshot safe to open (fills missing fields, never throws). */
function sanitizeScaleMask(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isInteger(n)) return undefined;
  return Math.max(0, Math.min(0xfff, n));
}

export function normalizeProject(raw: unknown, fallbackTitle = 'Untitled Song'): DAWProject {
  const base = createProject(fallbackTitle);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<DAWProject>;
  const bpm = clampTempo(num(r.bpm ?? r.transport?.bpm, 120));
  const tracks = (Array.isArray(r.tracks) ? r.tracks : []).filter((t) => t && typeof t === 'object' && t.type !== 'master').map((t, i) => {
    const d = createTrack(t.type === 'audio' ? 'audio' : isDrumInstrument(t.instrumentId) ? 'drums' : 'instrument', i);
    const id = typeof t.id === 'string' && t.id ? t.id : d.id;
    return {
      ...d,
      ...t,
      id,
      volume: Number.isFinite(t.volume) ? t.volume : 0,
      pan: num(t.pan, 0),
      effectChain: Array.isArray(t.effectChain) ? t.effectChain : [],
      automationLanes: Array.isArray(t.automationLanes) ? t.automationLanes : [],
      sendLevels: t.sendLevels && typeof t.sendLevels === 'object' ? t.sendLevels : {},
      clips: (Array.isArray(t.clips) ? t.clips : []).filter((c) => c && typeof c === 'object').map((c) => ({
        ...createMidiClip({ ...d, id }, 0, 4),
        ...c,
        trackId: id,
        startBeat: Math.max(0, num(c.startBeat, 0)),
        lengthBeats: Math.max(0.25, num(c.lengthBeats, 4)),
        loopLength: Math.max(0.25, num(c.loopLength, num(c.lengthBeats, 4))),
        midiNotes: c.type === 'audio' ? c.midiNotes : Array.isArray(c.midiNotes) ? c.midiNotes : [],
        pitchEdits: sanitizePitchEdits(c.pitchEdits),
      })),
      takes: sanitizeTakes(t.takes),
      comp: sanitizeComp(t.comp, sanitizeTakes(t.takes)),
    } as DAWTrack;
  });
  return {
    ...base,
    ...r,
    id: typeof r.id === 'string' && r.id ? r.id : base.id,
    title: typeof r.title === 'string' && r.title ? r.title : fallbackTitle,
    bpm,
    key: typeof r.key === 'string' && r.key.trim() ? r.key : base.key,
    scale: typeof r.scale === 'string' && r.scale.trim() ? r.scale : base.scale,
    scaleMask: sanitizeScaleMask(r.scaleMask),
    tracks,
    timeSignature: Array.isArray(r.timeSignature) && r.timeSignature.length === 2 ? r.timeSignature : [4, 4],
    masterBus: r.masterBus && typeof r.masterBus === 'object' ? { ...base.masterBus, ...r.masterBus, inserts: Array.isArray(r.masterBus.inserts) ? r.masterBus.inserts : [] } : base.masterBus,
    masteringChain: r.masteringChain && typeof r.masteringChain === 'object' ? { ...base.masteringChain, ...r.masteringChain } : base.masteringChain,
    arrangement: { ...base.arrangement, ...(r.arrangement || {}), tempo: sanitizeTempo(r.arrangement?.tempo) },
    transport: {
      ...base.transport,
      ...(r.transport || {}),
      bpm,
      loopRecord: r.transport?.loopRecord === true,
      punchEnabled: r.transport?.punchEnabled === true,
      punchIn: Math.max(0, num(r.transport?.punchIn, 0)),
      punchOut: Math.max(0, num(r.transport?.punchOut, 16)),
      punchPreRollBars: Math.max(0, Math.min(4, Math.round(num(r.transport?.punchPreRollBars, 1)))),
    },
    audioBuffers: {},
    audioAssets: r.audioAssets && typeof r.audioAssets === 'object' ? r.audioAssets : {},
    synthPresets: r.synthPresets && typeof r.synthPresets === 'object' ? r.synthPresets : {},
    drumPatterns: r.drumPatterns && typeof r.drumPatterns === 'object' ? r.drumPatterns : {},
    sessionDTUIds: Array.isArray(r.sessionDTUIds) ? r.sessionDTUIds : [],
  };
}

/** JSON-safe snapshot (no sample data, no functions); stable key order for diffing. */
export function snapshotForSave(p: DAWProject): DAWProject {
  const clean = JSON.parse(JSON.stringify({ ...p, audioBuffers: {} }, (_k, v) => {
    if (typeof v === 'number' && !Number.isFinite(v)) return v > 0 ? 12 : -120; // JSON has no Infinity
    return v;
  }));
  return clean as DAWProject;
}

/** Stable hash of a snapshot (detects "nothing changed" so autosave doesn't spam). */
export function snapshotHash(p: DAWProject): string {
  const s = JSON.stringify({ ...snapshotForSave(p), updatedAt: 0 });
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 + c, 2246822519);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}${s.length.toString(16)}`;
}
