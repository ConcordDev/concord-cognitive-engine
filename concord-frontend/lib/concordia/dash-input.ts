// concord-frontend/lib/concordia/dash-input.ts
//
// Part B (B1b) — PURE double-tap detection for the traversal dash/dodge. A
// double-tap of a movement key (W/A/S/D) within a short window fires a dash in
// that direction (Prototype/character-action standard) — no dedicated key, so
// it conflicts with nothing in combat input. Pure so it's unit-testable.

export interface TapMemory {
  key: string;
  t: number; // wall-clock ms of the last tap
}

export const DOUBLE_TAP_MS = 260;

/**
 * Returns true when `key` (lowercased) is the SAME as the remembered tap and
 * arrived within `windowMs`. Mutates `mem` to record this tap either way, so the
 * caller just calls it on every relevant keydown.
 */
export function isDoubleTap(mem: TapMemory, key: string, now: number, windowMs: number = DOUBLE_TAP_MS): boolean {
  const k = String(key).toLowerCase();
  const hit = mem.key === k && now - mem.t <= windowMs && now - mem.t >= 0;
  mem.key = k;
  mem.t = now;
  // After a successful double-tap, clear so a 3rd tap isn't also a dash.
  if (hit) { mem.key = ''; mem.t = 0; }
  return hit;
}

/** Movement keys that can trigger a dash. */
export const DASH_KEYS = new Set(['w', 'a', 's', 'd']);
