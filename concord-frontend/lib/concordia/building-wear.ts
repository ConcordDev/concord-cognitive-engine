// concord-frontend/lib/concordia/building-wear.ts
//
// Track 3 (legibility) — persistent diegetic building wear. The world already
// fires `concordia:building-state` transitions and BuildingCollapseVFX plays
// the TRANSIENT crack-puff / collapse burst — but the building then snaps back
// to looking pristine. This is the persistent half: a scar map keyed by
// buildingId that KEEPS a damaged/collapsed mark until the building is repaired
// (toState='standing'), so a world that took fire *stays* scarred. Pure + total
// reducer; the React layer just projects the marks the reducer holds.

export type WearLevel = 'damaged' | 'collapsed';

export interface WearMark {
  buildingId: string;
  x: number; y: number; z: number;
  level: WearLevel;
}

export interface BuildingStateEvent {
  buildingId?: string;
  fromState?: 'standing' | 'damaged' | 'collapsed';
  toState?: 'standing' | 'damaged' | 'collapsed';
  position?: { x?: number; y?: number; z?: number };
  worldId?: string;
}

/**
 * Fold a building-state transition into the persistent wear map. PURE — returns
 * a new Map.
 *   → 'standing'  : the building was repaired, drop its scar.
 *   → 'damaged'   : record/keep a crack scar (does NOT downgrade an existing
 *                   'collapsed' — collapse is the terminal, heavier mark).
 *   → 'collapsed' : record/upgrade to a rubble-char scar.
 * Events with no usable id are ignored.
 */
export function applyWearEvent(marks: Map<string, WearMark>, ev: BuildingStateEvent): Map<string, WearMark> {
  const id = ev?.buildingId;
  const to = ev?.toState;
  if (!id || !to) return marks;
  const next = new Map(marks);
  if (to === 'standing') {
    next.delete(id);
    return next;
  }
  if (to === 'damaged') {
    const existing = next.get(id);
    if (existing && existing.level === 'collapsed') return next; // don't downgrade
  }
  const p = ev.position ?? {};
  next.set(id, {
    buildingId: id,
    x: Number(p.x ?? marks.get(id)?.x ?? 0),
    y: Number(p.y ?? marks.get(id)?.y ?? 0),
    z: Number(p.z ?? marks.get(id)?.z ?? 0),
    level: to,
  });
  return next;
}

export interface WearStyle {
  /** CSS colour for the scar mark. */
  color: string;
  /** Base footprint radius in px at unit depth (scaled by projection). */
  radius: number;
  /** Number of crack streaks to draw. */
  streaks: number;
}

/** Presentation attributes for a wear level. Pure. */
export function wearStyle(level: WearLevel): WearStyle {
  if (level === 'collapsed') {
    return { color: 'rgba(40,34,30,0.72)', radius: 26, streaks: 7 };  // char/rubble, heavy
  }
  return { color: 'rgba(60,52,44,0.5)', radius: 16, streaks: 4 };      // cracks, light
}
