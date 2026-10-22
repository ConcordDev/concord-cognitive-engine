/**
 * Pitch Correct core. Pure TypeScript: the live worklet and the offline
 * block loop in render both call processPitchBlock. No network, no WASM.
 *
 * Detection is YIN on a window that covers at least two periods of minHz,
 * hopped every 512 samples (a full YIN on every 128-sample block of a long
 * window is too much work for one audio thread). The shifter is a time-domain
 * delay reader. At ratio 1 it is a pure delay of `latencySamples`, which is
 * the number the device reports. Formant shift is not implemented.
 */

export const PITCH_BLOCK = 128;
export const DETECT_HOP = 512;
const A4 = 440;

export type PitchMode = 'low' | 'quality';

export interface PitchRange {
  id: string;
  name: string;
  minHz: number;
  maxHz: number;
}

export const PITCH_RANGES: PitchRange[] = [
  { id: 'low-male', name: 'Low male', minHz: 75, maxHz: 280 },
  { id: 'tenor-alto', name: 'Tenor-Alto', minHz: 130, maxHz: 520 },
  { id: 'soprano', name: 'Soprano', minHz: 200, maxHz: 1100 },
  { id: 'instrument', name: 'Instrument', minHz: 60, maxHz: 1400 },
];

export interface PitchPreset {
  id: string;
  name: string;
  retuneMs: number;
  humanize: number;
  flexCents: number;
  preserveVibrato: boolean;
  mode: PitchMode;
}

export const PITCH_PRESETS: PitchPreset[] = [
  { id: 'rap-hard', name: 'Rap vocal: hard tune', retuneMs: 0, humanize: 0, flexCents: 200, preserveVibrato: false, mode: 'low' },
  { id: 'rnb-natural', name: 'R&B vocal: natural tune', retuneMs: 50, humanize: 60, flexCents: 70, preserveVibrato: true, mode: 'low' },
];

export interface PitchSettings {
  sampleRate: number;
  retuneMs: number;
  humanize: number;
  flexCents: number;
  preserveVibrato: boolean;
  transpose: number;
  mix: number;
  mode: PitchMode;
  minHz: number;
  maxHz: number;
  /** Bit i set → pitch class i (0 = C) is an allowed target. 0 means chromatic. */
  scaleMask: number;
  bypass: boolean;
}

export interface PitchMeter {
  detectedHz: number;
  targetHz: number;
  /** Detected pitch minus the target, in cents. 0 when unvoiced. */
  cents: number;
  confidence: number;
  voiced: boolean;
}

