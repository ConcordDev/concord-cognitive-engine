/**
 * Tempo map for Concord Studio.
 *
 * Points are musical breakpoints. `curve` is how tempo moves from this point
 * to the next: `step` holds, `linear` ramps. The last point holds forever.
 * Time before the first point (count-in) uses that point's tempo.
 *
 * Audio clips do not follow the ramp. Their wall-clock length is
 * `lengthBeats * 60 / bpmAt(start)`, so a ramp under a clip does not
 * time-stretch the file. MIDI, clicks, the playhead, loops and the offline
 * renderer integrate the map.
 */

export const TEMPO_MIN = 20;
export const TEMPO_MAX = 999;

export interface TempoPoint {
  beat: number;
  bpm: number;
  curve: 'step' | 'linear';
}

export interface TempoSource {
  bpm?: number;
  timeSignature?: [number, number] | number[];
  arrangement?: {
    tempo?: Array<{ bar?: number; beat?: number; bpm?: number; curve?: string }>;
  };
}

export function clampTempo(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120;
  return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, bpm));
}

export function projectTempoPoints(project: TempoSource): TempoPoint[] {
  const bpb = Math.max(1, Number(project.timeSignature?.[0]) || 4);
  const raw = project.arrangement?.tempo || [];
  const pts: TempoPoint[] = [];
  for (const p of raw) {
    if (!p || typeof p.bpm !== 'number' || !Number.isFinite(p.bpm)) continue;
    const beat = typeof p.beat === 'number' && Number.isFinite(p.beat)
      ? Math.max(0, p.beat)
      : Math.max(0, (Number(p.bar) || 0) * bpb);
    pts.push({
      beat,
      bpm: clampTempo(p.bpm),
      curve: p.curve === 'step' ? 'step' : 'linear',
    });
  }
  pts.sort((a, b) => a.beat - b.beat);
  const out: TempoPoint[] = [];
  for (const p of pts) {
    if (out.length && Math.abs(out[out.length - 1].beat - p.beat) < 1e-6) out[out.length - 1] = p;
    else out.push(p);
  }
  const base = clampTempo(typeof project.bpm === 'number' ? project.bpm : 120);
  if (!out.length || out[0].beat > 1e-6) out.unshift({ beat: 0, bpm: base, curve: 'step' });
  return out;
}

/** True when every breakpoint is the same tempo (a ramp of zero). */
export function isConstantTempo(points: TempoPoint[]): boolean {
  if (points.length <= 1) return true;
  const b = points[0].bpm;
  return points.every((p) => Math.abs(p.bpm - b) < 1e-6);
}

export function resolveTempo(src: { bpm?: number; tempo?: TempoPoint[] }): TempoPoint[] {
  if (src.tempo && src.tempo.length) return src.tempo;
  const bpm = typeof src.bpm === 'number' && src.bpm > 0 && Number.isFinite(src.bpm) ? src.bpm : 120;
  return [{ beat: 0, bpm, curve: 'step' }];
}

function linearSeconds(t0: number, t1: number, span: number, db: number): number {
  if (db <= 0) return 0;
  if (!(span > 0) || Math.abs(t1 - t0) < 1e-9) return (db * 60) / t0;
  const travelled = Math.min(span, db);
  const tAt = t0 + (t1 - t0) * (travelled / span);
  return ((60 * span) / (t1 - t0)) * Math.log(tAt / t0);
}

function linearBeat(t0: number, t1: number, span: number, seconds: number): number {
  if (seconds <= 0) return 0;
  if (!(span > 0) || Math.abs(t1 - t0) < 1e-9) return (seconds * t0) / 60;
  const tAt = t0 * Math.exp((seconds * (t1 - t0)) / (60 * span));
  return span * (tAt - t0) / (t1 - t0);
}

