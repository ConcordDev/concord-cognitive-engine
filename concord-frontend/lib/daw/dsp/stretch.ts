/**
 * Offline clip playback: reverse, region edits, pitch, and overlap-add stretch.
 * Pitch keeps the buffer length by resampling and stretching back.
 * timeStretch 1 is the original length. Values above 1 make it longer.
 * signalsmith-stretch is not used.
 */

import { yinDetect } from './pitch/core';

export interface RegionEdit {
  start: number;
  end: number;
  gainDb: number;
  reverse: boolean;
}

export interface ClipPlayback {
  reverse: boolean;
  semitones: number;
  stretch: number;
  regions?: RegionEdit[];
}

const WIN = 1024;
const SYN = 256;

function yinPeriod(frame: Float32Array, sampleRate: number): number {
  const hit = yinDetect(frame, sampleRate, 50, 2000);
  if (!(hit.confidence > 0.6) || !(hit.hz > 0)) return 0;
  return Math.max(8, Math.round(sampleRate / hit.hz));
}

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, n - 1));
  return w;
}

/** Read faster when `step` > 1 (shorter, higher pitch). Linear interpolation. */
export function resampleMono(input: Float32Array, step: number): Float32Array {
  const rate = step > 0 ? step : 1;
  const outLen = Math.max(1, Math.round(input.length / rate));
  const out = new Float32Array(outLen);
  const last = Math.max(0, input.length - 1);
  for (let i = 0; i < outLen; i++) {
    const x = Math.min(last, i * rate);
    const i0 = Math.floor(x);
    const i1 = Math.min(last, i0 + 1);
    const f = x - i0;
    out[i] = (input[i0] || 0) * (1 - f) + (input[i1] || 0) * f;
  }
  return out;
}

/** Overlap-add stretch. `ratio` > 1 lengthens. A ratio of 1 returns a copy. */
export function stretchMono(input: Float32Array, ratio: number, sampleRate = 48000): Float32Array {
  if (!input.length || !(ratio > 0)) return new Float32Array(0);
  if (Math.abs(ratio - 1) < 1e-3 || input.length < 64) {
    if (Math.abs(ratio - 1) < 1e-3) return input.slice();
    return resampleMono(input, 1 / ratio);
  }
  const win = Math.min(WIN, input.length);
  const window = hann(win);
  const probed = input.subarray(0, Math.min(input.length, 4096));
  const periodGuess = probed.length > 512 ? yinPeriod(probed, sampleRate) : 0;
  let synHop = Math.max(32, Math.min(SYN, Math.floor(win / 4)));
  if (periodGuess > 8) synHop = Math.max(periodGuess, Math.round(periodGuess * Math.max(1, Math.round(synHop / periodGuess))));
  const anaHop = synHop / ratio;
  const outLen = Math.max(win, Math.round(input.length * ratio));
  const out = new Float32Array(outLen);
  const weight = new Float32Array(outLen);
  const search = Math.min(160, Math.floor(win / 3));
  let prev = 0;
  let syn = 0;
  let guard = 0;
  while (syn + win <= outLen && guard++ < outLen) {
    let pos = Math.round(prev + (guard === 1 ? 0 : anaHop));
    pos = Math.max(0, Math.min(input.length - win, pos));
    if (guard > 1 && search > 0) {
      const ref = Math.max(0, syn - synHop);
      let best = pos;
      let bestScore = -Infinity;
      const compare = Math.min(win, synHop);
      for (let d = -search; d <= search; d += 2) {
        const c = pos + d;
        if (c < 0 || c + compare > input.length) continue;
        let score = 0;
        for (let i = 0; i < compare; i += 2) score += (out[ref + i] || 0) * input[c + i];
        if (score > bestScore) { bestScore = score; best = c; }
      }
      pos = best;
    }
    for (let i = 0; i < win; i++) {
      const w = window[i];
      out[syn + i] += input[pos + i] * w;
      weight[syn + i] += w;
    }
    prev = pos;
    syn += synHop;
    if (pos >= input.length - win && syn + win < outLen) break;
  }
  for (let i = 0; i < out.length; i++) if (weight[i] > 1e-6) out[i] /= weight[i];
  return out;
}

