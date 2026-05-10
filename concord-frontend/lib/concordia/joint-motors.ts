/**
 * Joint motors — Sprint D / T2
 *
 * PD-controller-driven motor system layered on top of the pose broker.
 * Motors track a target rotation per joint with stiffness (P-gain) and
 * damping (D-gain), giving physically-grounded animation: the limb
 * accelerates toward target, decelerates as it approaches, and shows
 * follow-through if the target moves quickly.
 *
 * Per-frame integration:
 *   torque   = stiffness * (target - current) - damping * velocity
 *   velocity += torque * dt
 *   current  += velocity * dt
 *
 * StiffnessModulator is the global state that biases motor params:
 *   relaxed   — low stiffness, high damping (slow, soft)
 *   focused   — moderate stiffness + damping (precise)
 *   explosive — high stiffness, moderate damping (snap)
 *   hurt      — low stiffness, low damping (twitchy, weak)
 *   exhausted — moderate stiffness, very high damping (sluggish)
 *
 * The modulator is read from each joint's category (`combat | locomotion
 * | postural`) so combat strikes can be explosive while breathing stays
 * relaxed.
 */

import * as THREE from 'three';
import type { BodyPart } from './pose-broker';

export type StiffnessMode = 'relaxed' | 'focused' | 'explosive' | 'hurt' | 'exhausted';

export type JointCategory = 'combat' | 'locomotion' | 'postural';

export interface MotorParams {
  stiffness: number;   // P-gain
  damping:   number;   // D-gain
}

const STIFFNESS_TABLE: Record<StiffnessMode, MotorParams> = {
  relaxed:   { stiffness: 30,  damping: 12 },
  focused:   { stiffness: 80,  damping: 18 },
  explosive: { stiffness: 220, damping: 14 },
  hurt:      { stiffness: 35,  damping: 6  },
  exhausted: { stiffness: 60,  damping: 28 },
};

const CATEGORY_MULTIPLIER: Record<JointCategory, { stiffness: number; damping: number }> = {
  combat:     { stiffness: 1.0, damping: 1.0 },
  locomotion: { stiffness: 0.7, damping: 1.2 },   // legs/hips need more damping
  postural:   { stiffness: 0.4, damping: 1.5 },   // spine sway, never twitchy
};

interface MotorState {
  current:  THREE.Euler;
  velocity: THREE.Vector3;     // angular velocity per axis
  target:   THREE.Euler;
  category: JointCategory;
}

export interface JointMotorOptions {
  /** Default mode if motor is created without explicit per-call mode. */
  initialMode?: StiffnessMode;
}

export class JointMotorSystem {
  private motors = new Map<BodyPart, MotorState>();
  private mode: StiffnessMode;

  constructor(opts?: JointMotorOptions) {
    this.mode = opts?.initialMode ?? 'focused';
  }

  /** Set the global stiffness mode (read by every motor next frame). */
  setMode(mode: StiffnessMode): void {
    this.mode = mode;
  }
  getMode(): StiffnessMode { return this.mode; }

  /**
   * Register a joint motor for a body part. category controls the
   * stiffness/damping multiplier from the global mode.
   */
  registerJoint(part: BodyPart, category: JointCategory, initialRotation = new THREE.Euler(0, 0, 0)): void {
    if (this.motors.has(part)) return;
    this.motors.set(part, {
      current:  initialRotation.clone(),
      velocity: new THREE.Vector3(0, 0, 0),
      target:   initialRotation.clone(),
      category,
    });
  }

  /** Set the motor's target rotation. Caller updates per-frame from pose broker. */
  setTarget(part: BodyPart, target: THREE.Euler): void {
    const m = this.motors.get(part);
    if (!m) return;
    m.target.copy(target);
  }

  /** Set instantaneous current rotation + zero velocity (e.g. on respawn). */
  reset(part: BodyPart, rotation: THREE.Euler): void {
    const m = this.motors.get(part);
    if (!m) return;
    m.current.copy(rotation);
    m.velocity.set(0, 0, 0);
    m.target.copy(rotation);
  }

  /** Step every motor forward by dt seconds. */
  step(dt: number): void {
    if (dt <= 0) return;
    // Clamp dt to avoid integration explosion on slow frames.
    const stepDt = Math.min(dt, 0.05);

    const baseParams = STIFFNESS_TABLE[this.mode];
    for (const m of this.motors.values()) {
      const cat = CATEGORY_MULTIPLIER[m.category];
      const k = baseParams.stiffness * cat.stiffness;
      const c = baseParams.damping * cat.damping;

      // Per-axis PD integration.
      for (const axis of ['x', 'y', 'z'] as const) {
        const error = m.target[axis] - m.current[axis];
        const torque = k * error - c * m.velocity[axis];
        m.velocity[axis] += torque * stepDt;
        m.current[axis] += m.velocity[axis] * stepDt;
      }
    }
  }

  /** Read out the motor's current rotation for a part. */
  read(part: BodyPart): THREE.Euler | null {
    const m = this.motors.get(part);
    return m ? m.current.clone() : null;
  }

  /** Apply current motor rotations to a bone map. */
  apply(boneMap: Map<BodyPart, THREE.Bone>): void {
    for (const [part, m] of this.motors.entries()) {
      const bone = boneMap.get(part);
      if (!bone) continue;
      bone.rotation.copy(m.current);
    }
  }

  /** Inspector for tests/debug. */
  inspect(part: BodyPart): MotorState | null {
    const m = this.motors.get(part);
    if (!m) return null;
    return {
      current:  m.current.clone(),
      velocity: m.velocity.clone(),
      target:   m.target.clone(),
      category: m.category,
    };
  }
}

export const MOTOR_CONSTANTS = Object.freeze({
  STIFFNESS_TABLE,
  CATEGORY_MULTIPLIER,
});
