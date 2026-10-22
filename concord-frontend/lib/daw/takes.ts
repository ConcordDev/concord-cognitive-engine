/**
 * Take lanes, comping, loop-record slicing, and punch trimming.
 * Pure functions: the same numbers drive the scheduler, flatten, and tests.
 */

import type { AudioTake, CompRegion, DAWTrack, TransportConfig } from './types';
import { bpmAt, secondsBetween, type TempoPoint } from './tempo-map';
import { applyEqualPowerEdgeFades, envelopeGain } from './dsp/fades';

const EPS = 1e-6;
/** Crossfade where two comp regions meet. */
export const COMP_XFADE_SEC = 0.01;
/** Punch edge fade. Inside the 5–10 ms range from the spec. */
export const PUNCH_FADE_SEC = 0.008;

export interface LoopSlice {
  startBeat: number;
  lengthBeats: number;
  channels: Float32Array[];
}

export interface CompSpec {
  bufferId: string;
  clipId: string;
  beat: number;
  offsetSec: number;
  lengthBeats: number;
  durationSec: number;
  gainDb: number;
  fadeInSec: number;
  fadeOutSec: number;
  fadeShape: 'equalPower';
}

export function sanitizeTakes(raw: unknown): AudioTake[] {
  if (!Array.isArray(raw)) return [];
  const out: AudioTake[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const t = item as AudioTake;
    if (typeof t.id !== 'string' || !t.id) continue;
    if (typeof t.audioBufferId !== 'string' || !t.audioBufferId) continue;
    const startBeat = Number(t.startBeat);
    const lengthBeats = Number(t.lengthBeats);
    if (!Number.isFinite(startBeat) || !Number.isFinite(lengthBeats) || lengthBeats <= 0) continue;
    const rating = t.rating === 1 ? 1 : undefined;
    out.push({
      id: t.id,
      audioBufferId: t.audioBufferId,
      startBeat: Math.max(0, startBeat),
      lengthBeats,
      offsetSec: Number.isFinite(t.offsetSec) ? Math.max(0, t.offsetSec) : 0,
      name: typeof t.name === 'string' && t.name.trim() ? t.name : 'Take',
      createdAt: Number.isFinite(t.createdAt) ? t.createdAt : 0,
      rating,
    });
  }
  return out;
}

export function sanitizeComp(raw: unknown, takes: AudioTake[]): CompRegion[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set(takes.map((t) => t.id));
  const regions: CompRegion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as CompRegion;
    if (!ids.has(r.takeId)) continue;
    const startBeat = Number(r.startBeat);
    const endBeat = Number(r.endBeat);
    if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || endBeat <= startBeat + EPS) continue;
    regions.push({ takeId: r.takeId, startBeat: Math.max(0, startBeat), endBeat });
  }
  return mergeAdjacent(regions.sort((a, b) => a.startBeat - b.startBeat));
}

