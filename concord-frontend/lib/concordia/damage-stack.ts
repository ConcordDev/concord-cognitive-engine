// concord-frontend/lib/concordia/damage-stack.ts
//
// Track 1 — damage-number grouping. A flurry on one target spawned a separate
// floating number per hit, which reads as noise. This coalesces numeric hits on
// ~the same spot within a short window into ONE running-tally number (with a hit
// count), so a 5-hit combo reads as a single climbing "+42 ×5" instead of five
// overlapping glyphs. Non-numeric calls (PARRY/BLOCK) + kills never merge. Pure.

export interface DmgEntry {
  id: string;
  x: number; y: number; z: number;
  value: string;   // rendered text
  kind: 'hit' | 'crit' | 'block' | 'dodge' | 'kill';
  bornAt: number;
  count: number;   // hits coalesced into this entry
}

const MERGEABLE = new Set(['hit', 'crit']);
function asNumber(v: string): number | null {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function escalateKind(a: DmgEntry['kind'], b: DmgEntry['kind']): DmgEntry['kind'] {
  if (a === 'kill' || b === 'kill') return 'kill';
  if (a === 'crit' || b === 'crit') return 'crit';
  return 'hit';
}

export interface MergeOpts { groupMs?: number; radiusM?: number; max?: number }

/**
 * Merge an incoming damage number into the entry list, tallying recent same-spot
 * numeric hits. PURE — returns a new array.
 */
export function mergeDamage(entries: DmgEntry[], incoming: Omit<DmgEntry, 'count'>, opts: MergeOpts = {}): DmgEntry[] {
  const groupMs = opts.groupMs ?? 2000;
  const radius = opts.radiusM ?? 1.5;
  const max = opts.max ?? 32;
  const incNum = asNumber(incoming.value);

  if (incNum !== null && MERGEABLE.has(incoming.kind)) {
    // Find the most recent mergeable entry at ~the same spot.
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (!MERGEABLE.has(e.kind)) continue;
      if (incoming.bornAt - e.bornAt > groupMs) break; // entries are append-ordered → older beyond here
      const d = Math.hypot(incoming.x - e.x, incoming.z - e.z);
      if (d <= radius) {
        const cur = asNumber(e.value) ?? 0;
        const merged: DmgEntry = {
          ...e,
          value: String(Math.round((cur + incNum) * 10) / 10),
          kind: escalateKind(e.kind, incoming.kind),
          bornAt: incoming.bornAt, // reset lifetime so the tally stays up while it climbs
          count: e.count + 1,
          y: incoming.y, // ride the latest hit's height
        };
        const next = entries.slice();
        next[i] = merged;
        return next;
      }
    }
  }
  return [...entries, { ...incoming, count: 1 }].slice(-max);
}

/** Display text for an entry (adds ×N when it tallied more than one hit). */
export function dmgLabel(e: DmgEntry): string {
  return e.count > 1 ? `${e.value} ×${e.count}` : e.value;
}
