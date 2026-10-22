/**
 * Key detection. Krumhansl–Schmuckler profiles distinguish major from
 * natural minor only. Pentatonic, blues, dorian, harmonic minor, chromatic,
 * and custom masks are user choices, never a detection result.
 *
 * Audio analysis reads PCM samples. A peak thumbnail is too short to pass
 * the window check and is rejected. The cache key is the asset id plus
 * KEY_ANALYSIS_VERSION.
 */

import type { DAWClip, DAWProject, MIDINote } from '../../types';
import { PITCH_ROOTS } from './core';

export const KEY_ANALYSIS_VERSION = 1;

/** Krumhansl & Kessler (1982) probe-tone profiles, tonic at index 0. */
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const WIN = 2048;
const MAX_WINDOWS = 40;
const MIN_SCORE = 0.55;
const MIN_MARGIN = 0.04;

export interface KeyDetection {
  key: string;
  scale: 'major' | 'minor';
  score: number;
  margin: number;
}

export interface CachedKey {
  version: number;
  result: KeyDetection | null;
}

export interface KeyStore {
  get(id: string): Promise<CachedKey | null>;
  set(id: string, value: CachedKey): Promise<void>;
}

export function keyCacheId(assetId: string): string {
  return `${assetId}:key:${KEY_ANALYSIS_VERSION}`;
}

