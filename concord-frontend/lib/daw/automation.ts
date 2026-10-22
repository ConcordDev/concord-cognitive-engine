/**
 * Automation curves. Exponential and logarithmic shapes are legal only when
 * both ends are strictly positive; otherwise the segment is linear.
 * Volume lanes store dB. The graph turns those into linear gain ramps.
 */

export type AutoCurve = 'linear' | 'exponential' | 'logarithmic' | 'step';

export interface AutoPoint {
  beat: number;
  value: number;
  curve?: AutoCurve;
}

export function valueAtBeat(points: AutoPoint[], beat: number): number {
  const sorted = points.filter((p) => Number.isFinite(p.beat) && Number.isFinite(p.value)).slice().sort((a, b) => a.beat - b.beat);
  if (!sorted.length) return NaN;
  if (beat <= sorted[0].beat) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (beat >= last.beat) return last.value;
  let i = 0;
  while (i + 1 < sorted.length && sorted[i + 1].beat <= beat) i += 1;
  const a = sorted[i];
  const b = sorted[i + 1];
  const span = b.beat - a.beat;
  const u = span > 0 ? (beat - a.beat) / span : 0;
  const curve = a.curve || 'linear';
  if (curve === 'step') return a.value;
  if ((curve === 'exponential' || curve === 'logarithmic') && a.value > 0 && b.value > 0) {
    return a.value * Math.pow(b.value / a.value, u);
  }
  return a.value + (b.value - a.value) * u;
}

/** Gain samples of a dB lane. Callers schedule these with linear ramps. */
export function gainPoints(points: AutoPoint[], from: number, to: number, dbToGain: (db: number) => number, step = 0.0625): Array<{ beat: number; gain: number }> {
  if (!(to > from)) return [];
  const beats = [from];
  for (let b = from + step; b < to; b += step) beats.push(b);
  if (beats[beats.length - 1] < to) beats.push(to);
  return beats.map((beat) => ({ beat, gain: Math.max(1e-5, dbToGain(valueAtBeat(points, beat))) }));
}
