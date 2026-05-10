/**
 * Ragdoll-on-imbalance — Sprint D / T5
 *
 * Layered API on top of `ragdoll.ts` (already shipped — fires on death).
 * `activateRagdollFor(handle, durationMs)` lets the reflex layer trigger
 * temporary ragdoll states (slip, knockdown, environmental fall) without
 * killing the entity, and recovers to a standing pose when the timer
 * expires.
 *
 * Recovery: after duration elapses, caller is expected to:
 *   1. Capture final ragdoll bone rotations (via getRagdollPose).
 *   2. Tween from those rotations to the standing-T-pose target via
 *      pose-broker, taking ~600ms with PD motors in `hurt` mode.
 *   3. Restore normal pose-broker priority chain.
 *
 * This module owns step (1) and emits the recovery target. Steps (2)+(3)
 * are caller-side because they touch the AvatarSystem3D tick.
 */

import type { RagdollHandle } from './ragdoll';

export type ImbalanceCause = 'slip' | 'knockdown' | 'environmental_fall' | 'cliff_fall' | 'heavy_stagger';

export interface ImbalanceActivation {
  handle:     RagdollHandle;
  cause:      ImbalanceCause;
  startedAt:  number;
  durationMs: number;
  /** True when the ragdoll has been disposed and the entity is recovering. */
  recovering: boolean;
}

const active = new Map<string, ImbalanceActivation>();

const DEFAULT_DURATIONS: Record<ImbalanceCause, number> = {
  slip:               700,
  knockdown:         1400,
  environmental_fall: 1200,
  cliff_fall:        2000,
  heavy_stagger:      900,
};

/**
 * Activate temporary ragdoll. Returns true if successfully activated;
 * false if entity already in imbalance state OR ragdoll cap reached.
 *
 * Caller passes a fresh RagdollHandle (instantiated via ragdoll.ts'
 * existing factory). Disposal is automatic when duration elapses.
 */
export function activateRagdollFor(
  entityId: string,
  handle: RagdollHandle,
  cause: ImbalanceCause,
  customDurationMs?: number,
): boolean {
  if (active.has(entityId)) return false;
  active.set(entityId, {
    handle,
    cause,
    startedAt: performance.now(),
    durationMs: customDurationMs ?? DEFAULT_DURATIONS[cause],
    recovering: false,
  });
  return true;
}

/**
 * Per-frame tick. Disposes any ragdoll whose duration has elapsed and
 * marks the entity as recovering. Caller polls `consumeRecovery()` next
 * frame to drive the standing-pose tween.
 */
export function tickImbalanceRagdolls(now: number = performance.now()): void {
  for (const act of active.values()) {
    if (act.recovering) continue;
    const elapsed = now - act.startedAt;
    if (elapsed >= act.durationMs) {
      try { act.handle.dispose(); } catch { /* dispose may be a no-op */ }
      act.recovering = true;
    } else {
      try { act.handle.tickFrame(); } catch { /* never throw */ }
    }
  }
}

/**
 * Returns + clears any entity that just transitioned to recovering.
 * Caller drives the recovery tween (step (2)+(3) above).
 */
export function consumeRecovery(): { entityId: string; cause: ImbalanceCause }[] {
  const out: { entityId: string; cause: ImbalanceCause }[] = [];
  for (const [entityId, act] of active.entries()) {
    if (act.recovering) {
      out.push({ entityId, cause: act.cause });
      active.delete(entityId);
    }
  }
  return out;
}

export function isInImbalance(entityId: string): boolean {
  return active.has(entityId);
}

export function abortImbalance(entityId: string): void {
  const act = active.get(entityId);
  if (!act) return;
  try { act.handle.dispose(); } catch { /* noop */ }
  active.delete(entityId);
}

export function clearAllImbalance(): void {
  for (const [, act] of active) {
    try { act.handle.dispose(); } catch { /* noop */ }
  }
  active.clear();
}

export const IMBALANCE_CONSTANTS = Object.freeze({ DEFAULT_DURATIONS });
