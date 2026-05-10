/**
 * Reflex layer — Sprint D / T4
 *
 * Sensors monitor the entity's physical state and inject pose-broker
 * overrides at top priority for short windows when something
 * physically demands a reaction:
 *
 *   - falling          → arms shoot out to brace
 *   - incoming-hit     → torso curls / shoulders raise
 *   - slip             → step-recovery (predictive foot placement)
 *   - grab-rail        → reach toward proximity wall/rail during fall
 *   - heavy-stagger    → spine yaws away from impact
 *
 * Activation > 60% pose-budget for >250ms triggers ragdoll mid-action
 * via the T5 entry point.
 */

import * as THREE from 'three';
import type { PoseBroker, BodyPart } from './pose-broker';

export type ReflexKind = 'brace' | 'wince' | 'step_recovery' | 'grab_rail' | 'stagger_yaw';

export interface ReflexSensorState {
  /** Centre of mass world position. */
  com: THREE.Vector3;
  /** Support polygon centre (foot-plant centre). */
  supportCentre: THREE.Vector3;
  /** Support polygon radius. */
  supportRadius: number;
  /** Last incoming-hit event (null if no hit pending). */
  incomingHit: { direction: THREE.Vector3; magnitude: number; timestamp: number } | null;
  /** Slip detection — foot didn't reach last IK target this frame. */
  slipDetected: boolean;
  /** True while the player is airborne / falling. */
  falling: boolean;
  /** Heavy stagger threshold (Sprint A combat:rocked event magnitude). */
  rockedMagnitude: number;
}

export interface ActiveReflex {
  kind:        ReflexKind;
  startedAt:   number;          // performance.now() ms
  durationMs:  number;
  intensity:   number;          // 0..1
  /** Body parts this reflex claims (with weights). */
  claimedParts: Map<BodyPart, number>;
}

export interface ReflexLayerOptions {
  /** Threshold above which ragdoll activates. Default 0.6 = 60% pose budget. */
  ragdollThreshold?: number;
  /** Minimum duration the threshold must be exceeded. Default 250ms. */
  ragdollHoldMs?: number;
}

export class ReflexLayer {
  private active: ActiveReflex[] = [];
  private overflowSince: number | null = null;
  private opts: Required<ReflexLayerOptions>;

  constructor(opts: ReflexLayerOptions = {}) {
    this.opts = {
      ragdollThreshold: opts.ragdollThreshold ?? 0.6,
      ragdollHoldMs:    opts.ragdollHoldMs ?? 250,
    };
  }

  /**
   * Update reflexes from sensor state. Called once per tick BEFORE the
   * pose broker resolves.
   */
  update(state: ReflexSensorState, now: number = performance.now()): void {
    // Garbage-collect expired reflexes.
    this.active = this.active.filter(r => (now - r.startedAt) < r.durationMs);

    // Falling → brace + grab-rail.
    if (state.falling) {
      this.maybeAdd('brace',     360, 0.85, now, ['left_arm', 'right_arm', 'torso']);
      this.maybeAdd('grab_rail', 280, 0.5,  now, ['left_arm', 'right_arm']);
    }

    // Incoming hit → wince.
    if (state.incomingHit && (now - state.incomingHit.timestamp) < 180) {
      const intensity = Math.min(1, state.incomingHit.magnitude / 60);
      this.maybeAdd('wince', 220, intensity, now, ['torso', 'spine', 'head']);
    }

    // Slip → step-recovery.
    if (state.slipDetected) {
      this.maybeAdd('step_recovery', 320, 0.7, now, ['hips', 'left_leg', 'right_leg']);
    }

    // CoM out of support polygon → step-recovery + stagger_yaw.
    const dx = state.com.x - state.supportCentre.x;
    const dz = state.com.z - state.supportCentre.z;
    const drift = Math.sqrt(dx * dx + dz * dz);
    if (drift > state.supportRadius * 1.05) {
      this.maybeAdd('step_recovery', 350, 0.9, now, ['hips', 'left_leg', 'right_leg']);
    }

    // Rocked → stagger_yaw.
    if (state.rockedMagnitude > 30) {
      const intensity = Math.min(1, state.rockedMagnitude / 100);
      this.maybeAdd('stagger_yaw', 400, intensity, now, ['spine', 'torso', 'hips']);
    }
  }

