/**
 * Pose broker — Sprint D / T1
 *
 * Central source-of-truth for per-bone rotations during the AvatarSystem3D
 * tick. Sources (gait / IK / combat-motor / reflex / idle / facial) call
 * `broker.contribute(source, bonePart, target, weight)` per frame. The
 * broker resolves the final pose via priority + per-body-part weight
 * blend, then writes resolved rotations to the bone map.
 *
 * Priority (highest → lowest):
 *   reflex > combat > IK > gait > idle
 *
 * Per-body-part weights blend within a priority tier — e.g. gait may
 * own legs at 1.0 while combat drives torso at 1.0; the broker honours
 * both because they target different parts.
 *
 * Invariants:
 *   - resolve() ALWAYS returns a complete pose (no missing bones).
 *   - Sources from a higher priority override lower priority on the
 *     same body part (no blend across tiers).
 *   - clear() must be called once per tick before contribute() to reset
 *     accumulators.
 */

import * as THREE from 'three';

export type BodyPart =
  | 'head' | 'neck' | 'torso' | 'spine' | 'hips'
  | 'left_arm' | 'right_arm' | 'left_hand' | 'right_hand'
  | 'left_leg' | 'right_leg' | 'left_foot' | 'right_foot';

// 'action' (Living Society) layers a non-combat verb motion over gait but
// yields to combat/reflex — so a worker mid-swing still flinches when hit.
export type SourcePriority = 'reflex' | 'combat' | 'action' | 'ik' | 'gait' | 'idle' | 'facial';

const PRIORITY_ORDER: SourcePriority[] = ['reflex', 'combat', 'action', 'ik', 'gait', 'idle', 'facial'];

interface Contribution {
  source:   SourcePriority;
  rotation: THREE.Euler;
  weight:   number;
}

interface PartAccumulator {
  contributions: Contribution[];
}

export interface PoseBrokerOptions {
  /** When set, overrides the default priority order. */
  priorityOrder?: SourcePriority[];
}

export class PoseBroker {
  private accumulators = new Map<BodyPart, PartAccumulator>();
  private priorityOrder: SourcePriority[];

  constructor(opts?: PoseBrokerOptions) {
    this.priorityOrder = opts?.priorityOrder ?? PRIORITY_ORDER;
  }

  /** Reset all accumulators. Call once at the start of every tick. */
  clear(): void {
    this.accumulators.clear();
  }

  /**
   * Register a contribution from a source. weight in [0, 1].
   * Multiple contributions to the same bone+source merge by averaging
   * (so e.g. combat can author punch + recoil-recover and they blend).
   */
  contribute(source: SourcePriority, part: BodyPart, rotation: THREE.Euler, weight = 1.0): void {
    if (weight <= 0) return;
    let acc = this.accumulators.get(part);
    if (!acc) {
      acc = { contributions: [] };
      this.accumulators.set(part, acc);
    }
    acc.contributions.push({ source, rotation: rotation.clone(), weight });
  }

  /**
   * Resolve the final rotation per body part. For each part, pick the
   * highest-priority tier with non-zero contributions; blend within
   * that tier by weight.
   */
  resolve(): Map<BodyPart, THREE.Euler> {
    const out = new Map<BodyPart, THREE.Euler>();
    for (const [part, acc] of this.accumulators.entries()) {
      const winner = this.pickWinningTier(acc.contributions);
      if (!winner.length) continue;
      out.set(part, this.blendContributions(winner));
    }
    return out;
  }

  /**
   * Apply the resolved pose to a bone map. Caller maps body-part keys to
   * THREE.Bone instances. Missing bones in the map are silently skipped.
   */
  apply(boneMap: Map<BodyPart, THREE.Bone>): void {
    const resolved = this.resolve();
    for (const [part, euler] of resolved.entries()) {
      const bone = boneMap.get(part);
      if (!bone) continue;
      bone.rotation.copy(euler);
    }
  }

  private pickWinningTier(contributions: Contribution[]): Contribution[] {
    for (const tier of this.priorityOrder) {
      const inTier = contributions.filter(c => c.source === tier);
      if (inTier.length > 0) return inTier;
    }
    return [];
  }

  private blendContributions(contributions: Contribution[]): THREE.Euler {
    if (contributions.length === 1) return contributions[0].rotation;
    let totalWeight = 0;
    let x = 0, y = 0, z = 0;
    for (const c of contributions) {
      totalWeight += c.weight;
      x += c.rotation.x * c.weight;
      y += c.rotation.y * c.weight;
      z += c.rotation.z * c.weight;
    }
    if (totalWeight === 0) return new THREE.Euler(0, 0, 0);
    return new THREE.Euler(x / totalWeight, y / totalWeight, z / totalWeight);
  }

  /** Inspector helper for tests/debug. */
  inspectPart(part: BodyPart): Contribution[] {
    return this.accumulators.get(part)?.contributions.slice() ?? [];
  }
}

export const POSE_BROKER_CONSTANTS = Object.freeze({
  PRIORITY_ORDER,
});
