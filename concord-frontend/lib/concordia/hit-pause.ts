// concord-frontend/lib/concordia/hit-pause.ts
//
// POLISH_AUDIT T2.7 — single hit-pause authority + dedup.
//
// Two systems dispatch `concordia:hit-pause` for the SAME strike:
//   - GameJuice (legacy damage-heuristic; also the only path for PvP socket
//     hits, which emit combat:hit but no combat:impact), and
//   - CombatBridges (server-authoritative impact-feel, T1.4b, on combat:impact).
// For an NPC hit both fire, so the target's mixer froze twice ("double
// hitstop"). This helper is the single chokepoint both now call: it dispatches
// at most ONE hit-pause per entity per DEDUP_WINDOW_MS (first-wins), so one
// strike = one freeze, while the PvP-only path still works (nothing else fired
// in-window, so it dispatches normally).

export const HIT_PAUSE_DEDUP_WINDOW_MS = 120;

const _lastByEntity = new Map<string, number>();

function _now(): number {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

/**
 * Request a hit-pause for an entity. Dispatches `concordia:hit-pause` only if no
 * hit-pause was already dispatched for this entity within the dedup window.
 * Returns true if it dispatched, false if it was suppressed as a duplicate.
 */
export function requestHitPause(entityId: string | undefined, durationMs: number, opts: { now?: number } = {}): boolean {
  if (!entityId || !(durationMs > 0)) return false;
  const now = opts.now ?? _now();
  const prev = _lastByEntity.get(entityId);
  if (prev != null && now - prev < HIT_PAUSE_DEDUP_WINDOW_MS) {
    return false; // a hit-pause for this entity already fired this strike
  }
  _lastByEntity.set(entityId, now);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('concordia:hit-pause', { detail: { entityId, durationMs } }));
  }
  return true;
}

/** Test/▶ reset hook. */
export function _resetHitPause(): void { _lastByEntity.clear(); }
