/**
 * Offline Pitch Editor. Analysis and the ratio curve are pure.
 * Playback and export pitch-shift with shiftSignalByRatio, the same delay
 * reader Pitch Correct uses. Formant shift is not implemented.
 */

import { noteLabel, pitchLatencySamples, removeLatency, scaleMaskFor, shiftSignalByRatio, yinDetect } from './core';
import {
  PITCH_ANALYSIS_VERSION,
  type F0Frame,
  type PitchAnalysis,
  type PitchEditDoc,
  type PitchNoteEdit,
} from '../../pitch-edit-types';

export const ANALYSIS_HOP_SEC = 0.005;
const MIN_HZ = 70;
const MAX_HZ = 1100;
const VOICED_CONF = 0.6;

const analysisMem = new Map<string, PitchAnalysis>();

export function analysisCacheKey(assetId: string, sampleRate: number, length: number): string {
  return `${assetId}@${sampleRate}@${length}@${PITCH_ANALYSIS_VERSION}`;
}

export function storeAnalysis(key: string, analysis: PitchAnalysis): void {
  analysisMem.set(key, analysis);
}

export function takeAnalysis(key: string): PitchAnalysis | null {
  return analysisMem.get(key) || null;
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function rmsOf(frame: Float32Array): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return Math.sqrt(s / Math.max(1, frame.length));
}

/** Power of a pure tone. A second strong partial more than a few semitones away marks a second voice. */
function tonePower(frame: Float32Array, sampleRate: number, hz: number): number {
  if (!(hz > 0)) return 0;
  const w = (2 * Math.PI * hz) / sampleRate;
  let re = 0;
  let im = 0;
  const n = frame.length;
  for (let i = 0; i < n; i++) {
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, n - 1)));
    re += frame[i] * window * Math.cos(w * i);
    im -= frame[i] * window * Math.sin(w * i);
  }
  return (re * re + im * im) / frame.length;
}

const RIVAL_SEMITONES = [3, 4, 5, 7, -3, -5, -7];

function hasRival(frame: Float32Array, sampleRate: number, hz: number): boolean {
  const primary = tonePower(frame, sampleRate, hz);
  if (!(primary > 0)) return false;
  for (const semi of RIVAL_SEMITONES) {
    const other = tonePower(frame, sampleRate, hz * Math.pow(2, semi / 12));
    if (other > primary * 0.45) return true;
  }
  return false;
}

function pushNote(notes: PitchNoteEdit[], start: number, end: number, hz: number[]): void {
  const clean = hz.filter((h) => h > 0);
  if (end - start < 0.04 || clean.length < 3) return;
  const med = median(clean);
  const midi = Math.round(hzToMidi(med));
  notes.push({
    id: `n${notes.length}`,
    startSec: start,
    endSec: end,
    midi,
    hz: med,
    targetMidi: midi,
    cents: 0,
    center: 0,
    drift: 0,
    vibrato: 100,
    gainDb: 0,
  });
}

/**
 * Segment voiced frames. A sustained jump past 80 cents starts a new note.
 * Vibrato inside ±50 cents stays one note. An unvoiced gap over 30 ms splits.
 */
function segmentNotes(frames: F0Frame[]): PitchNoteEdit[] {
  const notes: PitchNoteEdit[] = [];
  let start = -1;
  let lastT = -1;
  let samples: number[] = [];
  let awayFrom = -1;
  let awayCount = 0;
  const flush = (end: number) => {
    if (start >= 0) pushNote(notes, start, end, samples);
    start = -1;
    samples = [];
    awayFrom = -1;
    awayCount = 0;
  };
  for (const frame of frames) {
    const voiced = frame.hz > 0 && frame.conf >= VOICED_CONF;
    if (!voiced) {
      if (start >= 0 && frame.t - lastT > 0.03) flush(lastT);
      continue;
    }
    if (start < 0 || frame.t - lastT > 0.03) {
      flush(lastT);
      start = frame.t;
      samples = [frame.hz];
      lastT = frame.t;
      continue;
    }
    const anchor = median(samples);
    const cents = 1200 * Math.log2(frame.hz / anchor);
    if (Math.abs(cents) > 80) {
      if (awayFrom < 0) awayFrom = frame.t;
      awayCount += 1;
      if (frame.t - awayFrom >= 0.05 && awayCount >= 4) {
        flush(awayFrom);
        start = awayFrom;
        samples = [frame.hz];
        lastT = frame.t;
        continue;
      }
    } else {
      awayFrom = -1;
      awayCount = 0;
    }
    samples.push(frame.hz);
    lastT = frame.t;
  }
  flush(lastT);
  return notes;
}

