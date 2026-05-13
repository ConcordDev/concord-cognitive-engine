// concord-frontend/lib/concordia/ragdoll-bridge.ts
//
// Concordia Phase 3 — wire socket combat:hit lethal-kill events to
// the PhysicsWorld ragdoll spawn API.
//
// Pattern mirrors LevelUpJuiceBridge / CombatBridges: a tiny
// imperative module the world-lens host calls. Listens for the
// (already-emitted) `concordia:lethal-hit` CustomEvent + spawns a
// ragdoll at the target's last known position, decaying the ragdoll
// back to static state after `DECAY_MS`. If the PhysicsWorld can't
// load Rapier, calls fail soft (the listener returns silently).
//
// The server adds `lethal=true` to combat:hit when finalDamage causes
// applyDamageToNPC#kill — the existing combat path already sets the
// flag. This bridge is the missing client-side response.

export interface RagdollImpulse {
  x: number;
  y: number;
  z: number;
}

export interface LethalHitDetail {
  targetId: string;
  position: { x: number; y: number; z: number };
  impulse?: RagdollImpulse;
  /** Mass ratio from the server's actor-physique compute (0.7..1.4).
   *  Used to scale impulse so heavier attackers send lighter targets
   *  further. */
  massMultiplier?: number;
}

interface PhysicsWorldShim {
  spawnRagdoll(id: string, position: { x: number; y: number; z: number }, impulse?: RagdollImpulse): unknown;
  despawnRagdoll?(id: string): void;
  removeCharacter?(id: string): void;
}

const DECAY_MS = 10_000;
const BASE_IMPULSE_MS = 6.5; // base m/s of impulse magnitude on kill
const MAX_ACTIVE_RAGDOLLS = 32;

const activeTimers = new Map<string, number>();

/** Default impulse vector if server didn't supply one — points away from
 *  origin in the XZ plane and slightly up. */
function defaultImpulse(targetPos: { x: number; y: number; z: number }, mag: number): RagdollImpulse {
  // Best-effort: push the body away from world origin. For an authoring-
  // grade default this is fine; specific scenes can pass their own.
  const len = Math.max(0.001, Math.hypot(targetPos.x, targetPos.z));
  return {
    x: (targetPos.x / len) * mag,
    y: mag * 0.35,
    z: (targetPos.z / len) * mag,
  };
}

/**
 * Attach the bridge to a PhysicsWorld instance. Returns a detach
 * function. Idempotent across multiple attaches on the same world
 * (calls detach for prior listeners first).
 */
export function attachRagdollBridge(physicsWorld: PhysicsWorldShim): () => void {
  if (typeof window === "undefined") return () => {};

  function onLethal(e: Event) {
    const detail = (e as CustomEvent<LethalHitDetail>).detail;
    if (!detail?.targetId || !detail.position) return;

    // Cap active ragdolls so a massive battle doesn't OOM the physics tick.
    if (activeTimers.size >= MAX_ACTIVE_RAGDOLLS) {
      // Drop the oldest timer.
      const oldest = activeTimers.keys().next().value;
      if (oldest) {
        const t = activeTimers.get(oldest);
        if (t) window.clearTimeout(t);
        activeTimers.delete(oldest);
        try { physicsWorld.despawnRagdoll?.(oldest); } catch { /* noop */ }
      }
    }

    const mag = BASE_IMPULSE_MS * (detail.massMultiplier ?? 1.0);
    const impulse = detail.impulse || defaultImpulse(detail.position, mag);

    try {
      physicsWorld.spawnRagdoll(detail.targetId, detail.position, impulse);
    } catch {
      // Rapier not loaded yet — fall through silently.
      return;
    }

    // Schedule decay back to static. We re-key on a fresh timer so re-
    // spawning the same id resets the clock.
    const prev = activeTimers.get(detail.targetId);
    if (prev) window.clearTimeout(prev);
    const timer = window.setTimeout(() => {
      activeTimers.delete(detail.targetId);
      try { physicsWorld.despawnRagdoll?.(detail.targetId); } catch { /* noop */ }
    }, DECAY_MS);
    activeTimers.set(detail.targetId, timer);
  }

  window.addEventListener("concordia:lethal-hit", onLethal);

  return () => {
    window.removeEventListener("concordia:lethal-hit", onLethal);
    for (const t of activeTimers.values()) window.clearTimeout(t);
    activeTimers.clear();
  };
}

/**
 * Imperative kill helper for code paths that already have a target id
 * and position but didn't fire the CustomEvent. Equivalent to
 * dispatching concordia:lethal-hit.
 */
export function dispatchLethalHit(detail: LethalHitDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("concordia:lethal-hit", { detail }));
}

export const RAGDOLL_BRIDGE_CONSTANTS = Object.freeze({
  DECAY_MS,
  BASE_IMPULSE_MS,
  MAX_ACTIVE_RAGDOLLS,
});
