/**
 * Live master loudness. Blocks go through the same K-weight mean square and
 * the same gated integrated-loudness function as the offline report.
 */

import { integratedFromBlockPowers, kWeightedMeanSquare, truePeak } from './loudness';

export class LiveLoudness {
  private pendingL: number[] = [];
  private pendingR: number[] = [];
  private powers: number[] = [];
  private peak = 0;
  private rate = 48000;

  reset(): void {
    this.pendingL = [];
    this.pendingR = [];
    this.powers = [];
    this.peak = 0;
  }

  push(left: Float32Array, right: Float32Array, sampleRate: number): void {
    this.rate = sampleRate || this.rate;
    for (let i = 0; i < left.length; i++) {
      this.pendingL.push(left[i] || 0);
      this.pendingR.push(right[i] || 0);
    }
    const step = Math.max(1, Math.round(0.1 * this.rate));
    const block = Math.max(step, Math.round(0.4 * this.rate));
    while (this.pendingL.length >= block) {
      const l = Float32Array.from(this.pendingL.slice(0, block));
      const r = Float32Array.from(this.pendingR.slice(0, block));
      this.powers.push(kWeightedMeanSquare([l, r], this.rate));
      const tp = truePeak([l, r]);
      if (tp > this.peak) this.peak = tp;
      this.pendingL.splice(0, step);
      this.pendingR.splice(0, step);
      if (this.powers.length > 20000) this.powers.splice(0, this.powers.length - 20000);
    }
  }

  integratedLufs(): number {
    return integratedFromBlockPowers(this.powers);
  }

  truePeakDbtp(): number {
    return this.peak > 0 ? 20 * Math.log10(this.peak) : Number.NEGATIVE_INFINITY;
  }
}

export function correlation(left: ArrayLike<number>, right: ArrayLike<number>): number {
  const n = Math.min(left.length, right.length);
  let sl = 0;
  let sr = 0;
  let ml = 0;
  let mr = 0;
  for (let i = 0; i < n; i++) { ml += left[i]; mr += right[i]; }
  ml /= n || 1;
  mr /= n || 1;
  let dot = 0;
  for (let i = 0; i < n; i++) {
    const a = left[i] - ml;
    const b = right[i] - mr;
    dot += a * b;
    sl += a * a;
    sr += b * b;
  }
  const den = Math.sqrt(sl * sr);
  return den > 1e-12 ? Math.max(-1, Math.min(1, dot / den)) : 0;
}

export function rmsDb(frame: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  const r = Math.sqrt(s / Math.max(1, frame.length));
  return r > 1e-8 ? 20 * Math.log10(r) : -120;
}