function mergeAdjacent(regions: CompRegion[]): CompRegion[] {
  const out: CompRegion[] = [];
  for (const r of regions) {
    const last = out[out.length - 1];
    if (last && last.takeId === r.takeId && r.startBeat <= last.endBeat + 1e-4) {
      last.endBeat = Math.max(last.endBeat, r.endBeat);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/** The new region replaces coverage in that beat range. Gaps stay empty. */
export function applyCompSwipe(comp: CompRegion[], takeId: string, startBeat: number, endBeat: number): CompRegion[] {
  if (!(endBeat > startBeat + EPS)) return comp.map((r) => ({ ...r }));
  const next: CompRegion[] = [];
  for (const r of comp) {
    if (r.endBeat <= startBeat + EPS || r.startBeat >= endBeat - EPS) {
      next.push({ ...r });
      continue;
    }
    if (r.startBeat < startBeat - EPS) next.push({ ...r, endBeat: startBeat });
    if (r.endBeat > endBeat + EPS) next.push({ ...r, startBeat: endBeat });
  }
  next.push({ takeId, startBeat, endBeat });
  next.sort((a, b) => a.startBeat - b.startBeat || a.endBeat - b.endBeat);
  return mergeAdjacent(next);
}

/** Arrow keys: cycle which take supplies the comp region under `beat`. */
export function cycleCompTake(comp: CompRegion[], takes: AudioTake[], beat: number, dir: 1 | -1): CompRegion[] {
  const idx = comp.findIndex((r) => beat >= r.startBeat - EPS && beat < r.endBeat - EPS);
  if (idx < 0) return comp.map((r) => ({ ...r }));
  const region = comp[idx];
  const overlap = takes
    .filter((t) => t.startBeat < region.endBeat - EPS && t.startBeat + t.lengthBeats > region.startBeat + EPS)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  if (overlap.length < 2) return comp.map((r) => ({ ...r }));
  const at = Math.max(0, overlap.findIndex((t) => t.id === region.takeId));
  const next = overlap[(at + dir + overlap.length) % overlap.length];
  const copy = comp.map((r, i) => (i === idx ? { ...r, takeId: next.id } : { ...r }));
  return mergeAdjacent(copy);
}

export function punchRange(transport: TransportConfig): { start: number; end: number } | null {
  if (transport.loopEnabled && transport.loopEnd > transport.loopStart) {
    return { start: transport.loopStart, end: transport.loopEnd };
  }
  const a = transport.punchIn ?? 0;
  const b = transport.punchOut ?? 0;
  if (b > a) return { start: a, end: b };
  return null;
}

/**
 * Slice one continuous capture at loop boundaries.
 * Sample ranges are contiguous and do not overlap.
 */
export function sliceLoopCapture(
  channels: Float32Array[],
  sampleRate: number,
  opts: { startBeat: number; loopStart: number; loopEnd: number; points: TempoPoint[] },
): LoopSlice[] {
  const total = channels[0]?.length || 0;
  const loopLen = opts.loopEnd - opts.loopStart;
  if (total < 2 || !(loopLen > 0) || !(sampleRate > 0)) return [];
  const out: LoopSlice[] = [];
  let sample = 0;
  let musical = opts.startBeat;
  let guard = 0;
  while (sample < total - 1 && guard++ < 10000) {
    const before = musical < opts.loopStart - 1e-9;
    const m = before ? musical : (musical >= opts.loopEnd - 1e-9 ? opts.loopStart : musical);
    const boundary = before ? opts.loopStart : opts.loopEnd;
    const durSec = Math.max(0, secondsBetween(opts.points, m, boundary));
    const want = Math.max(1, Math.round(durSec * sampleRate));
    const count = Math.min(want, total - sample);
    if (count <= 0) break;
    const sliced = channels.map((c) => c.slice(sample, sample + count));
    const full = count >= want - 1;
    const lengthBeats = full ? boundary - m : (count / sampleRate) * (bpmAt(opts.points, m) / 60);
    if (lengthBeats > 1e-4) out.push({ startBeat: m, lengthBeats, channels: sliced });
    sample += count;
    if (!full) break;
    musical = opts.loopStart;
    if (!before) musical = opts.loopStart;
  }
  return out;
}

export function trimPunch(
  channels: Float32Array[],
  sampleRate: number,
  opts: { recordStartBeat: number; rangeStart: number; rangeEnd: number; points: TempoPoint[]; fadeSec?: number },
): { channels: Float32Array[]; startBeat: number; lengthBeats: number } | null {
  const total = channels[0]?.length || 0;
  if (total < 2 || !(opts.rangeEnd > opts.rangeStart)) return null;
  const actualStart = Math.max(opts.rangeStart, opts.recordStartBeat);
  const actualEnd = opts.rangeEnd;
  if (!(actualEnd > actualStart)) return null;
  const aSec = Math.max(0, secondsBetween(opts.points, opts.recordStartBeat, actualStart));
  const bSec = secondsBetween(opts.points, opts.recordStartBeat, actualEnd);
  const a = Math.max(0, Math.min(total, Math.round(aSec * sampleRate)));
  const b = Math.max(a, Math.min(total, Math.round(bSec * sampleRate)));
  if (b - a < Math.round(0.02 * sampleRate)) return null;
  const sliced = channels.map((c) => c.slice(a, b));
  applyEqualPowerEdgeFades(sliced, sampleRate, opts.fadeSec ?? PUNCH_FADE_SEC);
  const heardSec = (b - a) / sampleRate;
  const musicalSec = Math.max(0, secondsBetween(opts.points, actualStart, actualEnd));
  const lengthBeats = heardSec + 1e-4 < musicalSec
    ? heardSec * (bpmAt(opts.points, actualStart) / 60)
    : actualEnd - actualStart;
  return { channels: sliced, startBeat: actualStart, lengthBeats };
}

export function compPlaybackSpecs(
  takes: AudioTake[],
  comp: CompRegion[],
  from: number,
  to: number,
  points: TempoPoint[],
  catchUp: boolean,
): CompSpec[] {
  if (!(to > from) || !comp.length) return [];
  const byId = new Map(takes.map((t) => [t.id, t]));
  const regions = [...comp].sort((a, b) => a.startBeat - b.startBeat);
  const out: CompSpec[] = [];
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    const take = byId.get(region.takeId);
    if (!take) continue;
    const prev = i > 0 && Math.abs(regions[i - 1].endBeat - region.startBeat) < 1e-4;
    const next = i + 1 < regions.length && Math.abs(regions[i + 1].startBeat - region.endBeat) < 1e-4;
    let start = region.startBeat;
    let end = region.endBeat;
    let fadeIn = prev ? COMP_XFADE_SEC : 0;
    const fadeOut = next ? COMP_XFADE_SEC : 0;
    const takeEnd = take.startBeat + take.lengthBeats;
    if (prev) {
      const pad = (COMP_XFADE_SEC / 2) * (bpmAt(points, start) / 60);
      if (start - pad >= take.startBeat - 1e-4) start -= pad;
    }
    if (next) {
      const pad = (COMP_XFADE_SEC / 2) * (bpmAt(points, end) / 60);
      if (end + pad <= takeEnd + 1e-4) end += pad;
    }
    start = Math.max(start, take.startBeat);
    end = Math.min(end, takeEnd);
    if (!(end > start + 1e-6)) continue;
    if (end <= from + EPS || start >= to - EPS) continue;
    let playStart = start;
    let offsetSec = take.offsetSec + Math.max(0, secondsBetween(points, take.startBeat, start));
    if (playStart < from) {
      if (!catchUp || end <= from) continue;
      offsetSec += secondsBetween(points, playStart, from);
      const elapsed = secondsBetween(points, start, from);
      fadeIn = Math.max(0, fadeIn - elapsed);
      playStart = from;
    }
    const lengthBeats = end - playStart;
    const durationSec = Math.max(0, secondsBetween(points, playStart, end));
    if (durationSec <= 1e-4) continue;
    out.push({
      bufferId: take.audioBufferId,
      clipId: `comp:${take.id}:${region.startBeat.toFixed(4)}`,
      beat: playStart,
      offsetSec,
      lengthBeats,
      durationSec,
      gainDb: 0,
      fadeInSec: fadeIn,
      fadeOutSec: fadeOut,
      fadeShape: 'equalPower',
    });
  }
  return out;
}

/** Beat ranges of an arrangement clip that the comp does not cover. */
export function clipGaps(clipStart: number, clipEnd: number, comp: CompRegion[]): Array<{ start: number; end: number }> {
  if (!(clipEnd > clipStart)) return [];
  const cuts = [...comp].sort((a, b) => a.startBeat - b.startBeat);
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = clipStart;
  for (const r of cuts) {
    const a = Math.max(r.startBeat, clipStart);
    const b = Math.min(r.endBeat, clipEnd);
    if (b <= cursor + EPS) continue;
    if (a > cursor + EPS) gaps.push({ start: cursor, end: Math.min(a, clipEnd) });
    cursor = Math.max(cursor, b);
    if (cursor >= clipEnd - EPS) break;
  }
  if (cursor < clipEnd - EPS) gaps.push({ start: cursor, end: clipEnd });
  return gaps;
}

export function auditionSpec(take: AudioTake, from: number, to: number, points: TempoPoint[], catchUp: boolean): CompSpec | null {
  const start = take.startBeat;
  const end = take.startBeat + take.lengthBeats;
  if (end <= from + EPS || start >= to - EPS) return null;
  let playStart = start;
  let offsetSec = take.offsetSec;
  if (playStart < from) {
    if (!catchUp) return null;
    offsetSec += secondsBetween(points, playStart, from);
    playStart = from;
  }
  const durationSec = Math.max(0, secondsBetween(points, playStart, end));
  if (durationSec <= 1e-4) return null;
  return {
    bufferId: take.audioBufferId,
    clipId: `audition:${take.id}`,
    beat: playStart,
    offsetSec,
    lengthBeats: end - playStart,
    durationSec,
    gainDb: 0,
    fadeInSec: 0,
    fadeOutSec: 0,
    fadeShape: 'equalPower',
  };
}

export interface CompMix {
  channels: Float32Array[];
  startBeat: number;
  lengthBeats: number;
}

/** Render the comp to a new buffer. Does not delete takes. */
export function renderCompMix(
  takes: AudioTake[],
  comp: CompRegion[],
  buffers: Map<string, Float32Array[]>,
  sampleRate: number,
  points: TempoPoint[],
): CompMix | null {
  const specs = compPlaybackSpecs(takes, comp, -1e9, 1e12, points, true);
  if (!specs.length || !(sampleRate > 0)) return null;
  const startBeat = Math.min(...specs.map((s) => s.beat));
  const endBeat = Math.max(...specs.map((s) => s.beat + s.lengthBeats));
  let channelsN = 1;
  for (const s of specs) channelsN = Math.max(channelsN, buffers.get(s.bufferId)?.length || 1);
  const frames = Math.max(1, Math.ceil(secondsBetween(points, startBeat, endBeat) * sampleRate));
  const channels = Array.from({ length: channelsN }, () => new Float32Array(frames));
  for (const spec of specs) {
    const src = buffers.get(spec.bufferId);
    if (!src?.[0]) continue;
    const origin = Math.round(secondsBetween(points, startBeat, spec.beat) * sampleRate);
    const n = Math.round(spec.durationSec * sampleRate);
    const src0 = Math.round(spec.offsetSec * sampleRate);
    for (let i = 0; i < n; i++) {
      const dst = origin + i;
      const si = src0 + i;
      if (dst < 0 || dst >= frames || si < 0 || si >= src[0].length) continue;
      const g = envelopeGain(i / sampleRate, spec.durationSec, spec.fadeInSec, spec.fadeOutSec, 'equalPower');
      for (let c = 0; c < channelsN; c++) channels[c][dst] += (src[Math.min(c, src.length - 1)][si] || 0) * g;
    }
  }
  return { channels, startBeat, lengthBeats: endBeat - startBeat };
}

export function swipeTrack(track: DAWTrack, takeId: string, startBeat: number, endBeat: number): DAWTrack {
  return { ...track, comp: applyCompSwipe(track.comp || [], takeId, startBeat, endBeat) };
}

export function addTake(track: DAWTrack, take: AudioTake, swipe: boolean): DAWTrack {
  const takes = [...(track.takes || []), take];
  const comp = swipe
    ? applyCompSwipe(track.comp || [], take.id, take.startBeat, take.startBeat + take.lengthBeats)
    : (track.comp || []);
  return { ...track, takes, comp };
}
