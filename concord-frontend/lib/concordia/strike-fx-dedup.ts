// concord-frontend/lib/concordia/strike-fx-dedup.ts
//
// POLISH_AUDIT T2.7 (completion) — per-entity, first-wins dedup for the two
// strike effects hit-pause.ts didn't cover: KNOCKBACK and HIT-REACTION.
//
// For a PvP hit the server emits BOTH `combat:hit` (consumed by
// ImpactMomentumBridge — the live client momentum model) AND `combat:impact`
// (consumed by CombatImpactFeelBridge — the server-authoritative feel). Without a
// shared dedup each effect fired TWICE for the same strike: a double shove
// (knockback) and a double wince (hit-reaction). hit-pause.ts already solved the
// double-FREEZE; this is the same 120ms first-wins window for the other two, so
// one strike = one of each effect per entity. Single-source hits are unaffected
// (NPC HTTP emits only combat:impact; nothing else fires in-window).

export const STRIKE_FX_DEDUP_WINDOW_MS = 120;

const _lastKnockback = new Map<string, number>();
const _lastHitReaction = new Map<string, number>();

function _now(): number {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function _withinWindow(map: Map<string, number>, key: string, now: number): boolean {
  const prev = map.get(key);
  if (prev != null && now - prev < STRIKE_FX_DEDUP_WINDOW_MS) return true; // duplicate this strike
  map.set(key, now);
  return false;
}

export interface KnockbackDetail {
  entityId: string;
  direction: { x: number; z: number };
  magnitude: number;
  durationMs?: number;
}

/**
 * Dispatch `concordia:knockback` at most once per entity per dedup window
 * (first-wins). Returns true if it dispatched, false if suppressed as a duplicate.
 */
export function requestKnockback(detail: KnockbackDetail, opts: { now?: number } = {}): boolean {
  if (!detail?.entityId || !(detail.magnitude > 0)) return false;
  if (_withinWindow(_lastKnockback, detail.entityId, opts.now ?? _now())) return false;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('concordia:knockback', { detail }));
  }
  return true;
}

export interface HitReactionDetail {
  targetId: string;
  severity: 'light' | 'heavy' | 'crit';
  reflexIntensity?: number;
}

/**
 * Dispatch `concordia:hit-reaction` at most once per target per dedup window
 * (first-wins). Returns true if it dispatched, false if suppressed as a duplicate.
 */
export function requestHitReaction(detail: HitReactionDetail, opts: { now?: number } = {}): boolean {
  if (!detail?.targetId) return false;
  if (_withinWindow(_lastHitReaction, detail.targetId, opts.now ?? _now())) return false;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('concordia:hit-reaction', { detail }));
  }
  return true;
}

/** Test/▶ reset hook. */
export function _resetStrikeFx(): void {
  _lastKnockback.clear();
  _lastHitReaction.clear();
}
