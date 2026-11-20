/**
 * Booth tokens for code that paints outside CSS (canvas, rAF-driven meters).
 * Colours stay in booth.css; this reads them back so a canvas uses the same
 * palette, and names the meter zones that booth.css colours via data-zone.
 */

export type MeterZone = 'ok' | 'hot' | 'clip';

/** Meter colour zone for a level in dBFS: green below `hot`, yellow up to `clip`, red at or above it. */
export function meterZone(db: number, hot = -6, clip = -0.5): MeterZone {
  if (db >= clip) return 'clip';
  if (db >= hot) return 'hot';
  return 'ok';
}

/** A Booth colour token as a canvas-ready string (falls back when no .booth ancestor is mounted, e.g. tests). */
export function boothVar(name: string, fallback: string, from?: Element | null): string {
  if (typeof window === 'undefined') return fallback;
  const el = from?.closest('.booth') ?? document.querySelector('.booth');
  if (!el) return fallback;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}
