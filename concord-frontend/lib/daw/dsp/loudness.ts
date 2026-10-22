/**
 * Loudness measurement per ITU-R BS.1770-4 / EBU R128 (Tech 3341, 3342):
 *  - K-weighting (pre-filter high shelf + RLB high-pass), designed for any sample rate
 *  - integrated loudness: 400 ms blocks, 75 % overlap, absolute gate -70 LUFS,
 *    relative gate -10 LU
 *  - loudness range (LRA): 3 s short-term blocks every 100 ms, gates -70 LUFS and
 *    -20 LU, 10th→95th percentile
 *  - true peak: 4× oversampling (windowed-sinc polyphase interpolator), dBTP
 */

export interface LoudnessReport {
  integratedLufs: number;
  shortTermMaxLufs: number;
  momentaryMaxLufs: number;
  lra: number;
  truePeakDbtp: number;
  samplePeakDbfs: number;
}

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** Stage 1 (shelving) and stage 2 (high-pass) K-weighting coefficients for `fs`. */
export function kWeightingCoefficients(fs: number): [Biquad, Biquad] {
  // Stage 1: high shelf (BS.1770 pre-filter), design as in libebur128.
  const G = 3.999843853973347;
  const f0 = 1681.974450955533;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // Stage 2: RLB high-pass.
  const f1 = 38.13547087602444;
  const Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / fs);
  const d = 1 + K1 / Q1 + K1 * K1;
  const hp: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K1 * K1 - 1)) / d,
    a2: (1 - K1 / Q1 + K1 * K1) / d,
  };
  return [shelf, hp];
}

function filterInPlace(x: Float64Array, c: Biquad): void {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    x[i] = y0;
  }
}

/** Per-channel K-weighted squared signal prefix sums (for fast block energies). */
function kWeightedPrefix(channels: Float32Array[], fs: number): Float64Array[] {
  const [s1, s2] = kWeightingCoefficients(fs);
  return channels.map((ch) => {
    const x = Float64Array.from(ch);
    filterInPlace(x, s1);
    filterInPlace(x, s2);
    const pre = new Float64Array(x.length + 1);
    for (let i = 0; i < x.length; i++) pre[i + 1] = pre[i] + x[i] * x[i];
    return pre;
  });
}

const toLufs = (power: number) => (power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity);

/** Channel weights: 1.0 for L/R/C, 1.41 for surrounds (5.1 order L R C LFE Ls Rs; LFE excluded). */
function channelWeights(n: number): number[] {
  if (n === 6) return [1, 1, 1, 0, 1.41, 1.41];
  return new Array(n).fill(1);
}

function blockPowers(pre: Float64Array[], fs: number, blockSec: number, stepSec: number): number[] {
  const len = pre[0].length - 1;
  const block = Math.round(blockSec * fs);
  const step = Math.max(1, Math.round(stepSec * fs));
  const w = channelWeights(pre.length);
  const out: number[] = [];
  if (len < block) return out;
  for (let start = 0; start + block <= len; start += step) {
    let p = 0;
    for (let c = 0; c < pre.length; c++) p += (w[c] * (pre[c][start + block] - pre[c][start])) / block;
    out.push(p);
  }
  return out;
}

export function integratedLoudness(channels: Float32Array[], fs: number): number {
  if (!channels.length || !channels[0].length) return -Infinity;
  return integratedFromPrefix(kWeightedPrefix(channels, fs), fs);
}

/** Mean square of a K-weighted block. Live metering feeds 400 ms blocks here. */
export function kWeightedMeanSquare(channels: Float32Array[], fs: number): number {
  if (!channels.length || !channels[0]?.length) return 0;
  const pre = kWeightedPrefix(channels, fs);
  const len = pre[0].length - 1;
  if (!len) return 0;
  const w = channelWeights(pre.length);
  let p = 0;
  for (let c = 0; c < pre.length; c++) p += (w[c] * pre[c][len]) / len;
  return p;
}

/** Same absolute and relative gates as integrated loudness, on block powers. */
export function integratedFromBlockPowers(powers: number[]): number {
  const abs = powers.filter((p) => toLufs(p) > -70);
  if (!abs.length) return -Infinity;
  const relGate = toLufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((p) => toLufs(p) > relGate);
  if (!gated.length) return -Infinity;
  return toLufs(gated.reduce((a, b) => a + b, 0) / gated.length);
}

function integratedFromPrefix(pre: Float64Array[], fs: number): number {
  return integratedFromBlockPowers(blockPowers(pre, fs, 0.4, 0.1));
}

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function lraFromPrefix(pre: Float64Array[], fs: number): number {
  const st = blockPowers(pre, fs, 3, 0.1).map(toLufs).filter((l) => l > -70);
  if (st.length < 2) return 0;
  const meanPow = st.reduce((a, l) => a + Math.pow(10, (l + 0.691) / 10), 0) / st.length;
  const rel = toLufs(meanPow) - 20;
  const g = st.filter((l) => l > rel).sort((a, b) => a - b);
  if (g.length < 2) return 0;
  return percentile(g, 0.95) - percentile(g, 0.1);
}

