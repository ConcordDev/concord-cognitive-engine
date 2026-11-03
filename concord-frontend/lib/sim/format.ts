/**
 * Shared print-layer formatters for Sim Studio.
 *
 * sim.md F7: the compute layer is exact (p-values, Euler-integrated deltas
 * are mathematically correct) but the print layer was not — a p-value of
 * 1.3e-7 rounded to "0" under `toLocaleString()`'s default 3-fraction-digit
 * cap, and raw IEEE-754 deltas like `343.91599999999994` were rendered
 * verbatim. These helpers round away float noise and keep small values
 * legible without changing any underlying computation.
 */

/** Round to `decimals` places, stripping IEEE-754 representation noise. */
export function roundClean(n: number, decimals = 6): number {
  if (!Number.isFinite(n)) return n;
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

/** Format a number with float noise stripped, keeping up to `decimals` places. */
export function fmtClean(n: number, decimals = 6): string {
  if (!Number.isFinite(n)) return String(n);
  return roundClean(n, decimals).toLocaleString(undefined, { maximumFractionDigits: decimals });
}

/**
 * Format a p-value so small-but-nonzero values stay visible instead of
 * rounding to "0". Below 0.0001 (in magnitude), shows a bound (`<0.0001`)
 * rather than a misleadingly exact tiny float.
 */
export function formatPValue(p: number): string {
  if (!Number.isFinite(p)) return String(p);
  const abs = Math.abs(p);
  if (abs > 0 && abs < 0.0001) return p < 0 ? '<-0.0001' : '<0.0001';
  return p.toFixed(4);
}