export function analyzePitch(channel: Float32Array, sampleRate: number): PitchAnalysis {
  const hop = Math.max(1, Math.round(sampleRate * ANALYSIS_HOP_SEC));
  const win = Math.max(1024, Math.min(2048, Math.round(sampleRate / MIN_HZ) * 2));
  const frames: F0Frame[] = [];
  let prev = 0;
  for (let i = 0; i + win <= channel.length; i += hop) {
    const frame = channel.subarray(i, i + win);
    const found = yinDetect(frame, sampleRate, MIN_HZ, MAX_HZ, prev);
    if (found.confidence >= VOICED_CONF && found.hz > 0) prev = found.hz;
    frames.push({ t: (i + win / 2) / sampleRate, hz: found.hz, conf: found.confidence, rms: rmsOf(frame) });
  }
  let peak = 0;
  for (const f of frames) if (f.rms > peak) peak = f.rms;
  const gate = peak * 0.2;
  let energetic = 0;
  let unstable = 0;
  let checked = 0;
  let conflict = 0;
  frames.forEach((frame, index) => {
    if (frame.rms < gate) return;
    energetic += 1;
    if (!(frame.hz > 0) || frame.conf < 0.5) {
      unstable += 1;
      return;
    }
    if (index % 4 !== 0) return;
    checked += 1;
    const slice = channel.subarray(
      Math.max(0, Math.round(frame.t * sampleRate) - win / 2),
      Math.min(channel.length, Math.round(frame.t * sampleRate) + win / 2),
    );
    if (slice.length >= 512 && hasRival(slice, sampleRate, frame.hz)) conflict += 1;
  });
  const singleVoice = energetic >= 8
    && unstable / energetic < 0.35
    && (checked === 0 || conflict / checked < 0.25);
  return {
    version: PITCH_ANALYSIS_VERSION,
    hopSec: hop / sampleRate,
    frames,
    notes: singleVoice ? segmentNotes(frames) : [],
    singleVoice,
  };
}

export function seedEdits(assetId: string, analysis: PitchAnalysis): PitchEditDoc | null {
  if (!analysis.singleVoice || !analysis.notes.length) return null;
  return {
    version: 1,
    analysisVersion: PITCH_ANALYSIS_VERSION,
    assetId,
    macroCenter: 0,
    macroDrift: 0,
    notes: analysis.notes.map((n) => ({ ...n })),
  };
}

function clampNote(n: PitchNoteEdit): PitchNoteEdit | null {
  if (!n || typeof n.id !== 'string' || !n.id) return null;
  const start = Number(n.startSec);
  const end = Number(n.endSec);
  const hz = Number(n.hz);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return {
    id: n.id,
    startSec: Math.max(0, start),
    endSec: end,
    midi: Math.max(0, Math.min(127, Math.round(Number(n.midi) || 0))),
    hz: hz > 0 ? hz : midiToHz(Math.round(Number(n.midi) || 69)),
    targetMidi: Math.max(0, Math.min(127, Math.round(Number(n.targetMidi) || Number(n.midi) || 0))),
    cents: Math.max(-100, Math.min(100, Math.round(Number(n.cents) || 0))),
    center: Math.max(0, Math.min(100, Number(n.center) || 0)),
    drift: Math.max(0, Math.min(200, Number(n.drift) || 0)),
    vibrato: Math.max(0, Math.min(200, Number.isFinite(Number(n.vibrato)) ? Number(n.vibrato) : 100)),
    gainDb: Math.max(-24, Math.min(24, Number(n.gainDb) || 0)),
  };
}

export function sanitizePitchEdits(raw: unknown): PitchEditDoc | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<PitchEditDoc>;
  if (r.version !== 1 || !Array.isArray(r.notes)) return undefined;
  const notes = r.notes.map((n) => clampNote(n as PitchNoteEdit)).filter((n): n is PitchNoteEdit => !!n);
  return {
    version: 1,
    analysisVersion: PITCH_ANALYSIS_VERSION,
    assetId: typeof r.assetId === 'string' ? r.assetId : '',
    macroCenter: Math.max(0, Math.min(100, Number(r.macroCenter) || 0)),
    macroDrift: Math.max(0, Math.min(200, Number(r.macroDrift) || 0)),
    notes,
  };
}

