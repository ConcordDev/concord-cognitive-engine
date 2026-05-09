// concord-frontend/lib/concordia/mounts/mount-state-machine.ts
//
// Mounted state machine for Concordia (B2 → extends in B4).
//
// States: unmounted → mounting → mounted_idle ↔ mounted_walk ↔ mounted_trot
//         ↔ mounted_gallop, mounted_idle ↔ mounted_combat (B4),
//         any mounted_* → dismounting → unmounted.
//
// Invariants:
//   - You cannot skip ranks downward in a single transition. Going from
//     `mounted_gallop` to `mounted_idle` MUST go gallop → trot → walk → idle.
//     This is what makes the gait blend feel grounded; instant snap-to-idle
//     is the giveaway that the animation isn't physics-aware.
//   - You can always escape to dismounting from any mounted_* state.
//   - mounted_combat enters from idle/walk only (B4).
//
// The transition matrix below encodes those rules. `canTransition` is the
// only public answer to "can I switch state right now?"; the consumer
// owns the speed-thresholding logic that PROPOSES a transition.

import type { MountedState } from "./mount-types";

type TransitionMap = Record<MountedState, ReadonlySet<MountedState>>;

export const MOUNT_TRANSITIONS: TransitionMap = {
  unmounted:        new Set<MountedState>(["mounting"]),
  mounting:         new Set<MountedState>(["mounted_idle", "unmounted"]),
  mounted_idle:     new Set<MountedState>(["mounted_walk", "mounted_combat", "dismounting"]),
  mounted_walk:     new Set<MountedState>(["mounted_idle", "mounted_trot", "dismounting"]),
  mounted_trot:     new Set<MountedState>(["mounted_walk", "mounted_gallop", "dismounting"]),
  mounted_gallop:   new Set<MountedState>(["mounted_trot", "dismounting"]),
  mounted_combat:   new Set<MountedState>(["mounted_idle", "mounted_walk", "dismounting"]),
  dismounting:      new Set<MountedState>(["unmounted"]),
};

export function canTransition(from: MountedState, to: MountedState): boolean {
  if (from === to) return true;
  const allowed = MOUNT_TRANSITIONS[from];
  return !!allowed && allowed.has(to);
}

/**
 * Speed-driven gait selector. Given the current mount speed (m/s) and
 * whether the rider is in combat, returns the desired mounted state. The
 * caller still has to verify the proposed state is reachable from the
 * current one via canTransition() — if not, advance one step at a time.
 *
 * Thresholds are tuned around the warhorse profile (8.5 m/s base) and
 * scale by speciesBaseSpeed so a chimera (6 m/s) gallops at a lower
 * absolute speed than a hippogriff (11 m/s).
 */
export function gaitForSpeed(
  speedMps: number,
  speciesBaseSpeedMps: number,
  inCombat: boolean,
): MountedState {
  if (inCombat) return "mounted_combat";
  const r = speedMps / Math.max(0.1, speciesBaseSpeedMps);
  if (speedMps < 0.1) return "mounted_idle";
  if (r < 0.30) return "mounted_walk";
  if (r < 0.55) return "mounted_walk";
  if (r < 0.85) return "mounted_trot";
  return "mounted_gallop";
}

/**
 * Step the state machine one transition closer to the target. Returns
 * the next state to enter, or the current state if already at target or
 * if no legal step exists. Caller invokes this every frame until
 * `current === target`.
 */
export function stepTowards(current: MountedState, target: MountedState): MountedState {
  if (current === target) return current;
  // Direct transition allowed → take it.
  if (canTransition(current, target)) return target;
  // Otherwise compute one-step path through the gait ladder.
  const order: MountedState[] = ["mounted_idle", "mounted_walk", "mounted_trot", "mounted_gallop"];
  const ci = order.indexOf(current);
  const ti = order.indexOf(target);
  if (ci !== -1 && ti !== -1) {
    const next = ci < ti ? order[ci + 1] : order[ci - 1];
    if (next && canTransition(current, next)) return next;
  }
  // mounted_combat → idle goes via the legal idle bridge.
  if (current === "mounted_combat" && target !== "mounted_combat") {
    return "mounted_idle";
  }
  // mounting/dismounting are one-step states; the caller drives them.
  return current;
}

/** Whether a state represents "in the saddle". */
export function isMounted(s: MountedState): boolean {
  return s.startsWith("mounted_");
}
