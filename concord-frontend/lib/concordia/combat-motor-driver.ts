/**
 * Combat motor driver — Sprint D / U1+U2+U3
 *
 * Replaces the keyframe path in combat-clips.ts with motor-target
 * sequences fed through the pose broker. Reuses combat-biomechanics.ts
 * 7-phase punch/kick/grapple output (rest → anticipation → drive →
 * impact → peak → follow-through → settle), but instead of baking to
 * THREE.AnimationClip we drive PD motors via JointMotorSystem.
 *
 *   - Anticipation = low stiffness slow target (body coils)
 *   - Strike       = stiffness ramp + fast target (limb fires)
 *   - Follow-thru  = residual angular momentum until next phase pulls
 *
 * Style parameter sets (T6) modulate the per-phase stiffness mode.
 *
 * U2 — impact resolution: strike velocity × bone mass at contact =
 * momentum delta. Apply via reflex-layer (T4) as wince/stagger on
 * recipient.
 *
 * U3 — combos as physics state machines: each strike leaves the body in
 * a position; nextMoveMatrix(currentPose, currentMomentum) returns the
 * viable-move set for the AI / player input.
 */

import * as THREE from 'three';
import type { PoseBroker, BodyPart } from './pose-broker';
import type { JointMotorSystem } from './joint-motors';
import type { FightingStyle } from './style-sets';

export type CombatAction = 'attack-light' | 'attack-heavy' | 'kick' | 'grapple' | 'block' | 'parry' | 'dodge-back' | 'dodge-left' | 'dodge-right';

export type CombatPhase = 'rest' | 'anticipation' | 'drive' | 'impact' | 'peak' | 'follow_through' | 'settle';

const PHASE_DURATION_MS: Record<CombatPhase, number> = {
  rest:           0,
  anticipation: 140,
  drive:         90,
  impact:        40,
  peak:          70,
  follow_through:160,
  settle:        140,
};

export interface CombatExecution {
  action:           CombatAction;
  style:            FightingStyle;
  startedAt:        number;
  totalDurationMs:  number;
  /** Per-phase pose targets (Map<BodyPart, Euler>) keyed by phase. */
  phaseTargets:     Record<CombatPhase, Map<BodyPart, THREE.Euler>>;
  /** Computed bone-mass × velocity at impact (filled by U2). */
  impactMomentum?:  number;
}

/**
 * Build a combat execution from the existing combat-biomechanics output.
 * The biomechanics module is already shipped — caller passes the pose
 * arrays already produced by `generatePunchPoses`, `generateKickPoses`,
 * `generateGrapplePoses` and we map them onto our 7-phase taxonomy.
 *
 * For block/parry/dodge actions we fall back to combat-clips.ts (which
 * stays the baseline keyframe library — these are hold/stationary moves).
 */
export function buildCombatExecution(
  action: CombatAction,
  style: FightingStyle,
  biomechanicsPoses: Array<{ phase: CombatPhase; targets: Map<BodyPart, THREE.Euler> }>,
  now: number = performance.now(),
): CombatExecution {
  const phaseTargets: Record<CombatPhase, Map<BodyPart, THREE.Euler>> = {
    rest:           new Map(),
    anticipation:   new Map(),
    drive:          new Map(),
    impact:         new Map(),
    peak:           new Map(),
    follow_through: new Map(),
    settle:         new Map(),
  };
  for (const p of biomechanicsPoses) {
    phaseTargets[p.phase] = p.targets;
  }
  const totalDurationMs =
    PHASE_DURATION_MS.anticipation +
    PHASE_DURATION_MS.drive +
    PHASE_DURATION_MS.impact +
    PHASE_DURATION_MS.peak +
    PHASE_DURATION_MS.follow_through +
    PHASE_DURATION_MS.settle;

  return {
    action,
    style,
    startedAt: now,
    totalDurationMs,
    phaseTargets,
  };
}