export function loudnessRange(channels: Float32Array[], fs: number): number {
  if (!channels.length) return 0;
  return lraFromPrefix(kWeightedPrefix(channels, fs), fs);
}

// ── True peak ────────────────────────────────────────────────────────────────

const OS = 4;
const HALF = 6; // taps each side → 12-tap interpolator per phase
let phaseTaps: Float64Array[] | null = null;

/**
 * Windowed-sinc 4x interpolator. phaseTaps[p][k] weights x[i + k - HALF + 1]
 * to produce the value at time i + p/OS (p = 1..3; p = 0 is the sample itself).
 */
function getPhaseTaps(): Float64Array[] {
  if (phaseTaps) return phaseTaps;
  phaseTaps = [];
  for (let p = 0; p < OS; p++) {
    const taps = new Float64Array(2 * HALF);
    let sum = 0;
    for (let k = 0; k < 2 * HALF; k++) {
      const d = k - HALF + 1; // sample offset j - i
      const t = p / OS - d; // distance from the interpolation point
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const u = t / HALF; // -1..1
      const win = Math.abs(u) >= 1 ? 0 : 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u); // Blackman
      taps[k] = sinc * win;
      sum += taps[k];
    }
    for (let k = 0; k < 2 * HALF; k++) taps[k] /= sum; // unity DC gain
    phaseTaps.push(taps);
  }
  return phaseTaps;
}

/**
 * Per-sample true-peak envelope of one channel: env[i] = max |x| over the
 * oversampled points between sample i and i+1 (inclusive of i).
 */
export function truePeakEnvelope(x: Float32Array): Float32Array {
  const ph = getPhaseTaps();
  const n = x.length;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = Math.abs(x[i]);
    for (let p = 1; p < OS; p++) {
      const taps = ph[p];
      let acc = 0;
      // Interpolated point between i and i+1 at fraction p/OS.
      for (let k = 0; k < 2 * HALF; k++) {
        const idx = i + k - HALF + 1;
        if (idx >= 0 && idx < n) acc += taps[k] * x[idx];
      }
      const a = Math.abs(acc);
      if (a > m) m = a;
    }
    env[i] = m;
  }
  return env;
}

export function truePeak(channels: Float32Array[]): number {
  let m = 0;
  for (const ch of channels) {
    const env = truePeakEnvelope(ch);
    for (let i = 0; i < env.length; i++) if (env[i] > m) m = env[i];
  }
  return m;
}

export const linToDb = (g: number) => (g > 0 ? 20 * Math.log10(g) : -Infinity);

export function samplePeak(channels: Float32Array[]): number {
  let m = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > m) m = a; }
  return m;
}

export function measureLoudness(channels: Float32Array[], fs: number): LoudnessReport {
  if (!channels.length || !channels[0].length) {
    return { integratedLufs: -Infinity, shortTermMaxLufs: -Infinity, momentaryMaxLufs: -Infinity, lra: 0, truePeakDbtp: -Infinity, samplePeakDbfs: -Infinity };
  }
  const pre = kWeightedPrefix(channels, fs);
  const mom = blockPowers(pre, fs, 0.4, 0.1).map(toLufs);
  const st = blockPowers(pre, fs, 3, 0.1).map(toLufs);
  return {
    integratedLufs: integratedFromPrefix(pre, fs),
    momentaryMaxLufs: mom.length ? Math.max(...mom) : -Infinity,
    shortTermMaxLufs: st.length ? Math.max(...st) : -Infinity,
    lra: lraFromPrefix(pre, fs),
    truePeakDbtp: linToDb(truePeak(channels)),
    samplePeakDbfs: linToDb(samplePeak(channels)),
  };
}

/** RMS in dBFS over the whole signal (all channels pooled), ignoring digital silence. */
export function rmsDbfs(channels: Float32Array[], silenceDb = -70): number {
  // Use 100 ms windows; average power of windows above `silenceDb` so gaps don't drag the level down.
  if (!channels.length) return -Infinity;
  const len = channels[0].length;
  const win = 4410;
  let sum = 0, count = 0;
  for (let s = 0; s < len; s += win) {
    let p = 0, n = 0;
    for (const ch of channels) for (let i = s; i < Math.min(len, s + win); i++) { p += ch[i] * ch[i]; n++; }
    const pw = n ? p / n : 0;
    if (pw > 0 && 10 * Math.log10(pw) > silenceDb) { sum += pw; count++; }
  }
  return count ? 10 * Math.log10(sum / count) : -Infinity;
}