export function editIsActive(doc: PitchEditDoc | null | undefined): boolean {
  if (!doc?.notes.length) return false;
  if ((doc.macroCenter || 0) > 0 || (doc.macroDrift || 0) > 0) return true;
  return doc.notes.some((n) => n.center > 0 || n.drift > 0 || n.vibrato !== 100 || n.cents !== 0 || Math.abs(n.gainDb) > 0.05);
}

export function snapMidi(midi: number, mask: number): number {
  const m = mask & 0xfff ? mask & 0xfff : 0xfff;
  const rounded = Math.round(midi);
  let best = rounded;
  let bestDist = 1e9;
  for (let k = rounded - 12; k <= rounded + 12; k++) {
    const pc = ((k % 12) + 12) % 12;
    if ((m & (1 << pc)) === 0) continue;
    const dist = Math.abs(k - midi);
    if (dist < bestDist) { bestDist = dist; best = k; }
  }
  return Math.max(0, Math.min(127, best));
}

export function projectSnapMask(project: { key: string; scale: string; scaleMask?: number }): number {
  return scaleMaskFor(project.key, project.scale, project.scaleMask).mask;
}

function hashKey(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 + c, 2246822519);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

export function pitchEditBufferId(assetId: string, sampleRate: number, doc: PitchEditDoc): string {
  return `pe_${hashKey(JSON.stringify({ assetId, sampleRate, doc, v: PITCH_ANALYSIS_VERSION }))}`;
}

function hzAt(frames: F0Frame[], t: number, cursor: { i: number }): number {
  while (cursor.i + 1 < frames.length && frames[cursor.i + 1].t < t) cursor.i += 1;
  const a = frames[cursor.i];
  const b = frames[Math.min(frames.length - 1, cursor.i + 1)];
  if (!a) return 0;
  if (!b || b === a || !(a.hz > 0) || !(b.hz > 0)) return a.hz > 0 ? a.hz : 0;
  const span = b.t - a.t;
  if (!(span > 0)) return a.hz;
  const u = Math.max(0, Math.min(1, (t - a.t) / span));
  return a.hz + (b.hz - a.hz) * u;
}

/**
 * Per-sample read ratio. Dry settings (center 0, drift 0, vibrato 100) return 1.
 * Drift scales the slow residual below ~5 Hz. Vibrato scales what remains.
 */
export function pitchEditRatio(frames: F0Frame[], doc: PitchEditDoc, sampleRate: number, length: number): { ratio: Float32Array; gain: Float32Array } {
  const ratio = new Float32Array(length);
  const gain = new Float32Array(length);
  ratio.fill(1);
  gain.fill(1);
  const notes = doc.notes.slice().sort((a, b) => a.startSec - b.startSec);
  const cursor = { i: 0 };
  let noteIndex = 0;
  let slow = 0;
  let noteId = '';
  const coeff = 1 - Math.exp((-2 * Math.PI * 5) / sampleRate);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    while (noteIndex < notes.length && notes[noteIndex].endSec <= t) noteIndex += 1;
    const note = notes[noteIndex];
    if (!note || t < note.startSec || t >= note.endSec) continue;
    const hz = hzAt(frames, t, cursor);
    if (!(hz > 0)) continue;
    if (note.id !== noteId) {
      noteId = note.id;
      slow = hz;
    }
    slow += (hz - slow) * coeff;
    const center = Math.max(note.center, doc.macroCenter || 0) / 100;
    const driftPow = 1 - Math.max(note.drift, doc.macroDrift || 0) / 100;
    const vibPow = note.vibrato / 100;
    const medianHz = note.hz > 0 ? note.hz : midiToHz(note.midi);
    const targetHz = midiToHz(note.targetMidi) * Math.pow(2, note.cents / 1200);
    const tuned = medianHz * Math.pow(targetHz / medianHz, center);
    const slowGain = Math.pow(Math.max(1e-6, slow / medianHz), driftPow);
    const fastGain = Math.pow(Math.max(1e-6, hz / Math.max(1e-6, slow)), vibPow);
    const desired = tuned * slowGain * fastGain;
    ratio[i] = Math.max(0.25, Math.min(4, desired / hz));
    gain[i] = Math.pow(10, note.gainDb / 20);
  }
  return { ratio, gain };
}