export function detectKeyFromChroma(chroma: number[]): KeyDetection | null {
  const energy = chroma.reduce((s, v) => s + v, 0);
  if (!(energy > 0) || chroma.length !== 12) return null;
  // A flat pitch-class vector (noise, or a thumbnail-sized accident) correlates
  // with a profile by chance. Real major and natural-minor examples in the
  // tests sit above this peak-to-mean ratio; white noise does not.
  const peak = Math.max(...chroma) / (energy / 12);
  if (peak < 1.4) return null;
  const scored: Array<{ root: number; scale: 'major' | 'minor'; score: number }> = [];
  for (const scale of ['major', 'minor'] as const) {
    const profile = scale === 'major' ? MAJOR : MINOR;
    for (let root = 0; root < 12; root++) {
      const rotated = profile.map((_, pc) => profile[(pc - root + 12) % 12]);
      scored.push({ root, scale, score: pearson(chroma, rotated) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const margin = best.score - scored[1].score;
  if (best.score < MIN_SCORE || margin < MIN_MARGIN) return null;
  return { key: PITCH_ROOTS[best.root], scale: best.scale, score: best.score, margin };
}

/** Pitch-class energy from real samples. Returns null when the buffer cannot fill one window. */
export function chromaFromSamples(samples: Float32Array, sampleRate: number): number[] | null {
  const n = samples.length;
  if (n < WIN || !(sampleRate > 0)) return null;
  const chroma = new Array<number>(12).fill(0);
  const available = Math.floor((n - WIN) / WIN) + 1;
  const count = Math.min(MAX_WINDOWS, Math.max(1, available));
  const frame = new Float32Array(WIN);
  for (let w = 0; w < count; w++) {
    const start = count === 1 ? 0 : Math.floor((w * (n - WIN)) / (count - 1));
    let energy = 0;
    for (let i = 0; i < WIN; i++) {
      const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (WIN - 1)));
      const s = samples[start + i] * hann;
      frame[i] = s;
      energy += s * s;
    }
    if (energy < 1e-8) continue;
    for (let midi = 36; midi <= 84; midi++) {
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      if (freq >= sampleRate / 2) continue;
      chroma[midi % 12] += goertzel(frame, sampleRate, freq);
    }
  }
  return chroma.some((v) => v > 0) ? chroma : null;
}

export function detectKeyFromAudio(samples: Float32Array, sampleRate: number): KeyDetection | null {
  const chroma = chromaFromSamples(samples, sampleRate);
  if (!chroma) return null;
  return detectKeyFromChroma(chroma);
}

export function chromaFromNotes(notes: Array<Pick<MIDINote, 'pitch' | 'lengthBeats' | 'velocity'>>): number[] | null {
  const chroma = new Array<number>(12).fill(0);
  for (const note of notes) {
    const pitch = Math.round(note.pitch);
    if (pitch < 0 || pitch > 127) continue;
    const weight = Math.max(0, note.lengthBeats) * (Math.max(0, note.velocity) / 127);
    chroma[((pitch % 12) + 12) % 12] += weight;
  }
  return chroma.some((v) => v > 0) ? chroma : null;
}

export function detectKeyFromNotes(notes: Array<Pick<MIDINote, 'pitch' | 'lengthBeats' | 'velocity'>>): KeyDetection | null {
  const chroma = chromaFromNotes(notes);
  if (!chroma) return null;
  return detectKeyFromChroma(chroma);
}

export type ClipKeyResult =
  | { ok: true; key: string; scale: 'major' | 'minor'; fromCache: boolean }
  | { ok: false; reason: string };

const memory = new Map<string, CachedKey>();

export const memoryKeyStore: KeyStore = {
  async get(id) { return memory.get(id) ?? null; },
  async set(id, value) { memory.set(id, value); },
};

let browserStore: KeyStore | null = null;

function browserKeyStore(): KeyStore {
  if (browserStore) return browserStore;
  browserStore = createIdbKeyStore() ?? memoryKeyStore;
  return browserStore;
}

export async function detectClipKey(
  project: DAWProject,
  clipId: string | null,
  audio: Map<string, { channels: Float32Array[]; sampleRate: number }>,
  store: KeyStore = browserKeyStore(),
): Promise<ClipKeyResult> {
  const clip = findClip(project, clipId);
  if (!clip) return { ok: false, reason: 'Select an audio or MIDI clip first.' };
  if (clip.type === 'audio') {
    const id = clip.audioBufferId;
    if (!id) return { ok: false, reason: 'This clip has no audio.' };
    const cacheId = keyCacheId(id);
    const hit = await store.get(cacheId);
    if (hit && hit.version === KEY_ANALYSIS_VERSION) {
      if (!hit.result) return { ok: false, reason: 'No clear major or natural minor key in this clip.' };
      return { ok: true, key: hit.result.key, scale: hit.result.scale, fromCache: true };
    }
    const pcm = audio.get(id);
    if (!pcm?.channels?.length) return { ok: false, reason: 'This clip is not loaded yet, so there are no samples to analyze.' };
    if (pcm.channels[0].length < WIN) return { ok: false, reason: 'This clip is too short to detect a key. Peak drawings are not used.' };
    const mono = mixChannels(pcm.channels);
    const result = detectKeyFromAudio(mono, pcm.sampleRate);
    await store.set(cacheId, { version: KEY_ANALYSIS_VERSION, result });
    if (!result) return { ok: false, reason: 'No clear major or natural minor key in this clip.' };
    return { ok: true, key: result.key, scale: result.scale, fromCache: false };
  }
  const notes = clip.midiNotes || [];
  if (!notes.length) return { ok: false, reason: 'This MIDI clip has no notes.' };
  const result = detectKeyFromNotes(notes);
  if (!result) return { ok: false, reason: 'No clear major or natural minor key in this clip.' };
  return { ok: true, key: result.key, scale: result.scale, fromCache: false };
}

function findClip(project: DAWProject, clipId: string | null): DAWClip | null {
  if (!clipId) return null;
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return clip;
  }
  return null;
}

function mixChannels(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) {
    const m = Math.min(n, ch.length);
    for (let i = 0; i < m; i++) out[i] += ch[i];
  }
  const scale = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i] *= scale;
  return out;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da <= 0 || db <= 0) return 0;
  return num / Math.sqrt(da * db);
}

function goertzel(frame: Float32Array, sampleRate: number, freq: number): number {
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < frame.length; i++) {
    const s0 = frame[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

const DB_NAME = 'concord-studio-key-detect';
const STORE = 'analyses';

function createIdbKeyStore(): KeyStore | null {
  if (typeof indexedDB === 'undefined') return null;
  const openDb = () => new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return {
    async get(id) {
      const db = await openDb();
      if (!db) return null;
      return new Promise((resolve) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        req.onsuccess = () => resolve((req.result as CachedKey | undefined) ?? null);
        req.onerror = () => resolve(null);
      });
    },
    async set(id, value) {
      const db = await openDb();
      if (!db) return;
      await new Promise<void>((resolve) => {
        const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, id);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    },
  };
}
