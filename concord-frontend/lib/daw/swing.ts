/**
 * Swing. 0 is straight. 100 delays an off-eighth by a full eighth-note triplet
 * (from the halfway point of the beat to two-thirds). 16th notes stay put.
 * This is not the legacy quantize amount.
 */

export function swingBeat(beat: number, swing: number): number {
  const amount = Math.max(0, Math.min(100, Number.isFinite(swing) ? swing : 0)) / 100;
  if (amount === 0 || !Number.isFinite(beat)) return beat;
  const eighth = Math.round(beat / 0.5);
  if (eighth % 2 === 0) return beat;
  if (Math.abs(beat - eighth * 0.5) > 0.02) return beat;
  return beat + amount * (1 / 6);
}
