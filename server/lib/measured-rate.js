// A percent computed over an empty sample is not a measurement.
// Callers used to substitute 100, which reads as a perfect score.

/** @returns {{ value: number|null, reason: string|null }} */
export function measuredPercent(sampleSize, percent) {
  const n = typeof sampleSize === "number" ? sampleSize : Number(sampleSize);
  if (!Number.isFinite(n) || n <= 0) {
    return { value: null, reason: "no_sample" };
  }
  return { value: percent, reason: null };
}