  /** Compose pose contributions into the broker for currently-active reflexes. */
  contribute(broker: PoseBroker, now: number = performance.now()): void {
    for (const r of this.active) {
      const t = (now - r.startedAt) / r.durationMs;     // 0..1 progress
      const envelope = Math.sin(t * Math.PI);            // peak at midpoint
      const w = r.intensity * envelope;
      if (w <= 0.01) continue;

      const targets = REFLEX_POSE_TARGETS[r.kind];
      for (const [part, weight] of r.claimedParts) {
        const euler = targets.get(part);
        if (!euler) continue;
        broker.contribute('reflex', part, euler, weight * w);
      }
    }
  }

  /**
   * Returns true if the reflex pose budget exceeds threshold for longer
   * than the hold duration — caller (Sprint D / T5) activates ragdoll.
   */
  shouldActivateRagdoll(now: number = performance.now()): boolean {
    const totalIntensity = this.active.reduce((sum, r) => {
      const t = (now - r.startedAt) / r.durationMs;
      const envelope = Math.sin(t * Math.PI);
      return sum + r.intensity * envelope;
    }, 0);
    if (totalIntensity > this.opts.ragdollThreshold) {
      if (this.overflowSince == null) this.overflowSince = now;
      return (now - this.overflowSince) > this.opts.ragdollHoldMs;
    }
    this.overflowSince = null;
    return false;
  }

  /** Inspector for tests/debug. */
  inspect(): ActiveReflex[] {
    return this.active.slice();
  }

  /** Reset state (e.g. on respawn). */
  clear(): void {
    this.active = [];
    this.overflowSince = null;
  }

  private maybeAdd(kind: ReflexKind, durationMs: number, intensity: number, now: number, parts: BodyPart[]): void {
    // De-dupe within-window of same kind.
    if (this.active.some(r => r.kind === kind && (now - r.startedAt) < 80)) return;
    const claimedParts = new Map<BodyPart, number>();
    for (const p of parts) claimedParts.set(p, 1.0);
    this.active.push({ kind, startedAt: now, durationMs, intensity, claimedParts });
  }
}

/**
 * Pose targets per reflex kind. Each is a Map<BodyPart, Euler> giving
 * the rotation each part snaps toward. Caller blends with envelope +
 * intensity.
 */
const REFLEX_POSE_TARGETS: Record<ReflexKind, Map<BodyPart, THREE.Euler>> = (() => {
  const m: Record<ReflexKind, Map<BodyPart, THREE.Euler>> = {
    brace: new Map([
      ['left_arm',  new THREE.Euler(-0.4, -0.3, -0.6)],
      ['right_arm', new THREE.Euler(-0.4,  0.3,  0.6)],
      ['torso',     new THREE.Euler(-0.15, 0, 0)],
    ]),
    wince: new Map([
      ['torso', new THREE.Euler(0.25, 0, 0)],
      ['spine', new THREE.Euler(0.18, 0, 0)],
      ['head',  new THREE.Euler(-0.10, 0, 0)],
    ]),
    step_recovery: new Map([
      ['hips',     new THREE.Euler(0, 0, 0.05)],
      ['left_leg', new THREE.Euler(-0.4, 0, 0.1)],
      ['right_leg', new THREE.Euler(0.2, 0, -0.1)],
    ]),
    grab_rail: new Map([
      ['left_arm',  new THREE.Euler(-0.7, -0.3, -0.4)],
      ['right_arm', new THREE.Euler(-0.7,  0.3,  0.4)],
    ]),
    stagger_yaw: new Map([
      ['spine', new THREE.Euler(0, 0.20, 0)],
      ['torso', new THREE.Euler(0.05, 0.15, 0.10)],
      ['hips',  new THREE.Euler(0, 0, 0.08)],
    ]),
  };
  return m;
})();

export const REFLEX_CONSTANTS = Object.freeze({
  REFLEX_POSE_TARGETS,
});
