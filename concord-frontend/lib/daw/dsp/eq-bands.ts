/**
 * Eight-band EQ coefficients (Audio EQ Cookbook) and the Web Audio chain.
 * A peaking band at 0 dB is unity. High-pass / low-pass cascade 2, 4, or 8
 * poles (12 / 24 / 48 dB/oct).
 */

export type EqBandType = 'peak' | 'lowshelf' | 'highshelf' | 'highpass' | 'lowpass';

export interface EqBand {
  type: EqBandType;
  freq: number;
  gain: number;
  q: number;
  /** 12, 24, or 48. Only high-pass and low-pass use this. */
  slope: number;
}

export const EQ8_TYPES: EqBandType[] = ['peak', 'lowshelf', 'highshelf', 'highpass', 'lowpass'];

export function defaultEqBands(): EqBand[] {
  const freq = [60, 150, 400, 1000, 2500, 5000, 8000, 12000];
  return freq.map((f, i) => ({
    type: i === 0 ? 'highpass' : i === 7 ? 'lowshelf' : 'peak',
    freq: f,
    gain: 0,
    q: 0.707,
    slope: 12,
  }));
}

function clampType(n: number): EqBandType {
  return EQ8_TYPES[Math.max(0, Math.min(EQ8_TYPES.length - 1, Math.round(n)))] || 'peak';
}

export function eq8HasBands(params: Record<string, unknown> | undefined): boolean {
  if (!params) return false;
  if (Number(params.bands) === 1) return true;
  return params.b0f != null || params.b0g != null;
}

export function readEqBands(params: Record<string, unknown>): EqBand[] {
  const base = defaultEqBands();
  return base.map((band, i) => ({
    type: params[`b${i}t`] == null ? band.type : clampType(Number(params[`b${i}t`])),
    freq: Number.isFinite(Number(params[`b${i}f`])) ? Number(params[`b${i}f`]) : band.freq,
    gain: Number.isFinite(Number(params[`b${i}g`])) ? Number(params[`b${i}g`]) : 0,
    q: Number.isFinite(Number(params[`b${i}q`])) ? Math.max(0.1, Number(params[`b${i}q`])) : 0.707,
    slope: [12, 24, 48].includes(Number(params[`b${i}s`])) ? Number(params[`b${i}s`]) : 12,
  }));
}

export function eq8Params(bands: EqBand[] = defaultEqBands()): Record<string, number> {
  const out: Record<string, number> = { bands: 1 };
  bands.slice(0, 8).forEach((b, i) => {
    out[`b${i}t`] = EQ8_TYPES.indexOf(b.type);
    out[`b${i}f`] = b.freq;
    out[`b${i}g`] = b.gain;
    out[`b${i}q`] = b.q;
    out[`b${i}s`] = b.slope;
  });
  return out;
}

/** Magnitude of one RBJ biquad at `freq` Hz. Peaking gain is reached at f0. */
export function biquadMagnitude(type: EqBandType, f0: number, q: number, gainDb: number, freq: number, sampleRate: number): number {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * Math.max(1, f0)) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Math.max(0.05, q));
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  if (type === 'peak') {
    b0 = 1 + alpha * A;
    b1 = -2 * cos;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cos;
    a2 = 1 - alpha / A;
  } else if (type === 'lowshelf') {
    const beta = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) - (A - 1) * cos + beta);
    b1 = 2 * A * ((A - 1) - (A + 1) * cos);
    b2 = A * ((A + 1) - (A - 1) * cos - beta);
    a0 = (A + 1) + (A - 1) * cos + beta;
    a1 = -2 * ((A - 1) + (A + 1) * cos);
    a2 = (A + 1) + (A - 1) * cos - beta;
  } else if (type === 'highshelf') {
    const beta = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) + (A - 1) * cos + beta);
    b1 = -2 * A * ((A - 1) + (A + 1) * cos);
    b2 = A * ((A + 1) + (A - 1) * cos - beta);
    a0 = (A + 1) - (A - 1) * cos + beta;
    a1 = 2 * ((A - 1) - (A + 1) * cos);
    a2 = (A + 1) - (A - 1) * cos - beta;
  } else if (type === 'highpass') {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  }
  const w = (2 * Math.PI * Math.max(1, freq)) / sampleRate;
  const zRe = Math.cos(w);
  const zIm = -Math.sin(w);
  const num = complexDiv(evalBiquad(b0, b1, b2, zRe, zIm), evalBiquad(a0, a1, a2, zRe, zIm));
  return Math.hypot(num.re, num.im);
}

function evalBiquad(c0: number, c1: number, c2: number, zRe: number, zIm: number): { re: number; im: number } {
  const z2 = { re: zRe * zRe - zIm * zIm, im: 2 * zRe * zIm };
  return { re: c0 * z2.re + c1 * zRe + c2, im: c0 * z2.im + c1 * zIm };
}

function complexDiv(n: { re: number; im: number }, d: { re: number; im: number }): { re: number; im: number } {
  const m = d.re * d.re + d.im * d.im || 1e-12;
  return { re: (n.re * d.re + n.im * d.im) / m, im: (n.im * d.re - n.re * d.im) / m };
}

export function bandMagnitude(band: EqBand, freq: number, sampleRate: number): number {
  const poles = band.type === 'highpass' || band.type === 'lowpass' ? (band.slope >= 48 ? 4 : band.slope >= 24 ? 2 : 1) : 1;
  const one = biquadMagnitude(band.type, band.freq, band.q, band.type === 'highpass' || band.type === 'lowpass' ? 0 : band.gain, freq, sampleRate);
  return Math.pow(one, poles);
}

export function createEq8(ctx: BaseAudioContext, bands: EqBand[]): { input: AudioNode; output: AudioNode; dispose: () => void } {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const nodes: BiquadFilterNode[] = [];
  let last: AudioNode = input;
  for (const band of bands.slice(0, 8)) {
    const poles = band.type === 'highpass' || band.type === 'lowpass' ? (band.slope >= 48 ? 4 : band.slope >= 24 ? 2 : 1) : 1;
    const kind = band.type === 'peak' ? 'peaking' : band.type;
    for (let p = 0; p < poles; p++) {
      const f = ctx.createBiquadFilter();
      f.type = kind;
      f.frequency.value = Math.max(20, Math.min(ctx.sampleRate * 0.45, band.freq));
      f.Q.value = Math.max(0.05, band.q);
      f.gain.value = kind === 'highpass' || kind === 'lowpass' ? 0 : Math.max(-24, Math.min(24, band.gain));
      last.connect(f);
      last = f;
      nodes.push(f);
    }
  }
  last.connect(output);
  return {
    input,
    output,
    dispose: () => {
      try { input.disconnect(); output.disconnect(); } catch { /* noop */ }
      nodes.forEach((n) => { try { n.disconnect(); } catch { /* noop */ } });
    },
  };
}