export function renderPitchEdit(channel: Float32Array, sampleRate: number, frames: F0Frame[], doc: PitchEditDoc): Float32Array {
  const { ratio, gain } = pitchEditRatio(frames, doc, sampleRate, channel.length);
  const shifted = shiftSignalByRatio(channel, (i) => ratio[i] ?? 1, sampleRate);
  const out = removeLatency(shifted.output, shifted.latency);
  for (let i = 0; i < out.length; i++) out[i] *= gain[i] || 1;
  return out;
}

interface EditPcm {
  channels: Float32Array[];
  sampleRate: number;
}

interface EditProject {
  tracks: Array<{ clips: Array<{ id: string; type: string; audioBufferId?: string; pitchEdits?: PitchEditDoc }> }>;
}

/** Build derived mono buffers. Missing sources are skipped. The input map is not mutated. */
export function bakePitchEdits(project: EditProject, audio: Map<string, EditPcm>): { produced: Map<string, EditPcm>; overrides: Record<string, string> } {
  const produced = new Map<string, EditPcm>();
  const overrides: Record<string, string> = {};
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const doc = clip.pitchEdits;
      if (clip.type !== 'audio' || !doc || !editIsActive(doc) || !clip.audioBufferId) continue;
      const src = audio.get(clip.audioBufferId);
      if (!src || src.channels.length !== 1 || !src.channels[0]?.length) continue;
      const id = pitchEditBufferId(clip.audioBufferId, src.sampleRate, doc);
      overrides[clip.id] = id;
      if (audio.has(id) || produced.has(id)) continue;
      const key = analysisCacheKey(clip.audioBufferId, src.sampleRate, src.channels[0].length);
      let analysis = takeAnalysis(key);
      if (!analysis || analysis.version !== PITCH_ANALYSIS_VERSION) {
        analysis = analyzePitch(src.channels[0], src.sampleRate);
        storeAnalysis(key, analysis);
      }
      if (!analysis.singleVoice) {
        delete overrides[clip.id];
        continue;
      }
      const rendered = renderPitchEdit(src.channels[0], src.sampleRate, analysis.frames, doc);
      produced.set(id, { channels: [rendered], sampleRate: src.sampleRate });
    }
  }
  return { produced, overrides };
}

export function applyBufferOverrides<T extends EditProject>(project: T, overrides: Record<string, string>): T {
  if (!Object.keys(overrides).length) return project;
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        const id = overrides[clip.id];
        return id ? { ...clip, audioBufferId: id } : clip;
      }),
    })),
  };
}

export function splitPitchNote(doc: PitchEditDoc, noteId: string): PitchEditDoc {
  const notes: PitchNoteEdit[] = [];
  for (const note of doc.notes) {
    if (note.id !== noteId || note.endSec - note.startSec < 0.08) {
      notes.push(note);
      continue;
    }
    const mid = (note.startSec + note.endSec) / 2;
    notes.push({ ...note, id: `${note.id}a`, endSec: mid });
    notes.push({ ...note, id: `${note.id}b`, startSec: mid });
  }
  return { ...doc, notes };
}

export function mergePitchNote(doc: PitchEditDoc, noteId: string): PitchEditDoc {
  const sorted = doc.notes.slice().sort((a, b) => a.startSec - b.startSec);
  const index = sorted.findIndex((n) => n.id === noteId);
  const next = sorted[index + 1];
  const note = sorted[index];
  if (!note || !next || next.startSec - note.endSec > 0.04) return doc;
  const span = note.endSec - note.startSec + (next.endSec - next.startSec);
  const hz = span > 0 ? (note.hz * (note.endSec - note.startSec) + next.hz * (next.endSec - next.startSec)) / span : note.hz;
  const merged: PitchNoteEdit = {
    ...note,
    id: note.id,
    endSec: next.endSec,
    hz,
    midi: Math.round(hzToMidi(hz)),
    center: Math.max(note.center, next.center),
    drift: Math.max(note.drift, next.drift),
    vibrato: (note.vibrato + next.vibrato) / 2,
    gainDb: (note.gainDb + next.gainDb) / 2,
  };
  return { ...doc, notes: sorted.filter((n) => n.id !== note.id && n.id !== next.id).concat(merged).sort((a, b) => a.startSec - b.startSec) };
}

export function editorNoteLabel(midi: number): string {
  return noteLabel(midiToHz(midi));
}

/** Reported shifter delay at 48 kHz for the editor's fixed 70 Hz bound. Used by tests. */
export function editorShiftLatency(sampleRate: number): number {
  return pitchLatencySamples(sampleRate, 70, 'low');
}
