/**
 * Upload analysis for Liner Notes: tempo, key and loudness measured from the
 * actual audio, or null when the measurement is not confident. Nothing here
 * guesses a value to fill a field.
 *
 * Tempo: an amplitude onset envelope (hop ≈ 11.6 ms), half-wave rectified,
 * autocorrelated over 60–200 BPM. Each candidate period is scored with half
 * the correlation at twice that period (a beat repeats a bar later; an
 * off-beat hi-hat does not) and a broad prior centred on 120 BPM, then
 * refined by parabolic interpolation. Two honesty gates return null: no real
 * percussive onsets (fewer than 0.5 per second rising more than 1 nat in one
 * hop — sustained chords beat against each other but never attack like that),
 * or a weak periodicity peak.
 * Key: the Studio's Krumhansl-profile detector (lib/daw/dsp/pitch/key-detect).
 * Loudness: ITU-R BS.1770 integrated loudness (lib/daw/dsp/loudness).
 */

import { detectKeyFromAudio } from '@/lib/daw/dsp/pitch/key-detect';
import { integratedLoudness } from '@/lib/daw/dsp/loudness';

export interface TrackAnalysis {
  bpm: number | null;
  key: string | null;
  lufs: number | null;
  durationSec: number;
}

const MIN_BPM = 60;
const MAX_BPM = 200;
const MIN_CONFIDENCE = 0.2;
/** Log-energy rise (nats per ~11.6 ms hop) that counts as a percussive attack (≈ 4.3 dB). */
const ATTACK_NATS = 1;
const MIN_ATTACKS_PER_SEC = 0.5;

function mono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** Onset strength per hop: rise in log energy, half-wave rectified, mean-removed. */
export function onsetEnvelope(x: Float32Array, sampleRate: number): { env: Float32Array; hopSec: number; attacksPerSec: number } {
  const hop = Math.max(64, Math.round(sampleRate * 0.0116));
  const win = hop * 2;
  const frames = Math.max(0, Math.floor((x.length - win) / hop) + 1);
  const logE = new Float32Array(frames);
  const amp = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const o = f * hop;
    for (let i = 0; i < win; i++) e += x[o + i] * x[o + i];
    logE[f] = Math.log(1e-10 + e / win);
    amp[f] = Math.sqrt(e / win);
  }
  const env = new Float32Array(frames);
  let mean = 0;
  let attacks = 0;
  for (let f = 1; f < frames; f++) {
    // Tempo follows the amplitude rise (a kick outweighs an off-beat hi-hat);
    // the attack gate below uses the log rise (how sudden, not how loud).
    const rise = amp[f] - amp[f - 1];
    env[f] = rise > 0 ? rise : 0;
    mean += env[f];
    const d = logE[f] - logE[f - 1];
    const prev = f > 1 ? logE[f - 1] - logE[f - 2] : -Infinity;
    const next = f + 1 < frames ? logE[f + 1] - logE[f] : -Infinity;
    if (d > ATTACK_NATS && d >= prev && d >= next) attacks++;
  }
  mean /= Math.max(1, frames - 1);
  for (let f = 0; f < frames; f++) env[f] = Math.max(0, env[f] - mean);
  return { env, hopSec: hop / sampleRate, attacksPerSec: attacks / Math.max(1e-9, x.length / sampleRate) };
}

export function estimateTempo(x: Float32Array, sampleRate: number): { bpm: number | null; confidence: number } {
  if (!(sampleRate > 0) || x.length < sampleRate * 4) return { bpm: null, confidence: 0 };
  const { env, hopSec, attacksPerSec } = onsetEnvelope(x, sampleRate);
  if (attacksPerSec < MIN_ATTACKS_PER_SEC) return { bpm: null, confidence: 0 };
  const n = env.length;
  let zero = 0;
  for (let i = 0; i < n; i++) zero += env[i] * env[i];
  if (!(zero > 1e-9)) return { bpm: null, confidence: 0 };
  const minLag = Math.max(1, Math.floor(60 / (MAX_BPM * hopSec)));
  const maxLag = Math.min(n - 1, Math.ceil(60 / (MIN_BPM * hopSec)));
  const top = Math.min(n - 1, 2 * maxLag + 1);
  const acf = new Float64Array(top + 2);
  for (let lag = Math.max(0, minLag - 1); lag <= top; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    acf[lag] = s / (n - lag);
  }
  const zeroNorm = zero / n;
  let best = -1;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * hopSec);
    // Broad log-normal prior around 120 BPM (σ = 1 octave) — damps half/double-time picks.
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120), 2));
    const score = ((acf[lag] + 0.5 * (acf[2 * lag] || 0)) / zeroNorm) * prior;
    if (acf[lag] >= acf[lag - 1] && acf[lag] >= acf[lag + 1] && score > bestScore) { bestScore = score; best = lag; }
  }
  if (best < 0) return { bpm: null, confidence: 0 };
  const confidence = acf[best] / zeroNorm;
  if (confidence < MIN_CONFIDENCE) return { bpm: null, confidence };
  const a = acf[best - 1];
  const b = acf[best];
  const c = acf[best + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  const bpm = 60 / ((best + shift) * hopSec);
  return { bpm: Math.round(bpm * 10) / 10, confidence };
}

export function analyzeTrack(channels: Float32Array[], sampleRate: number): TrackAnalysis {
  const durationSec = channels[0] ? channels[0].length / sampleRate : 0;
  const m = channels.length ? mono(channels) : new Float32Array(0);
  const tempo = estimateTempo(m, sampleRate);
  const key = m.length ? detectKeyFromAudio(m, sampleRate) : null;
  let lufs: number | null = null;
  try {
    const l = channels.length ? integratedLoudness(channels, sampleRate) : -Infinity;
    lufs = Number.isFinite(l) && l > -70 ? Math.round(l * 10) / 10 : null;
  } catch { lufs = null; }
  return {
    bpm: tempo.bpm,
    key: key ? `${key.key} ${key.scale}` : null,
    lufs,
    durationSec: Math.round(durationSec * 10) / 10,
  };
}

/** Decode a File in the browser and analyse it. Null when the browser cannot decode it. */
export async function analyzeFile(file: File): Promise<(TrackAnalysis & { peaks: number[] }) | null> {
  try {
    const W = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctx = W.AudioContext || W.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    try {
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      const a = analyzeTrack(channels, buf.sampleRate);
      const peaks: number[] = [];
      const m = channels[0];
      const bucket = Math.max(1, Math.floor(m.length / 120));
      for (let i = 0; i < 120; i++) {
        let p = 0;
        for (let j = i * bucket; j < Math.min(m.length, (i + 1) * bucket); j++) p = Math.max(p, Math.abs(m[j]));
        peaks.push(Math.round(p * 1000) / 1000);
      }
      return { ...a, peaks };
    } finally {
      void ctx.close?.();
    }
  } catch {
    return null;
  }
}