/**
 * Per-frame driver: given an active execution + elapsed time, contribute
 * pose targets to the broker AND set motor stiffness mode according to
 * the style's phase curve.
 */
export function tickCombatExecution(
  exec: CombatExecution,
  broker: PoseBroker,
  motors: JointMotorSystem,
  now: number = performance.now(),
): { phase: CombatPhase; t: number; complete: boolean } {
  const elapsed = now - exec.startedAt;
  if (elapsed >= exec.totalDurationMs) {
    return { phase: 'settle', t: 1, complete: true };
  }

  const { phase, t } = phaseAtElapsed(elapsed);
  const stiffness = exec.style.stiffnessCurve[phase];
  motors.setMode(stiffness);

  // Ease the current phase toward its targets via the broker.
  const currentTargets = exec.phaseTargets[phase];
  for (const [part, euler] of currentTargets) {
    broker.contribute('combat', part, euler, 1.0);
  }

  return { phase, t, complete: false };
}

function phaseAtElapsed(elapsed: number): { phase: CombatPhase; t: number } {
  let acc = 0;
  for (const phase of ['anticipation', 'drive', 'impact', 'peak', 'follow_through', 'settle'] as CombatPhase[]) {
    const dur = PHASE_DURATION_MS[phase];
    if (elapsed < acc + dur) {
      return { phase, t: (elapsed - acc) / dur };
    }
    acc += dur;
  }
  return { phase: 'settle', t: 1 };
}

/**
 * U2 — Impact momentum resolution. Caller supplies the striking-bone
 * Dempster mass ratio and current angular velocity at impact frame.
 * Returns the magnitude of momentum-delta applied to the recipient
 * (used by reflex-layer to pick wince intensity).
 */
export function computeImpactMomentum(
  boneMass: number,           // in kg-equivalent (Dempster ratio × actor mass)
  angularVelocity: number,    // radians/sec at impact
  leverArmM: number,          // metres from joint pivot to impact point
): number {
  // Linear contact velocity = angular × lever; momentum = m × v.
  const contactVelocity = angularVelocity * leverArmM;
  return boneMass * contactVelocity;
}

/**
 * U3 — Combos as physics state machines.
 *
 * Each strike leaves the body in a "post-strike" position with residual
 * momentum. The viable next move depends on:
 *   - which limb was committed (lead/rear hand, lead/rear leg)
 *   - hip rotation direction
 *   - balance state
 *
 * Returns the array of CombatActions that physically follow well from
 * the previous action.
 */
export function nextViableMoves(prev: CombatAction | null, style: FightingStyle): CombatAction[] {
  if (!prev) return ['attack-light', 'attack-heavy', 'kick', 'block', 'parry'];

  // Style-specific common-combo lookup is the first hint.
  const styleHints = style.commonCombos
    .filter(combo => combo[0] === prev)
    .map(combo => combo[1] as CombatAction);
  if (styleHints.length > 0) return Array.from(new Set(styleHints));

  // Fallback: physics-state heuristic.
  switch (prev) {
    case 'attack-light':
      // Lead hand committed — rear hand or lead foot is set up.
      return ['attack-heavy', 'kick', 'parry'];
    case 'attack-heavy':
      // Rear hand committed — body weight is forward — kick or recover.
      return ['kick', 'block', 'parry'];
    case 'kick':
      // Plant foot is loaded; recover stance or follow with another kick.
      return ['attack-light', 'block', 'kick'];
    case 'grapple':
      return ['attack-heavy', 'kick'];
    case 'block':
      // After block: parry or counter-attack.
      return ['parry', 'attack-light', 'attack-heavy'];
    case 'parry':
      // After parry: open window for committed strike.
      return ['attack-heavy', 'kick'];
    case 'dodge-back':
    case 'dodge-left':
    case 'dodge-right':
      // After dodge: counter-attack window.
      return ['attack-light', 'attack-heavy', 'kick'];
  }
}

export const COMBAT_MOTOR_CONSTANTS = Object.freeze({
  PHASE_DURATION_MS,
});
