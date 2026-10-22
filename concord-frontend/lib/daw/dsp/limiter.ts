/**
 * Look-ahead true-peak limiter and loudness targeting for exports.
 *
 * Gain computation (per sample, linked across channels):
 *   req[n]  = min(1, ceiling / truePeakEnvelope[n])
 *   held[n] = min(req[n .. n+L])            (look-ahead window L)
 *   rel[n]  = instant attack / exponential release toward held[n]  (rel ≤ held)
 *   g[n]    = mean(rel[n-L+1 .. n])        (smooth ramp; g[p] ≤ req[p] at every peak p)
 * A final static trim guarantees the ceiling after inter-sample effects.
 */

import { truePeakEnvelope, truePeak, integratedLoudness, measureLoudness, type LoudnessReport } from './loudness';

export interface LimiterOptions {
  ceilingDb?: number; // dBTP
  lookaheadMs?: number;
  releaseMs?: number;
}

export function limitTruePeak(channels: Float32Array[], sampleRate: number, opts: LimiterOptions = {}): { channels: Float32Array[]; maxReductionDb: number } {
  const ceiling = Math.pow(10, (opts.ceilingDb ?? -1) / 20);
  const n = channels[0]?.length || 0;
  if (!n) return { channels, maxReductionDb: 0 };
  const L = Math.max(1, Math.round(((opts.lookaheadMs ?? 5) / 1000) * sampleRate));
  const relCoef = Math.exp(-1 / (((opts.releaseMs ?? 80) / 1000) * sampleRate));

  // Linked true-peak envelope.
  const env = new Float32Array(n);
  for (const ch of channels) {
    const e = truePeakEnvelope(ch);
    for (let i = 0; i < n; i++) if (e[i] > env[i]) env[i] = e[i];
  }
  const req = new Float32Array(n);
  for (let i = 0; i < n; i++) req[i] = env[i] > ceiling ? ceiling / env[i] : 1;

  // Sliding minimum over [i, i+L] (monotonic deque).
  const held = new Float32Array(n);
  const dq = new Int32Array(n + L + 1);
  let head = 0, tail = 0;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const hi = Math.min(n - 1, i + L);
    while (j <= hi) {
      while (tail > head && req[dq[tail - 1]] >= req[j]) tail--;
      dq[tail++] = j++;
    }
    while (dq[head] < i) head++;
    held[i] = req[dq[head]];
  }

  // Instant attack, smooth release.
  const rel = new Float32Array(n);
  let g = 1;
  for (let i = 0; i < n; i++) {
    const t = held[i];
    g = t < g ? t : t + (g - t) * relCoef;
    if (g > t) g = t; // never above the held target
    rel[i] = g;
  }

  // Moving average over L samples (ramps the gain down ahead of each peak).
  const out = channels.map(() => new Float32Array(n));
  let acc = 0;
  let minGain = 1;
  for (let i = 0; i < n; i++) {
    acc += rel[i];
    if (i >= L) acc -= rel[i - L];
    const gg = acc / Math.min(L, i + 1);
    if (gg < minGain) minGain = gg;
    for (let c = 0; c < channels.length; c++) out[c][i] = channels[c][i] * gg;
  }

  // Safety trim for any residual inter-sample overshoot.
  const tp = truePeak(out);
  if (tp > ceiling) {
    const k = ceiling / tp;
    for (const ch of out) for (let i = 0; i < n; i++) ch[i] *= k;
    minGain *= k;
  }
  return { channels: out, maxReductionDb: -20 * Math.log10(Math.max(1e-9, minGain)) };
}

export interface LoudnessTarget {
  id: string;
  label: string;
  lufs: number;
  ceilingDb: number;
  bitDepth?: 16 | 24 | 32;
}

export const LOUDNESS_TARGETS: LoudnessTarget[] = [
  { id: 'streaming', label: 'Streaming (-14 LUFS, -1 dBTP)', lufs: -14, ceilingDb: -1 },
  { id: 'apple', label: 'Apple Music (-16 LUFS, -1 dBTP)', lufs: -16, ceilingDb: -1 },
  { id: 'club', label: 'Club (-9 LUFS, -0.3 dBTP)', lufs: -9, ceilingDb: -0.3 },
  { id: 'cd', label: 'CD (-9.5 LUFS, -0.3 dBTP, 16-bit dithered)', lufs: -9.5, ceilingDb: -0.3, bitDepth: 16 },
];

export interface MasterResult {
  channels: Float32Array[];
  gainDb: number;
  maxReductionDb: number;
  report: LoudnessReport;
}

/** Gain to target loudness, then true-peak limit; one corrective pass if the limiter cost loudness. */
export function masterToTarget(channels: Float32Array[], sampleRate: number, target: { lufs: number; ceilingDb: number }): MasterResult {
  const src = integratedLoudness(channels, sampleRate);
  if (!Number.isFinite(src)) {
    return { channels, gainDb: 0, maxReductionDb: 0, report: measureLoudness(channels, sampleRate) };
  }
  let gainDb = Math.max(-30, Math.min(24, target.lufs - src));
  let result = applyAndLimit(channels, sampleRate, gainDb, target.ceilingDb);
  let lufs = integratedLoudness(result.channels, sampleRate);
  for (let pass = 0; pass < 2 && Number.isFinite(lufs) && target.lufs - lufs > 0.3; pass++) {
    gainDb = Math.min(24, gainDb + (target.lufs - lufs));
    result = applyAndLimit(channels, sampleRate, gainDb, target.ceilingDb);
    lufs = integratedLoudness(result.channels, sampleRate);
  }
  return { channels: result.channels, gainDb, maxReductionDb: result.maxReductionDb, report: measureLoudness(result.channels, sampleRate) };
}

function applyAndLimit(channels: Float32Array[], sr: number, gainDb: number, ceilingDb: number) {
  const k = Math.pow(10, gainDb / 20);
  const scaled = channels.map((ch) => { const o = new Float32Array(ch.length); for (let i = 0; i < ch.length; i++) o[i] = ch[i] * k; return o; });
  return limitTruePeak(scaled, sr, { ceilingDb });
}

/** Scale to a peak ceiling only (no loudness change upward) — used for unmastered exports so nothing clips. */
export function preventClipping(channels: Float32Array[], sampleRate: number, ceilingDb = -0.1): { channels: Float32Array[]; trimDb: number } {
  const tp = truePeak(channels);
  const ceil = Math.pow(10, ceilingDb / 20);
  if (tp <= ceil) return { channels, trimDb: 0 };
  const lim = limitTruePeak(channels, sampleRate, { ceilingDb });
  return { channels: lim.channels, trimDb: -lim.maxReductionDb };
}