export function reverseMono(input: Float32Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[input.length - 1 - i];
  return out;
}

function applyRegions(input: Float32Array, regions: RegionEdit[] | undefined, sampleRate: number): Float32Array {
  if (!regions?.length) return input;
  const out = input.slice();
  for (const region of regions) {
    const a = Math.max(0, Math.min(out.length, Math.round(region.start * sampleRate)));
    const b = Math.max(a, Math.min(out.length, Math.round(region.end * sampleRate)));
    if (b <= a) continue;
    if (region.reverse) {
      const span = b - a;
      for (let i = 0; i < span / 2; i++) {
        const tmp = out[a + i];
        out[a + i] = out[b - 1 - i];
        out[b - 1 - i] = tmp;
      }
    }
    const gain = Math.pow(10, (Number.isFinite(region.gainDb) ? region.gainDb : 0) / 20);
    if (gain !== 1) for (let i = a; i < b; i++) out[i] *= gain;
  }
  return out;
}

export function renderChannel(input: Float32Array, sampleRate: number, spec: ClipPlayback): Float32Array {
  let cur = applyRegions(input, spec.regions, sampleRate);
  if (spec.reverse) cur = reverseMono(cur);
  const semis = Number.isFinite(spec.semitones) ? Math.max(-12, Math.min(12, spec.semitones)) : 0;
  if (semis !== 0) {
    const step = Math.pow(2, semis / 12);
    cur = stretchMono(resampleMono(cur, step), step, sampleRate);
  }
  const stretch = Number.isFinite(spec.stretch) && spec.stretch > 0 ? spec.stretch : 1;
  if (Math.abs(stretch - 1) > 1e-3) cur = stretchMono(cur, stretch, sampleRate);
  return cur;
}

export function clipNeedsPlayback(spec: ClipPlayback): boolean {
  if (spec.reverse) return true;
  if (Math.abs(spec.semitones || 0) > 1e-6) return true;
  if (spec.stretch > 0 && Math.abs(spec.stretch - 1) > 1e-3) return true;
  return !!spec.regions?.length;
}

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function clipPlaybackId(sourceId: string, spec: ClipPlayback): string {
  const regions = (spec.regions || []).map((r) => `${r.start.toFixed(4)}:${r.end.toFixed(4)}:${r.gainDb.toFixed(2)}:${r.reverse ? 1 : 0}`).join(',');
  return `play_${fnv(`${sourceId}|${spec.reverse ? 1 : 0}|${spec.semitones}|${spec.stretch}|${regions}`)}`;
}

/** Energy onsets. Returns sample indexes. */
export function transientSamples(channel: Float32Array, sampleRate: number): number[] {
  const hop = Math.max(32, Math.round(0.005 * sampleRate));
  const hits: number[] = [];
  let prev = 0;
  for (let i = 0; i + hop <= channel.length; i += hop) {
    let energy = 0;
    for (let j = 0; j < hop; j++) energy += channel[i + j] * channel[i + j];
    energy /= hop;
    const gap = !hits.length || i - hits[hits.length - 1] > sampleRate * 0.05;
    if (gap && energy > 1e-4 && energy > prev * 4 + 1e-6) hits.push(i);
    prev = prev * 0.6 + energy * 0.4;
  }
  return hits;
}

/** BPM from onset spacing, folded into 70–180. */
export function tempoFromHits(samples: number[], sampleRate: number): number | null {
  if (samples.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < samples.length; i++) gaps.push((samples[i] - samples[i - 1]) / sampleRate);
  gaps.sort((a, b) => a - b);
  const med = gaps[Math.floor(gaps.length / 2)];
  if (!(med > 0)) return null;
  let bpm = 60 / med;
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm * 10) / 10;
}
