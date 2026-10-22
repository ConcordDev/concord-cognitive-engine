/**
 * Loopback latency measurement.
 * A log chirp is played, captured on the dry input tap, and located by FFT
 * cross-correlation. The result is accepted only when 8 of 10 chirps agree
 * within 2 ms. No browser or interface latency is claimed here.
 */

export const CAL_CHIRPS = 10;
export const CAL_TOLERANCE_SEC = 0.002;
export const CAL_MIN_AGREE = 8;
/** Far enough apart that a 500 ms search window cannot see the next chirp. */
export const CAL_GAP_SEC = 0.75;

export interface CalibrationJudgement {
  ok: boolean;
  offsetSec: number;
  agree: number;
  found: number;
  reason: string;
}

/** Hann-windowed log sweep, 400 Hz → 6 kHz. */
export function makeChirp(sampleRate: number, durSec = 0.04): Float32Array {
  const n = Math.max(8, Math.round(sampleRate * durSec));
  const out = new Float32Array(n);
  const f0 = 400;
  const f1 = 6000;
  const ln = Math.log(f1 / f0);
  const T = n / sampleRate;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const phase = 2 * Math.PI * f0 * T * (Math.pow(f1 / f0, t / T) - 1) / ln;
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    out[i] = Math.sin(phase) * hann * 0.5;
  }
  return out;
}

function fft(re: Float64Array, im: Float64Array, invert: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (invert ? -1 : 1);
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vr = re[i + j + half];
        const vi = im[i + j + half];
        const vRe = vr * wr - vi * wi;
        const vIm = vr * wi + vi * wr;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nwr = wr * wlenRe - wi * wlenIm;
        wi = wr * wlenIm + wi * wlenRe;
        wr = nwr;
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

function templateEnergy(template: Float32Array): number {
  let s = 0;
  for (let i = 0; i < template.length; i++) s += template[i] * template[i];
  return s;
}

/** Lag, in samples, where `template` best matches `signal`. */
export function correlatedLag(signal: Float32Array, template: Float32Array): { lag: number; mag: number } {
  const need = signal.length + template.length;
  let n = 1;
  while (n < need) n <<= 1;
  const reA = new Float64Array(n);
  const imA = new Float64Array(n);
  const reB = new Float64Array(n);
  const imB = new Float64Array(n);
  for (let i = 0; i < signal.length; i++) reA[i] = signal[i];
  for (let i = 0; i < template.length; i++) reB[i] = template[i];
  fft(reA, imA, false);
  fft(reB, imB, false);
  for (let i = 0; i < n; i++) {
    const ar = reA[i];
    const ai = imA[i];
    const br = reB[i];
    const bi = -imB[i];
    reA[i] = ar * br - ai * bi;
    imA[i] = ar * bi + ai * br;
  }
  fft(reA, imA, true);
  let best = 0;
  let mag = -Infinity;
  const limit = Math.max(1, signal.length);
  for (let k = 0; k < limit; k++) {
    if (reA[k] > mag) { mag = reA[k]; best = k; }
  }
  const left = best > 0 ? reA[best - 1] : mag;
  const right = best + 1 < n ? reA[best + 1] : mag;
  const denom = left - 2 * mag + right;
  let lag = best;
  if (Math.abs(denom) > 1e-9) {
    const delta = 0.5 * (left - right) / denom;
    if (delta > -1 && delta < 1) lag += delta;
  }
  return { lag, mag };
}

/**
 * For each play time, the delay (arrival − play) in seconds.
 * Null when the chirp is not in the capture.
 */
export function chirpArrivalDelays(
  recorded: Float32Array,
  template: Float32Array,
  sampleRate: number,
  playTimesSec: number[],
  recordStartSec: number,
): Array<number | null> {
  const energy = templateEnergy(template);
  const floor = energy * 0.25;
  return playTimesSec.map((play) => {
    const i0 = Math.max(0, Math.floor((play - 0.02 - recordStartSec) * sampleRate));
    const i1 = Math.min(recorded.length, Math.ceil((play + 0.52 - recordStartSec) * sampleRate));
    if (i1 - i0 < template.length) return null;
    const slice = recorded.subarray(i0, i1);
    const { lag, mag } = correlatedLag(slice, template);
    if (!(mag > floor)) return null;
    const arrival = recordStartSec + (i0 + lag) / sampleRate;
    return arrival - play;
  });
}

export function judgeDelays(delays: Array<number | null>): CalibrationJudgement {
  const finite = delays.filter((d): d is number => typeof d === 'number' && Number.isFinite(d));
  if (finite.length < CAL_MIN_AGREE) {
    return {
      ok: false,
      offsetSec: 0,
      agree: 0,
      found: finite.length,
      reason: `Only ${finite.length} of ${CAL_CHIRPS} chirps were found. Turn the speakers up, or use a loopback cable. Calibration does not work on headphones, because the microphone never hears the chirps.`,
    };
  }
  const sorted = [...finite].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const cluster = finite.filter((d) => Math.abs(d - mid) <= CAL_TOLERANCE_SEC);
  if (cluster.length < CAL_MIN_AGREE) {
    return {
      ok: false,
      offsetSec: 0,
      agree: cluster.length,
      found: finite.length,
      reason: `${cluster.length} of ${finite.length} chirps agreed within 2 ms. The measurement was rejected.`,
    };
  }
  const offset = cluster.reduce((s, v) => s + v, 0) / cluster.length;
  if (offset < 0 || offset > 0.5) {
    return {
      ok: false,
      offsetSec: 0,
      agree: cluster.length,
      found: finite.length,
      reason: 'The offset is outside 0–500 ms, so it was rejected.',
    };
  }
  return { ok: true, offsetSec: offset, agree: cluster.length, found: finite.length, reason: '' };
}