const SCALE_STEPS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'natural minor': [0, 2, 3, 5, 7, 8, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'major pentatonic': [0, 2, 4, 7, 9],
  'minor pentatonic': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

/** Twelve roots the device override offers. Enharmonic spellings stay in `scaleMaskFor`. */
export const PITCH_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export const PITCH_SCALES = Object.keys(SCALE_STEPS);

const ROOTS: Record<string, number> = {
  C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
};

export function scaleMaskFor(key: string, scale: string, customMask?: number): { mask: number; known: boolean } {
  if ((scale || '').trim().toLowerCase() === 'custom') {
    const m = Number(customMask);
    if (!Number.isInteger(m) || m <= 0 || m > 0xfff) return { mask: 0xfff, known: false };
    return { mask: m, known: true };
  }
  const root = ROOTS[(key || 'C').trim()] ?? null;
  const steps = SCALE_STEPS[(scale || '').trim().toLowerCase()];
  if (root === null || !steps) return { mask: 0xfff, known: false };
  if (steps.length === 12) return { mask: 0xfff, known: true };
  let mask = 0;
  for (const s of steps) mask |= 1 << ((root + s) % 12);
  return { mask, known: true };
}

/** Analysis window plus one hop plus one period of minHz. Matches the delay line. */
export function pitchLatencySamples(sampleRate: number, minHz: number, mode: PitchMode): number {
  const period = Math.max(1, Math.round(sampleRate / Math.max(1, minHz)));
  const analysis = mode === 'quality' ? Math.max(2048, period * 4) : Math.max(512, period * 2);
  return analysis + DETECT_HOP + period;
}

export function pitchLatencySec(sampleRate: number, minHz: number, mode: PitchMode): number {
  return pitchLatencySamples(sampleRate, minHz, mode) / sampleRate;
}

function analysisSamples(sampleRate: number, minHz: number, mode: PitchMode): number {
  const period = Math.max(1, Math.round(sampleRate / Math.max(1, minHz)));
  return mode === 'quality' ? Math.max(2048, period * 4) : Math.max(512, period * 2);
}

export interface YinResult { hz: number; confidence: number }

/** YIN cumulative-mean-normalized difference, with parabolic interpolation. */
export function yinDetect(frame: Float32Array, sampleRate: number, minHz: number, maxHz: number, prevHz = 0): YinResult {
  const n = frame.length;
  const tauMin = Math.max(2, Math.floor(sampleRate / Math.max(1, maxHz)));
  const tauMax = Math.min(n - 2, Math.floor(sampleRate / Math.max(1, minHz)));
  if (tauMax <= tauMin + 1) return { hz: 0, confidence: 0 };
  const yinN = n - tauMax;
  if (yinN < 16) return { hz: 0, confidence: 0 };
  const d = new Float32Array(tauMax + 1);
  for (let tau = tauMin; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < yinN; i++) {
      const diff = frame[i] - frame[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  const threshold = 0.12;
  const candidates: number[] = [];
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < threshold && cmnd[t] <= cmnd[t - 1] && cmnd[t] <= (cmnd[t + 1] ?? 1)) candidates.push(t);
  }
  let tau = -1;
  if (candidates.length) {
    tau = candidates[0];
    if (prevHz > 0) {
      const prevTau = sampleRate / prevHz;
      let best = tau;
      let bestDist = Math.abs(tau - prevTau);
      for (const c of candidates) {
        const dist = Math.abs(c - prevTau);
        if (dist + 1 < bestDist && cmnd[c] < threshold) { best = c; bestDist = dist; }
      }
      tau = best;
    }
  } else {
    let best = tauMin;
    let bv = Infinity;
    for (let t = tauMin; t <= tauMax; t++) if (cmnd[t] < bv) { bv = cmnd[t]; best = t; }
    if (bv > 0.45) return { hz: 0, confidence: 0 };
    tau = best;
  }
  const x0 = cmnd[tau - 1] ?? cmnd[tau];
  const x1 = cmnd[tau];
  const x2 = cmnd[tau + 1] ?? cmnd[tau];
  const denom = x0 - 2 * x1 + x2;
  const shift = denom === 0 ? 0 : Math.max(-1, Math.min(1, (x0 - x2) / (2 * denom)));
  const tauEst = Math.max(tauMin, tau + shift);
  return { hz: sampleRate / tauEst, confidence: Math.max(0, Math.min(1, 1 - x1)) };
}

export function snapHz(hz: number, scaleMask: number, transpose: number): number {
  if (!(hz > 0)) return 0;
  const mask = scaleMask & 0xfff ? scaleMask & 0xfff : 0xfff;
  const midi = 69 + 12 * Math.log2(hz / A4);
  let best = Math.round(midi);
  let bestDist = 1e9;
  for (let m = Math.round(midi) - 12; m <= Math.round(midi) + 12; m++) {
    const pc = ((m % 12) + 12) % 12;
    if ((mask & (1 << pc)) === 0) continue;
    const dist = Math.abs(m - midi);
    if (dist < bestDist) { bestDist = dist; best = m; }
  }
  const out = best + Math.max(-12, Math.min(12, Math.round(transpose)));
  return A4 * Math.pow(2, (out - 69) / 12);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function noteLabel(hz: number): string {
  if (!(hz > 0)) return '—';
  const midi = Math.round(69 + 12 * Math.log2(hz / A4));
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[pc]}${oct}`;
}

interface ShiftState {
  ring: Float32Array;
  mask: number;
  write: number;
  read: number;
  latency: number;
  primed: boolean;
  fadeFrom: number;
  fadeLeft: number;
  fadeN: number;
}

export interface PitchState {
  settings: PitchSettings;
  shift: ShiftState;
  latency: number;
  sinceDetect: number;
  ratio: number;
  desired: number;
  tauMs: number;
  centerHz: number;
  prevHz: number;
  stableMidi: number;
  stableSamples: number;
  meter: PitchMeter;
  frame: Float32Array;
}

function makeShift(latency: number): ShiftState {
  const size = 1 << Math.ceil(Math.log2(Math.max(4096, latency * 4)));
  return { ring: new Float32Array(size), mask: size - 1, write: 0, read: -latency, latency, primed: false, fadeFrom: 0, fadeLeft: 0, fadeN: 1 };
}

export function createPitchState(settings: PitchSettings): PitchState {
  const latency = pitchLatencySamples(settings.sampleRate, settings.minHz, settings.mode);
  return {
    settings: { ...settings },
    shift: makeShift(latency),
    latency,
    sinceDetect: DETECT_HOP,
    ratio: 1,
    desired: 1,
    tauMs: Math.max(0, settings.retuneMs),
    centerHz: 0,
    prevHz: 0,
    stableMidi: -1,
    stableSamples: 0,
    meter: { detectedHz: 0, targetHz: 0, cents: 0, confidence: 0, voiced: false },
    frame: new Float32Array(analysisSamples(settings.sampleRate, settings.minHz, settings.mode)),
  };
}

export function applyPitchSettings(state: PitchState, settings: PitchSettings): void {
  const latency = pitchLatencySamples(settings.sampleRate, settings.minHz, settings.mode);
  const modeChanged = settings.mode !== state.settings.mode || settings.minHz !== state.settings.minHz || latency !== state.latency;
  state.settings = { ...settings };
  if (modeChanged) {
    state.latency = latency;
    state.shift = makeShift(latency);
    state.frame = new Float32Array(analysisSamples(settings.sampleRate, settings.minHz, settings.mode));
    state.sinceDetect = DETECT_HOP;
  }
}

function readRing(shift: ShiftState, pos: number): number {
  const i = Math.floor(pos);
  const frac = pos - i;
  const a = shift.ring[i & shift.mask];
  const b = shift.ring[(i + 1) & shift.mask];
  return a + (b - a) * frac;
}

function recenter(shift: ShiftState, ratio: number): void {
  if (Math.abs(ratio - 1) < 1e-4) {
    shift.read = shift.write - shift.latency;
    shift.fadeLeft = 0;
    return;
  }
  const period = Math.max(32, Math.round(shift.latency / 8));
  const delay = shift.write - shift.read;
  if (shift.fadeLeft > 0) return;
  if (delay < shift.latency - period || delay > shift.latency + period) {
    shift.fadeFrom = shift.read;
    shift.fadeN = Math.min(period, 256);
    shift.fadeLeft = shift.fadeN;
    shift.read = shift.write - shift.latency;
  }
}

function shiftSample(shift: ShiftState, x: number, ratio: number): { wet: number; dry: number } {
  shift.ring[shift.write & shift.mask] = x;
  if (!shift.primed) {
    shift.read = shift.write - shift.latency;
    shift.primed = true;
  }
  recenter(shift, ratio);
  let wet = readRing(shift, shift.read);
  if (shift.fadeLeft > 0) {
    const from = readRing(shift, shift.fadeFrom);
    const t = 1 - shift.fadeLeft / shift.fadeN;
    const w = t * t * (3 - 2 * t);
    wet = from * (1 - w) + wet * w;
    shift.fadeFrom += ratio;
    shift.fadeLeft -= 1;
  }
  const dry = shift.ring[(shift.write - shift.latency) & shift.mask];
  shift.write += 1;
  shift.read += ratio;
  return { wet, dry };
}

function detect(state: PitchState): void {
  const s = state.settings;
  const frame = state.frame;
  const n = frame.length;
  for (let i = 0; i < n; i++) frame[i] = state.shift.ring[(state.shift.write - n + i) & state.shift.mask];
  const found = yinDetect(frame, s.sampleRate, s.minHz, s.maxHz, state.prevHz);
  const voiced = found.hz > 0 && found.confidence >= 0.55 && found.hz >= s.minHz * 0.9 && found.hz <= s.maxHz * 1.1;
  let target = 0;
  let cents = 0;
  let desired = 1;
  if (!voiced) {
    state.stableMidi = -1;
    state.stableSamples = 0;
    state.centerHz = 0;
    desired = 1;
  } else {
    state.prevHz = found.hz;
    const dt = DETECT_HOP / s.sampleRate;
    const a = 1 - Math.exp(-2 * Math.PI * 5 * dt);
    state.centerHz = state.centerHz > 0 ? state.centerHz + (found.hz - state.centerHz) * a : found.hz;
    target = snapHz(found.hz, s.scaleMask, s.transpose);
    cents = 1200 * Math.log2(found.hz / target);
    const midi = Math.round(69 + 12 * Math.log2(found.hz / A4));
    if (midi !== state.stableMidi) {
      state.stableMidi = midi;
      state.stableSamples = 0;
    } else state.stableSamples += DETECT_HOP;
    let tau = Math.max(0, s.retuneMs);
    if (state.stableSamples >= 0.2 * s.sampleRate) tau *= 1 + Math.max(0, Math.min(100, s.humanize)) / 100;
    state.tauMs = tau;
    const off = Math.abs(cents);
    if (off > Math.max(0, s.flexCents)) desired = 1;
    else {
      const base = s.preserveVibrato ? state.centerHz : found.hz;
      desired = base > 0 ? target / base : 1;
    }
  }
  state.desired = Math.max(0.25, Math.min(4, desired));
  state.meter = { detectedHz: voiced ? found.hz : 0, targetHz: voiced ? target : 0, cents: voiced ? cents : 0, confidence: found.confidence, voiced };
}

/** Process one block. `input` and `output` are the same length (the render quantum, normally 128). */
export function processPitchBlock(state: PitchState, input: Float32Array, output: Float32Array): PitchMeter {
  const s = state.settings;
  const mix = s.bypass ? 0 : Math.max(0, Math.min(1, s.mix));
  for (let i = 0; i < input.length; i++) {
    state.sinceDetect += 1;
    if (state.sinceDetect >= DETECT_HOP) {
      state.sinceDetect = 0;
      detect(state);
    }
    const tauSec = state.tauMs / 1000;
    if (s.bypass || tauSec <= 0.0005) state.ratio = s.bypass ? 1 : state.desired;
    else {
      const a = 1 - Math.exp(-1 / (tauSec * s.sampleRate));
      state.ratio += (state.desired - state.ratio) * a;
    }
    const { wet, dry } = shiftSample(state.shift, input[i], state.ratio);
    output[i] = dry * (1 - mix) + wet * mix;
  }
  return state.meter;
}

export function processPitchSignal(input: Float32Array, settings: PitchSettings): { output: Float32Array; latency: number } {
  const state = createPitchState(settings);
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += PITCH_BLOCK) {
    const n = Math.min(PITCH_BLOCK, input.length - i);
    processPitchBlock(state, input.subarray(i, i + n), output.subarray(i, i + n));
  }
  return { output, latency: state.latency };
}

/** Drop the processor delay so a clip stays on the timeline. Live playback advances by the same amount instead. */
export function removeLatency(signal: Float32Array, latency: number): Float32Array {
  if (latency <= 0 || latency >= signal.length) return signal.slice();
  const out = new Float32Array(signal.length);
  out.set(signal.subarray(latency), 0);
  return out;
}