/** Seconds from beat 0 to `beat` (negative before the first point). */
export function secondsFromBeat(points: TempoPoint[], beat: number): number {
  if (!points.length) return (beat * 60) / 120;
  const first = points[0];
  if (beat <= first.beat) return ((beat - first.beat) * 60) / first.bpm;
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const here = points[i];
    const next = points[i + 1];
    const from = here.beat;
    if (!next) return acc + ((beat - from) * 60) / here.bpm;
    const span = next.beat - from;
    if (beat >= next.beat - 1e-12) {
      acc += here.curve === 'linear' ? linearSeconds(here.bpm, next.bpm, span, span) : (span * 60) / here.bpm;
      continue;
    }
    const db = beat - from;
    acc += here.curve === 'linear' ? linearSeconds(here.bpm, next.bpm, span, db) : (db * 60) / here.bpm;
    return acc;
  }
  return acc;
}

export function secondsBetween(points: TempoPoint[], a: number, b: number): number {
  return secondsFromBeat(points, b) - secondsFromBeat(points, a);
}

export function beatFromSeconds(points: TempoPoint[], seconds: number): number {
  if (!points.length) return (seconds * 120) / 60;
  const first = points[0];
  if (seconds <= 0) return first.beat + (seconds * first.bpm) / 60;
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const here = points[i];
    const next = points[i + 1];
    if (!next) return here.beat + ((seconds - acc) * here.bpm) / 60;
    const span = next.beat - here.beat;
    const seg = here.curve === 'linear' ? linearSeconds(here.bpm, next.bpm, span, span) : (span * 60) / here.bpm;
    if (acc + seg >= seconds - 1e-12) {
      const into = seconds - acc;
      const db = here.curve === 'linear' ? linearBeat(here.bpm, next.bpm, span, into) : (into * here.bpm) / 60;
      return here.beat + db;
    }
    acc += seg;
  }
  return points[points.length - 1].beat;
}

/** Beat reached by travelling `seconds` of wall-clock time from `beat`. */
export function beatAfter(points: TempoPoint[], beat: number, seconds: number): number {
  return beatFromSeconds(points, secondsFromBeat(points, beat) + seconds);
}

export function bpmAt(points: TempoPoint[], beat: number): number {
  if (!points.length) return 120;
  if (beat <= points[0].beat) return points[0].bpm;
  for (let i = 0; i < points.length; i++) {
    const next = points[i + 1];
    if (!next || beat < next.beat - 1e-12) {
      if (!next || points[i].curve !== 'linear') return points[i].bpm;
      const span = next.beat - points[i].beat;
      if (!(span > 0)) return points[i].bpm;
      const u = (beat - points[i].beat) / span;
      return points[i].bpm + (next.bpm - points[i].bpm) * u;
    }
  }
  return points[points.length - 1].bpm;
}

export interface ClickRender {
  samples: Float32Array;
  sampleRate: number;
  /** Sample index of each click whose beat is in [fromBeat, toBeat). */
  positions: number[];
  beats: number[];
}

/**
 * Offline click track. One sample impulse per beat (accent 1, others 0.5).
 * Positions are `round(secondsFromBeat * sampleRate)` relative to `fromBeat`.
 */
export function renderClickTrack(points: TempoPoint[], opts: {
  fromBeat: number;
  toBeat: number;
  beatsPerBar: number;
  sampleRate: number;
}): ClickRender {
  const sampleRate = opts.sampleRate;
  const t0 = secondsFromBeat(points, opts.fromBeat);
  const t1 = secondsFromBeat(points, opts.toBeat);
  const n = Math.max(1, Math.ceil(Math.max(0, t1 - t0) * sampleRate));
  const samples = new Float32Array(n);
  const positions: number[] = [];
  const beats: number[] = [];
  const bpb = Math.max(1, opts.beatsPerBar);
  const eps = 1e-9;
  for (let b = Math.ceil(opts.fromBeat - eps); b < opts.toBeat - eps; b++) {
    const sec = secondsFromBeat(points, b) - t0;
    const i = Math.round(sec * sampleRate);
    if (i < 0 || i >= n) continue;
    const accent = ((b % bpb) + bpb) % bpb === 0;
    samples[i] = accent ? 1 : 0.5;
    positions.push(i);
    beats.push(b);
  }
  return { samples, sampleRate, positions, beats };
}
